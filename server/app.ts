import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { HTTPException } from 'hono/http-exception';
import { ensureReady } from './db.js';
import { HttpError } from './errors.js';
import { requireAuth, type Env } from './auth.js';
import auth from './routes/auth.js';
import catalog from './routes/catalog.js';
import tables from './routes/tables.js';
import orders from './routes/orders.js';
import cash from './routes/cash.js';
import transactions from './routes/transactions.js';
import credits from './routes/credits.js';
import users from './routes/users.js';
import schedules from './routes/schedules.js';
import reports from './routes/reports.js';
import me from './routes/me.js';

export const app = new Hono<Env>().basePath('/api');

if (!process.env.VERCEL) app.use(logger());
app.use(secureHeaders());

// Salud básica (no toca la base): útil para monitoreo.
app.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString(), db: !!(process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL || !process.env.VERCEL) }));

// Antes de cualquier consulta, garantizamos que el esquema exista.
app.use(async (c, next) => {
  await ensureReady();
  c.header('Cache-Control', 'no-store');
  await next();
});

app.route('/auth', auth);

// Todo lo demás exige sesión.
const secured = new Hono<Env>();
secured.use('*', requireAuth);
secured.route('/', catalog);
secured.route('/', tables);
secured.route('/', orders);
secured.route('/', cash);
secured.route('/', transactions);
secured.route('/', credits);
secured.route('/', users);
secured.route('/', schedules);
secured.route('/', reports);
secured.route('/', me);
app.route('/', secured);

app.notFound((c) => c.json({ error: 'Ruta no encontrada' }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message, details: err.details }, err.status as 400);
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  const msg = String((err as Error)?.message || err);
  if (/UNIQUE constraint failed: orders/.test(msg)) return c.json({ error: 'La mesa ya tiene una cuenta abierta' }, 409);
  console.error('[api] error:', err);
  const dbHint = /DATABASE_URL|libsql|SQLITE|Hrana/i.test(msg) ? ` (${msg})` : '';
  return c.json({ error: `Error interno del servidor${dbHint}` }, 500);
});

export default app;
