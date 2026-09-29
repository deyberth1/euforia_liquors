import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LayoutGrid, Wallet, Package, BarChart3, Users, CalendarDays, HandCoins, UserCircle2, UsersRound, Zap, LogOut, Sparkles, type LucideIcon } from 'lucide-react';
import { Logo, LogoMark } from '@/components/Logo';
import { Button, Modal } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { ROLE_LABEL, hasRole } from '@/lib/format';
import type { Role } from '@shared/types';

interface NavItem { to: string; label: string; icon: LucideIcon; min: Role; mobile?: Role[]; only?: Role }

// `min`: rol mínimo que ve el módulo. `mobile`: roles para los que va en la barra inferior del celular (máx. 5).
const NAV: NavItem[] = [
  { to: '/inicio', label: 'Inicio', icon: LayoutDashboard, min: 'admin', mobile: ['owner', 'admin'] },
  { to: '/mi-noche', label: 'Mi noche', icon: Sparkles, min: 'waiter', mobile: ['waiter'], only: 'waiter' },
  { to: '/mesas', label: 'Mesas', icon: LayoutGrid, min: 'waiter', mobile: ['owner', 'admin', 'waiter'] },
  { to: '/venta', label: 'Venta rápida', icon: Zap, min: 'admin' },
  { to: '/caja', label: 'Caja', icon: Wallet, min: 'admin', mobile: ['owner', 'admin'] },
  { to: '/inventario', label: 'Inventario', icon: Package, min: 'admin' },
  { to: '/reportes', label: 'Reportes', icon: BarChart3, min: 'owner', mobile: ['owner'] },
  { to: '/equipo', label: 'Equipo', icon: UsersRound, min: 'admin', mobile: ['admin'] },
  { to: '/creditos', label: 'Créditos', icon: HandCoins, min: 'admin' },
  { to: '/turnos', label: 'Turnos', icon: CalendarDays, min: 'waiter', mobile: ['waiter'] },
  { to: '/usuarios', label: 'Usuarios', icon: Users, min: 'owner' },
  { to: '/perfil', label: 'Perfil', icon: UserCircle2, min: 'waiter', mobile: ['owner', 'admin', 'waiter'] },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const role = user?.role;
  const items = NAV.filter((n) => hasRole(role, n.min) && (!n.only || n.only === role));
  // En celular mostramos máximo 5 accesos; el resto vive en "Perfil" (menú).
  const mobileItems = items.filter((n) => role && n.mobile?.includes(role)).slice(0, 5);
  const immersive = /^\/cuenta\//.test(location.pathname);

  return (
    <div className="flex min-h-dvh">
      {/* Barra lateral (tablet/escritorio) */}
      <aside className="print-hidden sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="px-5 pt-6 pb-4"><Logo size="sm" /></div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to}
              className={({ isActive }) => cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                isActive ? 'bg-gold/12 text-gold' : 'text-fg-muted hover:bg-surface-2 hover:text-fg')}>
              <n.icon className="h-5 w-5" />{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <NavLink to="/perfil" className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gold/15 text-sm font-bold text-gold">{initials(user?.full_name || user?.username || '?')}</div>
            <div className="min-w-0"><div className="truncate text-sm font-semibold">{user?.full_name || user?.username}</div><div className={cn('text-xs', user?.role === 'owner' ? 'text-gold' : 'text-fg-muted')}>{ROLE_LABEL[user?.role ?? '']}</div></div>
          </NavLink>
          <button type="button" onClick={logout} className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-fg-muted transition hover:bg-danger/10 hover:text-danger">
            <LogOut className="h-5 w-5" />Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Cabecera móvil */}
        {!immersive && (
          <header className="print-hidden sticky top-0 z-30 flex items-center justify-between border-b border-line bg-ink/85 px-4 py-2.5 backdrop-blur safe-top md:hidden">
            <div className="flex items-center gap-2.5"><LogoMark className="h-9 w-9" /><span className="font-display text-[15px] font-black tracking-[0.06em]">EUFORIA <span className="font-semibold text-gold">LIQUORS</span></span></div>
            <button type="button" onClick={() => setMenu(true)} aria-label="Menú de usuario" className="flex h-9 w-9 items-center justify-center rounded-full bg-gold/15 text-xs font-bold text-gold ring-2 ring-gold/30">{initials(user?.full_name || user?.username || '?')}</button>
          </header>
        )}
        <main className={cn('mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:px-6 sm:py-6', !immersive && 'pb-24 md:pb-8')}>
          <Outlet />
        </main>
        <Modal open={menu} onClose={() => setMenu(false)} size="sm" title={user?.full_name || user?.username}>
          <p className="-mt-2 mb-4 text-sm text-fg-muted">@{user?.username} · {ROLE_LABEL[user?.role ?? '']}</p>
          <div className="grid gap-2">
            <Button size="lg" icon={UserCircle2} onClick={() => { setMenu(false); nav('/perfil'); }} className="justify-start">Mi perfil y contraseña</Button>
            <Button size="lg" variant="danger" icon={LogOut} onClick={() => { setMenu(false); logout(); }} className="justify-start">Cerrar sesión</Button>
          </div>
        </Modal>
        {/* Navegación inferior móvil */}
        {!immersive && (
          <nav className="print-hidden fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur safe-bottom md:hidden">
            <div className="grid" style={{ gridTemplateColumns: `repeat(${mobileItems.length}, 1fr)` }}>
              {mobileItems.map((n) => (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => cn('flex flex-col items-center gap-1 py-2 text-[11px] font-medium transition', isActive ? 'text-gold' : 'text-fg-muted')}>
                  {({ isActive }) => (<><span className={cn('rounded-xl px-3 py-1 transition', isActive && 'bg-gold/12')}><n.icon className="h-5 w-5" /></span>{n.label}</>)}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export const NAV_ITEMS = NAV;
