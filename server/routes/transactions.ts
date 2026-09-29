import { Hono } from 'hono';
import { z } from 'zod';
import { all, getClient, nowIso, one, run } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { cop, idParam, isDate, parseBody, rangeUtc, todayLocal } from '../util.js';
import { requireAdmin, requireOwner, type Env } from '../auth.js';
import type { Transaction } from '../../shared/types.js';

const transactions = new Hono<Env>();
transactions.use('/transactions/*', requireAdmin);
transactions.use('/transactions', requireAdmin);

const TX_SELECT = `
  SELECT t.*, u.full_name AS created_by_name FROM transactions t JOIN users u ON u.id = t.created_by`;

transactions.get('/transactions', async (c) => {
  const q = c.req.query();
  const from = isDate(q.from) ? q.from : todayLocal();
  const to = isDate(q.to) ? q.to : from;
  const { start, end } = rangeUtc(from, to);
  let sql = `${TX_SELECT} WHERE t.created_at >= ? AND t.created_at < ?`;
  const args: (string | number)[] = [start, end];
  if (q.type === 'income' || q.type === 'expense') { sql += ' AND t.type = ?'; args.push(q.type); }
  if (q.payment_method === 'cash' || q.payment_method === 'transfer') { sql += ' AND t.payment_method = ?'; args.push(q.payment_method); }
  if (q.manual === '1') sql += ' AND t.order_id IS NULL';
  sql += ' ORDER BY t.created_at DESC LIMIT 1000';
  const rows = await all<Transaction>(getClient(), sql, args);
  return c.json(rows);
});

const txSchema = z.object({
  type: z.enum(['income', 'expense']),
  amount: z.number().positive('El monto debe ser mayor a cero'),
  description: z.string().trim().min(1, 'Descripción requerida').max(200),
  payment_method: z.enum(['cash', 'transfer']),
});

transactions.post('/transactions', async (c) => {
  const user = c.get('user');
  const body = await parseBody(c, txSchema);
  const db = getClient();
  const session = await one<{ id: number }>(db, "SELECT id FROM cash_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1");
  const { lastId } = await run(
    db,
    'INSERT INTO transactions (type, amount, description, payment_method, cash_session_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [body.type, cop(body.amount), body.description, body.payment_method, session?.id ?? null, user.id, nowIso()],
  );
  return c.json({ id: lastId }, 201);
});

transactions.put('/transactions/:id', requireOwner, async (c) => {
  const id = idParam(c);
  const body = await parseBody(c, txSchema);
  const db = getClient();
  const tx = await one<Transaction>(db, 'SELECT * FROM transactions WHERE id = ?', [id]);
  if (!tx) throw notFound('Movimiento no encontrado');
  if (tx.order_id) throw conflict('Este movimiento viene de una venta. Para corregirlo, anula la cuenta desde Reportes → Cuentas.');
  await run(db, 'UPDATE transactions SET type = ?, amount = ?, description = ?, payment_method = ? WHERE id = ?', [
    body.type, cop(body.amount), body.description, body.payment_method, id,
  ]);
  return c.json({ ok: true });
});

transactions.delete('/transactions/:id', requireOwner, async (c) => {
  const id = idParam(c);
  const db = getClient();
  const tx = await one<Transaction>(db, 'SELECT * FROM transactions WHERE id = ?', [id]);
  if (!tx) throw notFound('Movimiento no encontrado');
  if (tx.order_id) throw conflict('Este movimiento viene de una venta. Para corregirlo, anula la cuenta desde Reportes → Cuentas.');
  await run(db, 'DELETE FROM transactions WHERE id = ?', [id]);
  return c.json({ ok: true });
});

export default transactions;
