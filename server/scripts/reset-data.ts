/**
 * Deja la base lista para arrancar en limpio: borra todo el movimiento de prueba y conserva la configuración.
 *
 * Se borra: cuentas e ítems, turnos de caja, ingresos/gastos, créditos y abonos, historial de inventario
 * y las tablas legacy_* de la versión 1. El stock de todos los productos queda en 0.
 * Se conserva: usuarios, productos (precios, precio 2x1, categoría, activo), categorías, mesas y horarios.
 *
 * Antes de tocar nada guarda una copia completa de la base en data/backups/ (JSON, una clave por tabla).
 * Sin --confirm solo muestra lo que borraría.
 *
 *   npx tsx server/scripts/reset-data.ts --env .env.production            # revisar (no borra)
 *   npx tsx server/scripts/reset-data.ts --env .env.production --confirm  # borrar de verdad
 */
import { createClient, type Client } from '@libsql/client';
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const envIdx = args.indexOf('--env');
const envFile = envIdx >= 0 ? args[envIdx + 1] : undefined;
const CONFIRM = args.includes('--confirm');
if (envFile) config({ path: envFile, override: true, quiet: true });
else config({ quiet: true });

/** Tablas de movimiento, en orden hijo → padre para no romper claves foráneas. */
const WIPE = ['order_items', 'credit_payments', 'stock_movements', 'transactions', 'credits', 'orders', 'cash_sessions'];
const KEEP = ['users', 'products', 'categories', 'tables', 'schedules'];

const LABEL: Record<string, string> = {
  order_items: 'productos en cuentas', credit_payments: 'abonos a créditos', stock_movements: 'movimientos de inventario',
  transactions: 'ingresos/gastos (caja)', credits: 'créditos y préstamos', orders: 'cuentas / ventas', cash_sessions: 'turnos de caja',
  users: 'usuarios', products: 'productos', categories: 'categorías', tables: 'mesas', schedules: 'horarios',
};

const count = async (db: Client, table: string) => Number((await db.execute(`SELECT COUNT(*) AS n FROM "${table}"`)).rows[0]?.n ?? 0);

/** Orden para borrar las tablas legacy_*: primero las que ninguna otra tabla restante referencia. */
async function dropOrder(db: Client, tables: string[]): Promise<string[]> {
  const refs = new Map<string, Set<string>>();
  for (const t of tables) {
    const fks = (await db.execute(`PRAGMA foreign_key_list("${t}")`)).rows.map((r) => String(r.table));
    refs.set(t, new Set(fks.filter((p) => p !== t && tables.includes(p))));
  }
  const order: string[] = [];
  const left = new Set(tables);
  while (left.size) {
    const leaf = [...left].find((t) => ![...left].some((o) => o !== t && refs.get(o)!.has(t)));
    const next = leaf ?? [...left][0]; // ciclo improbable: se intenta igual
    order.push(next);
    left.delete(next);
  }
  return order;
}

async function backup(db: Client, host: string): Promise<string> {
  const names = (await db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).rows.map((r) => String(r.name));
  const dump: Record<string, unknown[]> = {};
  for (const n of names) dump[n] = (await db.execute(`SELECT * FROM "${n}"`)).rows.map((r) => ({ ...r }));
  mkdirSync('data/backups', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `data/backups/euforia-${host.startsWith('file:') ? 'local' : host.split('.')[0]}-${stamp}.json`;
  writeFileSync(file, JSON.stringify({ created_at: new Date().toISOString(), source: host, tables: dump }));
  return file;
}

async function main() {
  const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL || process.env.TURSO_URL || '';
  const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN || undefined;
  if (!url) throw new Error('Falta DATABASE_URL. Usa --env <archivo> con las variables de producción.');
  const host = url.startsWith('file:') ? url : new URL(url.replace(/^libsql:/, 'https:')).host;
  const db = createClient({ url, authToken: authToken || undefined });

  console.log(`\nBase de datos: ${host}${url.startsWith('file:') ? '  (archivo LOCAL, no es producción)' : ''}\n`);

  const names = (await db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows.map((r) => String(r.name));
  const missing = [...WIPE, ...KEEP].filter((t) => !names.includes(t));
  if (missing.length) throw new Error(`Esta base no tiene el esquema de la v2 (faltan: ${missing.join(', ')}).`);
  const legacy = names.filter((n) => n.startsWith('legacy_')).sort();

  console.log('SE BORRA:');
  for (const t of WIPE) console.log(`  ${String(await count(db, t)).padStart(6)}  ${LABEL[t]}`);
  for (const t of legacy) console.log(`  ${String(await count(db, t)).padStart(6)}  ${t} (sistema viejo, se elimina la tabla)`);
  const range = (await db.execute("SELECT MIN(opened_at) AS a, MAX(COALESCE(closed_at, opened_at)) AS b FROM orders")).rows[0];
  if (range?.a) console.log(`          cuentas desde ${String(range.a).slice(0, 16)} hasta ${String(range.b).slice(0, 16)} (UTC)`);
  const open = Number((await db.execute("SELECT COUNT(*) AS n FROM orders WHERE status = 'open'")).rows[0]?.n);
  const openCash = Number((await db.execute("SELECT COUNT(*) AS n FROM cash_sessions WHERE status = 'open'")).rows[0]?.n);
  if (open || openCash) console.log(`  ⚠  Hay ${open} cuenta(s) abierta(s) y ${openCash} caja(s) abierta(s): también se borran.`);
  const withStock = Number((await db.execute('SELECT COUNT(*) AS n FROM products WHERE stock != 0')).rows[0]?.n);
  console.log(`  stock a 0 en ${withStock} producto(s)`);

  console.log('\nSE CONSERVA:');
  for (const t of KEEP) console.log(`  ${String(await count(db, t)).padStart(6)}  ${LABEL[t]}`);

  const file = await backup(db, host);
  console.log(`\nCopia de seguridad completa guardada en ${file}`);

  if (!CONFIRM) {
    console.log('\nNo se borró nada. Para borrar de verdad, vuelve a correr el mismo comando con --confirm.\n');
    return;
  }

  const ts = new Date().toISOString();
  const stmts = [
    ...WIPE.map((t) => `DELETE FROM "${t}"`),
    `UPDATE products SET stock = 0, updated_at = '${ts}'`,
    // Que la numeración de cuentas, caja, etc. vuelva a empezar en 1.
    `DELETE FROM sqlite_sequence WHERE name IN (${[...WIPE, ...legacy].map((t) => `'${t}'`).join(', ')})`,
    ...(await dropOrder(db, legacy)).map((t) => `DROP TABLE IF EXISTS "${t}"`),
  ];
  await db.batch(stmts, 'write'); // una sola transacción: o se aplica todo o nada

  console.log('\nListo. Después de la limpieza:');
  for (const t of WIPE) console.log(`  ${String(await count(db, t)).padStart(6)}  ${LABEL[t]}`);
  for (const t of KEEP) console.log(`  ${String(await count(db, t)).padStart(6)}  ${LABEL[t]}`);
  const left = (await db.execute("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE 'legacy_%'")).rows[0]?.n;
  console.log(`  ${String(left).padStart(6)}  tablas legacy_*\n`);
}

main().catch((err) => {
  console.error(`\nError: ${(err as Error).message}\n`);
  process.exit(1);
});
