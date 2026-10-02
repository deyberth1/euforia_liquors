import { Hono } from 'hono';
import { z } from 'zod';
import { all, getClient, nowIso, one, run, withTx, type Db } from '../db.js';
import { badRequest, conflict, HttpError, notFound } from '../errors.js';
import { cop, idParam, isDate, parseBody, rangeUtc, todayLocal } from '../util.js';
import { requireAdmin, requireOwner, type Env } from '../auth.js';
import type { Order, OrderItem } from '../../shared/types.js';

const orders = new Hono<Env>();

const ORDER_SELECT = `
  SELECT o.*, t.name AS table_name, u1.full_name AS opened_by_name, u2.full_name AS closed_by_name, u3.full_name AS bill_requested_by_name
  FROM orders o
  LEFT JOIN tables t ON t.id = o.table_id
  JOIN users u1 ON u1.id = o.opened_by
  LEFT JOIN users u2 ON u2.id = o.closed_by
  LEFT JOIN users u3 ON u3.id = o.bill_requested_by`;

async function loadOrder(db: Db, id: number): Promise<Order> {
  const order = await one<Order>(db, `${ORDER_SELECT} WHERE o.id = ?`, [id]);
  if (!order) throw notFound('Cuenta no encontrada');
  order.items = await all<OrderItem>(
    db,
    `SELECT i.*, u.full_name AS added_by_name FROM order_items i JOIN users u ON u.id = i.added_by
     WHERE i.order_id = ? ORDER BY i.created_at, i.id`,
    [id],
  );
  return order;
}

/** Recalcula subtotal y total de una cuenta abierta a partir de sus ítems. */
async function recalc(db: Db, orderId: number) {
  await run(
    db,
    `UPDATE orders SET
       subtotal = (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM order_items WHERE order_id = ?),
       total = MAX(0, (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM order_items WHERE order_id = ?) - discount)
     WHERE id = ?`,
    [orderId, orderId, orderId],
  );
}

async function moveStock(db: Db, productId: number | null, delta: number, reason: string, orderId: number, userId: number) {
  if (!productId || delta === 0) return;
  const p = await one<{ track_stock: number }>(db, 'SELECT track_stock FROM products WHERE id = ?', [productId]);
  if (!p || Number(p.track_stock) !== 1) return;
  await run(db, 'UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?', [delta, nowIso(), productId]);
  await run(db, 'INSERT INTO stock_movements (product_id, delta, reason, order_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    productId, delta, reason, orderId, userId, nowIso(),
  ]);
}

// ---------- Listado / detalle ----------
orders.get('/orders', async (c) => {
  const user = c.get('user');
  const status = c.req.query('status') ?? 'open';
  const db = getClient();
  if (status === 'open') {
    const rows = await all<Order>(db, `${ORDER_SELECT} WHERE o.status = 'open' ORDER BY o.opened_at`);
    return c.json(rows);
  }
  if (user.role !== 'admin') throw new HttpError(403, 'Solo administradores');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const f = isDate(from) ? from : todayLocal();
  const t = isDate(to) ? to : f;
  const { start, end } = rangeUtc(f, t);
  const rows = await all<Order>(
    db,
    `${ORDER_SELECT} WHERE o.status IN ('paid','cancelled') AND o.closed_at >= ? AND o.closed_at < ? ORDER BY o.closed_at DESC LIMIT 500`,
    [start, end],
  );
  return c.json(rows);
});

orders.get('/orders/:id', async (c) => {
  const order = await loadOrder(getClient(), idParam(c));
  return c.json(order);
});

// ---------- Abrir cuenta ----------
const openSchema = z.object({
  table_id: z.number().int().positive().nullable().optional(),
  label: z.string().trim().max(60).optional(),
});

orders.post('/orders', async (c) => {
  const user = c.get('user');
  const body = await parseBody(c, openSchema);
  if (!body.table_id && !body.label) throw badRequest('Indica una mesa o un nombre para la cuenta');
  const id = await withTx(async (tx) => {
    // Regla del negocio: sin caja abierta no se abren cuentas (la venta no quedaría en ningún turno).
    const session = await one(tx, "SELECT id FROM cash_sessions WHERE status = 'open' LIMIT 1");
    if (!session) throw conflict(user.role === 'waiter' ? 'La caja está cerrada. Pide al administrador que abra la caja para empezar a atender.' : 'La caja está cerrada. Ábrela desde Caja antes de abrir cuentas.');
    if (body.table_id) {
      const table = await one<{ id: number; is_active: number }>(tx, 'SELECT id, is_active FROM tables WHERE id = ?', [body.table_id]);
      if (!table || Number(table.is_active) !== 1) throw notFound('Mesa no encontrada');
      const existing = await one<{ id: number }>(tx, "SELECT id FROM orders WHERE table_id = ? AND status = 'open'", [body.table_id]);
      if (existing) return Number(existing.id); // ya abierta: la reutilizamos
    }
    const { lastId } = await run(
      tx,
      'INSERT INTO orders (table_id, label, status, opened_by, opened_at) VALUES (?, ?, ?, ?, ?)',
      [body.table_id ?? null, body.label ?? null, 'open', user.id, nowIso()],
    );
    return lastId;
  });
  return c.json(await loadOrder(getClient(), id), 201);
});

