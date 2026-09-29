import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getClient, nowIso, one, run, USER_COLS } from '../db.js';
import { HttpError } from '../errors.js';
import { parseBody } from '../util.js';
import { requireAuth, signToken, type Env } from '../auth.js';
import type { User } from '../../shared/types.js';

const auth = new Hono<Env>();

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Usuario requerido').max(60),
  password: z.string().min(1, 'Contraseña requerida').max(200),
});

// Límite simple de intentos por usuario (en memoria; suficiente para un local).
const attempts = new Map<string, { n: number; until: number }>();

auth.post('/login', async (c) => {
  const { username, password } = await parseBody(c, loginSchema);
  const key = username.toLowerCase();
  const blocked = attempts.get(key);
  if (blocked && blocked.until > Date.now()) {
    throw new HttpError(429, 'Demasiados intentos. Espera un minuto.');
  }
  const db = getClient();
  const user = await one<User & { password_hash: string }>(
    db,
    `SELECT ${USER_COLS}, password_hash FROM users WHERE username = ?`,
    [key],
  );
  const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!user || !ok) {
    const cur = attempts.get(key) ?? { n: 0, until: 0 };
    cur.n += 1;
    if (cur.n >= 8) { cur.until = Date.now() + 60_000; cur.n = 0; }
    attempts.set(key, cur);
    throw new HttpError(401, 'Usuario o contraseña incorrectos');
  }
  if (Number(user.is_active) !== 1) throw new HttpError(403, 'Usuario desactivado. Habla con el administrador.');
  attempts.delete(key);
  await run(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso(), user.id]);
  const { password_hash: _ph, ...safe } = user;
  const token = await signToken(user);
  return c.json({ token, user: safe });
});

auth.get('/me', requireAuth, (c) => c.json({ user: c.get('user') }));

/** Cerrar sesión: borra la presencia para que deje de aparecer como conectado. */
auth.post('/logout', requireAuth, async (c) => {
  await run(getClient(), 'UPDATE users SET last_seen_at = NULL WHERE id = ?', [c.get('user').id]);
  return c.json({ ok: true });
});

const pwdSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(4, 'Mínimo 4 caracteres').max(200),
});

auth.put('/me/password', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await parseBody(c, pwdSchema);
  const db = getClient();
  const row = await one<{ password_hash: string }>(db, 'SELECT password_hash FROM users WHERE id = ?', [user.id]);
  if (!row || !(await bcrypt.compare(body.current_password, row.password_hash))) {
    throw new HttpError(400, 'La contraseña actual no es correcta');
  }
  const hash = await bcrypt.hash(body.new_password, 10);
  await run(db, 'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, nowIso(), user.id]);
  return c.json({ ok: true });
});

export default auth;
