import { Hono } from 'hono';
import { z } from 'zod';
import { all, getClient, nowIso, one, run, withTx } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { cop, idParam, parseBody } from '../util.js';
import { requireAdmin, requireOwner, type Env } from '../auth.js';
import type { Category, Product } from '../../shared/types.js';

const catalog = new Hono<Env>();

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.price, p.category_id, c.name AS category_name, p.stock, p.track_stock, p.is_active
  FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

// ---------- Categorías ----------
catalog.get('/categories', async (c) => {
  const rows = await all<Category>(
    getClient(),
    `SELECT c.id, c.name, c.sort_order, COUNT(p.id) AS product_count
     FROM categories c LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1
     GROUP BY c.id ORDER BY c.sort_order, c.name`,
  );
  return c.json(rows);
});

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(60),
  sort_order: z.number().int().min(0).optional(),
});

catalog.post('/categories', requireAdmin, async (c) => {
  const body = await parseBody(c, categorySchema);
  const db = getClient();
  const dup = await one(db, 'SELECT id FROM categories WHERE lower(name) = lower(?)', [body.name]);
  if (dup) throw conflict('Ya existe una categoría con ese nombre');
  const max = await one<{ m: number | null }>(db, 'SELECT MAX(sort_order) AS m FROM categories');
  const { lastId } = await run(db, 'INSERT INTO categories (name, sort_order) VALUES (?, ?)', [
    body.name, body.sort_order ?? (Number(max?.m ?? -1) + 1),
  ]);
  return c.json({ id: lastId }, 201);
});

catalog.put('/categories/:id', requireAdmin, async (c) => {
  const id = idParam(c);
  const body = await parseBody(c, categorySchema);
  const db = getClient();
  const dup = await one(db, 'SELECT id FROM categories WHERE lower(name) = lower(?) AND id != ?', [body.name, id]);
  if (dup) throw conflict('Ya existe una categoría con ese nombre');
  const { changes } = await run(db, 'UPDATE categories SET name = ?, sort_order = COALESCE(?, sort_order) WHERE id = ?', [
    body.name, body.sort_order ?? null, id,
  ]);
  if (!changes) throw notFound('Categoría no encontrada');
  return c.json({ ok: true });
});

catalog.delete('/categories/:id', requireOwner, async (c) => {
  const id = idParam(c);
  const db = getClient();
  const used = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM products WHERE category_id = ?', [id]);
  if (Number(used?.n) > 0) throw conflict('La categoría tiene productos. Muévelos a otra categoría primero.');
  const { changes } = await run(db, 'DELETE FROM categories WHERE id = ?', [id]);
  if (!changes) throw notFound('Categoría no encontrada');
  return c.json({ ok: true });
});

// ---------- Productos ----------
/** Los más pedidos en los últimos 30 días (para la fila de favoritos del selector). */
catalog.get('/products/frequent', async (c) => {
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const rows = await all<{ product_id: number; qty: number }>(
    getClient(),
    `SELECT i.product_id, SUM(i.quantity) AS qty FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id
     WHERE o.status != 'cancelled' AND i.created_at >= ? AND p.is_active = 1 GROUP BY i.product_id ORDER BY qty DESC LIMIT 8`,
    [since],
  );
  return c.json(rows.map((r) => Number(r.product_id)));
});

catalog.get('/products', async (c) => {
  const includeInactive = c.req.query('all') === '1' && c.get('user').role === 'admin';
  const rows = await all<Product>(
    getClient(),
    `${PRODUCT_SELECT} ${includeInactive ? '' : 'WHERE p.is_active = 1'} ORDER BY c.sort_order, c.name, p.name`,
  );
  return c.json(rows);
});

const productSchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(80),
  price: z.number().min(0, 'Precio inválido'),
  category_id: z.number().int().positive().nullable().optional(),
  stock: z.number().int().optional(),
  track_stock: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

