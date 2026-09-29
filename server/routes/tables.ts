import { Hono } from 'hono';
import { z } from 'zod';
import { all, getClient, one, run } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { idParam, parseBody } from '../util.js';
import { requireAdmin, requireOwner, type Env } from '../auth.js';
import type { Floor, FloorTable, OpenOrderSummary, TableRow } from '../../shared/types.js';

const tables = new Hono<Env>();

const OPEN_ORDERS_SQL = `
  SELECT o.id, o.table_id, o.label, o.opened_at, o.opened_by, u.full_name AS opened_by_name,
         o.bill_requested_at, ub.full_name AS bill_requested_by_name,
         COALESCE(SUM(i.quantity), 0) AS items_count,
         COALESCE(SUM(i.quantity * i.unit_price), 0) AS total
  FROM orders o
  JOIN users u ON u.id = o.opened_by
  LEFT JOIN users ub ON ub.id = o.bill_requested_by
  LEFT JOIN order_items i ON i.order_id = o.id
  WHERE o.status = 'open'
  GROUP BY o.id`;

/** Vista del salón: mesas con su cuenta abierta (si la hay) y cuentas sin mesa. */
tables.get('/floor', async (c) => {
  const db = getClient();
  const [rows, open] = await Promise.all([
    all<TableRow>(db, 'SELECT * FROM tables WHERE is_active = 1 ORDER BY sort_order, name'),
    all<OpenOrderSummary>(db, OPEN_ORDERS_SQL),
  ]);
  const byTable = new Map<number, OpenOrderSummary>();
  const loose: OpenOrderSummary[] = [];
  for (const o of open) {
    if (o.table_id) byTable.set(Number(o.table_id), o);
    else loose.push(o);
  }
  const floor: Floor = {
    tables: rows.map<FloorTable>((t) => ({ ...t, order: byTable.get(Number(t.id)) ?? null })),
    looseOrders: loose.sort((a, b) => a.opened_at.localeCompare(b.opened_at)),
  };
  return c.json(floor);
});

tables.get('/tables', requireAdmin, async (c) => {
  const rows = await all<TableRow>(getClient(), 'SELECT * FROM tables ORDER BY sort_order, name');
  return c.json(rows);
});

const tableSchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(40),
  type: z.enum(['table', 'bar']).default('table'),
  capacity: z.number().int().min(1).max(50).default(4),
  sort_order: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
});

tables.post('/tables', requireAdmin, async (c) => {
  const body = await parseBody(c, tableSchema);
  const db = getClient();
  const dup = await one(db, 'SELECT id FROM tables WHERE lower(name) = lower(?)', [body.name]);
  if (dup) throw conflict('Ya existe una mesa con ese nombre');
  const max = await one<{ m: number | null }>(db, 'SELECT MAX(sort_order) AS m FROM tables');
  const { lastId } = await run(db, 'INSERT INTO tables (name, type, capacity, sort_order) VALUES (?, ?, ?, ?)', [
    body.name, body.type, body.capacity, body.sort_order ?? Number(max?.m ?? 0) + 1,
  ]);
  return c.json({ id: lastId }, 201);
});

tables.put('/tables/:id', requireAdmin, async (c) => {
  const id = idParam(c);
  const body = await parseBody(c, tableSchema);
  const db = getClient();
  const dup = await one(db, 'SELECT id FROM tables WHERE lower(name) = lower(?) AND id != ?', [body.name, id]);
  if (dup) throw conflict('Ya existe una mesa con ese nombre');
  if (body.is_active === false) {
    const open = await one(db, "SELECT id FROM orders WHERE table_id = ? AND status = 'open'", [id]);
    if (open) throw conflict('La mesa tiene una cuenta abierta');
  }
  const { changes } = await run(
    db,
    'UPDATE tables SET name = ?, type = ?, capacity = ?, sort_order = COALESCE(?, sort_order), is_active = COALESCE(?, is_active) WHERE id = ?',
    [body.name, body.type, body.capacity, body.sort_order ?? null, body.is_active === undefined ? null : (body.is_active ? 1 : 0), id],
  );
  if (!changes) throw notFound('Mesa no encontrada');
  return c.json({ ok: true });
});

tables.delete('/tables/:id', requireOwner, async (c) => {
  const id = idParam(c);
  const db = getClient();
  const open = await one(db, "SELECT id FROM orders WHERE table_id = ? AND status = 'open'", [id]);
  if (open) throw conflict('La mesa tiene una cuenta abierta');
  const history = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM orders WHERE table_id = ?', [id]);
  if (Number(history?.n) > 0) {
    await run(db, 'UPDATE tables SET is_active = 0 WHERE id = ?', [id]);
    return c.json({ ok: true, deactivated: true });
  }
  const { changes } = await run(db, 'DELETE FROM tables WHERE id = ?', [id]);
  if (!changes) throw notFound('Mesa no encontrada');
  return c.json({ ok: true, deactivated: false });
});

export default tables;
