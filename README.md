# Euforia Liquors · Mesas, pedidos y caja

Aplicación web instalable (PWA) para operar el bar: los **meseros** abren mesas y anotan pedidos desde el celular; los **administradores** cobran, manejan la caja, el inventario, los reportes y el equipo.

## Stack

| Capa | Tecnología |
|---|---|
| Interfaz | React 19 + Vite 6 + Tailwind CSS 4 + TanStack Query (PWA instalable) |
| API | Hono (TypeScript) desplegado como función serverless en Vercel (`api/index.ts`) |
| Base de datos | libSQL / Turso en producción · archivo SQLite local en desarrollo (`data/euforia.db`) |
| Autenticación | JWT firmado (`jose`) + contraseñas con `bcryptjs` |

## Roles

| Acción | Mesero | Administrador | Dueño |
|---|:-:|:-:|:-:|
| Ver mesas, abrir cuentas y agregar productos | ✅ | ✅ | ✅ |
| Corregir cantidades | solo lo que él agregó | todo | todo |
| Cobrar, cancelar, descuento, mover de mesa, venta rápida | — | ✅ | ✅ |
| Abrir/cerrar caja, registrar ingresos y gastos | — | ✅ | ✅ |
| Inventario, categorías, mesas (crear y editar) | — | ✅ | ✅ |
| Créditos (crear y abonar), turnos (programar), equipo | — | ✅ | ✅ |
| Inicio (analítica) y Reportes | — | — | ✅ |
| Usuarios (crear, editar, eliminar) | — | — | ✅ |
| Eliminar o anular: ventas cobradas, créditos, movimientos, productos, mesas, categorías | — | — | ✅ |
| Ver turnos y cambiar su contraseña | ✅ | ✅ | ✅ |

El dueño es un administrador marcado con `is_owner`. Siempre debe quedar al menos un dueño activo. Cada producto anotado guarda **quién** lo agregó y **a qué hora**, por eso el módulo *Equipo* muestra qué mesas tiene cada mesero y cuánto vendió cada uno por turno o por rango de fechas.

## Desarrollo local

```bash
npm install
cp .env.example .env      # ajusta ADMIN_USERNAME / ADMIN_PASSWORD si quieres
npm run dev               # API en :3000 y web en :5173 (con proxy /api)
```

Abre <http://localhost:5173>. La base de datos y el usuario administrador inicial se crean solos en el primer arranque (credenciales en `.env`). Para probar desde el celular en la misma red: `npx vite --host` y entra por la IP del computador.

Otros comandos:

```bash
npm run typecheck   # tipos de la web y del API
npm run build       # compila la web en dist/
```

## Despliegue en Vercel

1. **Base de datos**: crea una base en [Turso](https://turso.tech) (plan gratuito) y copia su URL `libsql://...` y un token. Alternativa: instala la integración *Turso* desde el Marketplace de Vercel, que crea las variables por ti.
2. **Variables de entorno** en el proyecto de Vercel (Settings → Environment Variables):

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | `libsql://tu-base-xxxx.turso.io` |
   | `DATABASE_AUTH_TOKEN` | token de Turso |
   | `JWT_SECRET` | una cadena larga y aleatoria (`openssl rand -hex 32`) |
   | `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_NAME` | administrador inicial (solo se usa si la tabla de usuarios está vacía) |

   También se aceptan los nombres `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.
3. `vercel --prod` (o conecta el repositorio de GitHub para que despliegue en cada push). Vercel detecta Vite, compila `dist/` y publica `api/index.ts` como función.
4. Entra con el administrador inicial, **cambia la contraseña** en *Perfil* y crea los usuarios del equipo en *Usuarios*.

### Instalar en los celulares
Abre la URL en Chrome (Android) o Safari (iPhone) y usa "Añadir a pantalla de inicio". En *Perfil* hay un botón de instalación cuando el navegador lo permite.

## Migrar datos de la versión anterior (opcional)

La v1 usaba otro esquema (`sales`/`sale_items`, sedes, `super_admin`). Si quieres traer usuarios, productos, mesas y créditos abiertos de esa base:

```bash
LEGACY_DATABASE_URL=libsql://base-antigua.turso.io LEGACY_DATABASE_AUTH_TOKEN=... npm run db:migrate-legacy
```

Los usuarios conservan su contraseña; `super_admin` pasa a *dueño*, `admin`/`manager` a *administrador* y `employee` a *mesero*. Se migran las ventas pagadas de la sede; los gastos y turnos de caja de la v1 no guardaban sede, así que solo se migran con `LEGACY_INCLUDE_CASH=1`.

## Estructura

```
api/index.ts          Función serverless de Vercel (envuelve la app Hono)
server/               API: app.ts (rutas), db.ts (esquema + migraciones), auth.ts, routes/*
server/scripts/       migrate-legacy.ts
shared/types.ts       Tipos compartidos API ⇄ web
src/                  Aplicación React: pages/, components/, lib/ (api, auth, queries, format)
public/               logo.svg e íconos PWA
```

## Decisiones de diseño

- **Moneda**: todos los importes son enteros en pesos colombianos.
- **Zona horaria**: las fechas se guardan en UTC y se interpretan en hora de Colombia (UTC‑5) para "hoy", reportes y cierres.
- **Inventario**: el stock se descuenta al anotar el producto y vuelve si se quita o se cancela la cuenta. Los cócteles/preparados pueden marcarse "sin control de inventario".
- **Caja**: solo puede haber un turno abierto; no se puede cerrar con cuentas abiertas; el sistema calcula el efectivo esperado y registra la diferencia contra lo contado.
- **Borrado seguro**: productos, mesas y usuarios con historial se desactivan en lugar de eliminarse, para no perder reportes.
