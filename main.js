const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const db = require('./database/database.js');
const bcrypt = require('bcrypt');
const saltRounds = 10;

// Start API server for web scalability
try {
  require('./server');
} catch (e) {
  console.warn('API server not started:', e.message);
}

function createWindow () {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // and load the index.html of the app.
  try {
    mainWindow.loadURL('http://localhost:3000');
  } catch (e) {
    mainWindow.loadFile('index.html');
  }

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers for Products
ipcMain.on('get-products', (event) => {
    const sql = "SELECT * FROM products ORDER BY name";
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error(err.message);
            return;
        }
        event.sender.send('products-data', rows);
    });
});

ipcMain.on('add-product', (event, product) => {
    const { name, price, stock, category } = product;
    const sql = "INSERT INTO products (name, price, stock, category) VALUES (?, ?, ?, ?)";
    db.run(sql, [name, price, stock, category], function(err) {
        if (err) {
            console.error(err.message);
            return;
        }
        console.log(`A row has been inserted with rowid ${this.lastID}`);
        event.sender.send('product-added');
    });
});

ipcMain.on('update-product', (event, product) => {
    const { id, name, price, stock, category } = product;
    const sql = "UPDATE products SET name = ?, price = ?, stock = ?, category = ? WHERE id = ?";
    db.run(sql, [name, price, stock, category, id], function(err) {
        if (err) {
            console.error(err.message);
            return;
        }
        console.log(`Row(s) updated: ${this.changes}`);
        event.sender.send('product-updated');
    });
});

ipcMain.on('delete-product', (event, id) => {
    const sql = "DELETE FROM products WHERE id = ?";
    db.run(sql, id, function(err) {
        if (err) {
            console.error(err.message);
            return;
        }
        console.log(`Row(s) deleted ${this.changes}`);
        event.sender.send('product-deleted');
    });
});

ipcMain.on('get-product-by-id', (event, id) => {
    const sql = "SELECT * FROM products WHERE id = ?";
    db.get(sql, [id], (err, row) => {
        if (err) {
            console.error(err.message);
            return;
        }
        event.sender.send('product-data-by-id', row);
    });
});

// IPC Handlers for Users
ipcMain.on('get-users', (event) => {
    const sql = "SELECT id, username, role FROM users ORDER BY username";
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error(err.message);
            return;
        }
        event.sender.send('users-data', rows);
    });
});

ipcMain.on('add-user', (event, user) => {
    const { username, password, role } = user;
    bcrypt.hash(password, saltRounds, (err, hash) => {
        if (err) {
            console.error("Error hashing password", err);
            return;
        }
        const sql = "INSERT INTO users (username, password, role) VALUES (?, ?, ?)";
        db.run(sql, [username, hash, role], function(err) {
            if (err) {
                console.error(err.message);
                return;
            }
            event.sender.send('user-added');
        });
    });
});

ipcMain.on('update-user', (event, user) => {
    const { id, username, password, role } = user;

    if (password) {
        // Si se proporciona una nueva contraseña, la hasheamos y actualizamos
        bcrypt.hash(password, saltRounds, (err, hash) => {
            if (err) {
                console.error("Error hashing password", err);
                return;
            }
            const sql = "UPDATE users SET username = ?, password = ?, role = ? WHERE id = ?";
            db.run(sql, [username, hash, role, id], function(err) {
                if (err) { console.error(err.message); return; }
                event.sender.send('user-updated');
            });
        });
    } else {
        // Si no se proporciona contraseña, actualizamos solo el resto de los datos
        const sql = "UPDATE users SET username = ?, role = ? WHERE id = ?";
        db.run(sql, [username, role, id], function(err) {
            if (err) { console.error(err.message); return; }
            event.sender.send('user-updated');
        });
    }
});

ipcMain.on('delete-user', (event, id) => {
    const sql = "DELETE FROM users WHERE id = ?";
    db.run(sql, id, function(err) {
        if (err) {
            console.error(err.message);
            return;
        }
        event.sender.send('user-deleted');
    });
});

ipcMain.on('get-user-by-id', (event, id) => {
    const sql = "SELECT id, username, role FROM users WHERE id = ?";
    db.get(sql, [id], (err, row) => {
        if (err) {
            console.error(err.message);
            return;
        }
        event.sender.send('user-data-by-id', row);
    });
});

