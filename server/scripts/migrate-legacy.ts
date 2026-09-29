/**
 * Migra la base de la versión 1 (esquema: sales/sale_items, locations, super_admin…) al esquema nuevo.
 *
 * Modo "en la misma base" (recomendado): DATABASE_URL apunta a la base v1. El script renombra las tablas
 * viejas a legacy_* (no borra nada), crea el esquema nuevo y copia los datos de la sede indicada.
 *
 * Modo "entre bases": además define LEGACY_DATABASE_URL (+ LEGACY_DATABASE_AUTH_TOKEN) con la base v1 y
 * DATABASE_URL con la base nueva (vacía).
 *
 * Se migran: usuarios (con su contraseña), categorías, productos, mesas, turnos de caja, ventas pagadas
 * (como cuentas con sus ítems), movimientos manuales y créditos con sus abonos. Las ventas "pendientes"
 * de la v1 no se migran (eran mesas abiertas sin cerrar).
 *
 * En la v1 los gastos y los turnos de caja no guardaban la sede (quedaron todos como sede 1 aunque
 * fueran de Euforia Drinks), así que por defecto NO se migran; siguen consultables en legacy_*.
 * Con LEGACY_INCLUDE_CASH=1 se migran de todas formas bajo la sede elegida.
 *
 *   npm run db:migrate-legacy                      # sede 1 (Euforia Liquors)
 *   LEGACY_LOCATION_ID=2 npm run db:migrate-legacy # otra sede
 */
import { createClient, type Client, type InValue } from '@libsql/client';
import { config } from 'dotenv';
import { migrateSchema, nowIso, one, run, seed } from '../db.js';

config();

const LOCATION_ID = Number(process.env.LEGACY_LOCATION_ID || 1);
const INCLUDE_CASH = process.env.LEGACY_INCLUDE_CASH === '1';
const V1_TABLES = ['users', 'products', 'tables', 'sales', 'sale_items', 'transactions', 'cash_sessions', 'credits', 'credit_payments', 'schedules', 'locations', 'user_locations'];
const V1_INDEXES = ['idx_sales_created_at', 'idx_transactions_created_at', 'idx_transactions_type', 'idx_products_name', 'idx_products_location', 'idx_tables_location', 'idx_sales_location', 'idx_transactions_location', 'idx_user_locations_loc', 'idx_credits_status', 'idx_credits_type'];