// ---------- Ítems ----------
const addItemSchema = z.object({
  product_id: z.number().int().positive(),
  /** Cuántas unidades; en 2x1, cuántos pares (cada par son 2 botellas). */
  quantity: z.number().int().min(1).max(500).default(1),
  notes: z.string().trim().max(120).optional(),
  /** Vender en 2x1: se agregan 2 botellas por par al precio 2x1 del producto. */
  promo: z.boolean().optional(),
});

type SellableProduct = { id: number; name: string; price: number; stock: number; track_stock: number; is_active: number; promo_price: number | null };
const SELLABLE_SELECT = 'SELECT id, name, price, stock, track_stock, is_active, promo_price FROM products WHERE id = ?';

/**
 * Agrega `units` botellas de un producto a la cuenta y las descuenta del inventario.
 * En 2x1 cada botella queda a la mitad del precio 2x1, así reportes, caja e inventario cuadran solos.
 */
async function addProduct(tx: Db, orderId: number, product: SellableProduct, units: number, promo: boolean, notes: string | null, userId: number) {
  if (Number(product.track_stock) === 1 && Number(product.stock) < units) {
    throw conflict(`Solo hay ${product.stock} unidades de ${product.name}`);
  }
  const unitPrice = promo ? Number(product.promo_price) / 2 : Number(product.price);
  // Misma persona, mismo producto y precio, sin nota: sumamos cantidades en vez de duplicar líneas.
  const existing = !notes ? await one<{ id: number }>(
    tx,
    'SELECT id FROM order_items WHERE order_id = ? AND product_id = ? AND added_by = ? AND notes IS NULL AND unit_price = ? AND promo = ?',
    [orderId, product.id, userId, unitPrice, promo ? 1 : 0],
  ) : null;
  if (existing) {
    await run(tx, 'UPDATE order_items SET quantity = quantity + ? WHERE id = ?', [units, existing.id]);
  } else {
    await run(
      tx,
      'INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, notes, promo, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [orderId, product.id, product.name, unitPrice, units, notes, promo ? 1 : 0, userId, nowIso()],
    );
  }
  await moveStock(tx, product.id, -units, promo ? 'Venta 2x1' : 'Venta', orderId, userId);
}

orders.post('/orders/:id/items', async (c) => {
  const user = c.get('user');
  const orderId = idParam(c);
  const body = await parseBody(c, addItemSchema);
  await withTx(async (tx) => {
    const order = await one<{ status: string }>(tx, 'SELECT status FROM orders WHERE id = ?', [orderId]);
    if (!order) throw notFound('Cuenta no encontrada');
    if (order.status !== 'open') throw conflict('La cuenta ya está cerrada');
    const product = await one<SellableProduct>(tx, SELLABLE_SELECT, [body.product_id]);
    if (!product || Number(product.is_active) !== 1) throw notFound('Producto no disponible');
    const promo = body.promo === true;
    if (promo && !product.promo_price) throw badRequest(`${product.name} no tiene precio 2x1`);
    await addProduct(tx, orderId, product, promo ? body.quantity * 2 : body.quantity, promo, body.notes || null, user.id);
    await recalc(tx, orderId);
  });
  return c.json(await loadOrder(getClient(), orderId));
});

const qtySchema = z.object({ quantity: z.number().int().min(0).max(500) });

