import { Hono } from 'hono';
import { z } from 'zod';
import { all, getClient, nowIso, one, run, withTx, type Db } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { cop, idParam, isDate, parseBody, rangeUtc } from '../util.js';
import { requireAdmin, type Env } from '../auth.js';
import type { CashSession, CashSummary } from '../../shared/types.js';

const cash = new Hono<Env>();

const SESSION_SELECT = `
  SELECT s.*, u1.full_name AS opened_by_name, u2.full_name AS closed_by_name
  FROM cash_sessions s JOIN users u1 ON u1.id = s.opened_by LEFT JOIN users u2 ON u2.id = s.closed_by`;

/** Resumen de una sesión de caja: ventas, otros ingresos, gastos y efectivo esperado. */
export async function sessionSummary(db: Db, session: CashSession): Promise<CashSummary> {
  const sales = await one<{ n: number; total: number; cash: number; transfer: number; credit: number }>(
    db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total,
            COALESCE(SUM(paid_cash),0) AS cash,
            COALESCE(SUM(paid_transfer),0) AS transfer,
            COALESCE(SUM(CASE WHEN payment_method='credit' THEN total END),0) AS credit
     FROM orders WHERE status = 'paid' AND cash_session_id = ?`,
    [session.id],
  );
  const tx = await one<{ oic: number; oit: number; ec: number; et: number }>(
    db,
    `SELECT
       COALESCE(SUM(CASE WHEN type='income' AND order_id IS NULL AND payment_method='cash' THEN amount END),0) AS oic,
       COALESCE(SUM(CASE WHEN type='income' AND order_id IS NULL AND payment_method='transfer' THEN amount END),0) AS oit,
       COALESCE(SUM(CASE WHEN type='expense' AND payment_method='cash' THEN amount END),0) AS ec,
       COALESCE(SUM(CASE WHEN type='expense' AND payment_method='transfer' THEN amount END),0) AS et
     FROM transactions WHERE cash_session_id = ?`,
    [session.id],
  );
  const salesCash = Number(sales?.cash ?? 0);
  const otherIncomeCash = Number(tx?.oic ?? 0);
  const expenseCash = Number(tx?.ec ?? 0);
  return {
    salesCount: Number(sales?.n ?? 0),
    salesTotal: Number(sales?.total ?? 0),
    salesCash,
    salesTransfer: Number(sales?.transfer ?? 0),
    salesCredit: Number(sales?.credit ?? 0),
    otherIncomeCash,
    otherIncomeTransfer: Number(tx?.oit ?? 0),
    expenseCash,
    expenseTransfer: Number(tx?.et ?? 0),
    expectedCash: Number(session.opening_balance) + salesCash + otherIncomeCash - expenseCash,
  };
}

export async function currentSession(db: Db): Promise<CashSession | null> {
  const s = await one<CashSession>(db, `${SESSION_SELECT} WHERE s.status = 'open' ORDER BY s.opened_at DESC LIMIT 1`);
  if (!s) return null;
  s.summary = await sessionSummary(db, s);
  return s;
}

cash.get('/cash/current', async (c) => c.json(await currentSession(getClient())));

const openSchema = z.object({ opening_balance: z.number().min(0), notes: z.string().trim().max(300).optional() });

cash.post('/cash/open', requireAdmin, async (c) => {
  const user = c.get('user');
  const body = await parseBody(c, openSchema);
  await withTx(async (tx) => {
    const open = await one(tx, "SELECT id FROM cash_sessions WHERE status = 'open'");
    if (open) throw conflict('Ya hay una caja abierta');
    await run(tx, 'INSERT INTO cash_sessions (status, opened_by, opening_balance, opened_at, notes) VALUES (?, ?, ?, ?, ?)', [
      'open', user.id, cop(body.opening_balance), nowIso(), body.notes ?? null,
    ]);
  });
  return c.json(await currentSession(getClient()), 201);
});

const closeSchema = z.object({ closing_balance: z.number().min(0), notes: z.string().trim().max(300).optional() });

cash.post('/cash/close', requireAdmin, async (c) => {
  const user = c.get('user');
  const body = await parseBody(c, closeSchema);
  const id = await withTx(async (tx) => {
    const s = await currentSession(tx);
    if (!s) throw conflict('No hay caja abierta');
    const openOrders = await one<{ n: number }>(tx, "SELECT COUNT(*) AS n FROM orders WHERE status = 'open'");
    if (Number(openOrders?.n) > 0) throw conflict(`Hay ${openOrders!.n} cuenta(s) abierta(s). Cóbralas o cancélalas antes de cerrar la caja.`);
    const expected = s.summary!.expectedCash;
    const closing = cop(body.closing_balance);
    await run(
      tx,
      `UPDATE cash_sessions SET status = 'closed', closed_by = ?, closed_at = ?, closing_balance = ?, expected_cash = ?, difference = ?,
         notes = COALESCE(?, notes) WHERE id = ?`,
      [user.id, nowIso(), closing, expected, closing - expected, body.notes ?? null, s.id],
    );
    return s.id;
  });
  return c.json(await loadSession(id));
});

async function loadSession(id: number): Promise<CashSession> {
  const db = getClient();
  const s = await one<CashSession>(db, `${SESSION_SELECT} WHERE s.id = ?`, [id]);
  if (!s) throw notFound('Sesión de caja no encontrada');
  s.summary = await sessionSummary(db, s);
  return s;
}

cash.get('/cash/sessions', requireAdmin, async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  const db = getClient();
  let sql = `${SESSION_SELECT}`;
  const args: string[] = [];
  if (isDate(from) && isDate(to)) {
    const { start, end } = rangeUtc(from, to);
    sql += ' WHERE s.opened_at >= ? AND s.opened_at < ?';
    args.push(start, end);
  }
  sql += ' ORDER BY s.opened_at DESC LIMIT 60';
  const rows = await all<CashSession>(db, sql, args);
  for (const s of rows) s.summary = await sessionSummary(db, s);
  return c.json(rows);
});

cash.get('/cash/sessions/:id', requireAdmin, async (c) => c.json(await loadSession(idParam(c))));

export default cash;
