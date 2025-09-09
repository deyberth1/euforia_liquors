let ipcRenderer = null;
try {
    ipcRenderer = require('electron').ipcRenderer;
} catch (e) {
    // Running in pure web mode
}

// Global state
let currentUser = null;
let currentTicket = [];
let selectedTable = null;
let suppressPosReload = false;
let lastTransactions = [];
let lastDeletedProduct = null;

// Backend client with REST first, IPC fallback
const API_BASE = (typeof window !== 'undefined' && window.location && /^https?:/i.test(window.location.origin))
    ? '/api'
    : 'http://localhost:3000/api';
async function apiInvoke(channel, payload) {
    // Map channels to REST endpoints
    const routes = {
        'login-attempt': async () => post('/login', payload),
        'get-dashboard-summary': async () => get('/dashboard/summary'),
        'get-tables': async () => get('/tables'),
        'get-tables-for-sale': async () => get('/tables/free'),
        'get-table-order': async () => get(`/tables/${payload}/order`),
        'get-products-for-sale': async () => get('/products?forSale=true'),
        'get-products': async () => get('/products'),
        'add-product': async () => post('/products', payload),
        'update-product': async () => put(`/products/${payload.id}`, payload),
        'delete-product': async () => del(`/products/${payload}`),
        'process-sale': async () => post('/sales/process', payload),
        'save-order': async () => post('/sales/save', payload),
        'get-transactions-filtered': async () => get(`/transactions${toQuery(payload)}`),
        'cash-open': async () => post('/cash/open', payload),
        'cash-close': async () => post('/cash/close', payload),
        'get-cash-sessions': async () => get(`/cash/sessions${toQuery(payload)}`),
        'get-users-for-schedule': async () => get('/schedules/users'),
        'get-schedules': async () => get(`/schedules${toQuery(payload)}`),
        'add-schedule': async () => post('/schedules', payload),
        'add-income': async () => post('/transactions/income', payload),
        'add-expense': async () => post('/transactions/expense', payload),
    };
    try {
        if (routes[channel]) {
            return await routes[channel]();
        }
        throw new Error('route-not-found');
    } catch (err) {
        if (ipcRenderer) {
            return await ipcRenderer.invoke(channel, payload);
        }
        throw err;
    }
}

function toQuery(obj) {
    if (!obj) return '';
    const params = new URLSearchParams();
    Object.entries(obj).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params.append(k, String(v));
    });
    const str = params.toString();
    return str ? `?${str}` : '';
}

