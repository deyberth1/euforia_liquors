import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, LayoutGrid, Package, TrendingUp, ArrowRight, Receipt, CalendarRange } from 'lucide-react';
import { Badge, Button, Card, CardHeader, PageHeader, PageLoader, Segmented } from '@/components/ui';
import { Bars, Delta, Donut, RankList, RevenueArea, Sparkline, SplitBar, hourLabel, trimHours } from '@/components/charts';
import { useDashboard } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { AdminHome } from '@/pages/AdminHome';
import { fmtDay, fmtLongDay, fmtTime, money, number, plural } from '@/lib/format';
import { cn } from '@/lib/cn';

export function DashboardPage() {
  const { user, isOwner } = useAuth();
  const { data, isLoading } = useDashboard();
  const [span, setSpan] = useState<'7' | '14' | '30'>('14');
  if (isLoading || !data) return <PageLoader />;
  if (!isOwner) return <AdminHome data={data} name={user?.full_name.split(' ')[0] ?? ''} />;
  const cash = data.cash;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const series = data.last30Days.slice(-Number(span)).map((d) => ({ ...d, label: fmtDay(d.date, { day: '2-digit', month: 'short' }) }));
  const avgTicket = data.sales.count ? data.sales.total / data.sales.count : 0;
  const hours = trimHours(data.todayByHour).map((h) => ({ ...h, label: hourLabel(h.hour) }));
  const spark = data.last30Days.slice(-14).map((d) => d.total);

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={`${greet}, ${user?.full_name.split(' ')[0]}`} subtitle={fmtLongDay(data.today)} actions={<Link to="/venta"><Button variant="primary" icon={Banknote}>Venta rápida</Button></Link>} />

      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Ventas de hoy" value={money(data.sales.total)} icon={TrendingUp} tone="gold"
          foot={<div className="flex flex-col gap-0.5"><Delta now={data.sales.total} before={data.yesterday.total} label="vs ayer" /><Delta now={data.sales.total} before={data.sameDayLastWeek.total} label={`vs ${fmtDay(data.today, { weekday: 'long' })} pasado`} /></div>}
          spark={spark} />
        <Kpi label="Cuentas cobradas" value={number(data.sales.count)} icon={Receipt} tone="muted" foot={<span className="text-xs text-fg-muted">Ticket promedio <b className="text-fg">{money(avgTicket)}</b></span>} />
        <Kpi label="Por cobrar" value={money(data.openOrders.total)} icon={LayoutGrid} tone="warn" foot={<span className="text-xs text-fg-muted">{plural(data.openOrders.count, 'cuenta abierta', 'cuentas abiertas')}</span>} />
        <Kpi label={`Acumulado ${data.month.label}`} value={money(data.month.total)} icon={CalendarRange} tone="muted" foot={<span className="text-xs text-fg-muted">{plural(data.month.count, 'cuenta')} en el mes</span>} />
      </div>

      {/* Tendencia + caja */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Tendencia de ventas" subtitle="Total cobrado por día" action={<Segmented size="sm" value={span} onChange={setSpan} options={[{ value: '7', label: '7 días' }, { value: '14', label: '14 días' }, { value: '30', label: '30 días' }]} />} />
          <RevenueArea data={series} height={230} tooltipTitle={(p) => fmtDay(String(p.date), { weekday: 'long', day: 'numeric', month: 'long' })}
            tooltipRows={(p) => <><div className="font-semibold tabular-nums text-fg">{money(Number(p.total))}</div><div className="text-fg-muted">{plural(Number(p.count), 'cuenta')}</div></>} />
        </Card>
        <Card className="flex flex-col">
          <CardHeader title="Caja" subtitle={cash ? `Abierta ${fmtTime(cash.opened_at)} por ${cash.opened_by_name.split(' ')[0]}` : 'No hay caja abierta'} action={<Badge tone={cash ? 'ok' : 'muted'} dot>{cash ? 'Abierta' : 'Cerrada'}</Badge>} />
          {cash ? (
            <div className="space-y-3 text-sm">
              <div><div className="text-xs uppercase tracking-wider text-fg-muted">Efectivo esperado</div><div className="text-2xl font-bold tabular-nums text-ok">{money(cash.summary!.expectedCash)}</div><div className="text-xs text-fg-faint">Base {money(cash.opening_balance)}</div></div>
              <SplitBar a={cash.summary!.salesCash} b={cash.summary!.salesTransfer} labelA="Efectivo" labelB="Transfer." />
              <div className="flex justify-between text-fg-muted"><span>Otros ingresos</span><span className="tabular-nums text-fg">{money(cash.summary!.otherIncomeCash + cash.summary!.otherIncomeTransfer)}</span></div>
              <div className="flex justify-between text-fg-muted"><span>Gastos</span><span className="tabular-nums text-danger">− {money(cash.summary!.expenseCash + cash.summary!.expenseTransfer)}</span></div>
            </div>
          ) : <p className="flex-1 text-sm text-fg-muted">Abre la caja con la base en efectivo para empezar el turno. Las ventas quedarán ligadas al turno para el cierre.</p>}
          <Link to="/caja" className="mt-4 block"><Button full icon={ArrowRight}>{cash ? 'Ir a la caja' : 'Abrir caja'}</Button></Link>
        </Card>
      </div>

      {/* Hoy en detalle */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Ventas por hora (hoy)" subtitle="Hora en que se cobró cada cuenta" />
          <Bars data={hours} height={190} highlight={(p) => Number(p.hour) === new Date().getHours()} tooltipTitle={(p) => `${hourLabel(Number(p.hour))} · ${plural(Number(p.count), 'cuenta')}`} />
        </Card>
        <Card>
          <CardHeader title="Método de pago (hoy)" />
          <Donut data={[{ name: 'Efectivo', value: data.sales.cash }, { name: 'Transferencia', value: data.sales.transfer }, { name: 'A crédito', value: data.sales.credit }]} height={170} centerLabel="Hoy" />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Más vendidos hoy" subtitle="Por valor vendido" />
          <RankList rows={data.topProducts.map((p) => ({ label: p.product_name, value: p.total, hint: `${number(p.quantity)} und` }))} />
        </Card>
        <Card>
          <CardHeader title="Por categoría (hoy)" />
          <Donut data={data.byCategoryToday.map((c) => ({ name: c.category_name, value: c.total }))} height={170} />
        </Card>
        <Card>
          <CardHeader title="Meseros hoy" subtitle="Ventas de las mesas que abrió cada uno" action={<Link to="/equipo" className="text-sm text-gold hover:underline">Ver equipo</Link>} />
          <RankList rows={data.byWaiterToday.map((w) => ({ label: w.user_name, value: w.total, hint: plural(w.count, 'cuenta') }))} />
        </Card>
      </div>

      <Card>
        <CardHeader title="Inventario bajo" subtitle="Productos con 5 unidades o menos" action={<Link to="/inventario" className="text-sm text-gold hover:underline">Ver inventario</Link>} />
        {data.lowStock.length === 0 ? <p className="py-4 text-center text-sm text-fg-faint">Todo el inventario está por encima del mínimo.</p> : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.lowStock.map((p) => <div key={p.id} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-sm"><span className="truncate">{p.name}<span className="ml-2 text-xs text-fg-faint">{p.category_name}</span></span><Badge tone={p.stock === 0 ? 'danger' : 'warn'}>{p.stock} und</Badge></div>)}
          </div>
        )}
      </Card>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone, foot, spark }: { label: string; value: string; icon: typeof Package; tone: 'gold' | 'ok' | 'warn' | 'muted'; foot?: React.ReactNode; spark?: number[] }) {
  const color = { gold: 'text-gold', ok: 'text-ok', warn: 'text-warn', muted: 'text-fg' }[tone];
  return (
    <div className="card relative overflow-hidden p-4">
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span><Icon className={cn('h-4 w-4', color)} /></div>
      <div className={cn('mt-2 text-2xl font-bold tabular-nums leading-none', color)}>{value}</div>
      {foot && <div className="mt-2">{foot}</div>}
      {spark && <Sparkline data={spark} className="mt-2 -mx-1" />}
    </div>
  );
}
