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
        'create-table': async () => post('/tables', payload),
        'update-table': async () => put(`/tables/${payload.id}`, payload),
        'delete-table': async () => del(`/tables/${payload}`),
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
        'get-users': async () => get('/users'),
        'add-user': async () => post('/users', payload),
        'update-user': async () => put(`/users/${payload.id}`, payload),
        'delete-user': async () => del(`/users/${payload}`),
        'toggle-user-status': async () => put(`/users/${payload}/toggle-status`),
        'check-username': async () => get(`/users/check-username${toQuery(payload)}`),
        'reset-password': async () => post(`/users/${payload.id}/reset-password`, { new_password: payload.new_password }),
        // Credits
        'credits-list': async () => get(`/credits${toQuery(payload)}`),
        'credits-create': async () => post('/credits', payload),
        'credits-add-payment': async () => post(`/credits/${payload.id}/payments`, { amount: payload.amount, payment_method: payload.payment_method }),
        'credits-set-status': async () => put(`/credits/${payload.id}/status`, { status: payload.status }),
        // Transactions admin (super admin only)
        'tx-update': async () => put(`/transactions/${payload.id}`, { amount: payload.amount, description: payload.description, payment_method: payload.payment_method, type: payload.type, user_role: currentUser?.role }),
        'tx-delete': async () => del(`/transactions/${payload}?user_role=${encodeURIComponent(currentUser?.role||'')}`),
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
    const headers = {};
    try { const loc = localStorage.getItem('activeLocationId'); if (loc) headers['x-location-id'] = loc; } catch(_) {}
    try { if (currentUser && currentUser.role) headers['x-user-role'] = currentUser.role; } catch(_) {}
    const res = await fetch(`${API_BASE}${pathname}`, { cache: 'no-store', headers });
    if (!res.ok) {
        let msg = 'network';
        try { const j = await res.json(); msg = j?.error || JSON.stringify(j); } catch(_) { try { msg = await res.text(); } catch(__) {} }
        throw new Error(msg || 'network');
    }
    return await res.json();
}
async function post(pathname, body) {
    const headers = { 'Content-Type': 'application/json' };
    try { const loc = localStorage.getItem('activeLocationId'); if (loc) headers['x-location-id'] = loc; } catch(_) {}
    try { if (currentUser && currentUser.role) headers['x-user-role'] = currentUser.role; } catch(_) {}
    const doFetch = async () => {
        const res = await fetch(`${API_BASE}${pathname}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body || {}),
            cache: 'no-store'
        });
        if (!res.ok) {
            let msg = 'network';
            try { const j = await res.json(); msg = j?.error || JSON.stringify(j); } catch(_) { try { msg = await res.text(); } catch(__) {} }
            const err = new Error(msg || 'network'); err.httpStatus = res.status; throw err;
        }
        return await res.json();
    };
    try { return await doFetch(); } catch (e) {
        // Simple retry once for transient errors
        await new Promise(r => setTimeout(r, 300));
        return await doFetch();
    }
}
async function put(pathname, body) {
    const headers = { 'Content-Type': 'application/json' };
    try { const loc = localStorage.getItem('activeLocationId'); if (loc) headers['x-location-id'] = loc; } catch(_) {}
    try { if (currentUser && currentUser.role) headers['x-user-role'] = currentUser.role; } catch(_) {}
    const res = await fetch(`${API_BASE}${pathname}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body || {}),
        cache: 'no-store'
    });
    if (!res.ok) {
        let msg = 'network';
        try { const j = await res.json(); msg = j?.error || JSON.stringify(j); } catch(_) { try { msg = await res.text(); } catch(__) {} }
        const err = new Error(msg || 'network'); err.httpStatus = res.status; throw err;
    }
    return await res.json();
}
async function del(pathname) {
    const headers = {};
    try { const loc = localStorage.getItem('activeLocationId'); if (loc) headers['x-location-id'] = loc; } catch(_) {}
    try { if (currentUser && currentUser.role) headers['x-user-role'] = currentUser.role; } catch(_) {}
    const res = await fetch(`${API_BASE}${pathname}`, { method: 'DELETE', cache: 'no-store', headers });
    if (!res.ok) {
        let msg = 'network';
        try { const j = await res.json(); msg = j?.error || JSON.stringify(j); } catch(_) { try { msg = await res.text(); } catch(__) {} }
        const err = new Error(msg || 'network'); err.httpStatus = res.status; throw err;
    }
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
            const label = document.getElementById('current-user-label');
            if (label) { label.textContent = `Sesión: ${currentUser.username} (${getRoleDisplayName(currentUser.role)})`; }
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
    // Gate admin-only modules
    const isSuper = currentUser && currentUser.role === 'super_admin';

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
            ensureTablesAdminVisibility();
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
        case 'users':
            if (isSuper) { loadUsersData(); }
            else { showNotification('Acceso restringido', 'error'); showModule('dashboard'); }
            break;
    }
    // Setup location switcher for super admin
    const locSwitch = document.getElementById('location-switcher');
    if (locSwitch && !locSwitch._bound) {
        if (isSuper) {
            locSwitch.style.display = '';
            refreshLocationsDropdown();
        } else {
            locSwitch.style.display = 'none';
        }
        locSwitch._bound = true;
    } else if (locSwitch && isSuper) {
        // if already bound but became visible later (after login), refresh
        locSwitch.style.display = '';
        refreshLocationsDropdown();
    }
}

async function refreshLocationsDropdown() {
    try {
        const locations = await get('/locations');
        const sel = document.getElementById('active-location');
        if (!sel) return;
        const options = (locations||[]).filter(l=>l.is_active!==0).map(l=>`<option value="${l.id}">${l.name}</option>`).join('');
        sel.innerHTML = options || '<option value="1">Euforia Liquors</option>';
        try {
            const saved = localStorage.getItem('activeLocationId') || '1';
            if (Array.from(sel.options).some(o=>o.value===saved)) sel.value = saved; else sel.value = '1';
        } catch(_) {}
        sel.onchange = () => {
            try { localStorage.setItem('activeLocationId', sel.value); } catch(_) {}
            // Reload current module data
            const last = localStorage.getItem('lastModule') || 'dashboard';
            showModule(last);
        };
    } catch (e) {
        // ignore
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
        // Show suggested cash close if any
        try {
            const dash = document.getElementById('dashboard-module');
            const sum = await getCashSummary();
            const lbl = dash?.querySelector('#dash-cash-status');
            if (sum?.hasOpen && lbl) {
                const sug = formatCurrency(Number(sum.suggestedClose||0));
                lbl.title = `Cierre sugerido (efectivo): ${sug}`;
            }
        } catch (_) {}
        // Bind cash actions if present in dashboard
        const dashModule = document.getElementById('dashboard-module');
        if (dashModule) {
            const openBtn = dashModule.querySelector('#dash-cash-open');
            const closeBtn = dashModule.querySelector('#dash-cash-close');
            if (openBtn && !openBtn._bound) {
                openBtn.addEventListener('click', async () => {
                    const amount = parseFloat(dashModule.querySelector('#dash-cash-open-amount').value);
                    if (isNaN(amount)) { alert('Monto inválido'); return; }
                    // No permitir abrir si ya hay caja abierta
                    const status = await apiInvoke('get-cash-sessions', { status: 'open' });
                    if (Array.isArray(status) && status.length > 0) { showNotification('Ya hay una caja abierta', 'error'); return; }
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
                    // Obtener sugerido y advertir si difiere
                    try {
                        const cashSum = await getCashSummary();
                        if (cashSum?.hasOpen) {
                            const sug = Number(cashSum.suggestedClose || 0);
                            if (Math.round(amount) !== Math.round(sug)) {
                                let proceed = false;
                                openAppModal({ title: 'Cerrar Caja', message: `Cierre sugerido (efectivo): ${formatCurrency(sug)}. ¿Desea cerrar con ${formatCurrency(Math.round(amount))}?`, confirmText: 'Cerrar', cancelText: 'Cancelar', onConfirm: () => { proceed = true; } });
                                const wait = () => new Promise(r => setTimeout(r, 300));
                                // Simple wait loop for modal confirmation
                                for (let i=0;i<20 && !proceed;i++) await wait();
                                if (!proceed) return;
                            }
                        }
                    } catch (_) {}
                    const original = closeBtn.textContent; closeBtn.textContent = 'Cerrando...'; closeBtn.disabled = true;
                    const res = await apiInvoke('cash-close', { closing_balance: Math.round(amount), user_id: currentUser?.id || 1 });
                    closeBtn.textContent = original; closeBtn.disabled = false;
                    if (res.success === false) { showNotification(res.error || 'Error al cerrar caja', 'error'); }
                    else { showNotification('Caja cerrada', 'success'); updateCashStatusOnDashboard(); }
                });
                closeBtn._bound = true;
            }
            updateCashStatusOnDashboard();
            // Render turn summary
            try {
                const turn = await getTurnSummary();
                const panel = dashModule.querySelector('#turn-summary');
                if (panel && turn && turn.hasOpen) {
                    panel.innerHTML = `
                        <div>Ventas: <strong style="color:#d4af37;">${formatCurrency(turn.sales||0)}</strong></div>
                        <div>Otros ingresos: <strong style="color:#27ae60;">${formatCurrency(turn.otherIncome||0)}</strong></div>
                        <div>Gastos: <strong style="color:#e74c3c;">${formatCurrency(turn.expense||0)}</strong></div>
                        <div>Efectivo (ing): <strong style="color:#27ae60;">${formatCurrency(turn.incomeCash||0)}</strong></div>
                        <div>Transferencias (ing): <strong style="color:#27ae60;">${formatCurrency(turn.incomeTransfer||0)}</strong></div>
                        <div>Sugerido cierre (efectivo): <strong style="color:#27ae60;">${formatCurrency(turn.suggestedClose||0)}</strong></div>
                    `;
                } else if (panel) {
                    panel.innerHTML = '<div>No hay caja abierta.</div>';
                }
            } catch (_) {}
        }
    } catch (error) {
        console.error('Error loading dashboard data:', error);
    }
}

