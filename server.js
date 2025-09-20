try { require('dotenv').config(); } catch (e) {}
const express = require('express');
const path = require('path');
const db = require('./database/database');
const bcrypt = require('bcrypt');
const http = require('http');
let helmet, rateLimit;
try { helmet = require('helmet'); } catch(_) {}
try { rateLimit = require('express-rate-limit'); } catch(_) {}

const app = express();
app.use(express.json({ limit: '1mb' }));
try { app.use(require('compression')()); } catch (e) { /* optional */ }
if (helmet) {
  try { app.use(helmet({ crossOriginResourcePolicy: false })); } catch (_) {}
}

// Simple CORS for local file:// usage
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-location-id');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Location middleware
app.use((req, res, next) => {
  const hdr = req.headers['x-location-id'];
  const loc = parseInt(hdr || '1');
  req.locationId = Number.isFinite(loc) && loc > 0 ? loc : 1;
  next();
});

// DB reliability: wrap db.get/all/run with small retry/backoff for transients
(function attachDbRetries() {
  const isTransient = (err) => {
    const msg = String((err && err.message) || err || '').toLowerCase();
    return (
      msg.includes('busy') || msg.includes('locked') ||
      msg.includes('timeout') || msg.includes('reset') ||
      msg.includes('temporary') || msg.includes('fetch') || msg.includes('network')
    );
  };
  const wrap = (method) => {
    const original = db[method] && db[method].bind(db);
    if (!original) return;
    db[method] = function(sql, params, cb) {
      if (typeof params === 'function') { cb = params; params = []; }
      let attempts = 0;
      const max = 3;
      const attempt = () => {
        attempts++;
        try {
          original(sql, params, function(err, result) {
            if (err && isTransient(err) && attempts < max) {
              setTimeout(attempt, 100 * attempts);
              return;
            }
            if (cb) cb.apply(this, arguments);
          });
        } catch (e) {
          if (isTransient(e) && attempts < max) {
            setTimeout(attempt, 100 * attempts);
          } else {
            if (cb) cb(e);
          }
        }
      };
      attempt();
      return this;
    };
  };
  ['get','all','run'].forEach(wrap);
})();

// Auth
const loginHandler = (req, res) => {
  const rawUser = req.body?.username || '';
  const username = String(rawUser).trim().toLowerCase();
  const password = req.body?.password || '';
  const sql = 'SELECT * FROM users WHERE username = ?';
  db.get(sql, [username], (err, user) => {
    if (err) {
      console.error('Login DB error:', err && err.message ? err.message : err);
      return res.status(500).json({ success: false, error: 'db' });
    }
    if (!user) return res.json({ success: false, error: 'Invalid credentials' });
    bcrypt.compare(password, user.password, (err, ok) => {
      if (ok) {
        const { password, ...userWithoutPassword } = user;
        res.json({ success: true, user: userWithoutPassword });
      } else {
        res.json({ success: false, error: 'Invalid credentials' });
      }
    });
  });
};
if (rateLimit) {
  const limiter = rateLimit({ windowMs: 60 * 1000, max: 15 });
  app.post('/api/login', limiter, loginHandler);
} else {
  app.post('/api/login', loginHandler);
}

// Simple health endpoint to verify DB connectivity
app.get('/api/health', (req, res) => {
  db.get('SELECT COUNT(1) as users FROM users', [], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    res.json({ ok: true, users: row?.users || 0 });
  });
});

// Dashboard summary (localtime-safe)
app.get('/api/dashboard/summary', (req, res) => {
  const salesSql = "SELECT COALESCE(SUM(total), 0) as totalSales FROM sales WHERE DATE(created_at, 'localtime') = DATE('now','localtime') AND status = 'paid'";
  db.get(salesSql, [], (err, sales) => {
    if (err) return res.json({ totalSales: 0, totalIncomeToday: 0, activeTables: 0, lowStockProducts: 0, totalTransactions: 0 });
    const incomeSql = "SELECT COALESCE(SUM(amount),0) as totalIncomeToday FROM transactions WHERE type = 'income' AND DATE(created_at, 'localtime') = DATE('now','localtime')";
    db.get(incomeSql, [], (e0, inc) => {
      const incomes = e0 ? 0 : (inc?.totalIncomeToday || 0);
      const tablesSql = "SELECT COUNT(*) as activeTables FROM tables WHERE status = 'occupied'";
      db.get(tablesSql, [], (err, tables) => {
        if (err) return res.json({ totalSales: sales.totalSales || 0, totalIncomeToday: incomes, activeTables: 0, lowStockProducts: 0, totalTransactions: 0 });
        const stockSql = "SELECT COUNT(*) as lowStockProducts FROM products WHERE stock < 10";
        db.get(stockSql, [], (err, stock) => {
          if (err) return res.json({ totalSales: sales.totalSales || 0, totalIncomeToday: incomes, activeTables: tables.activeTables || 0, lowStockProducts: 0, totalTransactions: 0 });
          const transSql = "SELECT COUNT(*) as totalTransactions FROM sales WHERE DATE(created_at, 'localtime') = DATE('now','localtime')";
          db.get(transSql, [], (err, trans) => {
            if (err) return res.json({ totalSales: sales.totalSales || 0, totalIncomeToday: incomes, activeTables: tables.activeTables || 0, lowStockProducts: stock.lowStockProducts || 0, totalTransactions: 0 });
            res.json({ totalSales: sales.totalSales || 0, totalIncomeToday: incomes, activeTables: tables.activeTables || 0, lowStockProducts: stock.lowStockProducts || 0, totalTransactions: trans.totalTransactions || 0 });
          });
        });
      });
    });
  });
});

