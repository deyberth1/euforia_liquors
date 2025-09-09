# Euforia Liquors POS

Sistema POS (Punto de Venta) para Euforia Liquors, construido con Electron + Node.js + SQLite. Incluye inventario, ventas (directas y por mesa), gestión de mesas, usuarios con roles, caja, cronograma, y reportes con desglose por método de pago.

## Características
- Login con roles: super_admin, admin, manager, employee
- POS con selector de método de pago (efectivo/transferencia)
- Ventas directas y por mesa, guardado de cuentas, cierre de cuentas
- Gestión de mesas (nombre, tipo: mesa/barra, capacidad) — solo super_admin
- Gestión de usuarios — solo super_admin
- Inventario (CRUD de productos)
- Cronograma de turnos
- Caja (apertura/cierre)
- Reportes con filtros de fecha/tipo/método de pago y exportación CSV
- Moneda: COP (pesos colombianos) — todos los montos se guardan como enteros

## Requisitos
- macOS/Windows/Linux
- Node.js 18+ y npm

## Instalación
```bash
npm install
```

## Ejecución
- Servidor API (puerto 3000):
```bash
npm run api
```
- Aplicación completa (Electron):
```bash
npm start
```

## Credenciales iniciales
- Usuario: `deyberth20`
- Contraseña: `54255012`
- Rol: `super_admin`

> La base de datos se crea automáticamente en el primer arranque: `euforia_liquors.db`.

## Estructura
- `server.js`: API REST (Express) + estáticos
- `main.js`: proceso principal de Electron
- `index.html` + `renderer.js`: UI (SPA)
- `database/database.js`: inicialización de SQLite y migraciones suaves

## Moneda (COP)
- Todos los importes se guardan como enteros (pesos). La UI muestra formato COP.
- Productos: `price` (entero), Ventas: `total` (entero), Transacciones: `amount` (entero)

## Métodos de Pago
- Selector en POS: Efectivo o Transferencia
- Persistencia en `sales.payment_method` y `transactions.payment_method`
- Reportes muestran resumen por método de pago y lo incluyen en el CSV

## Roles y Accesos
- `super_admin`: Acceso total, Usuarios, Administración de Mesas
- Otros roles: Accesos restringidos a módulos operativos
- Cerrar sesión disponible en el menú lateral

## Despliegue Web (opciones)
- Railway/Render/Heroku (Node.js):
  - Asegurar persistencia de `euforia_liquors.db` en volumen
  - `Procfile`: `web: node server.js`
- Vercel (serverless): migrar SQLite a hospedaje externo (ej. LibSQL/Turso/Neon+pg) o usar `vercel build output` con adapter

## Copias de seguridad
- Respaldar `euforia_liquors.db` periódicamente

## Notas de rendimiento
- PRAGMA: WAL, synchronous=NORMAL, foreign_keys=ON
- Índices en `sales.created_at`, `transactions.created_at`, `transactions.type`, `products.name`
- Endpoints y UI sanitizan importes a enteros COP

## Scripts útiles
```bash
npm run api     # arranca solo el API
npm start       # ejecuta la app Electron
```

## Roadmap sugerido
- Gráficos en Reportes (por día/método de pago)
- Paginación y búsqueda avanzada en Usuarios/Mesas
- Export/Import de base de datos
- Impresiones y cierres de caja con totales por método

## Licencia
ISC