async function get(pathname) {
    const res = await fetch(`${API_BASE}${pathname}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('network');
    return await res.json();
}
async function post(pathname, body) {
    const res = await fetch(`${API_BASE}${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        cache: 'no-store'
    });
    if (!res.ok) throw new Error('network');
    return await res.json();
}
async function put(pathname, body) {
    const res = await fetch(`${API_BASE}${pathname}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        cache: 'no-store'
    });
    if (!res.ok) throw new Error('network');
    return await res.json();
}
async function del(pathname) {
    const res = await fetch(`${API_BASE}${pathname}`, { method: 'DELETE', cache: 'no-store' });
    if (!res.ok) throw new Error('network');
    return await res.json();
}

// DOM Elements
const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

// Login functionality with session persistence
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const result = await apiInvoke('login-attempt', { username, password });
        
        if (result.success) {
            currentUser = result.user;
            try { loginContainer.remove(); } catch (e) { loginContainer.classList.add('hidden'); }
            appContainer.classList.remove('hidden');
            try { localStorage.setItem('sessionUser', JSON.stringify(currentUser)); } catch (_) {}
            loadDashboardData();
        } else {
            showLoginError('Usuario o contraseña incorrectos');
        }
    } catch (error) {
        showLoginError('Error al conectar con la base de datos');
    }
});

function showLoginError(message) {
    loginError.textContent = message;
    loginError.classList.remove('hidden');
    setTimeout(() => {
        loginError.classList.add('hidden');
    }, 3000);
}

// Module navigation
function showModule(moduleName) {
    // Hide all modules
    document.querySelectorAll('.module').forEach(module => {
        module.classList.remove('active');
    });
    
    // Remove active class from all nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Show selected module
    const selectedModule = document.getElementById(`${moduleName}-module`);
    if (selectedModule) {
        appContainer.classList.remove('hidden');
        selectedModule.classList.add('active');
    }
    
    // Add active class to nav item
    const navItem = document.querySelector(`[onclick="showModule('${moduleName}')"]`);
    if (navItem) {
        navItem.classList.add('active');
    }
    try { localStorage.setItem('lastModule', moduleName); } catch (_) {}
    
    // Load module-specific data
    switch(moduleName) {
        case 'dashboard':
            loadDashboardData();
            break;
        case 'pos':
            if (suppressPosReload) {
                suppressPosReload = false;
            } else {
                loadPOSData();
            }
            break;
        case 'tables':
            loadTablesData();
            break;
        case 'inventory':
            loadInventoryData();
            break;
        case 'reports':
            loadReportsData();
            break;
        case 'schedules':
            loadSchedulesData();
            break;
    }
}

// Dashboard functionality
async function loadDashboardData() {
    try {
        // Load summary data
        const summaryData = await apiInvoke('get-dashboard-summary');
        updateDashboardSummary(summaryData);
        
        // Load tables status
        const tablesData = await apiInvoke('get-tables');
        updateDashboardTables(tablesData);
        // Bind cash actions if present in dashboard
        const dashModule = document.getElementById('dashboard-module');
        if (dashModule) {
            const openBtn = dashModule.querySelector('#dash-cash-open');
            const closeBtn = dashModule.querySelector('#dash-cash-close');
            if (openBtn && !openBtn._bound) {
                openBtn.addEventListener('click', async () => {
                    const amount = parseFloat(dashModule.querySelector('#dash-cash-open-amount').value);
                    if (isNaN(amount)) { alert('Monto inválido'); return; }
                    const original = openBtn.textContent; openBtn.textContent = 'Abriendo...'; openBtn.disabled = true;
                    const res = await apiInvoke('cash-open', { opening_balance: Math.round(amount), user_id: currentUser?.id || 1 });
                    openBtn.textContent = original; openBtn.disabled = false;
                    if (res.success === false) { showNotification(res.error || 'Error al abrir caja', 'error'); }
                    else { showNotification('Caja abierta', 'success'); updateCashStatusOnDashboard(); }
                });
                openBtn._bound = true;
            }
            if (closeBtn && !closeBtn._bound) {
                closeBtn.addEventListener('click', async () => {
                    const amount = parseFloat(dashModule.querySelector('#dash-cash-close-amount').value);
                    if (isNaN(amount)) { alert('Monto inválido'); return; }
                    const original = closeBtn.textContent; closeBtn.textContent = 'Cerrando...'; closeBtn.disabled = true;
                    const res = await apiInvoke('cash-close', { closing_balance: Math.round(amount), user_id: currentUser?.id || 1 });
                    closeBtn.textContent = original; closeBtn.disabled = false;
                    if (res.success === false) { showNotification(res.error || 'Error al cerrar caja', 'error'); }
                    else { showNotification('Caja cerrada', 'success'); updateCashStatusOnDashboard(); }
                });
                closeBtn._bound = true;
            }
            updateCashStatusOnDashboard();
        }
    } catch (error) {
        console.error('Error loading dashboard data:', error);
    }
}

function updateDashboardSummary(data) {
    const salesEl = document.getElementById('dash-sales-today');
    const tablesEl = document.getElementById('dash-active-tables');
    const lowStockEl = document.getElementById('dash-low-stock');
    const transEl = document.getElementById('dash-total-trans');
    if (salesEl) salesEl.textContent = formatCurrency(data.totalSales || 0);
    if (tablesEl) tablesEl.textContent = String(data.activeTables || 0);
    if (lowStockEl) lowStockEl.textContent = String(data.lowStockProducts || 0);
    if (transEl) transEl.textContent = String(data.totalTransactions || 0);
}

function updateDashboardTables(tablesData) {
    const tablesContainer = document.querySelector('#dashboard-module .tables-container');
    if (tablesContainer) {
        tablesContainer.innerHTML = '';
        tablesData.forEach(table => {
            const tableCard = createTableCard(table);
            tableCard.onclick = () => selectTable(table);
            tablesContainer.appendChild(tableCard);
        });
    }
}

// POS functionality
async function loadPOSData() {
    try {
        // Load products for sale
        const productsData = await apiInvoke('get-products-for-sale');
        renderProductsGrid(productsData);
        
        // Load available tables
        const tablesData = await apiInvoke('get-tables-for-sale');
        renderTableSelection(tablesData);
        
        // Reset current ticket
        if (!selectedTable) {
            currentTicket = [];
            updateCurrentTableLabel();
        }
        renderTicket();
        // Ensure POS buttons are bound after DOM elements exist
        bindPosButtons();
    } catch (error) {
        console.error('Error loading POS data:', error);
    }
}

function renderProductsGrid(products) {
    const productsGrid = document.querySelector('.products-grid');
    if (productsGrid) {
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < products.length; i++) {
            fragment.appendChild(createProductCard(products[i]));
        }
        productsGrid.innerHTML = '';
        productsGrid.appendChild(fragment);
    }
}

function createProductCard(product) {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.onclick = () => addProductToTicket(product);
    
    card.innerHTML = `
        <div class="product-name">${product.name}</div>
        <div class="product-price">${formatCurrency(product.price)}</div>
        <div class="product-stock">Stock: ${product.stock}</div>
    `;
    
    return card;
}

function addProductToTicket(product) {
    const existingItem = currentTicket.find(item => item.id === product.id);
    
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        currentTicket.push({
            id: product.id,
            name: product.name,
            price: product.price,
            quantity: 1
        });
    }
    
    renderTicket();
}

function renderTicket() {
    const ticketItems = document.querySelector('.order-items');
    const totalAmount = document.querySelector('.total-amount');
    
    if (ticketItems) {
        const fragment = document.createDocumentFragment();
        let total = 0;
        for (let i = 0; i < currentTicket.length; i++) {
            const item = currentTicket[i];
            fragment.appendChild(createTicketItem(item));
            total += item.price * item.quantity;
        }
        ticketItems.innerHTML = '';
        ticketItems.appendChild(fragment);
        if (totalAmount) totalAmount.textContent = formatCurrency(total);
    }
}

function createTicketItem(item) {
    const itemElement = document.createElement('div');
    itemElement.className = 'order-item';
    
    itemElement.innerHTML = `
        <div class="item-info">
            <div class="item-name">${item.name}</div>
            <div class="item-price">${formatCurrency(item.price)}</div>
        </div>
        <div class="item-quantity">
            <button class="quantity-btn" onclick="updateQuantity(${item.id}, -1)">-</button>
            <span style="color: white; font-weight: 600;">${item.quantity}</span>
            <button class="quantity-btn" onclick="updateQuantity(${item.id}, 1)">+</button>
        </div>
    `;
    
    return itemElement;
}

function updateQuantity(productId, change) {
    const item = currentTicket.find(item => item.id === productId);
    if (item) {
        item.quantity += change;
        if (item.quantity <= 0) {
            currentTicket = currentTicket.filter(item => item.id !== productId);
        }
        renderTicket();
    }
}

function renderTableSelection(tables) {
    const tableSelection = document.querySelector('#table-selection');
    if (tableSelection) {
        tableSelection.innerHTML = '<option value="direct">Venta Directa</option>';
        tables.forEach(table => {
            const option = document.createElement('option');
            option.value = table.id;
            option.textContent = `Mesa ${table.name}`;
            tableSelection.appendChild(option);
        });

        // If a table is already selected (e.g., from dashboard), ensure it is reflected in the select
        if (selectedTable && selectedTable.id) {
            const exists = Array.from(tableSelection.options).some(opt => parseInt(opt.value) === selectedTable.id);
            if (!exists) {
                const currentOption = document.createElement('option');
                currentOption.value = selectedTable.id;
                currentOption.textContent = `Mesa ${selectedTable.name}`;
                tableSelection.appendChild(currentOption);
            }
            tableSelection.value = String(selectedTable.id);
        } else {
            tableSelection.value = 'direct';
        }

        // Update label on change
        tableSelection.onchange = () => {
            if (tableSelection.value === 'direct') {
                selectedTable = null;
            } else {
                const selectedOption = tableSelection.options[tableSelection.selectedIndex];
                selectedTable = { id: parseInt(tableSelection.value), name: selectedOption.textContent.replace('Mesa ', '') };
            }
            updateCurrentTableLabel();
        };
    }
}

// Table management
async function loadTablesData() {
    try {
        const tablesData = await apiInvoke('get-tables');
        renderTablesGrid(tablesData);
    } catch (error) {
        console.error('Error loading tables data:', error);
    }
}

function renderTablesGrid(tables) {
    const tablesContainer = document.querySelector('#tables-module .tables-container');
    if (tablesContainer) {
        tablesContainer.innerHTML = '';
        tables.forEach(table => {
            const tableCard = createTableCard(table);
            tableCard.onclick = () => selectTable(table);
            tablesContainer.appendChild(tableCard);
        });
    }
}

function createTableCard(table) {
    const card = document.createElement('div');
    card.className = `table-card ${table.status === 'free' ? 'free' : 'occupied'}`;
    
    card.innerHTML = `
        <div class="table-number">${table.name}</div>
        <div class="table-status">${table.status === 'free' ? 'Libre' : 'Ocupada'}</div>
        <div class="table-info">
            ${table.status === 'free' 
                ? `Capacidad: ${table.capacity || 4} personas`
                : `${formatCurrency(table.currentTotal || 0)} - ${table.itemCount || 0} items`
            }
        </div>
    `;
    
    return card;
}

async function selectTable(table) {
    if (table.status === 'free') {
        // Start new order for this table
        selectedTable = table;
        suppressPosReload = true;
        showModule('pos');
        await loadPOSData();
        updateCurrentTableLabel();
        const tableSelection = document.querySelector('#table-selection');
        if (tableSelection) {
            tableSelection.value = String(table.id);
        }
        currentTicket = [];
        renderTicket();
    } else {
        // Show existing order for this table
        await loadTableOrder(table);
    }
}

async function loadTableOrder(table) {
    try {
        const orderData = await apiInvoke('get-table-order', table.id);
        selectedTable = table;
        suppressPosReload = true;
        showModule('pos');
        await loadPOSData();
        currentTicket = orderData.items || [];
        updateCurrentTableLabel();
        const tableSelection = document.querySelector('#table-selection');
        if (tableSelection) {
            const exists = Array.from(tableSelection.options).some(opt => parseInt(opt.value) === table.id);
            if (!exists) {
                const currentOption = document.createElement('option');
                currentOption.value = table.id;
                currentOption.textContent = `Mesa ${table.name}`;
                tableSelection.appendChild(currentOption);
            }
            tableSelection.value = String(table.id);
        }
        renderTicket();
    } catch (error) {
        console.error('Error loading table order:', error);
    }
}

// POS Actions
function bindPosButtons() {
    const finalizeBtn = document.querySelector('#pos-module .btn-primary');
    const saveBtn = document.querySelector('#pos-module .btn-secondary');
    if (finalizeBtn && !finalizeBtn._bound) {
        finalizeBtn.addEventListener('click', finalizeSale);
        finalizeBtn._bound = true;
    }
    if (saveBtn && !saveBtn._bound) {
        saveBtn.addEventListener('click', saveOrder);
        saveBtn._bound = true;
    }
}

bindPosButtons();

async function finalizeSale() {
    if (currentTicket.length === 0) {
        showNotification('No hay productos en la cuenta', 'error');
        return;
    }
    
    const btnFinalize = document.querySelector('#pos-module .btn-primary');
    const originalTextFinalize = btnFinalize?.textContent || '';
    try {
        const selectionValue = document.querySelector('#table-selection')?.value || 'direct';
        const tableId = selectedTable?.id ?? (selectionValue === 'direct' ? null : parseInt(selectionValue));
        const saleData = {
            items: currentTicket,
            tableId: tableId,
            total: currentTicket.reduce((sum, item) => sum + (item.price * item.quantity), 0)
        };
        
        if (btnFinalize) { btnFinalize.textContent = 'Procesando...'; btnFinalize.disabled = true; }
        const result = await apiInvoke('process-sale', saleData);
        
        if (result.success) {
            showNotification('Venta finalizada', 'success');
            currentTicket = [];
            selectedTable = null;
            renderTicket();
            showModule('dashboard');
            await loadDashboardData();
            setTimeout(() => { try { loadDashboardData(); } catch (_) {} }, 300);
        } else {
            showNotification('Error al procesar la venta', 'error');
        }
    } catch (error) {
        showNotification('Error al procesar la venta', 'error');
        console.error(error);
    }
    finally {
        if (btnFinalize) { btnFinalize.textContent = originalTextFinalize; btnFinalize.disabled = false; }
    }
}

async function saveOrder() {
    if (currentTicket.length === 0) {
        showNotification('No hay productos en la cuenta', 'error');
        return;
    }
    
    const btnSave = document.querySelector('#pos-module .btn-secondary');
    const originalTextSave = btnSave?.textContent || '';
    try {
        const selectionValue = document.querySelector('#table-selection')?.value || 'direct';
        const tableId = selectedTable?.id ?? (selectionValue === 'direct' ? null : parseInt(selectionValue));
        const orderData = {
            items: currentTicket,
            tableId: tableId
        };
        
        if (btnSave) { btnSave.textContent = 'Guardando...'; btnSave.disabled = true; }
        const result = await apiInvoke('save-order', orderData);
        
        if (result.success) {
            showNotification('Cuenta guardada', 'success');
        } else {
            showNotification('Error al guardar la cuenta', 'error');
        }
    } catch (error) {
        showNotification('Error al guardar la cuenta', 'error');
        console.error(error);
    }
    finally {
        if (btnSave) { btnSave.textContent = originalTextSave; btnSave.disabled = false; }
    }
}

// Utility functions
const formatCop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });
function formatCurrency(amount) {
    const n = Number(amount) || 0;
    return formatCop.format(n);
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === 'success' ? 'var(--success-green)' : type === 'error' ? 'var(--danger-red)' : 'var(--primary-gold)'};
        color: white;
        border-radius: 8px;
        z-index: 1000;
        font-weight: 500;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

function showActionNotification(message, actionLabel, onAction) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 20px;
        padding: 12px 16px;
        background: rgba(26,26,26,0.95);
        border: 2px solid var(--primary-gold, #d4af37);
        color: white;
        border-radius: 8px;
        z-index: 1000;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 12px;
    `;
    const text = document.createElement('span');
    text.textContent = message;
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = actionLabel;
    btn.onclick = () => { try { onAction && onAction(); } finally { notification.remove(); } };
    notification.appendChild(text);
    notification.appendChild(btn);
    document.body.appendChild(notification);
    setTimeout(() => { notification.remove(); }, 5000);
}

// Initialize the application
setupGlobalEventListeners();
// Try session restore
try {
    const stored = localStorage.getItem('sessionUser');
    if (stored) {
        currentUser = JSON.parse(stored);
        loginContainer.classList.add('hidden');
        appContainer.classList.remove('hidden');
        const last = localStorage.getItem('lastModule') || 'dashboard';
        showModule(last);
    }
} catch (_) {}

function setupGlobalEventListeners() {
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            const posModule = document.getElementById('pos-module');
            if (posModule && posModule.classList.contains('active')) {
                finalizeSale();
            }
        }
        if (e.key === 'F9') {
            const posModule = document.getElementById('pos-module');
            if (posModule && posModule.classList.contains('active')) {
                e.preventDefault();
                finalizeSale();
            }
        }
        if (e.key === 'F8') {
            const posModule = document.getElementById('pos-module');
            if (posModule && posModule.classList.contains('active')) {
                e.preventDefault();
                saveOrder();
            }
        }
    });
}