// Products
app.get('/api/products', (req, res) => {
  const forSale = req.query.forSale === 'true';
  const sql = forSale ? 'SELECT * FROM products WHERE stock > 0 AND location_id = ? ORDER BY name' : 'SELECT * FROM products WHERE location_id = ? ORDER BY name';
  db.all(sql, [req.locationId], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.post('/api/products', (req, res) => {
  const { name, price, stock, category } = req.body;
  const sql = 'INSERT INTO products (name, price, stock, category, location_id) VALUES (?, ?, ?, ?, ?)';
  db.run(sql, [name, Math.round(Number(price)||0), parseInt(stock)||0, category, req.locationId], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

app.put('/api/products/:id', (req, res) => {
  const { name, price, stock, category } = req.body;
  const { id } = req.params;
  const sql = 'UPDATE products SET name = ?, price = ?, stock = ?, category = ? WHERE id = ? AND location_id = ?';
  db.run(sql, [name, Math.round(Number(price)||0), parseInt(stock)||0, category, id, req.locationId], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, changes: this.changes });
  });
});

app.delete('/api/products/:id', (req, res) => {
  const { id } = req.params;
  const sql = 'DELETE FROM products WHERE id = ? AND location_id = ?';
  db.run(sql, [id, req.locationId], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, changes: this.changes });
  });
});

