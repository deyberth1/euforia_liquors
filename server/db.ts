import type { Client, InValue, Transaction } from '@libsql/client';
import bcrypt from 'bcryptjs';
import { config } from 'dotenv';

config();

export type Db = Client | Transaction;
export type Row = Record<string, unknown>;

let client: Client | null = null;
let ready: Promise<void> | null = null;

function resolveUrl(): { url: string; authToken?: string } {
  const url =
    process.env.DATABASE_URL ||
    process.env.TURSO_DATABASE_URL ||
    process.env.TURSO_URL ||
    'file:./data/euforia.db';
  const authToken =
    process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN || undefined;
  return { url, authToken: authToken || undefined };
}

/**
 * Crea el cliente. En Vercel (o con URL remota) usamos la variante "web" (solo HTTP/WebSocket),
 * que no arrastra el binario nativo de SQLite dentro de la función serverless.
 */
async function createDbClient(): Promise<Client> {
  const { url, authToken } = resolveUrl();
  if (url.startsWith('file:')) {
    if (process.env.VERCEL) {
      throw new Error('DATABASE_URL no está configurada. En Vercel debes definir DATABASE_URL (libsql://...) y DATABASE_AUTH_TOKEN.');
    }
    const mod = await import('@libsql/client');
    return mod.createClient({ url, authToken });
  }
  const mod = await import('@libsql/client/web');
  return mod.createClient({ url, authToken });
}

/** Cliente ya inicializado. Llama antes a ensureReady() (el API lo hace en un middleware). */
export function getClient(): Client {
  if (!client) throw new Error('La base de datos aún no está inicializada');
  return client;
}

/** Fecha/hora actual en ISO UTC (así se guarda todo en la base). */
export const nowIso = () => new Date().toISOString();

export async function all<T = Row>(db: Db, sql: string, args: InValue[] = []): Promise<T[]> {
  const res = await db.execute({ sql, args });
  return res.rows as unknown as T[];
}

export async function one<T = Row>(db: Db, sql: string, args: InValue[] = []): Promise<T | null> {
  const rows = await all<T>(db, sql, args);
  return rows[0] ?? null;
}

export async function run(db: Db, sql: string, args: InValue[] = []) {
  const res = await db.execute({ sql, args });
  return { lastId: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : 0, changes: res.rowsAffected };
}

/** Ejecuta `fn` dentro de una transacción de escritura, con rollback automático si falla. */
export async function withTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = await getClient().transaction('write');
  try {
    const out = await fn(tx);
    await tx.commit();
    return out;
  } catch (err) {
    try { await tx.rollback(); } catch { /* ya cerrada */ }
    throw err;
  } finally {
    tx.close();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'waiter' CHECK (role IN ('admin','waiter')),
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  track_stock INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);

CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'table' CHECK (type IN ('table','bar')),
  capacity INTEGER NOT NULL DEFAULT 4,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_by INTEGER NOT NULL REFERENCES users(id),
  opening_balance INTEGER NOT NULL DEFAULT 0,
  closing_balance INTEGER,
  expected_cash INTEGER,
  difference INTEGER,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by INTEGER REFERENCES users(id),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON cash_sessions(status);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER REFERENCES tables(id),
  label TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','cancelled')),
  opened_by INTEGER NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL,
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT,
  payment_method TEXT,
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  paid_cash INTEGER NOT NULL DEFAULT 0,
  paid_transfer INTEGER NOT NULL DEFAULT 0,
  credit_id INTEGER,
  cash_received INTEGER,
  cash_session_id INTEGER REFERENCES cash_sessions(id),
  notes TEXT,
  bill_requested_at TEXT,
  bill_requested_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_closed_at ON orders(closed_at);
CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_open_table ON orders(table_id) WHERE status = 'open' AND table_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  notes TEXT,
  added_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);