// Export functions for global access
window.showModule = showModule;
window.updateQuantity = updateQuantity;
window.selectTable = selectTable;
window.finalizeSale = finalizeSale;
window.saveOrder = saveOrder;

function updateCurrentTableLabel() {
    const label = document.getElementById('current-table');
    if (!label) return;
    if (selectedTable && selectedTable.name) {
        label.textContent = `Mesa ${selectedTable.name}`;
    } else {
        const selectionValue = document.querySelector('#table-selection')?.value || 'direct';
        if (selectionValue === 'direct') {
            label.textContent = 'Venta Directa';
        } else {
            const selectedOption = document.querySelector('#table-selection')?.options[document.querySelector('#table-selection')?.selectedIndex];
            label.textContent = selectedOption?.textContent || 'Venta Directa';
        }
    }
}

// Inventory module
async function loadInventoryData() {
    try {
        const products = await apiInvoke('get-products');
        renderInventory(products);
    } catch (e) {
        console.error('Error loading inventory:', e);
    }
}

function renderInventory(products) {
    const module = document.getElementById('inventory-module');
    if (!module) return;
    module.innerHTML = `
        <div class="page-header">
            <div class="brand-logo">
                <div class="logo-text">EUFORIA</div>
                <div class="logo-subtitle">LIQUORS</div>
            </div>
            <h2>Inventario</h2>
        </div>
        <div class="card">
            <div class="card-header"><h3>Gestión de Productos</h3></div>
            <div class="input-group" style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px;">
                <input id="inv-name" placeholder="Nombre" />
                <input id="inv-price" type="number" step="1" placeholder="Precio (COP)" />
                <input id="inv-stock" type="number" placeholder="Stock" />
                <input id="inv-category" placeholder="Categoría" />
            </div>
            <div class="action-buttons" style="flex-direction:row; gap:10px;">
                <button type="button" class="btn btn-primary" id="inv-add">Guardar</button>
                <button type="button" class="btn btn-secondary hidden" id="inv-cancel">Cancelar Edición</button>
            </div>
        </div>
        <div class="card">
            <div class="card-header"><h3>Buscar</h3></div>
            <div class="input-group" style="display:grid; grid-template-columns: 1fr; gap:10px;">
                <input id="inv-search" placeholder="Buscar por nombre o categoría" />
            </div>
        </div>
        <div class="card">
            <div class="card-header"><h3>Productos</h3></div>
            <div style="overflow:auto;">
                <table style="width:100%; border-collapse:collapse;">
                    <thead>
                        <tr><th style="text-align:left; padding:8px;">Nombre</th><th style="text-align:right; padding:8px;">Precio</th><th style="text-align:right; padding:8px;">Stock</th><th style="text-align:left; padding:8px;">Categoría</th><th style="padding:8px;">Acciones</th></tr>
                    </thead>
                    <tbody id="inv-tbody"></tbody>
                </table>
            </div>
        </div>
    `;
    const tbody = module.querySelector('#inv-tbody');
    function renderInvRows(list) {
        tbody.innerHTML = '';
        list.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style=\"padding:8px;\">${p.name}</td>
                <td style=\"padding:8px; text-align:right;\">${formatCurrency(p.price)}</td>
                <td style=\"padding:8px; text-align:right;\">${p.stock}</td>
                <td style=\"padding:8px;\">${p.category || ''}</td>
                <td style=\"padding:8px; display:flex; gap:8px; justify-content:center;\">
                    <button type=\"button\" class=\"btn btn-secondary\" data-edit=\"${p.id}\">Editar</button>
                    <button type=\"button\" class=\"btn btn-secondary\" data-del=\"${p.id}\">Eliminar</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
    renderInvRows(products);

    // Bind actions
    let editingId = null;
    const nameEl = module.querySelector('#inv-name');
    const priceEl = module.querySelector('#inv-price');
    const stockEl = module.querySelector('#inv-stock');
    const catEl = module.querySelector('#inv-category');
    const addBtn = module.querySelector('#inv-add');
    const cancelBtn = module.querySelector('#inv-cancel');

    tbody.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.dataset.edit) {
            const id = parseInt(btn.dataset.edit);
            const prod = products.find(x => x.id === id);
            if (!prod) return;
            editingId = id;
            nameEl.value = prod.name; priceEl.value = String(Math.round(Number(prod.price) || 0)); stockEl.value = String(prod.stock); catEl.value = prod.category || '';
            addBtn.textContent = 'Actualizar';
            cancelBtn.classList.remove('hidden');
        } else if (btn.dataset.del) {
            const id = parseInt(btn.dataset.del);
            const prod = products.find(x => x.id === id);
            if (!confirm('¿Eliminar producto?')) return;
            const res = await apiInvoke('delete-product', id);
            if (res.success !== false) {
                lastDeletedProduct = prod;
                showActionNotification('Producto eliminado', 'Deshacer', async () => {
                    if (lastDeletedProduct) {
                        const payload = { name: lastDeletedProduct.name, price: Math.round(Number(lastDeletedProduct.price)||0), stock: lastDeletedProduct.stock, category: lastDeletedProduct.category };
                        const addRes = await apiInvoke('add-product', payload);
                        if (addRes.success === false) { showNotification('No se pudo deshacer', 'error'); }
                        else { showNotification('Eliminación deshecha', 'success'); }
                        lastDeletedProduct = null;
                        loadInventoryData();
                    }
                });
                loadInventoryData();
            } else {
                showNotification('Error al eliminar', 'error');
            }
        }
    });

    addBtn.addEventListener('click', async () => {
        const payload = {
            name: nameEl.value.trim(),
            price: (() => { const v = String(priceEl.value||'').replace(/[^0-9]/g,''); return v? parseInt(v,10): NaN; })(),
            stock: (() => { const v = String(stockEl.value||'').replace(/[^0-9]/g,''); return v? parseInt(v,10): NaN; })(),
            category: catEl.value.trim()
        };
        if (!payload.name || isNaN(payload.price) || isNaN(payload.stock)) { alert('Complete nombre, precio y stock'); return; }
        if (editingId) {
            payload.id = editingId;
            const res = await apiInvoke('update-product', payload);
            if (res.success === false) alert('Error al actualizar');
        } else {
            const res = await apiInvoke('add-product', payload);
            if (res.success === false) alert('Error al agregar');
        }
        editingId = null; nameEl.value = ''; priceEl.value = ''; stockEl.value=''; catEl.value='';
        addBtn.textContent = 'Guardar'; cancelBtn.classList.add('hidden');
        loadInventoryData();
    });
    cancelBtn.addEventListener('click', () => {
        editingId = null; nameEl.value = ''; priceEl.value = ''; stockEl.value=''; catEl.value='';
        addBtn.textContent = 'Guardar'; cancelBtn.classList.add('hidden');
    });

    const searchEl = module.querySelector('#inv-search');
    if (searchEl) {
        let t = null;
        searchEl.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => {
                const q = searchEl.value.trim().toLowerCase();
                if (!q) { renderInvRows(products); return; }
                const filtered = products.filter(p => (p.name || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q));
                renderInvRows(filtered);
            }, 150);
        });
    }
}