// Tables
app.get('/api/tables', (req, res) => {
  const sql = `
    SELECT t.*, COALESCE(s.total, 0) as currentTotal, COALESCE(si.itemCount, 0) as itemCount
    FROM tables t
    LEFT JOIN (
      SELECT table_id, SUM(total) as total FROM sales WHERE status = 'pending' GROUP BY table_id
    ) s ON t.id = s.table_id
    LEFT JOIN (
      SELECT s.table_id, SUM(si.quantity) as itemCount
      FROM sales s JOIN sale_items si ON s.id = si.sale_id
      WHERE s.status = 'pending' GROUP BY s.table_id
    ) si ON t.id = si.table_id
    WHERE t.location_id = ?
    ORDER BY
      CASE
        WHEN t.name LIKE 'Mesa %' THEN 0
        WHEN t.name LIKE 'Barra %' THEN 1
        ELSE 2
      END,
      CASE WHEN t.name LIKE 'Mesa %' THEN CAST(SUBSTR(t.name, 6) AS INTEGER) END,
      CASE WHEN t.name LIKE 'Barra %' THEN CAST(SUBSTR(t.name, 7) AS INTEGER) END,
      t.name`;
  db.all(sql, [req.locationId], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.get('/api/tables/free', (req, res) => {
  const sql = "SELECT * FROM tables WHERE status = 'free' AND location_id = ? ORDER BY name";
  db.all(sql, [req.locationId], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

// Tables CRUD
app.post('/api/tables', (req, res) => {
  const rawName = String(req.body?.name || '').trim();
  const type = String(req.body?.type || 'table');
  const capacity = parseInt(req.body?.capacity) || 4;
  if (!rawName) return res.status(400).json({ success: false, error: 'Nombre requerido' });
  const sql = 'INSERT INTO tables (name, type, capacity, location_id) VALUES (?, ?, ?, ?)';
  db.run(sql, [rawName, type, capacity, req.locationId], function(err) {
    if (err) {
      if (String(err.message||'').includes('UNIQUE constraint failed')) {
        return res.status(400).json({ success: false, error: 'Ya existe una mesa con ese nombre' });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, id: this.lastID });
  });
});

app.put('/api/tables/:id', (req, res) => {
  const { id } = req.params;
  const name = String(req.body?.name||'').trim();
  const type = String(req.body?.type || 'table');
  const capacity = parseInt(req.body?.capacity) || 4;
  const status = req.body?.status;
  const fields = ['name = ?', 'type = ?', 'capacity = ?'];
  const params = [name, type, parseInt(capacity)||4];
  if (status) { fields.push('status = ?'); params.push(status); }
  params.push(id, req.locationId);
  const sql = `UPDATE tables SET ${fields.join(', ')}, created_at = created_at WHERE id = ? AND location_id = ?`;
  db.run(sql, params, function(err) {
    if (err) {
      if (String(err.message||'').includes('UNIQUE constraint failed')) {
        return res.status(400).json({ success: false, error: 'Ya existe una mesa con ese nombre' });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, changes: this.changes });
  });
});

app.delete('/api/tables/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM tables WHERE id = ? AND location_id = ?', [id, req.locationId], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, changes: this.changes });
  });
});

app.get('/api/tables/:id/order', (req, res) => {
  const { id } = req.params;
  const sql = `
    SELECT si.product_id as id, p.name, si.price, si.quantity
    FROM sales s
    JOIN sale_items si ON s.id = si.sale_id
    JOIN products p ON si.product_id = p.id
    WHERE s.table_id = ? AND s.status = 'pending'`;
  db.all(sql, [id], (err, rows) => {
    if (err) return res.status(500).json({ items: [] });
    res.json({ items: rows });
  });
});

// Sales
app.post('/api/sales/process', (req, res) => {
  const saleData = req.body;
  const idemKey = String(saleData.idempotency_key || '')
    .replace(/[^a-zA-Z0-9_-]/g,'')
    .slice(0,64);
  db.serialize(() => {
    db.run('BEGIN TRANSACTION;');
    if (idemKey) {
      // Prevent duplicate processing using sales.idempotency_key
      db.get('SELECT id FROM sales WHERE idempotency_key = ? AND location_id = ?', [ idemKey, req.locationId ], (err, row) => {
        if (row) { db.run('ROLLBACK;'); return res.json({ success:true, duplicate:true }); }
      });
    }
    const saleSql = `INSERT INTO sales (user_id, table_id, total, sale_type, payment_method, status, idempotency_key, location_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`;
    const tableId = saleData.tableId;
    const saleType = tableId ? 'table' : 'direct';
    const payment = saleData.payment_method || 'cash';
    const status = 'paid';

    const proceedWithInsert = () => {
      const items = Array.isArray(saleData.items) ? saleData.items : [];
      const tableId = saleData.tableId;
      // If trying to process with no items: for table → free it; for direct → reject
      if (items.length === 0) {
        if (tableId) {
          db.run(`UPDATE tables SET status = 'free' WHERE id = ?`, [tableId], (err) => {
            if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
            db.run('COMMIT;', (err) => {
              if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
              return res.json({ success: true, cleared: true });
            });
          });
        } else {
          db.run('ROLLBACK;');
          return res.status(400).json({ success: false, error: 'No hay items' });
        }
        return;
      }
      db.run(saleSql, [1, tableId, Math.round(Number(saleData.total)||0), saleType, payment, status, idemKey || null, req.locationId], function(err) {
        if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
        const saleId = this.lastID;
        const itemsSql = `INSERT INTO sale_items (sale_id, product_id, quantity, price) VALUES (?, ?, ?, ?)`;
        const stockSql = `UPDATE products SET stock = stock - ? WHERE id = ?`;

        let itemsProcessed = 0;
        const totalItems = items.length;
        items.forEach(item => {
          db.run(itemsSql, [saleId, item.id, item.quantity, item.price], (err) => {
            if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
          });
          db.run(stockSql, [item.quantity, item.id], (err) => {
            if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
            itemsProcessed++;
            if (itemsProcessed === totalItems) {
              const transSql = `INSERT INTO transactions (type, amount, description, payment_method, created_by, location_id) VALUES ('income', ?, ?, ?, ?, ?)`;
              const amountToInsert = Math.round(Number(saleData.total)||0);
              const insertTx = (desc) => db.run(transSql, [amountToInsert, desc, payment, 1, req.locationId], (err) => {
                if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
                const finalizeCommit = () => db.run('COMMIT;', (err) => {
                  if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
                  res.json({ success: true, saleId });
                });
                if (tableId) {
                  db.run(`UPDATE tables SET status = 'free' WHERE id = ?`, [tableId], (err) => {
                    if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
                    finalizeCommit();
                  });
                } else {
                  finalizeCommit();
                }
              });

              if (saleType === 'table' && tableId) {
                db.get('SELECT name FROM tables WHERE id = ?', [tableId], (e2, row) => {
                  const tableName = row?.name ? String(row.name) : `Mesa ${tableId}`;
                  insertTx(`Venta de mesa — ${tableName}`);
                });
              } else {
                insertTx('Venta directa');
              }
            }
          });
        });
      });
    };

    if (tableId) {
      db.run(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE table_id = ? AND status = 'pending')`, [tableId], (err) => {
        if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
        db.run(`DELETE FROM sales WHERE table_id = ? AND status = 'pending'`, [tableId], (err) => {
          if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
          proceedWithInsert();
        });
      });
    } else {
      proceedWithInsert();
    }
  });
});

app.post('/api/sales/save', (req, res) => {
  const orderData = req.body;
  try { console.log('[save-order] payload:', JSON.stringify(orderData)); } catch(_) {}
  db.serialize(() => {
    db.run('BEGIN TRANSACTION;');
    const saleSql = `INSERT INTO sales (user_id, table_id, total, sale_type, payment_method, status, idempotency_key, location_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`;
    const tableId = orderData.tableId;
    const saleType = tableId ? 'table' : 'direct';
    const payment = orderData.payment_method || 'cash';
    const status = 'pending';
    const rawItems = Array.isArray(orderData.items) ? orderData.items : [];
    const items = rawItems.map(it => ({ id: parseInt(it.id)||0, quantity: parseInt(it.quantity)||0, price: Math.round(Number(it.price)||0) }))
      .filter(it => it.id > 0 && it.quantity > 0);
    const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    const insertNewPending = () => {
      db.run(saleSql, [1, tableId, Math.round(Number(total)||0), saleType, payment, status, null, req.locationId], function(err) {
        if (err) { try { console.error('[save-order] insert sale error:', err); } catch(_) {} db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
        const saleId = this.lastID;
        const itemsSql = `INSERT INTO sale_items (sale_id, product_id, quantity, price) VALUES (?, ?, ?, ?)`;
        let itemsProcessed = 0;
        const totalItems = items.length;
        if (totalItems === 0) {
          // No items → just free the table if any, and commit
          if (tableId) {
            db.run(`UPDATE tables SET status = 'free' WHERE id = ?`, [tableId], (err) => {
              if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
              db.run('COMMIT;', (err) => {
                if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
                res.json({ success: true, cleared: true });
              });
            });
          } else {
            db.run('COMMIT;', (err) => {
              if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
              res.json({ success: true, cleared: true });
            });
          }
          return;
        }
        items.forEach(item => {
          db.run(itemsSql, [saleId, item.id, item.quantity, item.price], (err) => {
            if (err) { try { console.error('[save-order] insert item error:', err, { saleId, item }); } catch(_) {} db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
            itemsProcessed++;
            if (itemsProcessed === totalItems) {
              const finalize = () => db.run('COMMIT;', (err) => {
                if (err) { try { console.error('[save-order] commit error:', err); } catch(_) {} db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
                res.json({ success: true, saleId });
              });
              if (tableId) {
                db.run(`UPDATE tables SET status = 'occupied' WHERE id = ?`, [tableId], (err) => {
                  if (err) { try { console.error('[save-order] update table error:', err); } catch(_) {} db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
                  finalize();
                });
              } else {
                finalize();
              }
            }
          });
        });
      });
    };

    if (tableId) {
      // Replace existing pending order for the table
      db.run(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE table_id = ? AND status = 'pending')`, [tableId], (err) => {
        if (err) { try { console.error('[save-order] delete old items error:', err); } catch(_) {} db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
        db.run(`DELETE FROM sales WHERE table_id = ? AND status = 'pending'`, [tableId], (err) => {
          if (err) { try { console.error('[save-order] delete old sales error:', err); } catch(_) {} db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
          if (items.length === 0 || Math.round(Number(total)||0) <= 0) {
            // No items → simply free the table and commit
            db.run(`UPDATE tables SET status = 'free' WHERE id = ?`, [tableId], (err) => {
              if (err) { try { console.error('[save-order] free table error:', err); } catch(_) {} db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
              db.run('COMMIT;', (err) => {
                if (err) { try { console.error('[save-order] commit clear error:', err); } catch(_) {} db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
                res.json({ success: true, cleared: true });
              });
            });
          } else {
            insertNewPending();
          }
        });
      });
    } else {
      // Direct sale save without table: require items
      if (items.length === 0 || Math.round(Number(total)||0) <= 0) {
        try { console.warn('[save-order] direct save with no items'); } catch(_) {}
        db.run('ROLLBACK;');
        return res.status(400).json({ success: false, error: 'Sin items' });
      }
      insertNewPending();
    }
  });
});

// Transactions & filters
app.get('/api/transactions', (req, res) => {
  const { from, to, type, payment } = req.query;
  let sql = 'SELECT t.*, u.username as created_by_username FROM transactions t LEFT JOIN users u ON t.created_by = u.id WHERE 1=1';
  const params = [];
  if (type) { sql += ' AND t.type = ?'; params.push(type); }
  if (payment) { sql += ' AND t.payment_method = ?'; params.push(payment); }
  if (from) { sql += ' AND DATE(t.created_at) >= ?'; params.push(from); }
  if (to) { sql += ' AND DATE(t.created_at) <= ?'; params.push(to); }
  sql += ' ORDER BY t.created_at DESC';
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

// Update/Delete transactions (super admin only, pass user_role='super_admin')
app.put('/api/transactions/:id', (req, res) => {
  const { id } = req.params;
  const { amount, description, payment_method, type, user_role } = req.body;
  if (user_role !== 'super_admin') return res.status(403).json({ success:false, error:'Forbidden' });
  const fields = [];
  const params = [];
  if (typeof amount !== 'undefined') { fields.push('amount = ?'); params.push(Math.round(Number(amount)||0)); }
  if (typeof description !== 'undefined') { fields.push('description = ?'); params.push(description); }
  if (typeof payment_method !== 'undefined') { fields.push('payment_method = ?'); params.push(payment_method); }
  if (typeof type !== 'undefined') { fields.push('type = ?'); params.push(type); }
  if (fields.length === 0) return res.json({ success:true, changes:0 });
  const sql = `UPDATE transactions SET ${fields.join(', ')}, created_at = created_at WHERE id = ?`;
  params.push(id);
  db.run(sql, params, function(err){
    if (err) return res.status(500).json({ success:false, error: err.message });
    res.json({ success:true, changes: this.changes });
  });
});

app.delete('/api/transactions/:id', (req, res) => {
  const { id } = req.params;
  const user_role = req.query.user_role || req.body?.user_role;
  if (user_role !== 'super_admin') return res.status(403).json({ success:false, error:'Forbidden' });
  db.run('DELETE FROM transactions WHERE id = ?', [id], function(err){
    if (err) return res.status(500).json({ success:false, error: err.message });
    res.json({ success:true, changes: this.changes });
  });
});

// Credits API (accounts receivable/payable)
app.get('/api/credits', (req, res) => {
  const { type, status } = req.query;
  let sql = 'SELECT c.*, (c.total - COALESCE(p.paid,0)) as balance, COALESCE(p.paid,0) as paid_amount FROM credits c LEFT JOIN (SELECT credit_id, SUM(amount) as paid FROM credit_payments GROUP BY credit_id) p ON c.id = p.credit_id WHERE 1=1';
  const params = [];
  if (type) { sql += ' AND c.type = ?'; params.push(type); }
  if (status) { sql += ' AND c.status = ?'; params.push(status); }
  sql += ' ORDER BY c.created_at DESC';
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.post('/api/credits', (req, res) => {
  const { type, description, party, total, due_date } = req.body;
  if (!type || !total) return res.status(400).json({ success:false, error:'type and total are required' });
  const sql = 'INSERT INTO credits (type, description, party, total, due_date) VALUES (?, ?, ?, ?, ?)';
  db.run(sql, [type, description, party, Math.round(Number(total)||0), due_date || null], function(err) {
    if (err) return res.status(500).json({ success:false, error: err.message });
    res.json({ success:true, id: this.lastID });
  });
});

app.post('/api/credits/:id/payments', (req, res) => {
  const { id } = req.params;
  const { amount, payment_method } = req.body;
  const amt = Math.round(Number(amount)||0);
  if (!amt || amt <= 0) return res.status(400).json({ success:false, error:'invalid amount' });
  db.run('INSERT INTO credit_payments (credit_id, amount, payment_method) VALUES (?, ?, ?)', [id, amt, payment_method || 'cash'], function(err) {
    if (err) return res.status(500).json({ success:false, error: err.message });
    // Close credit if fully paid
    db.get('SELECT total, (SELECT COALESCE(SUM(amount),0) FROM credit_payments WHERE credit_id = ?) as paid FROM credits WHERE id = ?', [id, id], (err2, row) => {
      if (row && Math.round(Number(row.paid)||0) >= Math.round(Number(row.total)||0)) {
        db.run('UPDATE credits SET status = "closed", paid = ? WHERE id = ?', [Math.round(Number(row.paid)||0), id]);
      } else if (row) {
        db.run('UPDATE credits SET paid = ? WHERE id = ?', [Math.round(Number(row.paid)||0), id]);
      }
      res.json({ success:true, id: this.lastID });
    });
  });
});

app.put('/api/credits/:id/status', (req, res) => {
  const { id } = req.params;
  const { status, created_by } = req.body; // 'open' | 'closed'
  if (!status) return res.status(400).json({ success:false, error:'status required' });
  // Read current credit
  db.get('SELECT * FROM credits WHERE id = ?', [id], (err, credit) => {
    if (err) return res.status(500).json({ success:false, error: err.message });
    if (!credit) return res.status(404).json({ success:false, error:'not found' });
    if (credit.status === status) return res.json({ success:true, changes: 0 });
    db.run('UPDATE credits SET status = ? WHERE id = ?', [status, id], function(err2) {
      if (err2) return res.status(500).json({ success:false, error: err2.message });
      if (status === 'closed') {
        // Compute paid amount
        db.get('SELECT COALESCE(SUM(amount),0) as paid FROM credit_payments WHERE credit_id = ?', [id], (e3, sumRow) => {
          const paid = Math.round(Number(sumRow?.paid || credit.paid || 0));
          const amount = paid > 0 ? paid : Math.round(Number(credit.total || 0));
          if (amount <= 0) return res.json({ success:true, changes: this.changes });
          const type = credit.type === 'payable' ? 'expense' : 'income';
          const descPrefix = credit.type === 'payable' ? 'Crédito pagado' : 'Crédito cobrado';
          const description = `${descPrefix}: ${credit.description || ''} ${credit.party ? '('+credit.party+')' : ''}`.trim();
          db.run('INSERT INTO transactions (type, amount, description, payment_method, created_by) VALUES (?, ?, ?, ?, ?)',
            [type, amount, description, 'credit', created_by || 1], function(e4){
              if (e4) return res.status(500).json({ success:false, error: e4.message });
              return res.json({ success:true, changes: 1, transactionId: this.lastID });
            });
        });
      } else {
        res.json({ success:true, changes: this.changes });
      }
    });
  });
});

// Cash summary (for suggested closing amount)
app.get('/api/cash/summary', (req, res) => {
  // Get last open session and compute cash movements since then
  db.get("SELECT id, opening_balance, opened_at FROM cash_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1", [], (err, open) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!open) return res.json({ hasOpen: false });
    const opening = Number(open.opening_balance || 0);
    const since = open.opened_at;
    const sql = "SELECT type, payment_method, amount FROM transactions WHERE datetime(created_at) >= datetime(?)";
    db.all(sql, [since], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const cashIncome = rows.filter(r => r.type === 'income' && r.payment_method === 'cash').reduce((s, r) => s + Number(r.amount||0), 0);
      const cashExpense = rows.filter(r => r.type === 'expense' && r.payment_method === 'cash').reduce((s, r) => s + Number(r.amount||0), 0);
      const suggestedClose = opening + cashIncome - cashExpense;
      res.json({ hasOpen: true, opening, cashIncome, cashExpense, suggestedClose });
    });
  });
});

// Turn summary (since a cash session opened_at)
app.get('/api/cash/turn-summary', (req, res) => {
  const sessionParam = req.query.session; // 'open' or undefined
  const sessionId = req.query.id ? parseInt(req.query.id) : null;
  const findSql = sessionId
    ? "SELECT id, opening_balance, opened_at FROM cash_sessions WHERE id = ?"
    : "SELECT id, opening_balance, opened_at FROM cash_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1";
  const params = sessionId ? [sessionId] : [];
  db.get(findSql, params, (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.json({ hasOpen: false });
    const opening = Number(row.opening_balance || 0);
    const since = row.opened_at;
    const q = "SELECT type, payment_method, amount FROM transactions WHERE datetime(created_at) >= datetime(?)";
    db.all(q, [since], (e2, txs) => {
      if (e2) return res.status(500).json({ error: e2.message });
      const sum = (f) => txs.filter(f).reduce((s, r) => s + Number(r.amount || 0), 0);
      const income = sum(r => r.type === 'income');
      const incomeCash = sum(r => r.type === 'income' && r.payment_method === 'cash');
      const incomeTransfer = sum(r => r.type === 'income' && r.payment_method === 'transfer');
      const expense = sum(r => r.type === 'expense');
      const expenseCash = sum(r => r.type === 'expense' && r.payment_method === 'cash');
      // Sales from sales table during turn (paid)
      db.get("SELECT COALESCE(SUM(total),0) as sales FROM sales WHERE datetime(created_at) >= datetime(?) AND status = 'paid'", [since], (e3, s1) => {
        const salesTotal = e3 ? 0 : (s1?.sales || 0);
        db.get("SELECT COALESCE(SUM(total),0) as salesCash FROM sales WHERE datetime(created_at) >= datetime(?) AND status = 'paid' AND payment_method = 'cash'", [since], (e4, sc) => {
          const salesCash = e4 ? 0 : (sc?.salesCash || 0);
          db.get("SELECT COALESCE(SUM(total),0) as salesTransfer FROM sales WHERE datetime(created_at) >= datetime(?) AND status = 'paid' AND payment_method = 'transfer'", [since], (e5, st) => {
            const salesTransfer = e5 ? 0 : (st?.salesTransfer || 0);
            const otherIncome = Math.max(0, income - salesTotal);
            const suggestedClose = opening + incomeCash - expenseCash;
            res.json({
        hasOpen: true,
        sessionId: row.id,
        opening,
        since,
        income,
        incomeCash,
        incomeTransfer,
        expense,
        expenseCash,
        sales: salesTotal,
        salesCash,
        salesTransfer,
        otherIncome,
        balance: income - expense,
        suggestedClose
            });
          });
        });
      });
    });
  });
});

app.post('/api/transactions/income', (req, res) => {
  const { description, amount, user_id, payment_method } = req.body;
  const pay = payment_method === 'transfer' ? 'transfer' : 'cash';
  const sql = "INSERT INTO transactions (type, description, amount, payment_method, created_by) VALUES ('income', ?, ?, ?, ?)";
  db.run(sql, [description, Math.round(Number(amount)||0), pay, user_id || 1], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

app.post('/api/transactions/expense', (req, res) => {
  const { description, amount, user_id, payment_method } = req.body;
  const pay = payment_method === 'transfer' ? 'transfer' : 'cash';
  const sql = "INSERT INTO transactions (type, description, amount, payment_method, created_by) VALUES ('expense', ?, ?, ?, ?)";
  db.run(sql, [description, Math.round(Number(amount)||0), pay, user_id || 1], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

// Cash sessions
app.post('/api/cash/open', (req, res) => {
  const { opening_balance, user_id } = req.body;
  db.get("SELECT COUNT(1) as cnt FROM cash_sessions WHERE status = 'open'", [], (err, row) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (row.cnt > 0) return res.json({ success: false, error: 'Ya existe una caja abierta' });
    const sql = "INSERT INTO cash_sessions (opened_by, opening_balance, status) VALUES (?, ?, 'open')";
    db.run(sql, [user_id, opening_balance], function(err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, id: this.lastID });
    });
  });
});

app.post('/api/cash/close', (req, res) => {
  const { closing_balance, user_id } = req.body;
  db.get("SELECT id FROM cash_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1", [], (err, row) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (!row) return res.json({ success: false, error: 'No hay caja abierta' });
    const sql = "UPDATE cash_sessions SET closed_by = ?, closing_balance = ?, closed_at = datetime('now'), status = 'closed' WHERE id = ?";
    db.run(sql, [user_id, closing_balance, row.id], function(err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, changes: this.changes });
    });
  });
});

app.get('/api/cash/sessions', (req, res) => {
  const { from, to, status } = req.query;
  let sql = 'SELECT * FROM cash_sessions WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (from) { sql += ' AND DATE(opened_at) >= ?'; params.push(from); }
  if (to) { sql += ' AND DATE(opened_at) <= ?'; params.push(to); }
  sql += ' ORDER BY opened_at DESC';
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

// Schedules
app.get('/api/schedules', (req, res) => {
  const { year, month } = req.query;
  const monthStr = String(month).padStart(2, '0');
  const sql = `SELECT s.id, s.user_id, s.work_date, s.start_time, s.end_time, u.username FROM schedules s JOIN users u ON s.user_id = u.id WHERE SUBSTR(s.work_date, 1, 7) = ?`;
  db.all(sql, [`${year}-${monthStr}`], (err, rows) => {
    if (err) return res.status(500).json({ schedules: [] });
    res.json({ year, month, schedules: rows });
  });
});

app.get('/api/schedules/users', (req, res) => {
  const sql = 'SELECT id, username FROM users ORDER BY username';
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.post('/api/schedules', (req, res) => {
  const { userId, workDate, startTime, endTime } = req.body;
  const sql = 'INSERT INTO schedules (user_id, work_date, start_time, end_time) VALUES (?, ?, ?, ?)';
  db.run(sql, [userId, workDate, startTime, endTime], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

// Users API
app.get('/api/users', (req, res) => {
  // Super admin ve todos, otros solo los de su sede
  const base = 'SELECT id, username, role, full_name, email, phone, is_active, created_at, last_login FROM users';
  const sql = 'super' // placeholder to build dynamic
  const isSuper = String(req.headers['x-user-role']||'').toLowerCase() === 'super_admin';
  const query = isSuper
    ? `${base} ORDER BY created_at DESC`
    : `${base} WHERE id IN (SELECT user_id FROM user_locations WHERE location_id = ?) ORDER BY created_at DESC`;
  const params = isSuper ? [] : [req.locationId];
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

// Locations API
app.get('/api/locations', (req, res) => {
  db.all('SELECT id, name, is_active FROM locations ORDER BY name', [], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.post('/api/users', (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = req.body?.password;
  const role = String(req.body?.role || '').trim();
  const full_name = String(req.body?.full_name || '').trim();
  const email = String(req.body?.email || '').trim();
  const phone = String(req.body?.phone || '').trim();
  
  if (!username || !password || !role) {
    return res.status(400).json({ success: false, error: 'Username, password and role are required' });
  }
  
  bcrypt.hash(password, 10, (err, hash) => {
    if (err) return res.status(500).json({ success: false, error: 'Error hashing password' });
    
    const sql = 'INSERT INTO users (username, password, role, full_name, email, phone) VALUES (?, ?, ?, ?, ?, ?)';
    db.run(sql, [username, hash, role || 'employee', full_name, email, phone], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ success: false, error: 'Username already exists' });
        }
        return res.status(500).json({ success: false, error: err.message });
      }
      const newId = this.lastID;
      // Map user to current location unless super admin (who will be global)
      if ((role || 'employee') !== 'super_admin') {
        db.run('INSERT OR IGNORE INTO user_locations (user_id, location_id, role) VALUES (?, ?, ?)', [newId, req.locationId, role || 'employee']);
      }
      res.json({ success: true, id: newId });
    });
  });
});

// Check username availability
app.get('/api/users/check-username', (req, res) => {
  const username = String(req.query.username || '').trim().toLowerCase();
  const excludeId = req.query.excludeId ? parseInt(req.query.excludeId) : null;
  if (!username) return res.json({ available: false });
  const sql = excludeId
    ? 'SELECT COUNT(1) as cnt FROM users WHERE username = ? AND id != ?'
    : 'SELECT COUNT(1) as cnt FROM users WHERE username = ?';
  const params = excludeId ? [username, excludeId] : [username];
  db.get(sql, params, (err, row) => {
    if (err) return res.status(500).json({ available: false });
    res.json({ available: (row?.cnt || 0) === 0 });
  });
});

app.put('/api/users/:id', (req, res) => {
  const { id } = req.params;
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = req.body?.password;
  const role = String(req.body?.role || '').trim();
  const full_name = String(req.body?.full_name || '').trim();
  const email = String(req.body?.email || '').trim();
  const phone = String(req.body?.phone || '').trim();
  
  if (!username || !role) {
    return res.status(400).json({ success: false, error: 'Username and role are required' });
  }
  
  // Prevent non-super admins from editing super_admin users
  db.get('SELECT role FROM users WHERE id = ?', [id], (err, target) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (!target) return res.status(404).json({ success: false, error: 'User not found' });
    if (target.role === 'super_admin' && role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'No se puede modificar un super admin' });
    }

  if (password) {
    // Update with new password
    bcrypt.hash(password, 10, (err, hash) => {
      if (err) return res.status(500).json({ success: false, error: 'Error hashing password' });
      
      const sql = 'UPDATE users SET username = ?, password = ?, role = ?, full_name = ?, email = ?, phone = ?, updated_at = datetime("now") WHERE id = ?';
      db.run(sql, [username, hash, role, full_name, email, phone, id], function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ success: false, error: 'Username already exists' });
          }
          return res.status(500).json({ success: false, error: err.message });
        }
        // update mapping for non-super users in current location
        if (role !== 'super_admin') {
          db.run('INSERT OR IGNORE INTO user_locations (user_id, location_id, role) VALUES (?, ?, ?)', [id, req.locationId, role]);
        }
        res.json({ success: true, changes: this.changes });
      });
    });
  } else {
    // Update without changing password
    const sql = 'UPDATE users SET username = ?, role = ?, full_name = ?, email = ?, phone = ?, updated_at = datetime("now") WHERE id = ?';
    db.run(sql, [username, role, full_name, email, phone, id], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ success: false, error: 'Username already exists' });
        }
        return res.status(500).json({ success: false, error: err.message });
      }
      if (role !== 'super_admin') {
        db.run('INSERT OR IGNORE INTO user_locations (user_id, location_id, role) VALUES (?, ?, ?)', [id, req.locationId, role]);
      }
      res.json({ success: true, changes: this.changes });
    });
  }
  });
});