// IPC Handlers for Tables
ipcMain.on('get-tables', (event) => {
    const sql = "SELECT * FROM tables ORDER BY name";
    db.all(sql, [], (err, rows) => {
        if (err) { console.error(err.message); return; }
        event.sender.send('tables-data', rows);
    });
});

ipcMain.on('add-table', (event, table) => {
    const { name } = table;
    const sql = "INSERT INTO tables (name, status) VALUES (?, 'free')";
    db.run(sql, [name], function(err) {
        if (err) { console.error(err.message); return; }
        event.sender.send('table-added');
    });
});

ipcMain.on('update-table', (event, table) => {
    const { id, name } = table;
    const sql = "UPDATE tables SET name = ? WHERE id = ?";
    db.run(sql, [name, id], function(err) {
        if (err) { console.error(err.message); return; }
        event.sender.send('table-updated');
    });
});

ipcMain.on('delete-table', (event, id) => {
    const sql = "DELETE FROM tables WHERE id = ?";
    db.run(sql, id, function(err) {
        if (err) { console.error(err.message); return; }
        event.sender.send('table-deleted');
    });
});

ipcMain.on('get-table-by-id', (event, id) => {
    const sql = "SELECT * FROM tables WHERE id = ?";
    db.get(sql, [id], (err, row) => {
        if (err) { console.error(err.message); return; }
        event.sender.send('table-data-by-id', row);
    });
});

// IPC Handlers for Sales
ipcMain.on('get-products-for-sale', (event) => {
    const sql = "SELECT * FROM products WHERE stock > 0 ORDER BY name";
    db.all(sql, [], (err, rows) => {
        if (err) { console.error(err.message); return; }
        event.sender.send('products-data-for-sale', rows);
    });
});

ipcMain.on('get-tables-for-sale', (event) => {
    const sql = "SELECT * FROM tables WHERE status = 'free' ORDER BY name";
    db.all(sql, [], (err, rows) => {
        if (err) { console.error(err.message); return; }
        event.sender.send('tables-data-for-sale', rows);
    });
});

ipcMain.on('process-sale', (event, sale) => {
    db.serialize(() => {
        db.run('BEGIN TRANSACTION;');

        const saleSql = `INSERT INTO sales (user_id, table_id, total, sale_type, status) VALUES (?, ?, ?, ?, ?)`;
        // NOTA: user_id es 1 (admin) por ahora. Se debe cambiar cuando haya login de meseros.
        const tableId = sale.saleType === 'direct' ? null : sale.tableId;
        
        db.run(saleSql, [1, tableId, sale.total, sale.saleType, sale.status], function(err) {
            if (err) {
                console.error(err.message);
                db.run('ROLLBACK;');
                return;
            }
            
            const saleId = this.lastID;
            const itemsSql = `INSERT INTO sale_items (sale_id, product_id, quantity, price) VALUES (?, ?, ?, ?)`;
            const stockSql = `UPDATE products SET stock = stock - ? WHERE id = ?`;

            sale.items.forEach(item => {
                db.run(itemsSql, [saleId, item.id, item.quantity, item.price], (err) => {
                    if (err) { console.error(err.message); db.run('ROLLBACK;'); return; }
                });
                db.run(stockSql, [item.quantity, item.id], (err) => {
                    if (err) { console.error(err.message); db.run('ROLLBACK;'); return; }
                });
            });

            if (sale.saleType === 'table' && sale.status === 'pending') {
                db.run(`UPDATE tables SET status = 'occupied' WHERE id = ?`, [sale.tableId], (err) => {
                    if (err) { console.error(err.message); db.run('ROLLBACK;'); return; }
                });
            }

            if (sale.status === 'paid') {
                const transSql = `INSERT INTO transactions (type, amount, description) VALUES ('income', ?, ?)`;
                db.run(transSql, [sale.total, `Venta ID: ${saleId}`], (err) => {
                    if (err) { console.error(err.message); db.run('ROLLBACK;'); return; }
                });
            }

            db.run('COMMIT;', (err) => {
                if (err) {
                    console.error("Commit failed", err.message);
                    db.run('ROLLBACK;');
                } else {
                    event.sender.send('sale-processed-successfully');
                }
            });
        });
    });
});

