const express = require('express');
const path = require('path');
const db = require('./database/database');
const bcrypt = require('bcrypt');

const app = express();
app.use(express.json({ limit: '1mb' }));
try { app.use(require('compression')()); } catch (e) { /* optional */ }

// Simple CORS for local file:// usage
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Auth
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const sql = 'SELECT * FROM users WHERE username = ?';
  db.get(sql, [username], (err, user) => {
    if (err) return res.status(500).json({ success: false, error: 'db' });
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
});

// Dashboard summary (localtime-safe)
app.get('/api/dashboard/summary', (req, res) => {
  const salesSql = "SELECT COALESCE(SUM(total), 0) as totalSales FROM sales WHERE DATE(created_at, 'localtime') = DATE('now','localtime') AND status = 'paid'";
  db.get(salesSql, [], (err, sales) => {
    if (err) return res.json({ totalSales: 0, activeTables: 0, lowStockProducts: 0, totalTransactions: 0 });
    const tablesSql = "SELECT COUNT(*) as activeTables FROM tables WHERE status = 'occupied'";
    db.get(tablesSql, [], (err, tables) => {
      if (err) return res.json({ totalSales: sales.totalSales || 0, activeTables: 0, lowStockProducts: 0, totalTransactions: 0 });
      const stockSql = "SELECT COUNT(*) as lowStockProducts FROM products WHERE stock < 10";
      db.get(stockSql, [], (err, stock) => {
        if (err) return res.json({ totalSales: sales.totalSales || 0, activeTables: tables.activeTables || 0, lowStockProducts: 0, totalTransactions: 0 });
        const transSql = "SELECT COUNT(*) as totalTransactions FROM sales WHERE DATE(created_at, 'localtime') = DATE('now','localtime')";
        db.get(transSql, [], (err, trans) => {
          if (err) return res.json({ totalSales: sales.totalSales || 0, activeTables: tables.activeTables || 0, lowStockProducts: stock.lowStockProducts || 0, totalTransactions: 0 });
          res.json({ totalSales: sales.totalSales || 0, activeTables: tables.activeTables || 0, lowStockProducts: stock.lowStockProducts || 0, totalTransactions: trans.totalTransactions || 0 });
        });
      });
    });
  });
});

// Products
app.get('/api/products', (req, res) => {
  const forSale = req.query.forSale === 'true';
  const sql = forSale ? 'SELECT * FROM products WHERE stock > 0 ORDER BY name' : 'SELECT * FROM products ORDER BY name';
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.post('/api/products', (req, res) => {
  const { name, price, stock, category } = req.body;
  const sql = 'INSERT INTO products (name, price, stock, category) VALUES (?, ?, ?, ?)';
  db.run(sql, [name, price, stock, category], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

app.put('/api/products/:id', (req, res) => {
  const { name, price, stock, category } = req.body;
  const { id } = req.params;
  const sql = 'UPDATE products SET name = ?, price = ?, stock = ?, category = ? WHERE id = ?';
  db.run(sql, [name, price, stock, category, id], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, changes: this.changes });
  });
});

app.delete('/api/products/:id', (req, res) => {
  const { id } = req.params;
  const sql = 'DELETE FROM products WHERE id = ?';
  db.run(sql, id, function(err) {
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
    ORDER BY t.name`;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.get('/api/tables/free', (req, res) => {
  const sql = "SELECT * FROM tables WHERE status = 'free' ORDER BY name";
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
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
  db.serialize(() => {
    db.run('BEGIN TRANSACTION;');
    const saleSql = `INSERT INTO sales (user_id, table_id, total, sale_type, status, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`;
    const tableId = saleData.tableId;
    const saleType = tableId ? 'table' : 'direct';
    const status = 'paid';

    const proceedWithInsert = () => {
      db.run(saleSql, [1, tableId, saleData.total, saleType, status], function(err) {
        if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
        const saleId = this.lastID;
        const itemsSql = `INSERT INTO sale_items (sale_id, product_id, quantity, price) VALUES (?, ?, ?, ?)`;
        const stockSql = `UPDATE products SET stock = stock - ? WHERE id = ?`;

        let itemsProcessed = 0;
        const totalItems = saleData.items.length;
        saleData.items.forEach(item => {
          db.run(itemsSql, [saleId, item.id, item.quantity, item.price], (err) => {
            if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
          });
          db.run(stockSql, [item.quantity, item.id], (err) => {
            if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
            itemsProcessed++;
            if (itemsProcessed === totalItems) {
              const transSql = `INSERT INTO transactions (type, amount, description) VALUES ('income', ?, ?)`;
              db.run(transSql, [saleData.total, `Venta ID: ${saleId}`], (err) => {
                if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
                if (tableId) {
                  db.run(`UPDATE tables SET status = 'free' WHERE id = ?`, [tableId], (err) => {
                    if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
                    db.run('COMMIT;', (err) => {
                      if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
                      res.json({ success: true, saleId });
                    });
                  });
                } else {
                  db.run('COMMIT;', (err) => {
                    if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
                    res.json({ success: true, saleId });
                  });
                }
              });
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
  db.serialize(() => {
    db.run('BEGIN TRANSACTION;');
    const saleSql = `INSERT INTO sales (user_id, table_id, total, sale_type, status, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`;
    const tableId = orderData.tableId;
    const saleType = tableId ? 'table' : 'direct';
    const status = 'pending';
    const total = orderData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    db.run(saleSql, [1, tableId, total, saleType, status], function(err) {
      if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
      const saleId = this.lastID;
      const itemsSql = `INSERT INTO sale_items (sale_id, product_id, quantity, price) VALUES (?, ?, ?, ?)`;
      let itemsProcessed = 0;
      const totalItems = orderData.items.length;
      orderData.items.forEach(item => {
        db.run(itemsSql, [saleId, item.id, item.quantity, item.price], (err) => {
          if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
          itemsProcessed++;
          if (itemsProcessed === totalItems) {
            const finalize = () => db.run('COMMIT;', (err) => {
              if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
              res.json({ success: true, saleId });
            });
            if (tableId) {
              db.run(`UPDATE tables SET status = 'occupied' WHERE id = ?`, [tableId], (err) => {
                if (err) { db.run('ROLLBACK;'); return res.status(500).json({ success: false, error: err.message }); }
                finalize();
              });
            } else {
              finalize();
            }
          }
        });
      });
    });
  });
});

// Transactions & filters
app.get('/api/transactions', (req, res) => {
  const { from, to, type } = req.query;
  let sql = 'SELECT * FROM transactions WHERE 1=1';
  const params = [];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (from) { sql += ' AND DATE(created_at) >= ?'; params.push(from); }
  if (to) { sql += ' AND DATE(created_at) <= ?'; params.push(to); }
  sql += ' ORDER BY created_at DESC';
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.post('/api/transactions/income', (req, res) => {
  const { description, amount } = req.body;
  const sql = "INSERT INTO transactions (type, description, amount) VALUES ('income', ?, ?)";
  db.run(sql, [description, amount], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

app.post('/api/transactions/expense', (req, res) => {
  const { description, amount } = req.body;
  const sql = "INSERT INTO transactions (type, description, amount) VALUES ('expense', ?, ?)";
  db.run(sql, [description, amount], function(err) {
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


