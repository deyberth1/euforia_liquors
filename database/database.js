try { require('dotenv').config(); } catch (e) {}
const path = require('path');

// If TURSO_URL is set, use libSQL (Turso). Otherwise use local sqlite3.
const useTurso = !!process.env.TURSO_URL;
let db;
if (useTurso) {
    const { createClient } = require('@libsql/client');
    const turso = createClient({
        url: process.env.TURSO_URL,
        authToken: process.env.TURSO_TOKEN
    });

    const toArgs = (params) => {
        if (params === undefined || params === null) return [];
        if (Array.isArray(params)) return params;
        return [params];
    };

    // Shim API similar to sqlite3 Database
    let opQueue = Promise.resolve();
    const schedule = (sql, params) => {
        opQueue = opQueue.then(() => turso.execute({ sql, args: toArgs(params) }));
        return opQueue;
    };

    db = {
        run(sql, params, cb) {
            if (typeof params === 'function') { cb = params; params = []; }
            schedule(sql, params).then((res) => {
                const ctx = {
                    lastID: res?.lastInsertRowid ? Number(res.lastInsertRowid) : undefined,
                    changes: typeof res?.rowsAffected === 'number' ? res.rowsAffected : undefined
                };
                if (cb) cb.call(ctx, null);
            }).catch((err) => {
                if (cb) cb(err);
            });
            return this;
        },
        get(sql, params, cb) {
            if (typeof params === 'function') { cb = params; params = []; }
            schedule(sql, params).then((res) => {
                const row = res?.rows?.[0] || undefined;
                if (cb) cb(null, row);
            }).catch((err) => cb && cb(err));
        },
        all(sql, params, cb) {
            if (typeof params === 'function') { cb = params; params = []; }
            schedule(sql, params).then((res) => {
                const rows = res?.rows ? res.rows.map(r => ({ ...r })) : [];
                if (cb) cb(null, rows);
            }).catch((err) => cb && cb(err));
        },
        serialize(fn) {
            // Ya estamos serializando vía opQueue; ejecutar el cuerpo inmediatamente
            if (typeof fn === 'function') fn();
        },
        prepare(sql) {
            const self = this;
            return {
                run(params, cb) {
                    if (typeof params === 'function') { cb = params; params = []; }
                    schedule(sql, params).then((res) => {
                        const ctx = {
                            lastID: res?.lastInsertRowid ? Number(res.lastInsertRowid) : undefined,
                            changes: typeof res?.rowsAffected === 'number' ? res.rowsAffected : undefined
                        };
                        if (cb) cb.call(ctx, null);
                    }).catch((err) => cb && cb(err));
                    return this;
                },
                finalize(cb) { if (cb) cb(); }
            };
        }
    };
} else {
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = path.join(__dirname, '..', 'euforia_liquors.db');
    db = new sqlite3.Database(dbPath);
}