// Reset password (admin)
app.post('/api/users/:id/reset-password', (req, res) => {
  const { id } = req.params;
  const newPassword = String(req.body?.new_password || '');
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ success: false, error: 'Nueva contraseña inválida' });
  }
  bcrypt.hash(newPassword, 10, (err, hash) => {
    if (err) return res.status(500).json({ success: false, error: 'Error hashing password' });
    db.run('UPDATE users SET password = ?, updated_at = datetime("now") WHERE id = ?', [hash, id], function(err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, changes: this.changes });
    });
  });
});

app.delete('/api/users/:id', (req, res) => {
  const { id } = req.params;
  
  // Check if user is super_admin
  db.get('SELECT role FROM users WHERE id = ?', [id], (err, user) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (user.role === 'super_admin') {
      return res.status(400).json({ success: false, error: 'Cannot delete super admin user' });
    }
    
    const sql = 'DELETE FROM users WHERE id = ?';
    db.run(sql, [id], function(err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, changes: this.changes });
    });
  });
});

app.put('/api/users/:id/toggle-status', (req, res) => {
  const { id } = req.params;
  
  // Check if user is super_admin
  db.get('SELECT role FROM users WHERE id = ?', [id], (err, user) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (user.role === 'super_admin') {
      return res.status(400).json({ success: false, error: 'Cannot deactivate super admin user' });
    }
    
    const sql = 'UPDATE users SET is_active = NOT is_active, updated_at = datetime("now") WHERE id = ?';
    db.run(sql, [id], function(err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, changes: this.changes });
    });
  });
});

// Serve static frontend (disable cache for HTML/JS during development)
app.use(express.static(__dirname, {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html') || filePath.endsWith('renderer.js')) {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// SPA fallback: let frontend handle routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});


// Warm-up pings (keep the app/DB awake periodically)
try {
  setInterval(() => {
    http.get(`http://localhost:${PORT}/api/health`).on('error', () => {});
  }, 5 * 60 * 1000); // cada 5 minutos
} catch (_) {}

// Global error handler
app.use((err, req, res, next) => {
  try { console.error('Unhandled error:', err && err.stack ? err.stack : err); } catch(_) {}
  res.status(500).json({ success:false, error:'internal' });
});

// Process-level guards
process.on('uncaughtException', (e) => { try { console.error('uncaughtException:', e); } catch(_) {} });
process.on('unhandledRejection', (e) => { try { console.error('unhandledRejection:', e); } catch(_) {} });