orders.patch('/orders/:id/items/:itemId', requireAdmin, async (c) => {
  const user = c.get('user');
  const orderId = idParam(c);
  const itemId = idParam(c, 'itemId');
  const body = await parseBody(c, qtySchema);
  await withTx(async (tx) => {
    const order = await one<{ status: string }>(tx, 'SELECT status FROM orders WHERE id = ?', [orderId]);
    if (!order) throw notFound('Cuenta no encontrada');
    if (order.status !== 'open') throw conflict('La cuenta ya está cerrada');
    const item = await one<OrderItem>(tx, 'SELECT * FROM order_items WHERE id = ? AND order_id = ?', [itemId, orderId]);
    if (!item) throw notFound('Ítem no encontrado');
    if (Number(item.promo) === 1 && body.quantity % 2 !== 0) throw badRequest('Una línea 2x1 va de 2 en 2 botellas');
    const delta = body.quantity - Number(item.quantity);
    if (delta > 0) {
      const p = await one<{ stock: number; track_stock: number }>(tx, 'SELECT stock, track_stock FROM products WHERE id = ?', [item.product_id]);
      if (p && Number(p.track_stock) === 1 && Number(p.stock) < delta) throw conflict(`Solo hay ${p.stock} unidades disponibles`);
    }
    if (body.quantity === 0) await run(tx, 'DELETE FROM order_items WHERE id = ?', [itemId]);
    else await run(tx, 'UPDATE order_items SET quantity = ? WHERE id = ?', [body.quantity, itemId]);
    await moveStock(tx, item.product_id, -delta, delta < 0 ? 'Devolución a inventario (ítem retirado)' : 'Venta', orderId, user.id);
    await recalc(tx, orderId);
  });
  return c.json(await loadOrder(getClient(), orderId));
});

// ---------- Nombre / nota de la mesa (cualquier rol, cuenta abierta) ----------
const labelSchema = z.object({ label: z.string().trim().max(60).nullable() });
orders.patch('/orders/:id/label', async (c) => {
  const orderId = idParam(c);
  const body = await parseBody(c, labelSchema);
  const order = await one<{ status: string }>(getClient(), 'SELECT status FROM orders WHERE id = ?', [orderId]);
  if (!order) throw notFound('Cuenta no encontrada');
  if (order.status !== 'open') throw conflict('La cuenta ya está cerrada');
  await run(getClient(), 'UPDATE orders SET label = ? WHERE id = ?', [body.label || null, orderId]);
  return c.json(await loadOrder(getClient(), orderId));
});

