import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { all, getClient, nowIso, one, run, USER_COLS } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { idParam, parseBody } from '../util.js';
import { requireOwner, type Env } from '../auth.js';
import type { User } from '../../shared/types.js';

const users = new Hono<Env>();
users.use('/users/*', requireOwner);
users.use('/users', requireOwner);


users.get('/users', async (c) => c.json(await all<User>(getClient(), `SELECT ${USER_COLS} FROM users ORDER BY is_owner DESC, role, full_name`)));

const usernameSchema = z.string().trim().toLowerCase().min(3, 'Mínimo 3 caracteres').max(30)
  .regex(/^[a-z0-9._-]+$/, 'Solo letras, números, punto, guion y guion bajo');

const createSchema = z.object({
  username: usernameSchema,
  password: z.string().min(4, 'Mínimo 4 caracteres').max(200),
  full_name: z.string().trim().min(1, 'Nombre requerido').max(80),
  role: z.enum(['owner', 'admin', 'waiter']),
});

const split = (role: 'owner' | 'admin' | 'waiter') => ({ role: role === 'waiter' ? 'waiter' : 'admin', is_owner: role === 'owner' ? 1 : 0 });

users.post('/users', async (c) => {
  const body = await parseBody(c, createSchema);
  const db = getClient();
  const dup = await one(db, 'SELECT id FROM users WHERE username = ?', [body.username]);
  if (dup) throw conflict('Ese nombre de usuario ya existe');
  const hash = await bcrypt.hash(body.password, 10);
  const ts = nowIso();
  const r = split(body.role);
  const { lastId } = await run(db, 'INSERT INTO users (username, password_hash, full_name, role, is_owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    body.username, hash, body.full_name, r.role, r.is_owner, ts, ts,
  ]);
  return c.json({ id: lastId }, 201);
});

const updateSchema = z.object({
  username: usernameSchema,
  full_name: z.string().trim().min(1).max(80),
  role: z.enum(['owner', 'admin', 'waiter']),
  password: z.string().min(4, 'Mínimo 4 caracteres').max(200).optional().or(z.literal('')),
  is_active: z.boolean().optional(),
});

users.put('/users/:id', async (c) => {
  const id = idParam(c);
  const me = c.get('user');
  const body = await parseBody(c, updateSchema);
  const db = getClient();
  const target = await one<User>(db, `SELECT ${USER_COLS} FROM users WHERE id = ?`, [id]);
  if (!target) throw notFound('Usuario no encontrado');
  const dup = await one(db, 'SELECT id FROM users WHERE username = ? AND id != ?', [body.username, id]);
  if (dup) throw conflict('Ese nombre de usuario ya existe');
  const losingOwner = target.role === 'owner' && (body.role !== 'owner' || body.is_active === false);
  if (losingOwner) {
    const owners = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users WHERE is_owner = 1 AND is_active = 1 AND id != ?', [id]);
    if (Number(owners?.n) === 0) throw badRequest('Debe quedar al menos un dueño activo');
  }
  if (id === me.id && body.role !== 'owner') throw badRequest('No puedes quitarte tu propio rol de dueño');
  const r = split(body.role);
  await run(db, 'UPDATE users SET username = ?, full_name = ?, role = ?, is_owner = ?, is_active = COALESCE(?, is_active), updated_at = ? WHERE id = ?', [
    body.username, body.full_name, r.role, r.is_owner, body.is_active === undefined ? null : (body.is_active ? 1 : 0), nowIso(), id,
  ]);
  if (body.password) {
    const hash = await bcrypt.hash(body.password, 10);
    await run(db, 'UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
  }
  return c.json({ ok: true });
});

users.delete('/users/:id', async (c) => {
  const id = idParam(c);
  const me = c.get('user');
  if (id === me.id) throw badRequest('No puedes eliminar tu propio usuario');
  const db = getClient();
  const target = await one<User>(db, `SELECT ${USER_COLS} FROM users WHERE id = ?`, [id]);
  if (!target) throw notFound('Usuario no encontrado');
  if (target.role === 'owner') {
    const owners = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users WHERE is_owner = 1 AND is_active = 1 AND id != ?', [id]);
    if (Number(owners?.n) === 0) throw badRequest('Debe quedar al menos un dueño activo');
  }
  const history = await one<{ n: number }>(
    db,
    'SELECT (SELECT COUNT(*) FROM orders WHERE opened_by = ? OR closed_by = ?) + (SELECT COUNT(*) FROM order_items WHERE added_by = ?) + (SELECT COUNT(*) FROM transactions WHERE created_by = ?) AS n',
    [id, id, id, id],
  );
  if (Number(history?.n) > 0) {
    await run(db, 'UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?', [nowIso(), id]);
    return c.json({ ok: true, deactivated: true });
  }
  await run(db, 'DELETE FROM schedules WHERE user_id = ?', [id]);
  await run(db, 'DELETE FROM users WHERE id = ?', [id]);
  return c.json({ ok: true, deactivated: false });
});

export default users;