catalog.post('/products', requireAdmin, async (c) => {
  const body = await parseBody(c, productSchema);
  const ts = nowIso();
  const { lastId } = await run(
    getClient(),
    'INSERT INTO products (name, price, category_id, stock, track_stock, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [body.name, cop(body.price), body.category_id ?? null, body.stock ?? 0, body.track_stock === false ? 0 : 1, body.is_active === false ? 0 : 1, ts, ts],
  );
  return c.json({ id: lastId }, 201);
});

catalog.put('/products/:id', requireAdmin, async (c) => {
  const id = idParam(c);
  const body = await parseBody(c, productSchema);
  const user = c.get('user');
  await withTx(async (tx) => {
    const current = await one<Product>(tx, 'SELECT * FROM products WHERE id = ?', [id]);
    if (!current) throw notFound('Producto no encontrado');
    const newStock = body.stock ?? Number(current.stock);
    if (newStock !== Number(current.stock)) {
      await run(tx, 'INSERT INTO stock_movements (product_id, delta, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?)', [
        id, newStock - Number(current.stock), 'Ajuste manual de inventario', user.id, nowIso(),
      ]);
    }
    await run(
      tx,
      'UPDATE products SET name = ?, price = ?, category_id = ?, stock = ?, track_stock = ?, is_active = ?, updated_at = ? WHERE id = ?',
      [
        body.name, cop(body.price), body.category_id ?? null, newStock,
        body.track_stock === undefined ? Number(current.track_stock) : (body.track_stock ? 1 : 0),
        body.is_active === undefined ? Number(current.is_active) : (body.is_active ? 1 : 0),
        nowIso(), id,
      ],
    );
  });
  return c.json({ ok: true });
});

const stockSchema = z.object({
  delta: z.number().int().refine((n) => n !== 0, 'La cantidad no puede ser cero'),
  reason: z.string().trim().min(1, 'Motivo requerido').max(120),
});

catalog.post('/products/:id/stock', requireAdmin, async (c) => {
  const id = idParam(c);
  const body = await parseBody(c, stockSchema);
  const user = c.get('user');
  const stock = await withTx(async (tx) => {
    const p = await one<{ stock: number }>(tx, 'SELECT stock FROM products WHERE id = ?', [id]);
    if (!p) throw notFound('Producto no encontrado');
    const next = Number(p.stock) + body.delta;
    if (next < 0) throw badRequest('El inventario no puede quedar negativo');
    await run(tx, 'UPDATE products SET stock = ?, updated_at = ? WHERE id = ?', [next, nowIso(), id]);
    await run(tx, 'INSERT INTO stock_movements (product_id, delta, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?)', [
      id, body.delta, body.reason, user.id, nowIso(),
    ]);
    return next;
  });
  return c.json({ ok: true, stock });
});

catalog.get('/products/:id/movements', requireAdmin, async (c) => {
  const id = idParam(c);
  const rows = await all(
    getClient(),
    `SELECT m.id, m.delta, m.reason, m.order_id, m.created_at, u.full_name AS created_by_name
     FROM stock_movements m JOIN users u ON u.id = m.created_by
     WHERE m.product_id = ? ORDER BY m.created_at DESC LIMIT 100`,
    [id],
  );
  return c.json(rows);
});

catalog.delete('/products/:id', requireOwner, async (c) => {
  const id = idParam(c);
  const db = getClient();
  const used = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM order_items WHERE product_id = ?', [id]);
  if (Number(used?.n) > 0) {
    // Tiene historial de ventas: se desactiva en lugar de borrarse para no perder reportes.
    await run(db, 'UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?', [nowIso(), id]);
    return c.json({ ok: true, deactivated: true });
  }
  await run(db, 'DELETE FROM stock_movements WHERE product_id = ?', [id]);
  const { changes } = await run(db, 'DELETE FROM products WHERE id = ?', [id]);
  if (!changes) throw notFound('Producto no encontrado');
  return c.json({ ok: true, deactivated: false });
});

export default catalog;