// IPC Handlers for Accounting
ipcMain.on('get-transactions', (event) => {
    const sql = "SELECT * FROM transactions ORDER BY created_at DESC";
    db.all(sql, [], (err, rows) => {
        if (err) { console.error(err.message); return; }
        event.sender.send('transactions-data', rows);
    });
});

ipcMain.on('add-expense', (event, expense) => {
    const { description, amount } = expense;
    const sql = "INSERT INTO transactions (type, description, amount) VALUES ('expense', ?, ?)";
    db.run(sql, [description, amount], function(err) {
        if (err) { console.error(err.message); return; }
        event.sender.send('expense-added');
    });
});

// IPC Handlers for Schedules
ipcMain.on('get-schedules', (event, { year, month }) => {
    const monthStr = String(month).padStart(2, '0');
    // Consulta para obtener los turnos y unir con la tabla de usuarios para obtener el nombre
    const sql = `
        SELECT s.id, s.user_id, s.work_date, s.start_time, s.end_time, u.username
        FROM schedules s
        JOIN users u ON s.user_id = u.id
        WHERE SUBSTR(s.work_date, 1, 7) = ?
    `;
    const params = [`${year}-${monthStr}`];
    
    db.all(sql, params, (err, rows) => {
        if (err) { console.error(err.message); return; }
        event.sender.send('schedules-data', { year, month, schedules: rows });
    });
});

ipcMain.on('get-users-for-schedule', (event) => {
    const sql = "SELECT id, username FROM users ORDER BY username";
    db.all(sql, [], (err, rows) => {
        if (err) { console.error(err.message); return; }
        event.sender.send('users-data-for-schedule', rows);
    });
});

ipcMain.on('add-schedule', (event, schedule) => {
    const { userId, workDate, startTime, endTime } = schedule;
    const sql = "INSERT INTO schedules (user_id, work_date, start_time, end_time) VALUES (?, ?, ?, ?)";
    db.run(sql, [userId, workDate, startTime, endTime], function(err) {
        if (err) { console.error(err.message); return; }
        event.sender.send('schedule-added');
    });
});


// IPC Handler for Login
ipcMain.handle('login-attempt', async (event, { username, password }) => {
    return new Promise((resolve) => {
        const sql = "SELECT * FROM users WHERE username = ?";
        db.get(sql, [username], (err, user) => {
            if (err) {
                console.error(err.message);
                resolve({ success: false, error: 'Database error' });
                return;
            }
            if (user) {
                // Usuario encontrado, comparar contraseña
                bcrypt.compare(password, user.password, (err, result) => {
                    if (result) {
                        // Contraseña correcta
                        const { password, ...userWithoutPassword } = user;
                        resolve({ success: true, user: userWithoutPassword });
                    } else {
                        // Contraseña incorrecta
                        resolve({ success: false, error: 'Invalid credentials' });
                    }
                });
            } else {
                // Usuario no encontrado
                resolve({ success: false, error: 'Invalid credentials' });
            }
        });
    });
});

// New IPC Handlers for Dashboard
ipcMain.handle('get-dashboard-summary', async () => {
    return new Promise((resolve) => {
        // Get today's sales
        const today = new Date().toISOString().split('T')[0];
        const salesSql = "SELECT COALESCE(SUM(total), 0) as totalSales FROM sales WHERE DATE(created_at) = ? AND status = 'paid'";
        
        db.get(salesSql, [today], (err, salesResult) => {
            if (err) {
                console.error(err.message);
                resolve({ totalSales: 0, activeTables: 0, lowStockProducts: 0, totalTransactions: 0 });
                return;
            }
            
            // Get active tables
            const tablesSql = "SELECT COUNT(*) as activeTables FROM tables WHERE status = 'occupied'";
            db.get(tablesSql, [], (err, tablesResult) => {
                if (err) {
                    console.error(err.message);
                    resolve({ totalSales: salesResult.totalSales || 0, activeTables: 0, lowStockProducts: 0, totalTransactions: 0 });
                    return;
                }
                
                // Get low stock products
                const stockSql = "SELECT COUNT(*) as lowStockProducts FROM products WHERE stock < 10";
                db.get(stockSql, [], (err, stockResult) => {
                    if (err) {
                        console.error(err.message);
                        resolve({ 
                            totalSales: salesResult.totalSales || 0, 
                            activeTables: tablesResult.activeTables || 0, 
                            lowStockProducts: 0, 
                            totalTransactions: 0 
                        });
                        return;
                    }
                    
                    // Get total transactions today
                    const transSql = "SELECT COUNT(*) as totalTransactions FROM sales WHERE DATE(created_at) = ?";
                    db.get(transSql, [today], (err, transResult) => {
                        if (err) {
                            console.error(err.message);
                            resolve({ 
                                totalSales: salesResult.totalSales || 0, 
                                activeTables: tablesResult.activeTables || 0, 
                                lowStockProducts: stockResult.lowStockProducts || 0, 
                                totalTransactions: 0 
                            });
                            return;
                        }
                        
                        resolve({
                            totalSales: salesResult.totalSales || 0,
                            activeTables: tablesResult.activeTables || 0,
                            lowStockProducts: stockResult.lowStockProducts || 0,
                            totalTransactions: transResult.totalTransactions || 0
                        });
                    });
                });
            });
        });
    });
});

