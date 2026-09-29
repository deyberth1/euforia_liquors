import { Hono } from 'hono';
import { z } from 'zod';
import { all, getClient, nowIso, one, run, withTx } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { cop, idParam, isDate, parseBody } from '../util.js';
import { requireAdmin, requireOwner, type Env } from '../auth.js';
import type { Credit } from '../../shared/types.js';

const credits = new Hono<Env>();
credits.use('/credits/*', requireAdmin);
credits.use('/credits', requireAdmin);

const CREDIT_SELECT = `
  SELECT c.*, COALESCE(p.paid, 0) AS paid, c.total - COALESCE(p.paid, 0) AS balance
  FROM credits c LEFT JOIN (SELECT credit_id, SUM(amount) AS paid FROM credit_payments GROUP BY credit_id) p ON p.credit_id = c.id`;

credits.get('/credits', async (c) => {
  const status = c.req.query('status');
  const type = c.req.query('type');
  let sql = `${CREDIT_SELECT} WHERE 1=1`;
  const args: string[] = [];
  if (status === 'open' || status === 'closed') { sql += ' AND c.status = ?'; args.push(status); }
  if (type === 'receivable' || type === 'payable') { sql += ' AND c.type = ?'; args.push(type); }
  sql += ' ORDER BY c.status ASC, c.created_at DESC LIMIT 500';
  return c.json(await all<Credit>(getClient(), sql, args));
});

credits.get('/credits/:id/payments', async (c) => {
  const id = idParam(c);
  const rows = await all(
    getClient(),
    `SELECT p.*, u.full_name AS created_by_name FROM credit_payments p JOIN users u ON u.id = p.created_by WHERE p.credit_id = ? ORDER BY p.created_at DESC`,
    [id],
  );
  return c.json(rows);
});

const creditSchema = z.object({
  type: z.enum(['receivable', 'payable']),
  party: z.string().trim().min(1, 'Indica el cliente o proveedor').max(80),
  description: z.string().trim().max(200).default(''),
  total: z.number().positive('El total debe ser mayor a cero'),
  due_date: z.string().nullable().optional(),
});

credits.post('/credits', async (c) => {
  const user = c.get('user');
  const body = await parseBody(c, creditSchema);
  if (body.due_date && !isDate(body.due_date)) throw badRequest('Fecha de vencimiento inválida');
  const { lastId } = await run(
    getClient(),
    'INSERT INTO credits (type, party, description, total, due_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [body.type, body.party, body.description, cop(body.total), body.due_date || null, user.id, nowIso()],
  );
  return c.json({ id: lastId }, 201);
});

const paymentSchema = z.object({
  amount: z.number().positive('El abono debe ser mayor a cero'),
  payment_method: z.enum(['cash', 'transfer']),
});

/** Registrar abono. Cada abono genera un movimiento de caja (ingreso si nos pagan, gasto si pagamos). */
credits.post('/credits/:id/payments', async (c) => {
  const user = c.get('user');
  const id = idParam(c);
  const body = await parseBody(c, paymentSchema);
  await withTx(async (tx) => {
    const credit = await one<Credit>(tx, `${CREDIT_SELECT} WHERE c.id = ?`, [id]);
    if (!credit) throw notFound('Crédito no encontrado');
    if (credit.status === 'closed') throw conflict('El crédito ya está cerrado');
    const amount = cop(body.amount);
    if (amount > Number(credit.balance)) throw badRequest(`El abono supera el saldo pendiente (${credit.balance})`);
    const ts = nowIso();
    await run(tx, 'INSERT INTO credit_payments (credit_id, amount, payment_method, created_by, created_at) VALUES (?, ?, ?, ?, ?)', [
      id, amount, body.payment_method, user.id, ts,
    ]);
    const session = await one<{ id: number }>(tx, "SELECT id FROM cash_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1");
    const isReceivable = credit.type === 'receivable';
    await run(
      tx,
      'INSERT INTO transactions (type, amount, description, payment_method, credit_id, cash_session_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [isReceivable ? 'income' : 'expense', amount, `${isReceivable ? 'Abono recibido de' : 'Pago a'} ${credit.party}${credit.description ? ` · ${credit.description}` : ''}`,
        body.payment_method, id, session?.id ?? null, user.id, ts],
    );
    if (Number(credit.balance) - amount <= 0) {
      await run(tx, "UPDATE credits SET status = 'closed', closed_at = ? WHERE id = ?", [ts, id]);
    }
  });
  return c.json({ ok: true });
});

/** Eliminar crédito: se borran también sus abonos y los movimientos de caja que generaron. */
credits.delete('/credits/:id', requireOwner, async (c) => {
  const id = idParam(c);
  await withTx(async (tx) => {
    const credit = await one(tx, 'SELECT id FROM credits WHERE id = ?', [id]);
    if (!credit) throw notFound('Crédito no encontrado');
    await run(tx, 'DELETE FROM transactions WHERE credit_id = ?', [id]);
    await run(tx, 'DELETE FROM credit_payments WHERE credit_id = ?', [id]);
    await run(tx, 'DELETE FROM credits WHERE id = ?', [id]);
  });
  return c.json({ ok: true });
});

/** Reabrir un crédito cerrado (por ejemplo, si se cerró por error). */
credits.post('/credits/:id/reopen', async (c) => {
  const id = idParam(c);
  const { changes } = await run(getClient(), "UPDATE credits SET status = 'open', closed_at = NULL WHERE id = ?", [id]);
  if (!changes) throw notFound('Crédito no encontrado');
  return c.json({ ok: true });
});

export default credits;