// Reports module
async function loadReportsData() {
    renderReportsUI();
    await refreshTransactions();
}

function renderReportsUI() {
    const module = document.getElementById('reports-module');
    if (!module) return;
    module.innerHTML = `
        <div class="page-header">
            <div class="brand-logo">
                <div class="logo-text">EUFORIA</div>
                <div class="logo-subtitle">LIQUORS</div>
            </div>
            <h2>Reportes</h2>
        </div>
        <div class="card">
            <div class="card-header"><h3>Filtros</h3></div>
            <div class="input-group" style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px;">
                <input type="date" id="rep-from" />
                <input type="date" id="rep-to" />
                <select id="rep-type"><option value="">Todos</option><option value="income">Ingresos</option><option value="expense">Gastos</option></select>
                <button type="button" class="btn btn-primary" id="rep-apply">Aplicar</button>
            </div>
            <div class="input-group" style="display:flex; gap:10px; margin-top:10px;">
                <button type="button" class="btn btn-secondary" id="rep-today">Hoy</button>
                <button type="button" class="btn btn-secondary" id="rep-month">Este Mes</button>
                <button type="button" class="btn btn-secondary" id="rep-clear">Limpiar</button>
            </div>
        </div>
        <div class="card">
            <div class="card-header"><h3>Transacciones</h3></div>
            <div class="input-group" style="display:flex; gap:10px; margin-bottom:10px;">
                <button type="button" class="btn btn-secondary" id="rep-export">Exportar CSV</button>
                <button type="button" class="btn btn-secondary" id="rep-print">Imprimir</button>
                <button type="button" class="btn btn-secondary" id="rep-print-summary">Imprimir Resumen</button>
            </div>
            <div id="rep-list" style="max-height:40vh; overflow:auto;"></div>
        </div>
        <div class="card">
            <div class="card-header"><h3>Resumen</h3></div>
            <div id="rep-summary" style="display:flex; gap:20px; color:#b0b0b0;"></div>
        </div>
        <div class="card">
            <div class="card-header"><h3>Agregar Ingreso / Gasto</h3></div>
            <div class="input-group" style="display:grid; grid-template-columns: 2fr 1fr 1fr; gap:10px;">
                <input id="tx-desc" placeholder="Descripción" />
                <input id="tx-amount" type="number" step="1" placeholder="Monto (COP)" />
                <div style="display:flex; gap:10px;">
                    <button type="button" class="btn btn-primary" id="tx-add-income">Agregar Ingreso</button>
                    <button type="button" class="btn btn-secondary" id="tx-add-expense">Agregar Gasto</button>
                </div>
            </div>
        </div>
    `;
    // Ensure module becomes visible if menu doesn't toggle correctly
    const reportsContainer = document.getElementById('reports-module');
    if (reportsContainer) reportsContainer.classList.add('active');
    module.querySelector('#rep-apply').addEventListener('click', refreshTransactions);
    module.querySelector('#rep-export').addEventListener('click', exportTransactionsToCSV);
    module.querySelector('#rep-print').addEventListener('click', printTransactions);
    module.querySelector('#rep-print-summary').addEventListener('click', printSummary);
    module.querySelector('#rep-today').addEventListener('click', () => {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        module.querySelector('#rep-from').value = `${yyyy}-${mm}-${dd}`;
        module.querySelector('#rep-to').value = `${yyyy}-${mm}-${dd}`;
        refreshTransactions();
    });
    module.querySelector('#rep-month').addEventListener('click', () => {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = now.getMonth();
        const first = new Date(yyyy, mm, 1);
        const last = new Date(yyyy, mm + 1, 0);
        const f = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(first.getDate()).padStart(2, '0')}`;
        const t = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
        module.querySelector('#rep-from').value = f;
        module.querySelector('#rep-to').value = t;
        refreshTransactions();
    });
    module.querySelector('#rep-clear').addEventListener('click', () => {
        module.querySelector('#rep-from').value = '';
        module.querySelector('#rep-to').value = '';
        module.querySelector('#rep-type').value = '';
        refreshTransactions();
    });
    module.querySelector('#tx-add-income').addEventListener('click', async () => {
        const desc = module.querySelector('#tx-desc').value.trim();
        const amount = Math.round(parseFloat(module.querySelector('#tx-amount').value));
        if (!desc || isNaN(amount)) { alert('Complete descripción y monto'); return; }
        const btn = module.querySelector('#tx-add-income'); const orig = btn.textContent; btn.textContent = 'Guardando...'; btn.disabled = true;
        const res = await apiInvoke('add-income', { description: desc, amount });
        btn.textContent = orig; btn.disabled = false;
        if (res.success === false) { showNotification('Error al agregar ingreso', 'error'); return; }
        showNotification('Ingreso agregado', 'success');
        module.querySelector('#tx-desc').value = ''; module.querySelector('#tx-amount').value = '';
        refreshTransactions();
    });
    module.querySelector('#tx-add-expense').addEventListener('click', async () => {
        const desc = module.querySelector('#tx-desc').value.trim();
        const amount = Math.round(parseFloat(module.querySelector('#tx-amount').value));
        if (!desc || isNaN(amount)) { alert('Complete descripción y monto'); return; }
        const btn = module.querySelector('#tx-add-expense'); const orig = btn.textContent; btn.textContent = 'Guardando...'; btn.disabled = true;
        const res = await apiInvoke('add-expense', { description: desc, amount });
        btn.textContent = orig; btn.disabled = false;
        if (res.success === false) { showNotification('Error al agregar gasto', 'error'); return; }
        showNotification('Gasto agregado', 'success');
        module.querySelector('#tx-desc').value = ''; module.querySelector('#tx-amount').value = '';
        refreshTransactions();
    });
}

async function refreshTransactions() {
    const module = document.getElementById('reports-module');
    const from = module.querySelector('#rep-from').value;
    const to = module.querySelector('#rep-to').value;
    const type = module.querySelector('#rep-type').value;
    const list = module.querySelector('#rep-list');
    list.textContent = 'Cargando...';
    try {
        const rows = await apiInvoke('get-transactions-filtered', { from, to, type });
        lastTransactions = rows;
        list.innerHTML = rows.map(r => `<div style=\"display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid rgba(255,255,255,0.1);\"><span>${r.created_at} - ${r.description || ''}</span><span>${r.type === 'expense' ? '-' : ''}${formatCurrency(r.amount)}</span></div>`).join('');
        const income = rows.filter(r => r.type === 'income').reduce((s, r) => s + Number(r.amount || 0), 0);
        const expense = rows.filter(r => r.type === 'expense').reduce((s, r) => s + Number(r.amount || 0), 0);
        const balance = income - expense;
        const summary = module.querySelector('#rep-summary');
        if (summary) {
            summary.innerHTML = `
                <div>Ingresos: <strong style="color:#27ae60;">${formatCurrency(income)}</strong></div>
                <div>Gastos: <strong style="color:#e74c3c;">${formatCurrency(expense)}</strong></div>
                <div>Balance: <strong style="color:${balance>=0?'#27ae60':'#e74c3c'};">${formatCurrency(balance)}</strong></div>
            `;
        }
    } catch (e) {
        list.textContent = 'Error al cargar';
    }
}

