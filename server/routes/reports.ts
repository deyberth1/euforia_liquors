import { Hono } from 'hono';
import { all, getClient, one, ROLE_SQL } from '../db.js';
import { dayRangeUtc, isDate, rangeUtc, sqlLocalDate, sqlLocalHour, todayLocal } from '../util.js';
import { requireAdmin, requireOwner, type Env } from '../auth.js';
import { currentSession } from './cash.js';
import type { DashboardData, Product, SalesReport, StaffLive, StaffReport, StaffStat } from '../../shared/types.js';

const reports = new Hono<Env>();
reports.use('/reports/*', requireAdmin);
reports.use('/reports/sales', requireOwner);

reports.get('/reports/dashboard', async (c) => {
  const db = getClient();
  const today = todayLocal();
  const { start, end } = dayRangeUtc(today);
  const yesterday = dayRangeUtc(shiftDate(today, -1));
  const lastWeek = dayRangeUtc(shiftDate(today, -7));
  const month = rangeUtc(`${today.slice(0, 7)}-01`, today);
  const last30 = rangeUtc(shiftDate(today, -29), today);
  const totals = (range: { start: string; end: string }) => one<{ n: number; total: number; cash: number; transfer: number; credit: number }>(
    db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total,
            COALESCE(SUM(paid_cash),0) AS cash,
            COALESCE(SUM(paid_transfer),0) AS transfer,
            COALESCE(SUM(CASE WHEN payment_method='credit' THEN total END),0) AS credit
     FROM orders WHERE status='paid' AND closed_at >= ? AND closed_at < ?`,
    [range.start, range.end],
  );

  const [sales, yst, lw, mon, openOrders, cash, lowStock, series, hours, top, cats, waiters] = await Promise.all([
    totals({ start, end }), totals(yesterday), totals(lastWeek), totals(month),
    one<{ n: number; total: number }>(db, `SELECT COUNT(DISTINCT o.id) AS n, COALESCE(SUM(i.quantity * i.unit_price),0) AS total FROM orders o LEFT JOIN order_items i ON i.order_id = o.id WHERE o.status='open'`),
    currentSession(db),
    all<Product>(db, `SELECT p.id, p.name, p.price, p.category_id, c.name AS category_name, p.stock, p.track_stock, p.is_active
       FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.is_active = 1 AND p.track_stock = 1 AND p.stock <= 5 ORDER BY p.stock, p.name LIMIT 12`),
    all<{ date: string; total: number; count: number }>(db, `SELECT ${sqlLocalDate('closed_at')} AS date, COALESCE(SUM(total),0) AS total, COUNT(*) AS count
       FROM orders WHERE status='paid' AND closed_at >= ? AND closed_at < ? GROUP BY date ORDER BY date`, [last30.start, last30.end]),
    all<{ hour: number; total: number; count: number }>(db, `SELECT ${sqlLocalHour('closed_at')} AS hour, COALESCE(SUM(total),0) AS total, COUNT(*) AS count
       FROM orders WHERE status='paid' AND closed_at >= ? AND closed_at < ? GROUP BY hour`, [start, end]),
    all<{ product_name: string; quantity: number; total: number }>(db, `SELECT i.product_name, SUM(i.quantity) AS quantity, SUM(i.quantity * i.unit_price) AS total
       FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status='paid' AND o.closed_at >= ? AND o.closed_at < ?
       GROUP BY i.product_name ORDER BY total DESC LIMIT 6`, [start, end]),
    all<{ category_name: string; total: number; quantity: number }>(db, `SELECT COALESCE(c.name, 'Sin categoría') AS category_name, SUM(i.quantity * i.unit_price) AS total, SUM(i.quantity) AS quantity
       FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN products p ON p.id = i.product_id LEFT JOIN categories c ON c.id = p.category_id
       WHERE o.status='paid' AND o.closed_at >= ? AND o.closed_at < ? GROUP BY category_name ORDER BY total DESC`, [start, end]),
    all<{ user_name: string; total: number; count: number }>(db, `SELECT u.full_name AS user_name, COALESCE(SUM(o.total),0) AS total, COUNT(*) AS count
       FROM orders o JOIN users u ON u.id = o.opened_by
       WHERE o.status='paid' AND o.closed_at >= ? AND o.closed_at < ? AND u.role = 'waiter' GROUP BY u.id ORDER BY total DESC`, [start, end]),
  ]);

  const map = new Map(series.map((r) => [r.date, r]));
  const last30Days = [];
  for (let i = 29; i >= 0; i--) {
    const d = shiftDate(today, -i);
    const r = map.get(d);
    last30Days.push({ date: d, total: Number(r?.total ?? 0), count: Number(r?.count ?? 0) });
  }
  const hourMap = new Map(hours.map((h) => [Number(h.hour), h]));
  const todayByHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: Number(hourMap.get(h)?.total ?? 0), count: Number(hourMap.get(h)?.count ?? 0) }));
  const t = (r: { n: number; total: number } | null) => ({ count: Number(r?.n ?? 0), total: Number(r?.total ?? 0) });
  const monthLabel = new Intl.DateTimeFormat('es-CO', { month: 'long', timeZone: 'UTC' }).format(new Date(`${today}T00:00:00Z`));

  const owner = c.get('user').role === 'owner';
  const zero = { count: 0, total: 0 };
  const data: DashboardData = {
    today,
    sales: { ...t(sales), cash: Number(sales?.cash ?? 0), transfer: Number(sales?.transfer ?? 0), credit: Number(sales?.credit ?? 0) },
    yesterday: owner ? t(yst) : zero,
    sameDayLastWeek: owner ? t(lw) : zero,
    month: owner ? { ...t(mon), label: monthLabel } : { ...zero, label: monthLabel },
    openOrders: { count: Number(openOrders?.n ?? 0), total: Number(openOrders?.total ?? 0) },
    cash,
    lowStock,
    last30Days: owner ? last30Days : [],
    todayByHour: owner ? todayByHour : [],
    topProducts: top.map((x) => ({ product_name: x.product_name, quantity: Number(x.quantity), total: Number(x.total) })),
    byCategoryToday: cats.map((x) => ({ category_name: x.category_name, total: Number(x.total), quantity: Number(x.quantity) })),
    byWaiterToday: waiters.map((x) => ({ user_name: x.user_name, total: Number(x.total), count: Number(x.count) })),
  };
  if (!owner) data.byCategoryToday = [];
  return c.json(data);
});

reports.get('/reports/sales', async (c) => {
  const db = getClient();
  const q = c.req.query();
  const from = isDate(q.from) ? q.from : todayLocal();
  const to = isDate(q.to) ? q.to : from;
  const { start, end } = rangeUtc(from, to);
  const where = "o.status='paid' AND o.closed_at >= ? AND o.closed_at < ?";
  const args = [start, end];

  const [totals, byDay, byProduct, byCategory, byWaiter, byHour, byWeekday] = await Promise.all([
    one<{ count: number; total: number; cash: number; transfer: number; credit: number; discount: number }>(
      db,
      `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total,
              COALESCE(SUM(paid_cash),0) AS cash,
              COALESCE(SUM(paid_transfer),0) AS transfer,
              COALESCE(SUM(CASE WHEN payment_method='credit' THEN total END),0) AS credit,
              COALESCE(SUM(discount),0) AS discount
       FROM orders o WHERE ${where}`,
      args,
    ),
    all(db, `SELECT ${sqlLocalDate('o.closed_at')} AS date, COUNT(*) AS count, COALESCE(SUM(o.total),0) AS total FROM orders o WHERE ${where} GROUP BY date ORDER BY date`, args),
    all(
      db,
      `SELECT i.product_name, c.name AS category_name, SUM(i.quantity) AS quantity, SUM(i.quantity * i.unit_price) AS total
       FROM order_items i JOIN orders o ON o.id = i.order_id
       LEFT JOIN products p ON p.id = i.product_id LEFT JOIN categories c ON c.id = p.category_id
       WHERE ${where} GROUP BY i.product_name, c.name ORDER BY total DESC`,
      args,
    ),
    all(
      db,
      `SELECT COALESCE(c.name, 'Sin categoría') AS category_name, SUM(i.quantity) AS quantity, SUM(i.quantity * i.unit_price) AS total
       FROM order_items i JOIN orders o ON o.id = i.order_id
       LEFT JOIN products p ON p.id = i.product_id LEFT JOIN categories c ON c.id = p.category_id
       WHERE ${where} GROUP BY category_name ORDER BY total DESC`,
      args,
    ),
    all(
      db,
      `SELECT u.full_name AS user_name, COUNT(*) AS count, COALESCE(SUM(o.total),0) AS total
       FROM orders o JOIN users u ON u.id = o.opened_by WHERE ${where} GROUP BY u.id ORDER BY total DESC`,
      args,
    ),
    all(db, `SELECT ${sqlLocalHour('o.closed_at')} AS hour, COUNT(*) AS count, COALESCE(SUM(o.total),0) AS total FROM orders o WHERE ${where} GROUP BY hour ORDER BY hour`, args),
    all(db, `SELECT CAST(strftime('%w', o.closed_at, '-5 hours') AS INTEGER) AS weekday, COUNT(*) AS count, COALESCE(SUM(o.total),0) AS total, COUNT(DISTINCT ${sqlLocalDate('o.closed_at')}) AS days FROM orders o WHERE ${where} GROUP BY weekday ORDER BY weekday`, args),
  ]);

  const num = <T extends Record<string, unknown>>(rows: T[]) =>
    rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]))) as T[];

  const report: SalesReport = {
    from, to,
    totals: {
      count: Number(totals?.count ?? 0), total: Number(totals?.total ?? 0), cash: Number(totals?.cash ?? 0),
      transfer: Number(totals?.transfer ?? 0), credit: Number(totals?.credit ?? 0), discount: Number(totals?.discount ?? 0),
    },
    byDay: num(byDay) as SalesReport['byDay'],
    byProduct: num(byProduct) as SalesReport['byProduct'],
    byCategory: num(byCategory) as SalesReport['byCategory'],
    byWaiter: num(byWaiter) as SalesReport['byWaiter'],
    byHour: num(byHour) as SalesReport['byHour'],
    byWeekday: num(byWeekday) as SalesReport['byWeekday'],
    byPayment: [
      { method: 'cash', total: Number(totals?.cash ?? 0) },
      { method: 'transfer', total: Number(totals?.transfer ?? 0) },
      { method: 'credit', total: Number(totals?.credit ?? 0) },
    ],
  };
  return c.json(report);
});


/** Equipo: qué mesas atiende cada mesero ahora y cuánto vendió en un turno o rango. */
reports.get('/reports/staff', async (c) => {
  const db = getClient();
  const q = c.req.query();
  const sessionId = q.session ? Number(q.session) : null;
  let from = isDate(q.from) ? q.from : todayLocal();
  let to = isDate(q.to) ? q.to : from;

  // Filtro temporal: por sesión de caja (turno) o por rango de fechas.
  let where: string;
  let args: (string | number)[];
  if (sessionId) {
    const s = await one<{ opened_at: string; closed_at: string | null }>(db, 'SELECT opened_at, closed_at FROM cash_sessions WHERE id = ?', [sessionId]);
    if (!s) return c.json({ error: 'Turno no encontrado' }, 404);
    where = "o.status = 'paid' AND o.cash_session_id = ?";
    args = [sessionId];
    from = s.opened_at.slice(0, 10); to = (s.closed_at ?? new Date().toISOString()).slice(0, 10);
  } else {
    const r = rangeUtc(from, to);
    where = "o.status = 'paid' AND o.closed_at >= ? AND o.closed_at < ?";
    args = [r.start, r.end];
  }

  const ONLINE_MS = 10 * 60_000;
  const [users, liveRows, opened, sold, tops] = await Promise.all([
    all<{ id: number; full_name: string; role: 'owner' | 'admin' | 'waiter'; last_seen_at: string | null }>(db, `SELECT id, full_name, ${ROLE_SQL} AS role, last_seen_at FROM users WHERE is_active = 1 ORDER BY full_name`),
    // Mesas abiertas por cada mesero (la mesa es de quien la abrió, sin importar quién anote).
    all<{ order_id: number; table_name: string | null; label: string | null; opened_at: string; user_id: number; items: number; total: number }>(
      db,
      `SELECT o.id AS order_id, t.name AS table_name, o.label, o.opened_at, o.opened_by AS user_id,
              COALESCE(SUM(i.quantity),0) AS items, COALESCE(SUM(i.quantity * i.unit_price),0) AS total
       FROM orders o LEFT JOIN order_items i ON i.order_id = o.id LEFT JOIN tables t ON t.id = o.table_id
       WHERE o.status = 'open' GROUP BY o.id ORDER BY o.opened_at`,
    ),
    all<{ user_id: number; n: number; first: string; last: string; total: number }>(
      db, `SELECT o.opened_by AS user_id, COUNT(*) AS n, MIN(o.opened_at) AS first, MAX(o.closed_at) AS last, COALESCE(SUM(o.total),0) AS total FROM orders o WHERE ${where} GROUP BY o.opened_by`, args,
    ),
    all<{ user_id: number; items: number }>(
      db,
      `SELECT o.opened_by AS user_id, SUM(i.quantity) AS items FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${where} GROUP BY o.opened_by`,
      args,
    ),
    all<{ user_id: number; product_name: string; qty: number }>(
      db,
      `SELECT user_id, product_name, qty FROM (
         SELECT o.opened_by AS user_id, i.product_name, SUM(i.quantity) AS qty,
                ROW_NUMBER() OVER (PARTITION BY o.opened_by ORDER BY SUM(i.quantity) DESC) AS rn
         FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${where} GROUP BY o.opened_by, i.product_name
       ) WHERE rn = 1`,
      args,
    ),
  ]);

  const isOnline = (u: { last_seen_at: string | null }) => !!u.last_seen_at && Date.now() - Date.parse(u.last_seen_at) < ONLINE_MS;
  const live: StaffLive[] = users
    .filter((u) => u.role === 'waiter')
    .map((u) => {
      const mine = liveRows.filter((r) => Number(r.user_id) === Number(u.id));
      return {
        user_id: Number(u.id), user_name: u.full_name, role: u.role, online: isOnline(u), last_seen_at: u.last_seen_at,
        tables: mine.map((r) => ({ order_id: Number(r.order_id), table_name: r.table_name ?? (r.label ? `“${r.label}”` : `Cuenta #${r.order_id}`), items: Number(r.items), total: Number(r.total), opened_at: r.opened_at })),
        items_added: mine.reduce((s, r) => s + Number(r.items), 0), amount_added: mine.reduce((s, r) => s + Number(r.total), 0),
      };
    })
    // Solo quienes tienen sesión activa, o dejaron mesas abiertas (para que el admin las vea).
    .filter((l) => l.online || l.tables.length > 0)
    .sort((a, b) => Number(b.online) - Number(a.online) || b.amount_added - a.amount_added);

  const stats: StaffStat[] = users.filter((u) => u.role === 'waiter').map((u) => {
    const op = opened.find((r) => Number(r.user_id) === Number(u.id));
    const so = sold.find((r) => Number(r.user_id) === Number(u.id));
    const tp = tops.find((r) => Number(r.user_id) === Number(u.id));
    const n = Number(op?.n ?? 0);
    const amount = Number(op?.total ?? 0);
    return {
      user_id: Number(u.id), user_name: u.full_name, role: u.role,
      orders_opened: n, items_sold: Number(so?.items ?? 0), amount_sold: amount,
      avg_ticket: n ? Math.round(amount / n) : 0,
      top_product: tp?.product_name ?? null,
      first_activity: op?.first ?? null, last_activity: op?.last ?? null,
    };
  }).filter((s) => s.orders_opened > 0).sort((a, b) => b.amount_sold - a.amount_sold);

  const report: StaffReport = { from, to, session_id: sessionId, live, stats };
  return c.json(report);
});

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default reports;
