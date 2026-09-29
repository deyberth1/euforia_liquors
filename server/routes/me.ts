import { Hono } from 'hono';
import { all, getClient, one } from '../db.js';
import { dayRangeUtc, todayLocal } from '../util.js';
import type { Env } from '../auth.js';
import type { MySummary } from '../../shared/types.js';

const me = new Hono<Env>();

/** "Mi noche": lo que el usuario actual ha hecho en el turno (solo sus propios datos). */
me.get('/me/summary', async (c) => {
  const user = c.get('user');
  const db = getClient();
  const today = todayLocal();
  // El turno = la caja abierta; si no hay, el día de hoy.
  const session = await one<{ id: number; opened_at: string }>(db, "SELECT id, opened_at FROM cash_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1");
  const range = session ? { start: session.opened_at, end: '9999' } : dayRangeUtc(today);

  const [openTables, mine, products, best] = await Promise.all([
    all<{ order_id: number; table_name: string | null; label: string | null; total: number; my_items: number; my_amount: number; opened_at: string; bill_requested_at: string | null }>(
      db,
      `SELECT o.id AS order_id, t.name AS table_name, o.label, o.total, o.opened_at, o.bill_requested_at,
              COALESCE(SUM(CASE WHEN i.added_by = ? THEN i.quantity END),0) AS my_items,
              COALESCE(SUM(CASE WHEN i.added_by = ? THEN i.quantity * i.unit_price END),0) AS my_amount
       FROM orders o LEFT JOIN tables t ON t.id = o.table_id LEFT JOIN order_items i ON i.order_id = o.id
       WHERE o.status = 'open' AND o.opened_by = ? GROUP BY o.id
       ORDER BY o.opened_at`,
      [user.id, user.id, user.id],
    ),
    one<{ tables: number; items: number; amount: number; first: string | null; last: string | null }>(
      db,
      `SELECT COUNT(DISTINCT o.id) AS tables, COALESCE(SUM(i.quantity),0) AS items, COALESCE(SUM(i.quantity * i.unit_price),0) AS amount,
              MIN(o.opened_at) AS first, MAX(o.closed_at) AS last
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.opened_by = ? AND o.status = 'paid' AND o.closed_at >= ? AND o.closed_at < ?`,
      [user.id, range.start, range.end],
    ),
    all<{ product_name: string; quantity: number; total: number }>(
      db,
      `SELECT i.product_name, SUM(i.quantity) AS quantity, SUM(i.quantity * i.unit_price) AS total
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.opened_by = ? AND o.status = 'paid' AND o.closed_at >= ? AND o.closed_at < ?
       GROUP BY i.product_name ORDER BY total DESC`,
      [user.id, range.start, range.end],
    ),
    one<{ table_name: string | null; label: string | null; total: number }>(
      db,
      `SELECT t.name AS table_name, o.label, SUM(i.quantity * i.unit_price) AS total
       FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN tables t ON t.id = o.table_id
       WHERE o.opened_by = ? AND o.status = 'paid' AND o.closed_at >= ? AND o.closed_at < ?
       GROUP BY o.id ORDER BY total DESC LIMIT 1`,
      [user.id, range.start, range.end],
    ),
  ]);

  const name = (t: string | null, l: string | null, id: number) => t ?? (l ? `“${l}”` : `Cuenta #${id}`);
  const data: MySummary = {
    date: today,
    session_id: session ? Number(session.id) : null,
    openTables: openTables.map((r) => ({ order_id: Number(r.order_id), table_name: name(r.table_name, r.label, Number(r.order_id)), total: Number(r.total), my_items: Number(r.my_items), my_amount: Number(r.my_amount), opened_at: r.opened_at, bill_requested_at: r.bill_requested_at })),
    today: { tables: Number(mine?.tables ?? 0), items: Number(mine?.items ?? 0), amount: Number(mine?.amount ?? 0), firstActivity: mine?.first ?? null, lastActivity: mine?.last ?? null },
    products: products.map((p) => ({ product_name: p.product_name, quantity: Number(p.quantity), total: Number(p.total) })),
    bestTable: best ? { table_name: name(best.table_name, best.label, 0), total: Number(best.total) } : null,
  };
  return c.json(data);
});

export default me;