// Updated IPC Handlers for Tables
ipcMain.handle('get-tables', async () => {
    return new Promise((resolve) => {
        const sql = `
            SELECT t.*, 
                   COALESCE(s.total, 0) as currentTotal,
                   COALESCE(si.itemCount, 0) as itemCount
            FROM tables t
            LEFT JOIN (
                SELECT table_id, SUM(total) as total
                FROM sales 
                WHERE status = 'pending' 
                GROUP BY table_id
            ) s ON t.id = s.table_id
            LEFT JOIN (
                SELECT s.table_id, SUM(si.quantity) as itemCount
                FROM sales s
                JOIN sale_items si ON s.id = si.sale_id
                WHERE s.status = 'pending'
                GROUP BY s.table_id
            ) si ON t.id = si.table_id
            ORDER BY t.name
        `;
        
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error(err.message);
                resolve([]);
                return;
            }
            resolve(rows);
        });
    });
});

ipcMain.handle('get-tables-for-sale', async () => {
    return new Promise((resolve) => {
        const sql = "SELECT * FROM tables WHERE status = 'free' ORDER BY name";
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error(err.message);
                resolve([]);
                return;
            }
            resolve(rows);
        });
    });
});

// New IPC Handler for Table Orders
ipcMain.handle('get-table-order', async (event, tableId) => {
    return new Promise((resolve) => {
        const sql = `
            SELECT si.product_id as id, p.name, si.price, si.quantity
            FROM sales s
            JOIN sale_items si ON s.id = si.sale_id
            JOIN products p ON si.product_id = p.id
            WHERE s.table_id = ? AND s.status = 'pending'
        `;
        
        db.all(sql, [tableId], (err, rows) => {
            if (err) {
                console.error(err.message);
                resolve({ items: [] });
                return;
            }
            resolve({ items: rows });
        });
    });
});

// Updated IPC Handlers for Products
ipcMain.handle('get-products-for-sale', async () => {
    return new Promise((resolve) => {
        const sql = "SELECT * FROM products WHERE stock > 0 ORDER BY name";
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error(err.message);
                resolve([]);
                return;
            }
            resolve(rows);
        });
    });
});

ipcMain.handle('get-products', async () => {
    return new Promise((resolve) => {
        const sql = "SELECT * FROM products ORDER BY name";
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error(err.message);
                resolve([]);
                return;
            }
            resolve(rows);
        });
    });
});

ipcMain.handle('add-product', async (event, product) => {
    return new Promise((resolve) => {
        const { name, price, stock, category } = product;
        const sql = "INSERT INTO products (name, price, stock, category) VALUES (?, ?, ?, ?)";
        db.run(sql, [name, price, stock, category], function(err) {
            if (err) { console.error(err.message); resolve({ success: false, error: err.message }); return; }
            resolve({ success: true, id: this.lastID });
        });
    });
});

ipcMain.handle('update-product', async (event, product) => {
    return new Promise((resolve) => {
        const { id, name, price, stock, category } = product;
        const sql = "UPDATE products SET name = ?, price = ?, stock = ?, category = ? WHERE id = ?";
        db.run(sql, [name, price, stock, category, id], function(err) {
            if (err) { console.error(err.message); resolve({ success: false, error: err.message }); return; }
            resolve({ success: true, changes: this.changes });
        });
    });
});

ipcMain.handle('delete-product', async (event, id) => {
    return new Promise((resolve) => {
        const sql = "DELETE FROM products WHERE id = ?";
        db.run(sql, id, function(err) {
            if (err) { console.error(err.message); resolve({ success: false, error: err.message }); return; }
            resolve({ success: true, changes: this.changes });
        });
    });
});