// Initialize database tables
db.serialize(() => {
    // SQLite pragmas para modo sqlite local; en Turso se omiten
    if (!useTurso) {
        try { db.run("PRAGMA journal_mode = WAL"); } catch (e) {}
        try { db.run("PRAGMA synchronous = NORMAL"); } catch (e) {}
        try { db.run("PRAGMA foreign_keys = ON"); } catch (e) {}
    }
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'employee',
        full_name TEXT,
        email TEXT,
        phone TEXT,
        is_active BOOLEAN DEFAULT 1,
        last_login DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Add new columns solo en sqlite local
    if (!useTurso) {
        db.run(`ALTER TABLE users ADD COLUMN full_name TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding full_name column:', err.message);
            }
        });
        db.run(`ALTER TABLE users ADD COLUMN email TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding email column:', err.message);
            }
        });
        db.run(`ALTER TABLE users ADD COLUMN phone TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding phone column:', err.message);
            }
        });
        db.run(`ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding is_active column:', err.message);
            }
        });
        db.run(`ALTER TABLE users ADD COLUMN last_login DATETIME`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding last_login column:', err.message);
            }
        });
        db.run(`ALTER TABLE users ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding updated_at column:', err.message);
            }
        });
    }

    // Products table
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        stock INTEGER DEFAULT 0,
        category TEXT DEFAULT 'general',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tables table
    db.run(`CREATE TABLE IF NOT EXISTS tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'table',
        capacity INTEGER DEFAULT 4,
        status TEXT DEFAULT 'free',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Migrate tables extra columns if missing (solo sqlite local)
    if (!useTurso) {
        db.run(`ALTER TABLE tables ADD COLUMN type TEXT DEFAULT 'table'`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding tables.type column:', err.message);
            }
        });
        db.run(`ALTER TABLE tables ADD COLUMN capacity INTEGER DEFAULT 4`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding tables.capacity column:', err.message);
            }
        });
    }

    // Sales table
    db.run(`CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        table_id INTEGER,
        total INTEGER NOT NULL,
        sale_type TEXT DEFAULT 'direct',
        payment_method TEXT DEFAULT 'cash',
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (table_id) REFERENCES tables (id)
    )`);

    // Migrate sales.payment_method if missing (solo sqlite local)
    if (!useTurso) {
        db.run(`ALTER TABLE sales ADD COLUMN payment_method TEXT DEFAULT 'cash'`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding sales.payment_method:', err.message);
            }
        });
    }

    // Sale items table
    db.run(`CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        price INTEGER NOT NULL,
        FOREIGN KEY (sale_id) REFERENCES sales (id),
        FOREIGN KEY (product_id) REFERENCES products (id)
    )`);

    // Transactions table
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        description TEXT,
        payment_method TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Migrate transactions extra columns if missing (solo sqlite local)
    if (!useTurso) {
        db.run(`ALTER TABLE transactions ADD COLUMN payment_method TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding transactions.payment_method:', err.message);
            }
        });
        db.run(`ALTER TABLE transactions ADD COLUMN created_by INTEGER`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding transactions.created_by:', err.message);
            }
        });
    }

    // Schedules table
    db.run(`CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        work_date DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Cash sessions table
    db.run(`CREATE TABLE IF NOT EXISTS cash_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opened_by INTEGER NOT NULL,
        opening_balance REAL DEFAULT 0,
        closing_balance REAL,
        status TEXT DEFAULT 'open',
        opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME,
        closed_by INTEGER,
        FOREIGN KEY (opened_by) REFERENCES users (id),
        FOREIGN KEY (closed_by) REFERENCES users (id)
    )`);

    // Insert default admin user if not exists
    db.get("SELECT COUNT(*) as count FROM users WHERE username = 'deyberth20'", (err, row) => {
        if (err) {
            console.error('Error checking admin user:', err.message);
        } else if (row.count === 0) {
            const bcrypt = require('bcrypt');
            const saltRounds = 10;
            const defaultPassword = '54255012';
            
            bcrypt.hash(defaultPassword, saltRounds, (err, hash) => {
                if (err) {
                    console.error('Error hashing password:', err);
                } else {
                    // Try to insert with all columns, fallback to basic columns if needed
                    db.run("INSERT INTO users (username, password, role, full_name, email) VALUES (?, ?, ?, ?, ?)", 
                        ['deyberth20', hash, 'super_admin', 'Deyberth Chaverra', 'deyberth@euforialiquors.com'], (err) => {
                        if (err) {
                            // Fallback to basic columns if new columns don't exist yet
                            console.log('Trying fallback insert...');
                            db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", 
                                ['deyberth20', hash, 'super_admin'], (err2) => {
                                if (err2) {
                                    console.error('Error creating admin user:', err2.message);
                                } else {
                                    console.log('Default admin user created (username: deyberth20, password: 54255012)');
                                }
                            });
                        } else {
                            console.log('Default admin user created (username: deyberth20, password: 54255012)');
                        }
                    });
                }
            });
        }
    });

    // Insert some sample products if not exists
    db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
        if (err) {
            console.error('Error checking products:', err.message);
        } else if (row.count === 0) {
            const sampleProducts = [
                ['Cerveza Nacional', 8000, 50, 'bebidas'],
                ['Cerveza Importada', 12000, 30, 'bebidas'],
                ['Vino Tinto', 35000, 20, 'bebidas'],
                ['Whisky', 120000, 15, 'licores'],
                ['Ron', 90000, 25, 'licores'],
                ['Vodka', 85000, 20, 'licores'],
                ['Tequila', 95000, 18, 'licores'],
                ['Cóctel Margarita', 25000, 0, 'cocteles'],
                ['Cóctel Mojito', 23000, 0, 'cocteles'],
                ['Cóctel Piña Colada', 27000, 0, 'cocteles']
            ];

            const stmt = db.prepare("INSERT INTO products (name, price, stock, category) VALUES (?, ?, ?, ?)");
            sampleProducts.forEach(product => {
                stmt.run(product);
            });
            stmt.finalize();
            console.log('Sample products inserted');
        }
    });

    // Indexes for faster queries
    db.run("CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at)");
    db.run("CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at)");
    db.run("CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type)");
    db.run("CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)");

    // Insert some sample tables if not exists
    db.get("SELECT COUNT(*) as count FROM tables", (err, row) => {
        if (err) {
            console.error('Error checking tables:', err.message);
        } else if (row.count === 0) {
            const sampleTables = [
                { name: 'Mesa 1', type: 'table', capacity: 4 },
                { name: 'Mesa 2', type: 'table', capacity: 4 },
                { name: 'Mesa 3', type: 'table', capacity: 4 },
                { name: 'Mesa 4', type: 'table', capacity: 4 },
                { name: 'Mesa 5', type: 'table', capacity: 4 },
                { name: 'Mesa 6', type: 'table', capacity: 4 },
                { name: 'Mesa 7', type: 'table', capacity: 4 },
                { name: 'Mesa 8', type: 'table', capacity: 4 },
                { name: 'Mesa 9', type: 'table', capacity: 4 },
                { name: 'Mesa 10', type: 'table', capacity: 4 },
                { name: 'Barra 1', type: 'bar', capacity: 2 },
            ];

            const stmt = db.prepare("INSERT INTO tables (name, type, capacity) VALUES (?, ?, ?)");
            sampleTables.forEach(t => {
                stmt.run([t.name, t.type, t.capacity]);
            });
            stmt.finalize();
            console.log('Sample tables inserted');
        }
    });

    // Credits (accounts receivable/payable)
    db.run(`CREATE TABLE IF NOT EXISTS credits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL, -- 'receivable' | 'payable'
        description TEXT,
        party TEXT,
        total INTEGER NOT NULL,
        paid INTEGER DEFAULT 0,
        status TEXT DEFAULT 'open', -- 'open' | 'closed'
        due_date DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS credit_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credit_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        payment_method TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (credit_id) REFERENCES credits (id)
    )`);

    db.run("CREATE INDEX IF NOT EXISTS idx_credits_status ON credits(status)");
    db.run("CREATE INDEX IF NOT EXISTS idx_credits_type ON credits(type)");
});

console.log('Database initialized successfully');

module.exports = db;
