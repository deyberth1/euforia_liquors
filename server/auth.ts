import { SignJWT, jwtVerify } from 'jose';
import type { Context, MiddlewareHandler } from 'hono';
import type { Role, User } from '../shared/types.js';
import { getClient, one, run, nowIso, USER_COLS } from './db.js';
import { HttpError } from './errors.js';

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret-cambiar-en-produccion');
const TOKEN_DAYS = 30;

export type AuthUser = User;

export type Env = { Variables: { user: AuthUser } };

export async function signToken(user: { id: number; role: Role }) {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_DAYS}d`)
    .sign(secret());
}

export async function userFromToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    const id = Number(payload.sub);
    if (!id) return null;
    const user = await one<AuthUser>(getClient(), `SELECT ${USER_COLS} FROM users WHERE id = ?`, [id]);
    if (!user || Number(user.is_active) !== 1) return null;
    // Presencia: marcamos actividad como máximo una vez por minuto (sin esperar la escritura).
    const seen = user.last_seen_at ? Date.parse(user.last_seen_at) : 0;
    if (Date.now() - seen > 60_000) {
      void run(getClient(), 'UPDATE users SET last_seen_at = ? WHERE id = ?', [nowIso(), id]).catch(() => undefined);
    }
    return user;
  } catch {
    return null;
  }
}

function extractToken(c: Context): string | null {
  const header = c.req.header('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return null;
}

export const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
  const token = extractToken(c);
  if (!token) throw new HttpError(401, 'Sesión requerida');
  const user = await userFromToken(token);
  if (!user) throw new HttpError(401, 'Sesión inválida o expirada');
  c.set('user', user);
  await next();
};

/** Administrador o dueño. */
export const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  const user = c.get('user');
  if (!user || (user.role !== 'admin' && user.role !== 'owner')) throw new HttpError(403, 'Solo administradores');
  await next();
};

/** Solo el dueño: reportes, usuarios y acciones de eliminar/anular. */
export const requireOwner: MiddlewareHandler<Env> = async (c, next) => {
  const user = c.get('user');
  if (!user || user.role !== 'owner') throw new HttpError(403, 'Solo el dueño puede hacer esto');
  await next();
};