function exportTransactionsToCSV() {
    const rows = lastTransactions || [];
    const header = ['Fecha', 'Tipo', 'Descripción', 'Monto'];
    const csvRows = [header.join(',')].concat(rows.map(r => [
        (r.created_at || '').replace(/,/g, ' '),
        r.type || '',
        (r.description || '').replace(/,/g, ' '),
        String(r.amount || 0)
    ].join(',')));
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transacciones.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function printTransactions() {
    const module = document.getElementById('reports-module');
    const list = module.querySelector('#rep-list');
    const win = window.open('', 'PRINT', 'height=600,width=800');
    win.document.write('<html><head><title>Transacciones</title></head><body>');
    win.document.write(list.innerHTML);
    win.document.write('</body></html>');
    win.document.close();
    win.focus();
    win.print();
    win.close();
}

function printSummary() {
    const module = document.getElementById('reports-module');
    const summary = module.querySelector('#rep-summary');
    const from = module.querySelector('#rep-from').value || '-';
    const to = module.querySelector('#rep-to').value || '-';
    const type = module.querySelector('#rep-type').value || 'Todos';
    const win = window.open('', 'PRINT', 'height=600,width=800');
    win.document.write('<html><head><title>Resumen</title></head><body>');
    win.document.write(`<h3>Resumen de Transacciones</h3>`);
    win.document.write(`<div>Rango: ${from} a ${to} | Tipo: ${type}</div>`);
    win.document.write(summary.innerHTML);
    win.document.write('</body></html>');
    win.document.close();
    win.focus();
    win.print();
    win.close();
}

async function updateCashStatusOnDashboard() {
    try {
        const res = await apiInvoke('get-cash-sessions', { status: 'open' });
        const el = document.querySelector('#dash-cash-status');
        if (el) {
            if (Array.isArray(res) && res.length > 0) { el.textContent = 'Abierta'; el.style.color = '#27ae60'; }
            else { el.textContent = 'Cerrada'; el.style.color = '#e74c3c'; }
        }
    } catch (e) {
        const el = document.querySelector('#dash-cash-status');
        if (el) { el.textContent = '-'; el.style.color = '#b0b0b0'; }
    }
}

// Schedules module
async function loadSchedulesData() {
    renderSchedulesUI();
    await refreshSchedules();
}

function renderSchedulesUI() {
    const module = document.getElementById('schedules-module');
    if (!module) return;
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    module.innerHTML = `
        <div class="page-header">
            <div class="brand-logo">
                <div class="logo-text">EUFORIA</div>
                <div class="logo-subtitle">LIQUORS</div>
            </div>
            <h2>Cronograma</h2>
        </div>
        <div class="card">
            <div class="card-header"><h3>Programar Turnos</h3></div>
            <div class="input-group" style="display:grid; grid-template-columns: repeat(5, 1fr); gap:10px;">
                <input id="sch-year" type="number" min="2000" value="${yyyy}" />
                <input id="sch-month" type="number" min="1" max="12" value="${parseInt(mm)}" />
                <input id="sch-date" type="date" />
                <input id="sch-start" type="time" />
                <input id="sch-end" type="time" />
            </div>
            <div class="input-group" style="display:grid; grid-template-columns: 1fr 200px; gap:10px;">
                <select id="sch-user"></select>
                <button class="btn btn-primary" id="sch-add">Agregar Turno</button>
            </div>
            <div class="action-buttons" style="flex-direction:row; gap:10px;">
                <button class="btn btn-secondary" id="sch-reload">Cargar Mes</button>
            </div>
        </div>
        <div class="card">
            <div class="card-header"><h3>Turnos</h3></div>
            <div id="sch-list" style="max-height:50vh; overflow:auto;"></div>
        </div>
    `;
    module.querySelector('#sch-reload').addEventListener('click', refreshSchedules);
    module.querySelector('#sch-add').addEventListener('click', addSchedule);
}

async function refreshSchedules() {
    const module = document.getElementById('schedules-module');
    const year = parseInt(module.querySelector('#sch-year').value);
    const month = parseInt(module.querySelector('#sch-month').value);
    try {
        const users = await apiInvoke('get-users-for-schedule');
        const sel = module.querySelector('#sch-user');
        sel.innerHTML = users.map(u => `<option value="${u.id}">${u.username}</option>`).join('');
        const res = await apiInvoke('get-schedules', { year, month });
        const list = module.querySelector('#sch-list');
        list.innerHTML = (res.schedules || []).map(s => `<div style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.1);">${s.work_date} ${s.start_time}-${s.end_time} — ${s.username}</div>`).join('');
    } catch (e) {
        console.error(e);
    }
}

async function addSchedule() {
    const module = document.getElementById('schedules-module');
    const userId = parseInt(module.querySelector('#sch-user').value);
    const workDate = module.querySelector('#sch-date').value;
    const startTime = module.querySelector('#sch-start').value;
    const endTime = module.querySelector('#sch-end').value;
    if (!userId || !workDate || !startTime || !endTime) { alert('Complete todos los campos'); return; }
    const res = await apiInvoke('add-schedule', { userId, workDate, startTime, endTime });
    if (res.success === false) alert('Error al agregar turno');
    await refreshSchedules();
}