type Row = Record<string, InValue>;
const iso = (v: unknown): string => {
  const s = String(v ?? '').trim();
  if (!s) return nowIso();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return `${s.replace(' ', 'T')}.000Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? nowIso() : d.toISOString();
};
const int = (v: unknown) => Math.round(Number(v) || 0);
const pay = (v: unknown): 'cash' | 'transfer' => (String(v) === 'transfer' ? 'transfer' : 'cash');
const tableSort = (name: string) => { const m = /(\d+)/.exec(name); return (name.toLowerCase().startsWith('barra') ? 1000 : 0) + (m ? Number(m[1]) : 500); };

async function main() {
  const legacyUrl = process.env.LEGACY_DATABASE_URL;
  const targetUrl = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL || '';
  if (!targetUrl) throw new Error('Falta DATABASE_URL');

  // 1) Origen de los datos viejos.
  let src: Client;
  let prefix = 'legacy_';
  if (legacyUrl) {
    src = createClient({ url: legacyUrl, authToken: process.env.LEGACY_DATABASE_AUTH_TOKEN || undefined });
    prefix = '';
  } else {
    src = createClient({ url: targetUrl, authToken: process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || undefined });
    const names = (await src.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map((r) => String(r.name));
    const hasV1 = names.includes('sales') && !names.includes('legacy_sales');
    const hasNew = names.includes('orders');
    if (hasV1 && !hasNew) {
      console.log('Renombrando tablas v1 a legacy_* …');
      const stmts = [...V1_INDEXES.map((i) => `DROP INDEX IF EXISTS ${i}`), ...V1_TABLES.filter((t) => names.includes(t)).map((t) => `ALTER TABLE ${t} RENAME TO legacy_${t}`)];
      await src.batch(stmts.map((sql) => ({ sql, args: [] })), 'write');
    } else if (!names.includes('legacy_sales')) {
      throw new Error('No encuentro tablas de la v1 en esta base (ni sales ni legacy_sales).');
    }
  }
  const L = (t: string) => `${prefix}${t}`;
  const q = async (sql: string, args: InValue[] = []) => (await src.execute({ sql, args })).rows as unknown as Row[];

  // 2) Esquema nuevo en la base destino.
  const db = await migrateSchema();
  const already = await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM orders');
  if (Number(already?.n) > 0) throw new Error('La base destino ya tiene cuentas migradas; no se repite la migración.');
  const ts = nowIso();
  const r = { users: 0, products: 0, tables: 0, sessions: 0, orders: 0, items: 0, tx: 0, credits: 0, skippedPending: 0 };

  // 3) Usuarios (super_admin/admin/manager → admin, employee → mesero). Conservan su hash bcrypt.
  const userMap = new Map<number, number>();
  for (const u of await q(`SELECT id, username, password, role, full_name, is_active, last_login, created_at FROM ${L('users')} ORDER BY id`)) {
    const username = String(u.username).toLowerCase();
    let existing = await one<{ id: number }>(db, 'SELECT id FROM users WHERE username = ?', [username]);
    if (!existing) {
      const role = ['super_admin', 'admin', 'manager'].includes(String(u.role)) ? 'admin' : 'waiter';
      const { lastId } = await run(db, 'INSERT INTO users (username, password_hash, full_name, role, is_owner, is_active, last_login_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        username, String(u.password), String(u.full_name || username), role, String(u.role) === 'super_admin' ? 1 : 0, Number(u.is_active ?? 1) ? 1 : 0, u.last_login ? iso(u.last_login) : null, iso(u.created_at), ts,
      ]);
      existing = { id: lastId }; r.users++;
    }
    userMap.set(Number(u.id), Number(existing.id));
  }
  const firstAdmin = (await one<{ id: number }>(db, "SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1"))?.id ?? 1;
  const uid = (v: unknown) => userMap.get(Number(v)) ?? firstAdmin;

  // 4) Categorías y productos.
  const productMap = new Map<number, { id: number; name: string }>();
  const catIds = new Map<string, number>();
  for (const p of await q(`SELECT id, name, price, stock, category FROM ${L('products')} WHERE location_id = ? ORDER BY category, name`, [LOCATION_ID])) {
    const raw = String(p.category || 'Otros').trim() || 'Otros';
    const catName = raw.charAt(0).toUpperCase() + raw.slice(1);
    let catId = catIds.get(catName.toLowerCase());
    if (!catId) {
      const ex = await one<{ id: number }>(db, 'SELECT id FROM categories WHERE lower(name) = lower(?)', [catName]);
      if (ex) catId = Number(ex.id);
      else {
        const max = await one<{ m: number | null }>(db, 'SELECT MAX(sort_order) AS m FROM categories');
        catId = (await run(db, 'INSERT INTO categories (name, sort_order) VALUES (?, ?)', [catName, Number(max?.m ?? -1) + 1])).lastId;
      }
      catIds.set(catName.toLowerCase(), catId);
    }
    const { lastId } = await run(db, 'INSERT INTO products (name, price, category_id, stock, track_stock, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)', [
      String(p.name), int(p.price), catId, Math.max(0, int(p.stock)), ts, ts,
    ]);
    productMap.set(Number(p.id), { id: lastId, name: String(p.name) }); r.products++;
  }

  // 5) Mesas.
  const tableMap = new Map<number, number>();
  const tables = (await q(`SELECT id, name, type, capacity FROM ${L('tables')} WHERE location_id = ?`, [LOCATION_ID])).sort((a, b) => tableSort(String(a.name)) - tableSort(String(b.name)));
  let sort = 1;
  for (const t of tables) {
    let ex = await one<{ id: number }>(db, 'SELECT id FROM tables WHERE lower(name) = lower(?)', [String(t.name)]);
    if (!ex) {
      ex = { id: (await run(db, 'INSERT INTO tables (name, type, capacity, sort_order) VALUES (?, ?, ?, ?)', [String(t.name), String(t.type) === 'bar' ? 'bar' : 'table', Number(t.capacity) || 4, sort])).lastId };
      r.tables++;
    }
    tableMap.set(Number(t.id), Number(ex.id)); sort++;
  }

  // 6) Turnos de caja (los abiertos se cierran con nota; el efectivo esperado se recalcula al final).
  const sessions: { id: number; from: string; to: string }[] = [];
  if (INCLUDE_CASH) for (const s of await q(`SELECT * FROM ${L('cash_sessions')} WHERE location_id = ? ORDER BY opened_at`, [LOCATION_ID])) {
    const wasOpen = String(s.status) === 'open';
    const openedAt = iso(s.opened_at);
    const closedAt = wasOpen ? ts : iso(s.closed_at);
    const { lastId } = await run(db, 'INSERT INTO cash_sessions (status, opened_by, opening_balance, closing_balance, opened_at, closed_at, closed_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      'closed', uid(s.opened_by), int(s.opening_balance), s.closing_balance == null ? null : int(s.closing_balance), openedAt, closedAt, uid(s.closed_by ?? s.opened_by),
      wasOpen ? 'Cerrada automáticamente al migrar a la versión 2 (estaba abierta).' : null,
    ]);
    sessions.push({ id: lastId, from: openedAt, to: closedAt }); r.sessions++;
  }
  const sessionFor = (at: string) => sessions.find((s) => at >= s.from && at < s.to)?.id ?? null;

  // 7) Ventas pagadas → cuentas + ítems + movimiento de ingreso ligado.
  const sales = await q(`SELECT * FROM ${L('sales')} WHERE location_id = ? ORDER BY created_at, id`, [LOCATION_ID]);
  for (const s of sales) {
    if (String(s.status) !== 'paid') { r.skippedPending++; continue; }
    const at = iso(s.created_at);
    const items = await q(`SELECT product_id, quantity, price FROM ${L('sale_items')} WHERE sale_id = ?`, [Number(s.id)]);
    const subtotal = items.reduce((sum, i) => sum + int(i.price) * int(i.quantity), 0) || int(s.total);
    const total = int(s.total) || subtotal;
    const tableId = s.table_id ? tableMap.get(Number(s.table_id)) ?? null : null;
    const sessionId = sessionFor(at);
    const method = pay(s.payment_method);
    const { lastId: orderId } = await run(db, `INSERT INTO orders (table_id, label, status, opened_by, opened_at, closed_by, closed_at, payment_method, subtotal, discount, total, paid_cash, paid_transfer, cash_session_id)
       VALUES (?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      tableId, tableId ? null : 'Venta directa', uid(s.user_id), at, uid(s.user_id), at, method, subtotal, Math.max(0, subtotal - total), total, method === 'cash' ? total : 0, method === 'transfer' ? total : 0, sessionId,
    ]);
    for (const i of items) {
      const p = productMap.get(Number(i.product_id));
      const name = p?.name ?? String((await q(`SELECT name FROM ${L('products')} WHERE id = ?`, [Number(i.product_id)]))[0]?.name ?? `Producto #${i.product_id}`);
      await run(db, 'INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        orderId, p?.id ?? null, name, int(i.price), Math.max(1, int(i.quantity)), uid(s.user_id), at,
      ]);
      r.items++;
    }
    if (total > 0) {
      const tname = tableId ? (await one<{ name: string }>(db, 'SELECT name FROM tables WHERE id = ?', [tableId]))?.name : null;
      await run(db, 'INSERT INTO transactions (type, amount, description, payment_method, order_id, cash_session_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        'income', total, `Venta ${tname ?? 'directa'} · cuenta #${orderId}`, pay(s.payment_method), orderId, sessionId, uid(s.user_id), at,
      ]);
    }
    r.orders++;
  }

  // 8) Movimientos manuales (los generados por ventas ya vienen de las cuentas).
  if (INCLUDE_CASH) for (const t of await q(`SELECT * FROM ${L('transactions')} WHERE location_id = ? ORDER BY created_at, id`, [LOCATION_ID])) {
    const desc = String(t.description || '');
    if (String(t.type) === 'income' && /^venta/i.test(desc)) continue;
    const amount = int(t.amount);
    if (amount <= 0) continue;
    const at = iso(t.created_at);
    await run(db, 'INSERT INTO transactions (type, amount, description, payment_method, cash_session_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      String(t.type) === 'expense' ? 'expense' : 'income', amount, desc || 'Movimiento', pay(t.payment_method), sessionFor(at), uid(t.created_by), at,
    ]);
    r.tx++;
  }

  // 9) Créditos y abonos (sin generar movimientos: ya estaban en la v1).
  for (const c of await q(`SELECT * FROM ${L('credits')} ORDER BY id`)) {
    const total = int(c.total);
    if (total <= 0) continue;
    const { lastId } = await run(db, 'INSERT INTO credits (type, party, description, total, status, due_date, created_by, created_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      String(c.type) === 'payable' ? 'payable' : 'receivable', String(c.party || 'Sin nombre'), String(c.description || ''), total, String(c.status) === 'closed' ? 'closed' : 'open',
      c.due_date ? String(c.due_date) : null, firstAdmin, iso(c.created_at), String(c.status) === 'closed' ? iso(c.created_at) : null,
    ]);
    for (const p of await q(`SELECT amount, payment_method, created_at FROM ${L('credit_payments')} WHERE credit_id = ?`, [Number(c.id)])) {
      if (int(p.amount) <= 0) continue;
      await run(db, 'INSERT INTO credit_payments (credit_id, amount, payment_method, created_by, created_at) VALUES (?, ?, ?, ?, ?)', [lastId, int(p.amount), pay(p.payment_method), firstAdmin, iso(p.created_at)]);
    }
    r.credits++;
  }

  // 10) Efectivo esperado y diferencia de cada turno migrado, con la misma fórmula que usa la app.
  for (const s of sessions) {
    const row = await one<{ opening: number; closing: number | null }>(db, 'SELECT opening_balance AS opening, closing_balance AS closing FROM cash_sessions WHERE id = ?', [s.id]);
    const sums = await one<{ salesCash: number; otherCash: number; expCash: number }>(db, `
      SELECT COALESCE((SELECT SUM(paid_cash) FROM orders WHERE status='paid' AND cash_session_id = ?),0) AS salesCash,
             COALESCE((SELECT SUM(amount) FROM transactions WHERE cash_session_id = ? AND type='income' AND order_id IS NULL AND payment_method='cash'),0) AS otherCash,
             COALESCE((SELECT SUM(amount) FROM transactions WHERE cash_session_id = ? AND type='expense' AND payment_method='cash'),0) AS expCash`, [s.id, s.id, s.id]);
    const expected = Number(row?.opening ?? 0) + Number(sums?.salesCash ?? 0) + Number(sums?.otherCash ?? 0) - Number(sums?.expCash ?? 0);
    const closing = row?.closing == null ? expected : Number(row.closing);
    await run(db, 'UPDATE cash_sessions SET expected_cash = ?, closing_balance = ?, difference = ? WHERE id = ?', [expected, closing, closing - expected, s.id]);
  }

  await seed(db); // completa mesas/categorías por defecto solo si quedaron vacías
  console.log('Migración completa:', r);
  console.log('Las tablas viejas siguen disponibles como legacy_* (no se borró nada).');
}

main().then(() => process.exit(0)).catch((e) => { console.error('Error en la migración:', e); process.exit(1); });