function updateDashboardSummary(data) {
    const salesEl = document.getElementById('dash-sales-today');
    const tablesEl = document.getElementById('dash-active-tables');
    const transEl = document.getElementById('dash-total-trans');
    if (salesEl) salesEl.textContent = formatCurrency(data.totalSales || 0);
    const incLbl = document.getElementById('dash-income-today');
    if (incLbl && typeof data.totalIncomeToday !== 'undefined') incLbl.textContent = formatCurrency(data.totalIncomeToday || 0);
    if (tablesEl) tablesEl.textContent = String(data.activeTables || 0);
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

async function getCashSummary() {
    try {
        const res = await fetch(`${API_BASE}/cash/summary`, { cache: 'no-store' });
        if (!res.ok) return null;
        return await res.json();
    } catch (_) { return null; }
}

async function getTurnSummary() {
    try {
        const res = await fetch(`${API_BASE}/cash/turn-summary`, { cache: 'no-store' });
        if (!res.ok) return null;
        return await res.json();
    } catch (_) { return null; }
}

// POS functionality
async function loadPOSData() {
    try {
        // Load products for sale
        const productsData = await apiInvoke('get-products-for-sale');
        renderProductsGrid(productsData);
        bindPosProductFilters(productsData);
        
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
        // Try to sync offline sales silently
        try { await syncOfflineSales(); } catch(_) {}
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

function bindPosProductFilters(products) {
    const allCats = Array.from(new Set((products||[]).map(p => (p.category||'').trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
    const catSel = document.getElementById('pos-category-filter');
    const searchEl = document.getElementById('pos-search');
    if (catSel) {
        catSel.innerHTML = `<option value="">Todas las categorías</option>${allCats.map(c=>`<option value="${c}">${c}</option>`).join('')}`;
    }
    const apply = () => {
        const q = (searchEl?.value || '').toLowerCase().trim();
        const c = (catSel?.value || '').toLowerCase().trim();
        let list = products.slice();
        if (c) list = list.filter(p => (p.category||'').toLowerCase() === c);
        if (q) list = list.filter(p => (p.name||'').toLowerCase().includes(q) || (p.category||'').toLowerCase().includes(q));
        renderProductsGrid(list);
    };
    if (searchEl && !searchEl._bound) {
        let t=null; searchEl.addEventListener('input', ()=>{ clearTimeout(t); t=setTimeout(apply,150); }); searchEl._bound=true;
    }
    if (catSel && !catSel._bound) {
        catSel.addEventListener('change', apply); catSel._bound=true;
    }
}

function createProductCard(product) {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.onclick = () => addProductToTicket(product);
    
    card.innerHTML = `
        <div class="product-name">${product.name}</div>
        <div class="product-price">${formatCurrency(Math.round(Number(product.price)||0))}</div>
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
            total += (Math.round(Number(item.price)||0)) * item.quantity;
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
            <div class="item-price">${formatCurrency(Math.round(Number(item.price)||0))}</div>
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

// Offline sales queue (IndexedDB via simple localStorage fallback)
function getOfflineQueue() {
    try { return JSON.parse(localStorage.getItem('offlineSalesQueue')||'[]'); } catch(_) { return []; }
}
function setOfflineQueue(q) {
    try { localStorage.setItem('offlineSalesQueue', JSON.stringify(q)); } catch(_) {}
}
async function syncOfflineSales() {
    const q = getOfflineQueue();
    if (!q.length) return;
    const remaining = [];
    for (const sale of q) {
        try {
            await apiInvoke('process-sale', sale);
        } catch (e) {
            remaining.push(sale);
        }
    }
    setOfflineQueue(remaining);
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
        renderTablesAdmin(tablesData);
    } catch (error) {
        console.error('Error loading tables data:', error);
    }
}

function renderTablesGrid(tables) {
    const tablesContainer = document.querySelector('#tables-module .tables-container');
    if (tablesContainer) {
        tablesContainer.innerHTML = '';
        const sorted = tables.slice().sort((a,b)=>{
            const orderKey = (t) => {
                const name = String(t.name||'');
                const mesa = name.match(/^Mesa\s+(\d+)/i);
                const barra = name.match(/^Barra\s+(\d+)/i);
                if (mesa) return { group: 0, num: parseInt(mesa[1],10) || 0, name };
                if (barra) return { group: 1, num: parseInt(barra[1],10) || 0, name };
                return { group: 2, num: Number.MAX_SAFE_INTEGER, name };
            };
            const ka = orderKey(a), kb = orderKey(b);
            if (ka.group !== kb.group) return ka.group - kb.group;
            if (ka.num !== kb.num) return ka.num - kb.num;
            return ka.name.localeCompare(kb.name);
        });
        sorted.forEach(table => {
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
function ensureTablesAdminVisibility() {
    const adminCard = document.getElementById('tables-admin-card');
    if (!adminCard) return;
    if (currentUser && currentUser.role === 'super_admin') adminCard.classList.remove('hidden');
    else adminCard.classList.add('hidden');
}

function renderTablesAdmin(tables) {
    ensureTablesAdminVisibility();
    const adminCard = document.getElementById('tables-admin-card');
    if (!adminCard || adminCard.classList.contains('hidden')) return;
    const tbody = document.getElementById('tbl-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    tables.forEach(t => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding:8px;">${t.name}</td>
            <td style="padding:8px;">${t.type || 'table'}</td>
            <td style="padding:8px; text-align:right;">${t.capacity || 4}</td>
            <td style="padding:8px;">${t.status}</td>
            <td style="padding:8px; display:flex; gap:8px; justify-content:center;">
                <button type="button" class="btn btn-secondary" data-edit="${t.id}">Editar</button>
                <button type="button" class="btn btn-secondary" data-del="${t.id}">Eliminar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    let editingId = null;
    const nameEl = document.getElementById('tbl-name');
    const typeEl = document.getElementById('tbl-type');
    const capEl = document.getElementById('tbl-cap');
    const saveBtn = document.getElementById('tbl-save');
    const cancelBtn = document.getElementById('tbl-cancel');

    tbody.onclick = async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.dataset.edit) {
            const id = parseInt(btn.dataset.edit);
            const t = tables.find(x => x.id === id);
            if (!t) return;
            editingId = id;
            nameEl.value = t.name; typeEl.value = t.type || 'table'; capEl.value = String(t.capacity || 4);
            saveBtn.textContent = 'Actualizar'; cancelBtn.classList.remove('hidden');
        } else if (btn.dataset.del) {
            const id = parseInt(btn.dataset.del);
            if (!confirm('¿Eliminar mesa?')) return;
            const res = await apiInvoke('delete-table', id);
            if (res.success !== false) { showNotification('Mesa eliminada', 'success'); loadTablesData(); }
            else showNotification('Error al eliminar', 'error');
        }
    };

    saveBtn.onclick = async () => {
        const payload = { name: nameEl.value.trim(), type: typeEl.value, capacity: parseInt(capEl.value)||4 };
        if (!payload.name) { alert('Nombre requerido'); return; }
        const original = saveBtn.textContent; saveBtn.textContent = 'Guardando...'; saveBtn.disabled = true;
        try {
            let res;
            if (editingId) {
                payload.id = editingId;
                res = await apiInvoke('update-table', payload);
            } else {
                res = await apiInvoke('create-table', payload);
            }
            if (res && res.success === false) {
                showNotification(res.error || 'Error al guardar', 'error');
            }
        } catch (e) {
            showNotification('Error de red al guardar', 'error');
        } finally {
            saveBtn.textContent = original; saveBtn.disabled = false;
        }
        editingId = null; nameEl.value=''; capEl.value=''; typeEl.value='table'; saveBtn.textContent='Guardar'; cancelBtn.classList.add('hidden');
        loadTablesData();
    };

    cancelBtn.onclick = () => { editingId = null; nameEl.value=''; capEl.value=''; typeEl.value='table'; saveBtn.textContent='Guardar'; cancelBtn.classList.add('hidden'); };
}

// Logout
function logoutApp() {
    try { localStorage.removeItem('sessionUser'); } catch (_) {}
    currentUser = null;
    appContainer.classList.add('hidden');
    try { document.body.appendChild(loginContainer); } catch (_) {}
    loginContainer.classList.remove('hidden');
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
        // Merge duplicated product rows into single lines
        const merged = Object.create(null);
        (orderData.items || []).forEach(it => {
            const key = String(it.id);
            if (!merged[key]) merged[key] = { id: it.id, name: it.name, price: it.price, quantity: 0 };
            merged[key].quantity += parseInt(it.quantity)||0;
        });
        currentTicket = Object.values(merged);
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
    const clearBtn = document.querySelector('#pos-clear');
    if (finalizeBtn && !finalizeBtn._bound) {
        finalizeBtn.addEventListener('click', finalizeSale);
        finalizeBtn._bound = true;
    }
    if (saveBtn && !saveBtn._bound) {
        saveBtn.addEventListener('click', saveOrder);
        saveBtn._bound = true;
    }
    if (clearBtn && !clearBtn._bound) {
        clearBtn.addEventListener('click', clearCurrentTicket);
        clearBtn._bound = true;
    }
}

bindPosButtons();

async function finalizeSale() {
    
    const btnFinalize = document.querySelector('#pos-module .btn-primary');
    const originalTextFinalize = btnFinalize?.textContent || '';
    try {
        const selectionValue = document.querySelector('#table-selection')?.value || 'direct';
        const tableId = selectedTable?.id ?? (selectionValue === 'direct' ? null : parseInt(selectionValue));
        if ((currentTicket.length === 0 || currentTicket.every(i => (i.quantity||0) <= 0))) {
            if (!tableId) { showNotification('No hay productos en la cuenta', 'error'); return; }
            // Close/clear table with zero total
            const payload = {
                items: [],
                tableId,
                payment_method: document.querySelector('#payment-method')?.value || 'cash',
                total: 0,
                idempotency_key: `${Date.now()}-${currentUser?.id||0}-${Math.random().toString(36).slice(2,8)}`
            };
            if (btnFinalize) { btnFinalize.textContent = 'Procesando...'; btnFinalize.disabled = true; }
            const result = await apiInvoke('process-sale', payload);
            if (result && result.success) {
                showNotification('Mesa liberada', 'success');
                currentTicket = [];
                selectedTable = null;
                renderTicket();
                showModule('dashboard');
                await loadDashboardData();
            } else {
                showNotification('Error al liberar mesa', 'error');
            }
            return;
        }
        const saleData = {
            items: currentTicket.filter(i => (parseInt(i.quantity)||0) > 0).map(i => ({ id: i.id, quantity: parseInt(i.quantity)||0, price: Math.round(Number(i.price)||0) })),
            tableId: tableId,
            payment_method: document.querySelector('#payment-method')?.value || 'cash',
            total: currentTicket.reduce((sum, item) => sum + (item.price * item.quantity), 0),
            idempotency_key: `${Date.now()}-${currentUser?.id||0}-${Math.random().toString(36).slice(2,8)}`
        };
        
        if (btnFinalize) { btnFinalize.textContent = 'Procesando...'; btnFinalize.disabled = true; }
        const result = await apiInvoke('process-sale', saleData);
        
        if (result && result.success) {
            showNotification('Venta finalizada', 'success');
            openAppModal({ title: 'Venta', message: 'Venta procesada correctamente.', confirmText: 'OK' });
            currentTicket = [];
            selectedTable = null;
            renderTicket();
            showModule('dashboard');
            await loadDashboardData();
            setTimeout(() => { try { loadDashboardData(); } catch (_) {} }, 300);
        } else {
            showNotification(result?.error || 'Error al procesar la venta', 'error');
        }
    } catch (error) {
        // En caso de error, guardar en cola offline para sincronizar luego
        const queued = {
            items: currentTicket,
            tableId: null,
            payment_method: document.querySelector('#payment-method')?.value || 'cash',
            total: currentTicket.reduce((sum, item) => sum + (item.price * item.quantity), 0),
            idempotency_key: `${Date.now()}-${currentUser?.id||0}-${Math.random().toString(36).slice(2,8)}`
        };
        const q = getOfflineQueue(); q.push(queued); setOfflineQueue(q);
        showNotification('Venta guardada offline. Se sincronizará automáticamente.', 'success');
        console.error('Venta en cola offline por error de red:', error);
    }
    finally {
        if (btnFinalize) { btnFinalize.textContent = originalTextFinalize; btnFinalize.disabled = false; }
    }
}

async function saveOrder() {
    
    const btnSave = document.querySelector('#pos-module .btn-secondary');
    const originalTextSave = btnSave?.textContent || '';
    try {
        const selectionValue = document.querySelector('#table-selection')?.value || 'direct';
        const tableId = selectedTable?.id ?? (selectionValue === 'direct' ? null : parseInt(selectionValue));
        if ((!currentTicket.length || currentTicket.every(i => (i.quantity||0) <= 0))) {
            if (!tableId) { showNotification('No hay productos en la cuenta', 'error'); return; }
            // Save empty to clear pending order and free table
            const orderData = { items: [], tableId, payment_method: document.querySelector('#payment-method')?.value || 'cash' };
            if (btnSave) { btnSave.textContent = 'Guardando...'; btnSave.disabled = true; }
            const result = await apiInvoke('save-order', orderData);
            if (result && result.success) {
                showNotification('Mesa liberada', 'success');
            } else {
                showNotification('Error al limpiar mesa', 'error');
            }
            return;
        }
        const orderData = {
            items: currentTicket.filter(i => (parseInt(i.quantity)||0) > 0).map(i => ({ id: i.id, quantity: parseInt(i.quantity)||0, price: Math.round(Number(i.price)||0) })),
            tableId: tableId,
            payment_method: document.querySelector('#payment-method')?.value || 'cash'
        };
        
        if (btnSave) { btnSave.textContent = 'Guardando...'; btnSave.disabled = true; }
        const result = await apiInvoke('save-order', orderData);
        
        if (result && result.success) {
            showNotification('Cuenta guardada', 'success');
            openAppModal({ title: 'Cuenta', message: 'Cuenta guardada correctamente.', confirmText: 'OK' });
        } else {
            showNotification(result?.error || 'Error al guardar la cuenta', 'error');
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

// App modal (styled alert/confirm)
function openAppModal({ title, message, confirmText = 'Aceptar', cancelText, onConfirm }) {
    const modal = document.getElementById('appModal');
    const t = document.getElementById('appModalTitle');
    const m = document.getElementById('appModalMessage');
    const a = document.getElementById('appModalActions');
    if (!modal || !t || !m || !a) return;
    t.textContent = title || '';
    m.innerHTML = message || '';
    a.innerHTML = '';
    const ok = document.createElement('button'); ok.className = 'btn btn-primary'; ok.textContent = confirmText; ok.onclick = () => { modal.style.display = 'none'; try { onConfirm && onConfirm(); } catch(_) {} };
    a.appendChild(ok);
    if (cancelText) { const c = document.createElement('button'); c.className = 'btn btn-secondary'; c.textContent = cancelText; c.onclick = () => { modal.style.display = 'none'; }; a.appendChild(c); }
    modal.style.display = 'flex';
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
        const label = document.getElementById('current-user-label');
        if (label) { label.textContent = `Sesión: ${currentUser.username} (${getRoleDisplayName(currentUser.role)})`; }
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
window.clearCurrentTicket = clearCurrentTicket;

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

async function clearCurrentTicket() {
    if (!confirm('¿Vaciar la cuenta actual?')) return;
    const selectionValue = document.querySelector('#table-selection')?.value || 'direct';
    const tableId = selectedTable?.id ?? (selectionValue === 'direct' ? null : parseInt(selectionValue));
    currentTicket = [];
    renderTicket();
    if (tableId) {
        try {
            const result = await apiInvoke('save-order', { items: [], tableId, payment_method: document.querySelector('#payment-method')?.value || 'cash' });
            if (result && result.success) {
                showNotification('Mesa liberada', 'success');
            } else {
                showNotification('No se pudo limpiar la mesa', 'error');
            }
        } catch (e) {
            showNotification('Error de red al limpiar', 'error');
        }
    }
}

// Inventory module
function getExtraCategories() {
    try {
        const raw = localStorage.getItem('invExtraCategories');
        const arr = JSON.parse(raw || '[]');
        return Array.isArray(arr) ? arr.filter(Boolean) : [];
    } catch (_) { return []; }
}
function setExtraCategories(categories) {
    try { localStorage.setItem('invExtraCategories', JSON.stringify(Array.from(new Set(categories.filter(Boolean))))); } catch (_) {}
}

function updateInventoryControlsFromCategories(allCategories) {
    const categories = Array.from(new Set((allCategories || []).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
    const catSelect = document.getElementById('inv-category-select');
    const filterSel = document.getElementById('inv-filter');
    if (catSelect) {
        const current = catSelect.value;
        catSelect.innerHTML = `<option value="">Seleccione categoría</option>${categories.map(c=>`<option value="${c}">${c}</option>`).join('')}<option value="__new__">Nueva categoría…</option>`;
        if (Array.from(catSelect.options).some(o => o.value === current)) catSelect.value = current;
    }
    if (filterSel) {
        const current = filterSel.value;
        filterSel.innerHTML = `<option value="">Todas las categorías</option>${categories.map(c=>`<option value="${c}">${c}</option>`).join('')}`;
        if (Array.from(filterSel.options).some(o => o.value === current)) filterSel.value = current; else filterSel.value = '';
    }
}
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
    const categoriesFromProducts = Array.from(new Set((products || []).map(p => (p.category || '').trim()).filter(Boolean)));
    const categories = Array.from(new Set([...categoriesFromProducts, ...getExtraCategories()])).sort((a,b)=>a.localeCompare(b));
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
            <div class="input-group" style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; align-items:center;">
                <input id="inv-name" placeholder="Nombre" />
                <input id="inv-price" type="number" step="1" placeholder="Precio (COP)" />
                <input id="inv-stock" type="number" placeholder="Stock" />
                <div style="display:grid; grid-template-columns: 1fr; gap:8px;">
                    <select id="inv-category-select">
                        <option value="">Seleccione categoría</option>
                        ${categories.map(c=>`<option value="${c}">${c}</option>`).join('')}
                        <option value="__new__">Nueva categoría…</option>
                    </select>
                    <input id="inv-category-new" placeholder="Nueva categoría" class="hidden" />
                </div>
            </div>
            <div class="action-buttons" style="flex-direction:row; gap:10px;">
                <button type="button" class="btn btn-primary" id="inv-add">Guardar</button>
                <button type="button" class="btn btn-secondary hidden" id="inv-cancel">Cancelar Edición</button>
            </div>
        </div>
        <div class="card">
            <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; gap:10px;"><h3>Filtros</h3><button type="button" class="btn btn-secondary" id="inv-manage-cats">Gestionar Categorías</button></div>
            <div class="input-group" style="display:grid; grid-template-columns: 1fr 220px; gap:10px; align-items:center;">
                <input id="inv-search" placeholder="Buscar por nombre o categoría" />
                <select id="inv-filter">
                    <option value="">Todas las categorías</option>
                    ${categories.map(c=>`<option value="${c}">${c}</option>`).join('')}
                </select>
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
            tr.setAttribute('data-id', String(p.id));
            tr.innerHTML = `
                <td style=\"padding:8px;\" data-col=\"name\">${p.name}</td>
                <td style=\"padding:8px; text-align:right;\" data-col=\"price\">${formatCurrency(p.price)}</td>
                <td style=\"padding:8px; text-align:right;\" data-col=\"stock\">${p.stock}</td>
                <td style=\"padding:8px;\" data-col=\"category\">${p.category || ''}</td>
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
    const catSelect = module.querySelector('#inv-category-select');
    const catNew = module.querySelector('#inv-category-new');
    const addBtn = module.querySelector('#inv-add');
    const cancelBtn = module.querySelector('#inv-cancel');

    tbody.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const tr = btn.closest('tr');
        const id = tr ? parseInt(tr.getAttribute('data-id')) : NaN;
        const prod = products.find(x => x.id === id);
        if (btn.dataset.edit) {
            if (!prod || !tr) return;
            if (tr.getAttribute('data-editing') === '1') {
                // Save inline edits
                const val = (sel) => tr.querySelector(sel)?.value || '';
                const payload = {
                    id,
                    name: String(val('input.inv-name')||'').trim(),
                    price: (()=>{ const v=String(val('input.inv-price')||'').replace(/[^0-9]/g,''); return v?parseInt(v,10):0; })(),
                    stock: (()=>{ const v=String(val('input.inv-stock')||'').replace(/[^0-9]/g,''); return v?parseInt(v,10):0; })(),
                    category: String(val('input.inv-cat')||'').trim()
                };
                // Validaciones básicas con feedback visual
                const mark = (sel) => { const el = tr.querySelector(sel); if (el) { el.style.outline = '2px solid #e74c3c'; el.focus(); } };
                tr.querySelectorAll('input').forEach(i => { i.style.outline = ''; });
                if (!payload.name) { mark('input.inv-name'); showNotification('Nombre requerido', 'error'); return; }
                if (Number.isNaN(payload.price) || payload.price < 0) { mark('input.inv-price'); showNotification('Precio inválido', 'error'); return; }
                if (Number.isNaN(payload.stock) || payload.stock < 0) { mark('input.inv-stock'); showNotification('Stock inválido', 'error'); return; }
                const res = await apiInvoke('update-product', payload);
                if (res && res.success === false) { showNotification('Error al actualizar', 'error'); return; }
                showNotification('Producto actualizado', 'success');
                loadInventoryData();
                return;
            }
            // Enter edit mode
            const tdName = tr.querySelector('td[data-col="name"]');
            const tdPrice = tr.querySelector('td[data-col="price"]');
            const tdStock = tr.querySelector('td[data-col="stock"]');
            const tdCat = tr.querySelector('td[data-col="category"]');
            tdName.innerHTML = `<input class="inv-name" value="${(prod.name||'').replace(/"/g,'&quot;')}" />`;
            tdPrice.innerHTML = `<input class="inv-price" type="number" step="1" min="0" value="${Math.round(Number(prod.price)||0)}" style="text-align:right;" />`;
            tdStock.innerHTML = `<input class="inv-stock" type="number" step="1" min="0" value="${parseInt(prod.stock)||0}" style="text-align:right;" />`;
            const listId = `inv-cat-list-${id}`;
            tdCat.innerHTML = `<input class="inv-cat" list="${listId}" value="${(prod.category||'').replace(/"/g,'&quot;')}" /><datalist id="${listId}">${categories.map(c=>`<option value="${c}"></option>`).join('')}</datalist>`;
            tr.setAttribute('data-editing','1');
            btn.textContent = 'Guardar';
            // Add cancel button next to it only if not present
            if (!tr.querySelector('[data-cancel]')) {
                const cancel = document.createElement('button'); cancel.className='btn btn-secondary'; cancel.textContent='Cancelar'; cancel.setAttribute('data-cancel', String(id)); cancel.style.marginLeft='8px'; btn.parentElement.appendChild(cancel);
            }
            // Key handlers
            tr.querySelectorAll('input').forEach(inp => {
                inp.addEventListener('keydown', async (ev) => {
                    if (ev.key === 'Enter') { btn.click(); }
                    if (ev.key === 'Escape') { loadInventoryData(); }
                });
            });
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
        } else if (btn.dataset.cancel) {
            loadInventoryData();
        }
    });

    addBtn.addEventListener('click', async () => {
        const payload = {
            name: nameEl.value.trim(),
            price: (() => { const v = String(priceEl.value||'').replace(/[^0-9]/g,''); return v? parseInt(v,10): NaN; })(),
            stock: (() => { const v = String(stockEl.value||'').replace(/[^0-9]/g,''); return v? parseInt(v,10): NaN; })(),
            category: (() => { const sel = catSelect.value; return sel === '__new__' ? String(catNew.value||'').trim() : String(sel||'').trim(); })()
        };
        if (!payload.name || isNaN(payload.price) || isNaN(payload.stock)) { alert('Complete nombre, precio y stock'); return; }
        if (!payload.category && catSelect.value === '__new__') { alert('Ingrese el nombre de la nueva categoría'); return; }
        if (catSelect.value === '__new__' && payload.category) {
            const extras = getExtraCategories();
            if (!extras.includes(payload.category)) {
                extras.push(payload.category);
                setExtraCategories(extras);
            }
        }
        if (editingId) {
            payload.id = editingId;
            const res = await apiInvoke('update-product', payload);
            if (res.success === false) alert('Error al actualizar');
        } else {
            const res = await apiInvoke('add-product', payload);
            if (res.success === false) alert('Error al agregar');
        }
        editingId = null; nameEl.value = ''; priceEl.value = ''; stockEl.value=''; catSelect.value=''; catNew.value=''; catNew.classList.add('hidden');
        addBtn.textContent = 'Guardar'; cancelBtn.classList.add('hidden');
        loadInventoryData();
    });
    cancelBtn.addEventListener('click', () => {
        editingId = null; nameEl.value = ''; priceEl.value = ''; stockEl.value=''; catSelect.value=''; catNew.value=''; catNew.classList.add('hidden');
        addBtn.textContent = 'Guardar'; cancelBtn.classList.add('hidden');
    });

    const searchEl = module.querySelector('#inv-search');
    const filterEl = module.querySelector('#inv-filter');
    function applyInvFilters() {
        const q = (searchEl?.value || '').trim().toLowerCase();
        const cat = (filterEl?.value || '').trim().toLowerCase();
        let list = products.slice();
        if (cat) list = list.filter(p => (p.category || '').toLowerCase() === cat);
        if (q) list = list.filter(p => (p.name || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q));
        renderInvRows(list);
    }
    if (searchEl) { let t=null; searchEl.addEventListener('input', ()=>{ clearTimeout(t); t=setTimeout(applyInvFilters,150); }); }
    if (filterEl) { filterEl.addEventListener('change', applyInvFilters); }
    // Initialize filter dropdown options if categories update later
    updateInventoryControlsFromCategories(categories);

    if (catSelect) {
        catSelect.addEventListener('change', () => {
            if (catSelect.value === '__new__') { catNew.classList.remove('hidden'); catNew.focus(); }
            else { catNew.classList.add('hidden'); catNew.value=''; }
        });
    }

    // Category manager modal
    const manageBtn = module.querySelector('#inv-manage-cats');
    if (manageBtn && !manageBtn._bound) {
        manageBtn.addEventListener('click', () => openCategoryManager(products));
        manageBtn._bound = true;
    }
}

async function openCategoryManager(products) {
    const categoriesFromProducts = Array.from(new Set((products || []).map(p => (p.category || '').trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
    const extra = getExtraCategories();
    const allCats = Array.from(new Set([...categoriesFromProducts, ...extra]));
    let overlay = document.getElementById('catManagerModal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'catManagerModal';
        overlay.className = 'app-modal';
        overlay.innerHTML = `
            <div class="box" style="max-width:520px; width:90%;">
                <div class="title">Gestionar Categorías</div>
                <div class="message">
                    <div style="display:grid; gap:10px;">
                        <div>
                            <div style="color:#b0b0b0; margin-bottom:6px;">Categorías existentes</div>
                            <div id="cat-list" style="max-height:200px; overflow:auto; border:1px solid rgba(212,175,55,0.2); border-radius:8px; padding:8px;"></div>
                        </div>
                        <div style="display:grid; grid-template-columns: 1fr auto; gap:10px; align-items:center;">
                            <input id="cat-new" placeholder="Nueva categoría" />
                            <button class="btn btn-secondary" id="cat-add">Agregar</button>
                        </div>
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                            <div>
                                <label style="color:#b0b0b0;">Renombrar</label>
                                <select id="cat-rename-from"></select>
                                <input id="cat-rename-to" placeholder="Nuevo nombre" style="margin-top:6px;" />
                                <button class="btn btn-secondary" id="cat-rename" style="margin-top:8px; width:100%;">Aplicar</button>
                            </div>
                            <div>
                                <label style="color:#b0b0b0;">Eliminar</label>
                                <select id="cat-delete"></select>
                                <label style="color:#b0b0b0; margin-top:6px; display:block;">Mover productos a</label>
                                <select id="cat-move-to"></select>
                                <button class="btn btn-secondary" id="cat-delete-btn" style="margin-top:8px; width:100%;">Eliminar</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="actions">
                    <button class="btn btn-secondary" id="cat-close">Cerrar</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e)=>{ if (e.target === overlay) overlay.style.display='none'; });
    }
    const populateSelects = () => {
        const all = Array.from(new Set([...categoriesFromProducts, ...getExtraCategories()]));
        overlay.querySelector('#cat-rename-from').innerHTML = all.map(c=>`<option value="${c}">${c}</option>`).join('');
        overlay.querySelector('#cat-delete').innerHTML = all.map(c=>`<option value="${c}">${c}</option>`).join('');
        const moveOptions = ['general',''].concat(all).filter((c,i,arr)=>arr.indexOf(c)===i).map(c=>`<option value="${c}">${c || 'Sin categoría'}</option>`).join('');
        overlay.querySelector('#cat-move-to').innerHTML = moveOptions;
    };
    const renderList = () => {
        const counts = Object.create(null);
        products.forEach(p => { const c=(p.category||''); counts[c] = (counts[c]||0)+1; });
        const list = overlay.querySelector('#cat-list');
        const all = Array.from(new Set([...categoriesFromProducts, ...getExtraCategories()]));
        list.innerHTML = all.map(c=>`<div style="display:flex; justify-content:space-between; padding:6px 8px; border-bottom:1px solid rgba(255,255,255,0.06);"><span>${c || 'Sin categoría'}</span><span style="color:#b0b0b0;">${counts[c]||0}</span></div>`).join('');
    };
    populateSelects();
    renderList();
    overlay.style.display = 'flex';
    overlay.querySelector('#cat-close').onclick = () => overlay.style.display='none';

    overlay.querySelector('#cat-add').onclick = () => {
        const val = String(overlay.querySelector('#cat-new').value||'').trim();
        if (!val) return;
        // avoid duplicates case-insensitively
        const lower = val.toLowerCase();
        const updated = Array.from(new Set([...getExtraCategories().filter(c=>c.toLowerCase()!==lower), val]));
        setExtraCategories(updated);
        overlay.querySelector('#cat-new').value = '';
        populateSelects(); renderList();
        updateInventoryControlsFromCategories([...categoriesFromProducts, ...updated]);
        showNotification('Categoría agregada', 'success');
    };

    overlay.querySelector('#cat-rename').onclick = async () => {
        const from = String(overlay.querySelector('#cat-rename-from').value||'').trim();
        const to = String(overlay.querySelector('#cat-rename-to').value||'').trim();
        if (!from || !to || from === to) { showNotification('Datos inválidos', 'error'); return; }
        const affected = products.filter(p => (p.category||'') === from);
        for (const prod of affected) {
            const payload = { id: prod.id, name: prod.name, price: Math.round(Number(prod.price)||0), stock: parseInt(prod.stock)||0, category: to };
            const res = await apiInvoke('update-product', payload);
            if (res?.success === false) { showNotification('Error en renombrar categoría', 'error'); return; }
        }
        const extras = getExtraCategories().filter(c => c !== from);
        if (!categoriesFromProducts.includes(to)) extras.push(to);
        setExtraCategories(extras);
        showNotification('Categoría renombrada', 'success');
        updateInventoryControlsFromCategories([...categoriesFromProducts.filter(c=>c!==from), to, ...getExtraCategories()]);
        overlay.style.display='none';
        loadInventoryData();
    };

    overlay.querySelector('#cat-delete-btn').onclick = async () => {
        const del = String(overlay.querySelector('#cat-delete').value||'').trim();
        const moveTo = String(overlay.querySelector('#cat-move-to').value||'');
        if (!del) return;
        if (!confirm(`Eliminar categoría "${del}" y mover productos a "${moveTo || 'Sin categoría'}"?`)) return;
        const affected = products.filter(p => (p.category||'') === del);
        for (const prod of affected) {
            const payload = { id: prod.id, name: prod.name, price: Math.round(Number(prod.price)||0), stock: parseInt(prod.stock)||0, category: moveTo };
            const res = await apiInvoke('update-product', payload);
            if (res?.success === false) { showNotification('Error eliminando categoría', 'error'); return; }
        }
        const extras = getExtraCategories().filter(c => c !== del);
        setExtraCategories(extras);
        showNotification('Categoría eliminada', 'success');
        updateInventoryControlsFromCategories([...categoriesFromProducts.filter(c=>c!==del), ...extras]);
        overlay.style.display='none';
        loadInventoryData();
    };
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
            <div class="input-group" style="display:grid; grid-template-columns: repeat(5, 1fr); gap:10px;">
                <input type="date" id="rep-from" />
                <input type="date" id="rep-to" />
                <select id="rep-type"><option value="">Todos</option><option value="income">Ingresos</option><option value="expense">Gastos</option></select>
                <select id="rep-payment"><option value="">Todos los pagos</option><option value="cash">Efectivo</option><option value="transfer">Transferencia</option></select>
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
            <div class="input-group" style="display:grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap:10px;">
                <input id="tx-desc" placeholder="Descripción" />
                <input id="tx-amount" type="number" step="1" placeholder="Monto (COP)" />
                <select id="tx-payment"><option value="cash">Efectivo</option><option value="transfer">Transferencia</option></select>
                <div style="display:flex; gap:10px;">
                    <button type="button" class="btn btn-primary" id="tx-add-income">Agregar Ingreso</button>
                    <button type="button" class="btn btn-secondary" id="tx-add-expense">Agregar Gasto</button>
                </div>
            </div>
        </div>
        <div class="card">
            <div class="card-header"><h3>Cuentas por Cobrar / Pagar</h3></div>
            <div class="input-group" style="display:grid; grid-template-columns: 1fr 2fr 1fr 1fr 1fr; gap:10px; align-items:center;">
                <select id="cr-type"><option value="receivable">Por Cobrar</option><option value="payable">Por Pagar</option></select>
                <input id="cr-desc" placeholder="Descripción" />
                <input id="cr-party" placeholder="Cliente/Proveedor" />
                <input id="cr-total" type="number" step="1" placeholder="Total (COP)" />
                <button type="button" class="btn btn-primary" id="cr-create">Crear</button>
            </div>
            <div class="input-group" style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px; align-items:center; margin-top:10px;">
                <select id="cr-filter-type"><option value="">Todos</option><option value="receivable">Por Cobrar</option><option value="payable">Por Pagar</option></select>
                <select id="cr-filter-status"><option value="open">Abiertos</option><option value="closed">Cerrados</option><option value="">Todos</option></select>
                <button type="button" class="btn btn-secondary" id="cr-refresh">Actualizar</button>
            </div>
            <div id="cr-list" style="max-height:40vh; overflow:auto; margin-top:10px;"></div>
        </div>
    `;
    // Ensure module becomes visible if menu doesn't toggle correctly
    const reportsContainer = document.getElementById('reports-module');
    if (reportsContainer) reportsContainer.classList.add('active');
    module.querySelector('#rep-apply').addEventListener('click', refreshTransactions);
    module.querySelector('#rep-export').addEventListener('click', exportTransactionsToCSV);
    module.querySelector('#rep-print').addEventListener('click', printTransactions);
    module.querySelector('#rep-print-summary').addEventListener('click', printSummary);
    // Credits bindings
    const crCreate = module.querySelector('#cr-create');
    const crRefresh = module.querySelector('#cr-refresh');
    if (crCreate && !crCreate._bound) { crCreate.addEventListener('click', createCredit); crCreate._bound = true; }
    if (crRefresh && !crRefresh._bound) { crRefresh.addEventListener('click', refreshCredits); crRefresh._bound = true; }
    refreshCredits();
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
        const payment_method = module.querySelector('#tx-payment').value;
        if (!desc || isNaN(amount)) { alert('Complete descripción y monto'); return; }
        const btn = module.querySelector('#tx-add-income'); const orig = btn.textContent; btn.textContent = 'Guardando...'; btn.disabled = true;
        const res = await apiInvoke('add-income', { description: desc, amount, payment_method, user_id: currentUser?.id || 1 });
        btn.textContent = orig; btn.disabled = false;
        if (res.success === false) { showNotification('Error al agregar ingreso', 'error'); return; }
        showNotification('Ingreso agregado', 'success');
        module.querySelector('#tx-desc').value = ''; module.querySelector('#tx-amount').value = '';
        refreshTransactions();
    });
    module.querySelector('#tx-add-expense').addEventListener('click', async () => {
        const desc = module.querySelector('#tx-desc').value.trim();
        const amount = Math.round(parseFloat(module.querySelector('#tx-amount').value));
        const payment_method = module.querySelector('#tx-payment').value;
        if (!desc || isNaN(amount)) { alert('Complete descripción y monto'); return; }
        const btn = module.querySelector('#tx-add-expense'); const orig = btn.textContent; btn.textContent = 'Guardando...'; btn.disabled = true;
        const res = await apiInvoke('add-expense', { description: desc, amount, payment_method, user_id: currentUser?.id || 1 });
        btn.textContent = orig; btn.disabled = false;
        if (res.success === false) { showNotification('Error al agregar gasto', 'error'); return; }
        showNotification('Gasto agregado', 'success');
        module.querySelector('#tx-desc').value = ''; module.querySelector('#tx-amount').value = '';
        refreshTransactions();
    });
}

async function createCredit() {
    const module = document.getElementById('reports-module');
    const type = module.querySelector('#cr-type').value;
    const description = String(module.querySelector('#cr-desc').value||'').trim();
    const party = String(module.querySelector('#cr-party').value||'').trim();
    const total = (()=>{ const v = String(module.querySelector('#cr-total').value||'').replace(/[^0-9]/g,''); return v? parseInt(v,10): 0; })();
    if (!total) { alert('Total inválido'); return; }
    let res;
    try { res = await apiInvoke('credits-create', { type, description, party, total }); }
    catch (e) { showNotification('Error de red al crear', 'error'); return; }
    if (res.success === false) { showNotification('Error creando crédito', 'error'); return; }
    module.querySelector('#cr-desc').value=''; module.querySelector('#cr-party').value=''; module.querySelector('#cr-total').value='';
    showNotification('Registro creado', 'success');
    refreshCredits();
}

async function refreshCredits() {
    const module = document.getElementById('reports-module');
    const type = module.querySelector('#cr-filter-type').value;
    const status = module.querySelector('#cr-filter-status').value || 'open';
    const list = await apiInvoke('credits-list', { type, status });
    const container = module.querySelector('#cr-list');
    container.innerHTML = (list||[]).map(c => {
        const balance = Math.max(0, Math.round(Number(c.total||0) - Number(c.paid_amount||0)));
        const badge = c.type === 'receivable' ? 'Por Cobrar' : 'Por Pagar';
        return `<div style="display:grid; grid-template-columns: 2fr 1fr 1fr auto; gap:10px; align-items:center; padding:8px; border-bottom:1px solid rgba(255,255,255,0.08);">
            <div>
                <div style="color:#fff; font-weight:600;">${c.description || '(sin descripción)'} — <span style="color:#d4af37;">${badge}</span></div>
                <div style="color:#b0b0b0; font-size:12px;">${c.party || ''} ${c.due_date ? '· vence ' + c.due_date : ''}</div>
            </div>
            <div style="text-align:right; color:#b0b0b0;">Total ${formatCurrency(c.total||0)}</div>
            <div style="text-align:right; color:#b0b0b0;">Pagado ${formatCurrency(c.paid_amount||0)}</div>
            <div style="text-align:right; font-weight:700; color:${balance>0?'#e67e22':'#27ae60'};">${formatCurrency(balance)}</div>
            <div style="grid-column: 1 / -1; display:flex; gap:10px; justify-content:flex-end;">
                <input type="number" min="1" placeholder="Abono (COP)" id="cr-pay-${c.id}" style="max-width:160px;" />
                <button class="btn btn-secondary" onclick="payCredit(${c.id})">Abonar</button>
                <button class="btn btn-secondary" onclick="setCreditStatus(${c.id}, '${c.status==='open'?'closed':'open'}')">${c.status==='open'?'Marcar Cerrado':'Reabrir'}</button>
            </div>
        </div>`;
    }).join('');
}

async function payCredit(id) {
    const module = document.getElementById('reports-module');
    const input = module.querySelector(`#cr-pay-${id}`);
    const amount = (()=>{ const v = String(input?.value||'').replace(/[^0-9]/g,''); return v? parseInt(v,10): 0; })();
    if (!amount) { alert('Monto inválido'); return; }
    let res; try { res = await apiInvoke('credits-add-payment', { id, amount, payment_method: 'cash' }); } catch (e) { showNotification('Error de red al abonar', 'error'); return; }
    if (res.success === false) { showNotification('Error al abonar', 'error'); return; }
    showNotification('Abono registrado', 'success');
    refreshCredits();
}

async function setCreditStatus(id, status) {
    const res = await apiInvoke('credits-set-status', { id, status, created_by: currentUser?.id || 1 });
    if (res.success === false) { showNotification('Error al actualizar estado', 'error'); return; }
    refreshCredits();
}

// expose helpers
window.payCredit = payCredit;
window.setCreditStatus = setCreditStatus;

async function refreshTransactions() {
    const module = document.getElementById('reports-module');
    const from = module.querySelector('#rep-from').value;
    const to = module.querySelector('#rep-to').value;
    const type = module.querySelector('#rep-type').value;
    const payment = module.querySelector('#rep-payment').value;
    const list = module.querySelector('#rep-list');
    list.textContent = 'Cargando...';
    try {
        const rows = await apiInvoke('get-transactions-filtered', { from, to, type, payment });
        lastTransactions = rows;
        list.innerHTML = rows.map(r => {
            const canAdmin = currentUser && currentUser.role === 'super_admin';
            const left = `${r.created_at} - ${r.description || ''} ${r.payment_method ? '('+r.payment_method+')' : ''} — ${r.created_by_username || ''}`;
            const right = `${r.type === 'expense' ? '-' : ''}${formatCurrency(r.amount)}`;
            const actions = canAdmin ? `<div style="display:flex; gap:6px; margin-left:10px;">
                <button class="btn btn-secondary btn-small" data-tx-edit="${r.id}">Editar</button>
                <button class="btn btn-secondary btn-small" data-tx-del="${r.id}">Eliminar</button>
            </div>` : '';
            return `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid rgba(255,255,255,0.1);">
                <div style="display:flex; align-items:center;">${left}${actions}</div>
                <span>${right}</span>
            </div>`;
        }).join('');
        if (currentUser && currentUser.role === 'super_admin') {
            list.querySelectorAll('[data-tx-edit]').forEach(btn => {
                btn.addEventListener('click', () => openTxEditor(parseInt(btn.getAttribute('data-tx-edit'))));
            });
            list.querySelectorAll('[data-tx-del]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = parseInt(btn.getAttribute('data-tx-del'));
                    if (!confirm('¿Eliminar transacción?')) return;
                    try {
                        const res = await apiInvoke('tx-delete', id);
                        if (res && res.success === false) { showNotification('Error al eliminar', 'error'); return; }
                        showNotification('Transacción eliminada', 'success');
                        refreshTransactions();
                    } catch (e) {
                        showNotification('Error de red al eliminar', 'error');
                    }
                });
            });
        }
        const income = rows.filter(r => r.type === 'income').reduce((s, r) => s + Number(r.amount || 0), 0);
        const expense = rows.filter(r => r.type === 'expense').reduce((s, r) => s + Number(r.amount || 0), 0);
        const balance = income - expense;
        const summary = module.querySelector('#rep-summary');
        if (summary) {
            const incomeCash = rows.filter(r => r.type === 'income' && r.payment_method === 'cash').reduce((s, r) => s + Number(r.amount || 0), 0);
            const incomeTransfer = rows.filter(r => r.type === 'income' && r.payment_method === 'transfer').reduce((s, r) => s + Number(r.amount || 0), 0);
            summary.innerHTML = `
                <div>Ingresos: <strong style="color:#27ae60;">${formatCurrency(income)}</strong></div>
                <div>Efectivo: <strong style="color:#27ae60;">${formatCurrency(incomeCash)}</strong></div>
                <div>Transferencias: <strong style="color:#27ae60;">${formatCurrency(incomeTransfer)}</strong></div>
                <div>Gastos: <strong style="color:#e74c3c;">${formatCurrency(expense)}</strong></div>
                <div>Balance: <strong style="color:${balance>=0?'#27ae60':'#e74c3c'};">${formatCurrency(balance)}</strong></div>
            `;
        }
    } catch (e) {
        list.textContent = 'Error al cargar';
    }
}

function openTxEditor(id) {
    const tx = (lastTransactions||[]).find(t => t.id === id);
    if (!tx) return;
    openAppModal({
        title: 'Editar Transacción',
        message: `<div style="display:grid; gap:10px;">
            <select id="txe-type"><option value="income" ${tx.type==='income'?'selected':''}>Ingreso</option><option value="expense" ${tx.type==='expense'?'selected':''}>Gasto</option></select>
            <input id="txe-desc" placeholder="Descripción" value="${(tx.description||'').replace(/\"/g,'&quot;')}" />
            <input id="txe-amount" type="number" step="1" placeholder="Monto (COP)" value="${tx.amount}" />
            <select id="txe-pay"><option value="cash" ${tx.payment_method==='cash'?'selected':''}>Efectivo</option><option value="transfer" ${tx.payment_method==='transfer'?'selected':''}>Transferencia</option></select>
        </div>`,
        confirmText: 'Guardar',
        cancelText: 'Cancelar',
        onConfirm: async () => {
            const type = document.getElementById('txe-type').value;
            const description = String(document.getElementById('txe-desc').value||'').trim();
            const amount = (()=>{ const v = String(document.getElementById('txe-amount').value||'').replace(/[^0-9]/g,''); return v? parseInt(v,10): 0; })();
            const payment_method = document.getElementById('txe-pay').value;
            if (!amount) { showNotification('Monto inválido', 'error'); return; }
            const res = await apiInvoke('tx-update', { id, type, description, amount, payment_method });
            if (res.success === false) { showNotification('Error al guardar', 'error'); return; }
            showNotification('Transacción actualizada', 'success');
            refreshTransactions();
        }
    });
}

function exportTransactionsToCSV() {
    const rows = lastTransactions || [];
    const header = ['Fecha', 'Tipo', 'Descripción', 'Monto', 'Método de pago', 'Usuario'];
    const csvRows = [header.join(',')].concat(rows.map(r => [
        (r.created_at || '').replace(/,/g, ' '),
        r.type || '',
        (r.description || '').replace(/,/g, ' '),
        String(r.amount || 0),
        r.payment_method || '',
        String(r.created_by || '')
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

// Users module
async function loadUsersData() {
    try {
        const users = await apiInvoke('get-users');
        renderUsersGrid(users);
    } catch (error) {
        console.error('Error loading users data:', error);
        showNotification('Error al cargar usuarios', 'error');
    }
}

function renderUsersGrid(users) {
    const usersList = document.getElementById('users-list');
    if (!usersList) return;
    
    usersList.innerHTML = '';
    
    if (users.length === 0) {
        usersList.innerHTML = '<p style="color: #b0b0b0; text-align: center; padding: 20px;">No hay usuarios registrados</p>';
        return;
    }
    
    const usersGrid = document.createElement('div');
    usersGrid.className = 'users-grid';
    
    users.forEach(user => {
        const userCard = createUserCard(user);
        usersGrid.appendChild(userCard);
    });
    
    usersList.appendChild(usersGrid);
}

function createUserCard(user) {
    const card = document.createElement('div');
    card.className = 'user-card';
    
    const roleClass = `role-${user.role}`;
    const statusText = user.is_active ? 'Activo' : 'Inactivo';
    const statusColor = user.is_active ? '#27ae60' : '#e74c3c';
    
    card.innerHTML = `
        <div class="user-header">
            <div class="user-name">${user.full_name || user.username}</div>
            <div class="user-role ${roleClass}">${getRoleDisplayName(user.role)}</div>
        </div>
        <div class="user-info">
            <div class="user-info-item">
                <span class="user-info-label">Usuario:</span>
                <span class="user-info-value">${user.username}</span>
            </div>
            <div class="user-info-item">
                <span class="user-info-label">Email:</span>
                <span class="user-info-value">${user.email || 'No especificado'}</span>
            </div>
            <div class="user-info-item">
                <span class="user-info-label">Teléfono:</span>
                <span class="user-info-value">${user.phone || 'No especificado'}</span>
            </div>
            <div class="user-info-item">
                <span class="user-info-label">Estado:</span>
                <span class="user-info-value" style="color: ${statusColor};">${statusText}</span>
            </div>
            <div class="user-info-item">
                <span class="user-info-label">Creado:</span>
                <span class="user-info-value">${formatDate(user.created_at)}</span>
            </div>
        </div>
        <div class="user-actions">
            <button class="btn btn-small btn-edit" onclick="editUser(${user.id})">Editar</button>
            <button class="btn btn-small btn-toggle" onclick="toggleUserStatus(${user.id})">
                ${user.is_active ? 'Desactivar' : 'Activar'}
            </button>
            ${currentUser && currentUser.role === 'super_admin' ? `<button class="btn btn-small btn-secondary" onclick=\"resetUserPassword(${user.id})\">Restablecer</button>` : ''}
            ${user.role !== 'super_admin' ? `<button class="btn btn-small btn-delete" onclick="deleteUser(${user.id})">Eliminar</button>` : ''}
        </div>
    `;
    
    return card;
}

function getRoleDisplayName(role) {
    const roleNames = {
        'super_admin': 'Super Admin',
        'admin': 'Administrador',
        'manager': 'Gerente',
        'employee': 'Empleado'
    };
    return roleNames[role] || role;
}

function formatDate(dateString) {
    if (!dateString) return 'No especificado';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-CO');
}

// User form functions
function showUserForm(userId = null) {
    const modal = document.getElementById('userModal');
    const modalTitle = document.getElementById('modalTitle');
    const form = document.getElementById('userForm');
    
    if (userId) {
        modalTitle.textContent = 'Editar Usuario';
        loadUserForEdit(userId);
    } else {
        modalTitle.textContent = 'Nuevo Usuario';
        form.reset();
        document.getElementById('userId').value = '';
    }
    
    modal.style.display = 'block';

    // Bind username availability check
    const usernameEl = document.getElementById('username');
    if (usernameEl && !usernameEl._bound) {
        let t = null;
        usernameEl.addEventListener('input', async () => {
            clearTimeout(t);
            t = setTimeout(async () => {
                const uname = String(usernameEl.value||'').trim().toLowerCase();
                const excludeId = document.getElementById('userId').value || '';
                if (!uname) { usernameEl.style.outline = ''; return; }
                try {
                    const res = await apiInvoke('check-username', { username: uname, excludeId });
                    usernameEl.style.outline = res.available ? '2px solid #27ae60' : '2px solid #e74c3c';
                } catch (_) { usernameEl.style.outline = ''; }
            }, 250);
        });
        usernameEl._bound = true;
    }
}

function closeUserModal() {
    const modal = document.getElementById('userModal');
    modal.style.display = 'none';
    document.getElementById('userForm').reset();
}

async function loadUserForEdit(userId) {
    try {
        const users = await apiInvoke('get-users');
        const user = users.find(u => u.id === userId);
        
        if (user) {
            document.getElementById('userId').value = user.id;
            document.getElementById('username').value = user.username;
            document.getElementById('fullName').value = user.full_name || '';
            document.getElementById('email').value = user.email || '';
            document.getElementById('phone').value = user.phone || '';
            document.getElementById('role').value = user.role;
            document.getElementById('password').required = false;
            document.getElementById('confirmPassword').required = false;
        }
    } catch (error) {
        console.error('Error loading user for edit:', error);
        showNotification('Error al cargar datos del usuario', 'error');
    }
}

async function editUser(userId) {
    showUserForm(userId);
}

async function toggleUserStatus(userId) {
    try {
        const result = await apiInvoke('toggle-user-status', userId);
        if (result.success) {
            showNotification('Estado del usuario actualizado', 'success');
            loadUsersData();
        } else {
            showNotification('Error al actualizar estado', 'error');
        }
    } catch (error) {
        console.error('Error toggling user status:', error);
        showNotification('Error al actualizar estado', 'error');
    }
}

async function deleteUser(userId) {
    if (!confirm('¿Está seguro de que desea eliminar este usuario?')) {
        return;
    }
    
    try {
        const result = await apiInvoke('delete-user', userId);
        if (result.success) {
            showNotification('Usuario eliminado', 'success');
            loadUsersData();
        } else {
            showNotification('Error al eliminar usuario', 'error');
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        showNotification('Error al eliminar usuario', 'error');
    }
}

async function resetUserPassword(userId) {
    if (!currentUser || currentUser.role !== 'super_admin') { showNotification('Acceso restringido', 'error'); return; }
    const newPwd = prompt('Nueva contraseña (mínimo 4 caracteres):');
    if (!newPwd || newPwd.length < 4) { showNotification('Contraseña inválida', 'error'); return; }
    try {
        const res = await apiInvoke('reset-password', { id: userId, new_password: newPwd });
        if (res.success) { showNotification('Contraseña actualizada', 'success'); }
        else { showNotification(res.error || 'Error al actualizar', 'error'); }
    } catch (e) {
        showNotification('Error al actualizar', 'error');
    }
}

// User form submission
document.addEventListener('DOMContentLoaded', function() {
    const userForm = document.getElementById('userForm');
    if (userForm) {
        userForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = new FormData(userForm);
            const userId = document.getElementById('userId').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            
            // Validate passwords match
            if (password && password !== confirmPassword) {
                showNotification('Las contraseñas no coinciden', 'error');
                return;
            }
            
            const userData = {
                username: String(formData.get('username')||'').trim().toLowerCase(),
                full_name: formData.get('fullName'),
                email: formData.get('email'),
                phone: formData.get('phone'),
                role: formData.get('role')
            };
            
            // Only include password if provided
            if (password) {
                userData.password = password;
            }
            
            try {
                let result;
                if (userId) {
                    userData.id = parseInt(userId);
                    result = await apiInvoke('update-user', userData);
                } else {
                    result = await apiInvoke('add-user', userData);
                }
                
                if (result.success) {
                    showNotification(userId ? 'Usuario actualizado' : 'Usuario creado', 'success');
                    closeUserModal();
                    loadUsersData();
                } else {
                    showNotification(result.error || 'Error al guardar usuario', 'error');
                }
            } catch (error) {
                console.error('Error saving user:', error);
                showNotification('Error al guardar usuario', 'error');
            }
        });
    }
    
    // Close modal when clicking outside
    const modal = document.getElementById('userModal');
    if (modal) {
        window.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeUserModal();
            }
        });
    }
});

// Export functions for global access
window.showUserForm = showUserForm;
window.closeUserModal = closeUserModal;
window.editUser = editUser;
window.toggleUserStatus = toggleUserStatus;
window.deleteUser = deleteUser;
window.resetUserPassword = resetUserPassword;