// Updated IPC Handler for Sales Processing
ipcMain.handle('process-sale', async (event, saleData) => {
    return new Promise((resolve) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION;');

            const saleSql = `INSERT INTO sales (user_id, table_id, total, sale_type, status, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`;
            const tableId = saleData.tableId;
            const saleType = tableId ? 'table' : 'direct';
            const status = 'paid';

            const proceedWithInsert = () => {
                db.run(saleSql, [1, tableId, saleData.total, saleType, status], function(err) {
                    if (err) {
                        console.error(err.message);
                        db.run('ROLLBACK;');
                        resolve({ success: false, error: err.message });
                        return;
                    }
                    
                    const saleId = this.lastID;
                    const itemsSql = `INSERT INTO sale_items (sale_id, product_id, quantity, price) VALUES (?, ?, ?, ?)`;
                    const stockSql = `UPDATE products SET stock = stock - ? WHERE id = ?`;

                    let itemsProcessed = 0;
                    const totalItems = saleData.items.length;

                    saleData.items.forEach(item => {
                        db.run(itemsSql, [saleId, item.id, item.quantity, item.price], (err) => {
                            if (err) { 
                                console.error(err.message); 
                                db.run('ROLLBACK;'); 
                                resolve({ success: false, error: err.message });
                                return; 
                            }
                        });
                        
                        db.run(stockSql, [item.quantity, item.id], (err) => {
                            if (err) { 
                                console.error(err.message); 
                                db.run('ROLLBACK;'); 
                                resolve({ success: false, error: err.message });
                                return; 
                            }
                            
                            itemsProcessed++;
                            if (itemsProcessed === totalItems) {
                                const transSql = `INSERT INTO transactions (type, amount, description) VALUES ('income', ?, ?)`;
                                db.run(transSql, [saleData.total, `Venta ID: ${saleId}`], (err) => {
                                    if (err) { 
                                        console.error(err.message); 
                                        db.run('ROLLBACK;'); 
                                        resolve({ success: false, error: err.message });
                                        return; 
                                    }

                                    // If it was a table sale, mark table as free now
                                    if (tableId) {
                                        db.run(`UPDATE tables SET status = 'free' WHERE id = ?`, [tableId], (err) => {
                                            if (err) { 
                                                console.error(err.message); 
                                                db.run('ROLLBACK;'); 
                                                resolve({ success: false, error: err.message });
                                                return; 
                                            }
                                            db.run('COMMIT;', (err) => {
                                                if (err) {
                                                    console.error("Commit failed", err.message);
                                                    db.run('ROLLBACK;');
                                                    resolve({ success: false, error: err.message });
                                                } else {
                                                    resolve({ success: true, saleId: saleId });
                                                }
                                            });
                                        });
                                    } else {
                                        db.run('COMMIT;', (err) => {
                                            if (err) {
                                                console.error("Commit failed", err.message);
                                                db.run('ROLLBACK;');
                                                resolve({ success: false, error: err.message });
                                            } else {
                                                resolve({ success: true, saleId: saleId });
                                            }
                                        });
                                    }
                                });
                            }
                        });
                    });
                });
            };

            if (tableId) {
                // Purge any pending sales for this table before inserting a new paid sale
                db.run(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE table_id = ? AND status = 'pending')`, [tableId], (err) => {
                    if (err) { console.error(err.message); db.run('ROLLBACK;'); resolve({ success: false, error: err.message }); return; }
                    db.run(`DELETE FROM sales WHERE table_id = ? AND status = 'pending'`, [tableId], (err) => {
                        if (err) { console.error(err.message); db.run('ROLLBACK;'); resolve({ success: false, error: err.message }); return; }
                        proceedWithInsert();
                    });
                });
            } else {
                proceedWithInsert();
            }
        });
    });
});

// New IPC Handler for Saving Orders
ipcMain.handle('save-order', async (event, orderData) => {
    return new Promise((resolve) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION;');

            const saleSql = `INSERT INTO sales (user_id, table_id, total, sale_type, status, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`;
            const tableId = orderData.tableId;
            const saleType = tableId ? 'table' : 'direct';
            const status = 'pending';
            const total = orderData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            
            db.run(saleSql, [1, tableId, total, saleType, status], function(err) {
                if (err) {
                    console.error(err.message);
                    db.run('ROLLBACK;');
                    resolve({ success: false, error: err.message });
                    return;
                }
                
                const saleId = this.lastID;
                const itemsSql = `INSERT INTO sale_items (sale_id, product_id, quantity, price) VALUES (?, ?, ?, ?)`;

                let itemsProcessed = 0;
                const totalItems = orderData.items.length;

                orderData.items.forEach(item => {
                    db.run(itemsSql, [saleId, item.id, item.quantity, item.price], (err) => {
                        if (err) { 
                            console.error(err.message); 
                            db.run('ROLLBACK;'); 
                            resolve({ success: false, error: err.message });
                            return; 
                        }
                        
                        itemsProcessed++;
                        if (itemsProcessed === totalItems) {
                            const finalize = () => {
                                db.run('COMMIT;', (err) => {
                                    if (err) {
                                        console.error("Commit failed", err.message);
                                        db.run('ROLLBACK;');
                                        resolve({ success: false, error: err.message });
                                    } else {
                                        resolve({ success: true, saleId: saleId });
                                    }
                                });
                            };

                            if (tableId) {
                                db.run(`UPDATE tables SET status = 'occupied' WHERE id = ?`, [tableId], (err) => {
                                    if (err) { console.error(err.message); db.run('ROLLBACK;'); resolve({ success: false, error: err.message }); return; }
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
});

// Transactions with filters
ipcMain.handle('get-transactions-filtered', async (event, { from, to, type }) => {
    return new Promise((resolve) => {
        let sql = 'SELECT * FROM transactions WHERE 1=1';
        const params = [];
        if (type) { sql += ' AND type = ?'; params.push(type); }
        if (from) { sql += " AND DATE(created_at) >= ?"; params.push(from); }
        if (to) { sql += " AND DATE(created_at) <= ?"; params.push(to); }
        sql += ' ORDER BY created_at DESC';
        db.all(sql, params, (err, rows) => {
            if (err) { console.error(err.message); resolve([]); return; }
            resolve(rows);
        });
    });
});

// Cash sessions
ipcMain.handle('cash-open', async (event, { opening_balance, user_id }) => {
    return new Promise((resolve) => {
        db.get("SELECT COUNT(1) as cnt FROM cash_sessions WHERE status = 'open'", [], (err, row) => {
            if (err) { console.error(err.message); resolve({ success: false, error: err.message }); return; }
            if (row.cnt > 0) { resolve({ success: false, error: 'Ya existe una caja abierta' }); return; }
            const sql = "INSERT INTO cash_sessions (opened_by, opening_balance, status) VALUES (?, ?, 'open')";
            db.run(sql, [user_id || 1, opening_balance], function(err) {
                if (err) { console.error(err.message); resolve({ success: false, error: err.message }); return; }
                resolve({ success: true, id: this.lastID });
            });
        });
    });
});

ipcMain.handle('cash-close', async (event, { closing_balance, user_id }) => {
    return new Promise((resolve) => {
        db.get("SELECT id FROM cash_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1", [], (err, row) => {
            if (err) { console.error(err.message); resolve({ success: false, error: err.message }); return; }
            if (!row) { resolve({ success: false, error: 'No hay caja abierta' }); return; }
            const sql = "UPDATE cash_sessions SET closed_by = ?, closing_balance = ?, closed_at = datetime('now'), status = 'closed' WHERE id = ?";
            db.run(sql, [user_id || 1, closing_balance, row.id], function(err) {
                if (err) { console.error(err.message); resolve({ success: false, error: err.message }); return; }
                resolve({ success: true, changes: this.changes });
            });
        });
    });
});

ipcMain.handle('get-cash-sessions', async (event, { from, to, status }) => {
    return new Promise((resolve) => {
        let sql = 'SELECT * FROM cash_sessions WHERE 1=1';
        const params = [];
        if (status) { sql += ' AND status = ?'; params.push(status); }
        if (from) { sql += " AND DATE(opened_at) >= ?"; params.push(from); }
        if (to) { sql += " AND DATE(opened_at) <= ?"; params.push(to); }
        sql += ' ORDER BY opened_at DESC';
        db.all(sql, params, (err, rows) => {
            if (err) { console.error(err.message); resolve([]); return; }
            resolve(rows);
        });
    });
});