CREATE TABLE IF NOT EXISTS credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('receivable','payable')),
  party TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL CHECK (total > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  due_date TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS credit_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credit_id INTEGER NOT NULL REFERENCES credits(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','transfer')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','transfer')),
  order_id INTEGER REFERENCES orders(id),
  credit_id INTEGER REFERENCES credits(id),
  cash_session_id INTEGER REFERENCES cash_sessions(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_session ON transactions(cash_session_id);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(work_date);
`;

/** Crea el cliente (si no existe) y aplica el esquema. No inserta datos. */
export async function migrateSchema(): Promise<Client> {
  if (!client) client = await createDbClient();
  const statements = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean);
  await client.batch(statements.map((sql) => ({ sql, args: [] })), 'write');
  await addColumnIfMissing(client, 'users', 'is_owner', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(client, 'orders', 'bill_requested_at', 'TEXT');
  await addColumnIfMissing(client, 'orders', 'bill_requested_by', 'INTEGER');
  await rebuildOrdersIfNeeded(client);
  await addColumnIfMissing(client, 'credits', 'order_id', 'INTEGER');
  await addColumnIfMissing(client, 'users', 'last_seen_at', 'TEXT');
  return client;
}

/**
 * Versión 2 de `orders`: sin la restricción CHECK de payment_method (ahora admite 'mixed' y 'credit')
 * y con paid_cash / paid_transfer / credit_id. SQLite no permite quitar un CHECK, así que se
 * reconstruye la tabla en una sola transacción y se rellenan los montos de las ventas ya cobradas.
 */
async function rebuildOrdersIfNeeded(db: Client) {
  const row = await one<{ sql: string }>(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'");
  if (!row || !/CHECK\s*\(\s*payment_method/i.test(row.sql)) return;
  console.log('[db] Reconstruyendo tabla orders (v2: pagos mixtos y a crédito)…');
  const cols = 'id, table_id, label, status, opened_by, opened_at, closed_by, closed_at, payment_method, subtotal, discount, total, cash_received, cash_session_id, notes, bill_requested_at, bill_requested_by';
  // Un solo script en una misma conexión: las claves foráneas se apagan fuera de la transacción
  // (dentro de una transacción el PRAGMA no tiene efecto) y se vuelven a encender al final.
  await db.executeMultiple(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE orders_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id INTEGER REFERENCES tables(id),
      label TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','cancelled')),
      opened_by INTEGER NOT NULL REFERENCES users(id),
      opened_at TEXT NOT NULL,
      closed_by INTEGER REFERENCES users(id),
      closed_at TEXT,
      payment_method TEXT,
      subtotal INTEGER NOT NULL DEFAULT 0,
      discount INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      paid_cash INTEGER NOT NULL DEFAULT 0,
      paid_transfer INTEGER NOT NULL DEFAULT 0,
      credit_id INTEGER,
      cash_received INTEGER,
      cash_session_id INTEGER REFERENCES cash_sessions(id),
      notes TEXT,
      bill_requested_at TEXT,
      bill_requested_by INTEGER
    );
    INSERT INTO orders_v2 (${cols}) SELECT ${cols} FROM orders;
    UPDATE orders_v2 SET paid_cash = total WHERE status = 'paid' AND payment_method = 'cash';
    UPDATE orders_v2 SET paid_transfer = total WHERE status = 'paid' AND payment_method = 'transfer';
    DROP TABLE orders;
    ALTER TABLE orders_v2 RENAME TO orders;
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_closed_at ON orders(closed_at);
    CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_open_table ON orders(table_id) WHERE status = 'open' AND table_id IS NOT NULL;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

/** Migración suave: agrega una columna si la tabla aún no la tiene. */
async function addColumnIfMissing(db: Client, table: string, column: string, ddl: string) {
  const cols = await all<{ name: string }>(db, `PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) await run(db, `ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

/** Expresión SQL del rol efectivo: el dueño es un admin con is_owner = 1. */
export const ROLE_SQL = "CASE WHEN is_owner = 1 THEN 'owner' ELSE role END";
export const USER_COLS = `id, username, full_name, ${ROLE_SQL} AS role, is_active, last_login_at, last_seen_at, created_at`;

async function migrate() {
  const db = await migrateSchema();
  await seed(db);
}

/** Datos iniciales: administrador y mesas por defecto. Solo si la base está vacía. */
export async function seed(db: Client) {
  const users = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users');
  if (!users || Number(users.n) === 0) {
    const username = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'admin1234';
    const name = process.env.ADMIN_NAME || 'Administrador';
    const hash = await bcrypt.hash(password, 10);
    const ts = nowIso();
    await run(db, 'INSERT INTO users (username, password_hash, full_name, role, is_owner, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)', [
      username, hash, name, 'admin', ts, ts,
    ]);
    console.log(`[db] Usuario dueño creado: ${username}`);
  }
  // Siempre debe existir un dueño: si no hay, el administrador más antiguo pasa a serlo.
  const owner = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users WHERE is_owner = 1');
  if (Number(owner?.n) === 0) {
    await run(db, "UPDATE users SET is_owner = 1 WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1)");
  }

  const tables = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM tables');
  if (!tables || Number(tables.n) === 0) {
    const rows: [string, string, number, number][] = [];
    for (let i = 1; i <= 10; i++) rows.push([`Mesa ${i}`, 'table', 4, i]);
    rows.push(['Barra 1', 'bar', 2, 11], ['Barra 2', 'bar', 2, 12]);
    await db.batch(
      rows.map(([name, type, capacity, sort]) => ({
        sql: 'INSERT INTO tables (name, type, capacity, sort_order) VALUES (?, ?, ?, ?)',
        args: [name, type, capacity, sort],
      })),
      'write',
    );
  }

  const cats = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM categories');
  if (!cats || Number(cats.n) === 0) {
    const names = ['Cervezas', 'Licores', 'Cócteles', 'Vinos', 'Sin alcohol', 'Comida', 'Otros'];
    await db.batch(
      names.map((name, i) => ({ sql: 'INSERT INTO categories (name, sort_order) VALUES (?, ?)', args: [name, i] })),
      'write',
    );
  }
}

/** Garantiza que el esquema exista. Se ejecuta una vez por proceso (o por arranque en frío en Vercel). */
export function ensureReady(): Promise<void> {
  if (!ready) {
    ready = migrate().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}