// ---------- Pedir la cuenta: la mesa queda "Por cobrar" para el administrador ----------
orders.post('/orders/:id/request-bill', async (c) => {
  const user = c.get('user');
  const orderId = idParam(c);
  await withTx(async (tx) => {
    const order = await one<Order>(tx, 'SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) throw notFound('Cuenta no encontrada');
    if (order.status !== 'open') throw conflict('La cuenta ya está cerrada');
    const count = await one<{ n: number }>(tx, 'SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?', [orderId]);
    if (Number(count?.n) === 0) throw badRequest('La cuenta no tiene productos');
    await run(tx, 'UPDATE orders SET bill_requested_at = ?, bill_requested_by = ? WHERE id = ?', [nowIso(), user.id, orderId]);
  });
  return c.json(await loadOrder(getClient(), orderId));
});

orders.post('/orders/:id/cancel-request', async (c) => {
  const orderId = idParam(c);
  const order = await one<{ status: string }>(getClient(), 'SELECT status FROM orders WHERE id = ?', [orderId]);
  if (!order) throw notFound('Cuenta no encontrada');
  if (order.status !== 'open') throw conflict('La cuenta ya está cerrada');
  await run(getClient(), 'UPDATE orders SET bill_requested_at = NULL, bill_requested_by = NULL WHERE id = ?', [orderId]);
  return c.json(await loadOrder(getClient(), orderId));
});

// ---------- Repetir la última ronda ----------
// Vuelve a agregar los productos de la última tanda anotada (ítems creados en una ventana de 2 minutos).
orders.post('/orders/:id/repeat-last', async (c) => {
  const user = c.get('user');
  const orderId = idParam(c);
  await withTx(async (tx) => {
    const order = await one<{ status: string }>(tx, 'SELECT status FROM orders WHERE id = ?', [orderId]);
    if (!order) throw notFound('Cuenta no encontrada');
    if (order.status !== 'open') throw conflict('La cuenta ya está cerrada');
    const last = await one<{ created_at: string }>(tx, 'SELECT MAX(created_at) AS created_at FROM order_items WHERE order_id = ?', [orderId]);
    if (!last?.created_at) throw badRequest('La cuenta aún no tiene productos');
    const since = new Date(new Date(last.created_at).getTime() - 120_000).toISOString();
    const round = await all<OrderItem>(tx, 'SELECT * FROM order_items WHERE order_id = ? AND created_at >= ? AND product_id IS NOT NULL', [orderId, since]);
    for (const it of round) {
      const p = await one<SellableProduct>(tx, SELLABLE_SELECT, [it.product_id]);
      if (!p || Number(p.is_active) !== 1) continue;
      // Un 2x1 se repite como 2x1 mientras el producto siga teniendo precio 2x1.
      const promo = Number(it.promo) === 1 && !!p.promo_price;
      await addProduct(tx, orderId, p, Number(it.quantity), promo, it.notes, user.id);
    }
    await recalc(tx, orderId);
  });
  return c.json(await loadOrder(getClient(), orderId));
});

// ---------- Editar cuenta (mover de mesa, nombre, notas, descuento) ----------
const patchSchema = z.object({
  table_id: z.number().int().positive().nullable().optional(),
  label: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
  discount: z.number().min(0).optional(),
});

orders.patch('/orders/:id', requireAdmin, async (c) => {
  const orderId = idParam(c);
  const body = await parseBody(c, patchSchema);
  await withTx(async (tx) => {
    const order = await one<Order>(tx, 'SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) throw notFound('Cuenta no encontrada');
    if (order.status !== 'open') throw conflict('La cuenta ya está cerrada');
    if (body.table_id !== undefined && body.table_id !== order.table_id) {
      if (body.table_id) {
        const busy = await one(tx, "SELECT id FROM orders WHERE table_id = ? AND status = 'open' AND id != ?", [body.table_id, orderId]);
        if (busy) throw conflict('La mesa destino ya tiene una cuenta abierta');
      }
      await run(tx, 'UPDATE orders SET table_id = ? WHERE id = ?', [body.table_id, orderId]);
    }
    if (body.label !== undefined) await run(tx, 'UPDATE orders SET label = ? WHERE id = ?', [body.label, orderId]);
    if (body.notes !== undefined) await run(tx, 'UPDATE orders SET notes = ? WHERE id = ?', [body.notes, orderId]);
    if (body.discount !== undefined) await run(tx, 'UPDATE orders SET discount = ? WHERE id = ?', [cop(body.discount), orderId]);
    await recalc(tx, orderId);
  });
  return c.json(await loadOrder(getClient(), orderId));
});

// ---------- Cobrar ----------
const paySchema = z.object({
  payment_method: z.enum(['cash', 'transfer', 'mixed', 'credit']),
  discount: z.number().min(0).optional(),
  cash_received: z.number().min(0).nullable().optional(),
  /** Solo para 'mixed': cuánto en efectivo (el resto va por transferencia). */
  cash_part: z.number().min(0).optional(),
  /** Solo para 'credit': a nombre de quién queda la deuda. */
  credit_party: z.string().trim().max(80).optional(),
  credit_due_date: z.string().nullable().optional(),
  notes: z.string().trim().max(300).optional(),
});

orders.post('/orders/:id/pay', requireAdmin, async (c) => {
  const user = c.get('user');
  const orderId = idParam(c);
  const body = await parseBody(c, paySchema);
  await withTx(async (tx) => {
    const order = await one<Order>(tx, 'SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) throw notFound('Cuenta no encontrada');
    if (order.status !== 'open') throw conflict('La cuenta ya está cerrada');
    const count = await one<{ n: number }>(tx, 'SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?', [orderId]);
    if (Number(count?.n) === 0) throw badRequest('La cuenta no tiene productos. Usa "Cancelar" para cerrarla.');
    const discount = body.discount !== undefined ? cop(body.discount) : Number(order.discount);
    const subtotal = Number(
      (await one<{ s: number }>(tx, 'SELECT COALESCE(SUM(quantity * unit_price),0) AS s FROM order_items WHERE order_id = ?', [orderId]))?.s ?? 0,
    );
    if (discount > subtotal) throw badRequest('El descuento no puede superar el subtotal');
    const total = subtotal - discount;
    if (body.payment_method === 'cash' && body.cash_received != null && cop(body.cash_received) < total) {
      throw badRequest('El efectivo recibido es menor que el total');
    }
    // Reparto del pago.
    let paidCash = 0; let paidTransfer = 0;
    if (body.payment_method === 'cash') paidCash = total;
    else if (body.payment_method === 'transfer') paidTransfer = total;
    else if (body.payment_method === 'mixed') {
      paidCash = cop(body.cash_part ?? 0);
      if (paidCash <= 0 || paidCash >= total) throw badRequest('En pago mixto, el efectivo debe ser mayor a cero y menor que el total');
      paidTransfer = total - paidCash;
    } else if (body.payment_method === 'credit') {
      if (!body.credit_party) throw badRequest('Indica a nombre de quién queda el crédito');
      if (body.credit_due_date && !isDate(body.credit_due_date)) throw badRequest('Fecha de vencimiento inválida');
    }
    const session = await one<{ id: number }>(tx, "SELECT id FROM cash_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1");
    const ts = nowIso();
    const tname = order.table_id ? (await one<{ name: string }>(tx, 'SELECT name FROM tables WHERE id = ?', [order.table_id]))?.name : null;
    const label = tname ? tname : order.label ? `“${order.label}”` : 'directa';
    let creditId: number | null = null;
    if (body.payment_method === 'credit' && total > 0) {
      const r = await run(tx, 'INSERT INTO credits (type, party, description, total, due_date, order_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        'receivable', body.credit_party!, `Cuenta #${orderId} · ${label}`, total, body.credit_due_date || null, orderId, user.id, ts,
      ]);
      creditId = r.lastId;
    }
    await run(
      tx,
      `UPDATE orders SET status = 'paid', closed_by = ?, closed_at = ?, payment_method = ?, subtotal = ?, discount = ?, total = ?,
         paid_cash = ?, paid_transfer = ?, credit_id = ?, cash_received = ?, cash_session_id = ?, notes = COALESCE(?, notes) WHERE id = ?`,
      [user.id, ts, body.payment_method, subtotal, discount, total, paidCash, paidTransfer, creditId, body.cash_received != null ? cop(body.cash_received) : null, session?.id ?? null, body.notes ?? null, orderId],
    );
    // Movimientos de caja: uno por cada parte que sí entra dinero. A crédito no entra nada (entra con los abonos).
    const parts: [number, 'cash' | 'transfer'][] = [[paidCash, 'cash'], [paidTransfer, 'transfer']];
    for (const [amount, method] of parts) {
      if (amount <= 0) continue;
      const desc = `Venta ${label} · cuenta #${orderId}${body.payment_method === 'mixed' ? ` (${method === 'cash' ? 'parte en efectivo' : 'parte por transferencia'})` : ''}`;
      await run(tx, 'INSERT INTO transactions (type, amount, description, payment_method, order_id, cash_session_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        'income', amount, desc, method, orderId, session?.id ?? null, user.id, ts,
      ]);
    }
  });
  return c.json(await loadOrder(getClient(), orderId));
});

// ---------- Cancelar ----------
orders.post('/orders/:id/cancel', requireAdmin, async (c) => {
  const user = c.get('user');
  const orderId = idParam(c);
  await withTx(async (tx) => {
    const order = await one<Order>(tx, 'SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) throw notFound('Cuenta no encontrada');
    if (order.status !== 'open') throw conflict('La cuenta ya está cerrada');
    const items = await all<OrderItem>(tx, 'SELECT * FROM order_items WHERE order_id = ?', [orderId]);
    for (const it of items) {
      await moveStock(tx, it.product_id, Number(it.quantity), 'Devolución a inventario (cuenta cancelada)', orderId, user.id);
    }
    await run(tx, "UPDATE orders SET status = 'cancelled', closed_by = ?, closed_at = ? WHERE id = ?", [user.id, nowIso(), orderId]);
  });
  return c.json(await loadOrder(getClient(), orderId));
});

// ---------- Anular una venta ya cobrada (corrección de errores) ----------
orders.post('/orders/:id/void', requireOwner, async (c) => {
  const user = c.get('user');
  const orderId = idParam(c);
  await withTx(async (tx) => {
    const order = await one<Order>(tx, 'SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) throw notFound('Cuenta no encontrada');
    if (order.status !== 'paid') throw conflict('Solo se pueden anular cuentas ya cobradas');
    const items = await all<OrderItem>(tx, 'SELECT * FROM order_items WHERE order_id = ?', [orderId]);
    for (const it of items) {
      await moveStock(tx, it.product_id, Number(it.quantity), 'Devolución a inventario (venta anulada)', orderId, user.id);
    }
    await run(tx, 'DELETE FROM transactions WHERE order_id = ?', [orderId]);
    if (order.credit_id) {
      const paid = await one<{ n: number }>(tx, 'SELECT COUNT(*) AS n FROM credit_payments WHERE credit_id = ?', [order.credit_id]);
      if (Number(paid?.n) > 0) throw conflict('El crédito de esta cuenta ya tiene abonos. Elimina el crédito primero desde Créditos.');
      await run(tx, 'DELETE FROM credits WHERE id = ?', [order.credit_id]);
    }
    await run(tx, "UPDATE orders SET status = 'cancelled', closed_by = ?, closed_at = ?, notes = ? WHERE id = ?", [
      user.id, nowIso(), `Venta anulada por ${user.full_name} (cobrada originalmente el ${order.closed_at} por ${money(order.total)})`, orderId,
    ]);
  });
  return c.json(await loadOrder(getClient(), orderId));
});

const money = (n: number) => `$${Number(n).toLocaleString('es-CO')}`;

export default orders;
