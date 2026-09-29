import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Banknote, Wallet, LayoutGrid, Package, Zap, UsersRound, HandCoins, CalendarDays, ArrowRight, Radio, Unlock, type LucideIcon } from 'lucide-react';
import { Badge, Button, Card, CardHeader } from '@/components/ui';
import { RankList, SplitBar } from '@/components/charts';
import { api } from '@/lib/api';
import { fmtTime, money, number, plural, timeAgo } from '@/lib/format';
import { initials } from '@/components/layout/AppShell';
import { cn } from '@/lib/cn';
import type { DashboardData, StaffReport } from '@shared/types';

/** Inicio del administrador: estado del turno y accesos rápidos, sin analítica histórica. */
export function AdminHome({ data, name }: { data: DashboardData; name: string }) {
  const { data: staff } = useQuery({ queryKey: ['staff', {}], queryFn: () => api.get<StaffReport>('/reports/staff'), refetchInterval: 10_000 });
  const cash = data.cash;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const live = staff?.live ?? [];

  return (
    <div className="animate-fade-up space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-xl font-bold tracking-tight sm:text-2xl">{greet}, {name}</h1><p className="mt-0.5 text-sm text-fg-muted">Así va el turno ahora mismo.</p></div>
        <Link to="/venta"><Button variant="primary" icon={Banknote}>Venta rápida</Button></Link>
      </div>

      {/* Estado de la caja */}
      <Card className={cn(!cash && 'border-warn/40')}>
        <CardHeader title="Caja" subtitle={cash ? `Abierta ${fmtTime(cash.opened_at)} por ${cash.opened_by_name.split(' ')[0]}` : 'La caja está cerrada: no se pueden abrir mesas hasta abrirla.'} action={<Badge tone={cash ? 'ok' : 'warn'} dot>{cash ? 'Abierta' : 'Cerrada'}</Badge>} />
        {cash ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <div><div className="text-xs uppercase tracking-wider text-fg-muted">Efectivo esperado</div><div className="text-2xl font-bold tabular-nums text-ok">{money(cash.summary!.expectedCash)}</div><div className="text-xs text-fg-faint">Base {money(cash.opening_balance)}</div></div>
            <div><div className="text-xs uppercase tracking-wider text-fg-muted">Ventas del turno</div><div className="text-2xl font-bold tabular-nums text-gold">{money(cash.summary!.salesTotal)}</div><div className="text-xs text-fg-faint">{plural(cash.summary!.salesCount, 'cuenta cobrada', 'cuentas cobradas')}</div></div>
            <div className="sm:pt-1"><SplitBar a={cash.summary!.salesCash} b={cash.summary!.salesTransfer} labelA="Efectivo" labelB="Transfer." /></div>
          </div>
        ) : <Link to="/caja"><Button variant="primary" icon={Unlock}>Abrir caja</Button></Link>}
      </Card>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Quick to="/mesas" icon={LayoutGrid} label="Mesas" hint={`${data.openOrders.count} abiertas · ${money(data.openOrders.total)}`} tone="gold" />
        <Quick to="/caja" icon={Wallet} label="Caja" hint={cash ? 'Ingresos y gastos' : 'Abrir turno'} />
        <Quick to="/venta" icon={Zap} label="Venta rápida" hint="Barra o para llevar" />
        <Quick to="/inventario" icon={Package} label="Inventario" hint={data.lowStock.length ? `${plural(data.lowStock.length, 'producto')} bajo` : 'Todo en orden'} tone={data.lowStock.length ? 'warn' : undefined} />
        <Quick to="/equipo" icon={UsersRound} label="Equipo" hint={`${plural(live.length, 'mesero')} con mesas`} />
        <Quick to="/creditos" icon={HandCoins} label="Créditos" hint="Por cobrar y pagar" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Radio className="h-4 w-4 animate-pulse-soft text-ok" />Meseros ahora</span>} subtitle="Conectados y qué mesas tiene cada uno" action={<Link to="/equipo" className="text-sm text-gold hover:underline">Ver equipo</Link>} />
          {live.length === 0 ? <p className="py-6 text-center text-sm text-fg-faint">Ningún mesero conectado.</p> : (
            <ul className="space-y-3">
              {live.map((w) => (
                <li key={w.user_id} className="rounded-xl bg-surface-2 p-3">
                  <div className="flex items-center gap-3"><div className="relative"><div className={cn('flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold', w.online ? 'bg-gold/15 text-gold' : 'bg-surface-3 text-fg-muted')}>{initials(w.user_name)}</div><span className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-2', w.online ? 'bg-ok' : 'bg-fg-faint')} /></div><div className="min-w-0 flex-1"><div className="truncate font-semibold">{w.user_name}{!w.online && <span className="ml-1.5 text-[10px] uppercase tracking-wider text-fg-faint">desconectado</span>}</div><div className="text-xs text-fg-muted">{plural(w.tables.length, 'mesa')} · {plural(w.items_added, 'ítem', 'ítems')}</div></div><div className="font-bold tabular-nums text-gold">{money(w.amount_added)}</div></div>
                  <div className="mt-2 flex flex-wrap gap-1.5">{w.tables.map((t) => <Link key={t.order_id} to={`/cuenta/${t.order_id}`} className="rounded-lg border border-line px-2 py-1 text-xs hover:border-gold/50">{t.table_name} · {money(t.total)} · {timeAgo(t.opened_at)}</Link>)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Más vendidos hoy" subtitle="Por valor" />
            <RankList limit={5} rows={data.topProducts.map((p) => ({ label: p.product_name, value: p.total, hint: `${number(p.quantity)} und` }))} />
          </Card>
          <Card>
            <CardHeader title="Inventario bajo" subtitle="5 unidades o menos" action={<Link to="/inventario" className="text-sm text-gold hover:underline">Ajustar</Link>} />
            {data.lowStock.length === 0 ? <p className="py-3 text-center text-sm text-fg-faint">Todo por encima del mínimo.</p> : (
              <ul className="divide-y divide-line text-sm">{data.lowStock.slice(0, 6).map((p) => <li key={p.id} className="flex items-center justify-between py-2"><span className="truncate">{p.name}</span><Badge tone={p.stock === 0 ? 'danger' : 'warn'}>{p.stock} und</Badge></li>)}</ul>
            )}
          </Card>
        </div>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><CalendarDays className="h-5 w-5 text-gold" /><div><div className="font-semibold">Turnos de la semana</div><div className="text-xs text-fg-muted">Programa quién trabaja cada día.</div></div></div>
        <Link to="/turnos"><Button icon={ArrowRight}>Ver turnos</Button></Link>
      </Card>
    </div>
  );
}

function Quick({ to, icon: Icon, label, hint, tone }: { to: string; icon: LucideIcon; label: string; hint: string; tone?: 'gold' | 'warn' }) {
  return (
    <Link to={to} className={cn('card flex flex-col gap-2 p-4 transition hover:border-gold/50 active:scale-[0.98]', tone === 'gold' && 'border-gold/40')}>
      <Icon className={cn('h-6 w-6', tone === 'warn' ? 'text-warn' : 'text-gold')} />
      <div><div className="font-semibold">{label}</div><div className="truncate text-xs text-fg-muted">{hint}</div></div>
    </Link>
  );
}
