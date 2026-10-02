import { useState } from 'react';
import { Download, Printer, Receipt, Eye, Ban } from 'lucide-react';
import { Badge, Button, Card, CardHeader, DateRangePicker, EmptyState, Modal, PageHeader, PageLoader, Segmented, Stat, Table, useConfirm, useDateRange } from '@/components/ui';
import { Bars, Donut, RankList, RevenueArea, WEEKDAYS, hourLabel, trimHours } from '@/components/charts';
import { ORDER_RELATED, useInvalidatingMutation, useOrder, useOrders, useSalesReport, useTransactions } from '@/lib/queries';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { downloadCsv, fmtDateTime, fmtDay, money, number, ORDER_STATUS_LABEL, PAYMENT_LABEL, plural } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Order } from '@shared/types';

export function ReportsPage() {
  const { range, setRange, presets } = useDateRange('today');
  const [tab, setTab] = useState<'sales' | 'orders' | 'movements'>('sales');
  const p = { from: range.from, to: range.to };
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="Reportes" subtitle={range.from === range.to ? fmtDay(range.from, { weekday: 'long', day: 'numeric', month: 'long' }) : `${fmtDay(range.from)} – ${fmtDay(range.to)}`}
        actions={<Button size="sm" icon={Printer} onClick={() => window.print()} className="print-hidden">Imprimir</Button>} />
      <div className="print-hidden flex flex-wrap items-center justify-between gap-3">
        <DateRangePicker range={range} onChange={setRange} presets={presets} />
        <Segmented size="sm" value={tab} onChange={setTab} options={[{ value: 'sales', label: 'Ventas' }, { value: 'orders', label: 'Cuentas' }, { value: 'movements', label: 'Movimientos' }]} />
      </div>
      {tab === 'sales' && <Sales p={p} />}
      {tab === 'orders' && <OrdersHistory p={p} />}
      {tab === 'movements' && <Movements p={p} />}
    </div>
  );
}

function Sales({ p }: { p: { from: string; to: string } }) {
  const { data, isLoading } = useSalesReport(p);
  if (isLoading || !data) return <PageLoader />;
  const t = data.totals;
  const exportCsv = () => downloadCsv(`ventas_${p.from}_${p.to}.csv`, ['Producto', 'Categoría', 'Cantidad', 'Total'], data.byProduct.map((r) => [r.product_name, r.category_name ?? '', r.quantity, r.total]));
  const days = data.byDay.map((d) => ({ ...d, label: fmtDay(d.date, { day: '2-digit', month: 'short' }) }));
  const hours = trimHours(Array.from({ length: 24 }, (_, h) => { const r = data.byHour.find((x) => x.hour === h); return { hour: h, total: r?.total ?? 0, count: r?.count ?? 0 }; })).map((h) => ({ ...h, label: hourLabel(h.hour) }));
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((w) => { const r = data.byWeekday.find((x) => x.weekday === w); return { weekday: w, label: WEEKDAYS[w], total: r ? Math.round(r.total / Math.max(1, r.days)) : 0, count: r?.count ?? 0, days: r?.days ?? 0 }; });
  const multiDay = p.from !== p.to;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total vendido" value={money(t.total)} hint={plural(t.count, 'cuenta cobrada', 'cuentas cobradas')} />
        <Stat label="Ticket promedio" value={money(t.count ? t.total / t.count : 0)} tone="muted" hint={multiDay && data.byDay.length ? `${money(t.total / data.byDay.length)} por día` : undefined} />
        <Stat label="Efectivo" value={money(t.cash)} tone="ok" hint={t.total ? `${Math.round((t.cash / t.total) * 100)}% del total` : undefined} />
        <Stat label="Transferencias" value={money(t.transfer)} tone="info" hint={t.discount > 0 ? `Descuentos: ${money(t.discount)}` : t.total ? `${Math.round((t.transfer / t.total) * 100)}% del total` : undefined} />
      </div>
      {multiDay && (
        <Card>
          <CardHeader title="Ventas por día" subtitle="Total cobrado cada día del periodo" />
          <RevenueArea data={days} height={240} tooltipTitle={(x) => fmtDay(String(x.date), { weekday: 'long', day: 'numeric', month: 'long' })}
            tooltipRows={(x) => <><div className="font-semibold tabular-nums text-fg">{money(Number(x.total))}</div><div className="text-fg-muted">{plural(Number(x.count), 'cuenta')}</div></>} />
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Ventas por hora" subtitle="Hora de cobro" /><Bars data={hours} height={200} tooltipTitle={(x) => `${hourLabel(Number(x.hour))} · ${plural(Number(x.count), 'cuenta')}`} /></Card>
        {multiDay ? (
          <Card><CardHeader title="Promedio por día de la semana" subtitle="Cuánto se vende en un día típico de cada tipo" /><Bars data={weekdays} height={200} tooltipTitle={(x) => `${x.label} · ${plural(Number(x.count), 'cuenta')} en ${plural(Number(x.days), 'día')}`} /></Card>
        ) : (
          <Card><CardHeader title="Método de pago" /><Donut data={data.byPayment.map((m) => ({ name: PAYMENT_LABEL[m.method], value: m.total }))} height={180} /></Card>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {multiDay && <Card><CardHeader title="Método de pago" /><Donut data={data.byPayment.map((m) => ({ name: PAYMENT_LABEL[m.method], value: m.total }))} height={170} /></Card>}
        <Card><CardHeader title="Por categoría" /><Donut data={data.byCategory.map((c) => ({ name: c.category_name, value: c.total }))} height={170} /></Card>
        <Card className={cn(!multiDay && 'lg:col-span-2')}><CardHeader title="Por mesero" subtitle="Cuentas que abrió cada uno" /><RankList rows={data.byWaiter.map((w) => ({ label: w.user_name, value: w.total, hint: plural(w.count, 'cuenta') }))} /></Card>
      </div>
      <Card>
        <CardHeader title="Productos vendidos" subtitle={`${data.byProduct.length} productos distintos`} action={<Button size="sm" icon={Download} onClick={exportCsv} className="print-hidden">CSV</Button>} />
        {data.byProduct.length === 0 ? <EmptyState title="Sin ventas en este periodo" /> : (
          <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <div><h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted">Top 10 por valor</h4><RankList limit={10} rows={data.byProduct.map((r) => ({ label: r.product_name, value: r.total, hint: `${number(r.quantity)} und` }))} /></div>
            <Table><thead><tr><th>Producto</th><th>Categoría</th><th className="text-right">Cant.</th><th className="text-right">Total</th><th className="text-right">%</th></tr></thead>
              <tbody>{data.byProduct.map((r, i) => <tr key={i}><td className="font-medium">{r.product_name}</td><td className="text-fg-muted">{r.category_name ?? '—'}</td><td className="text-right tabular-nums">{number(r.quantity)}</td><td className="text-right tabular-nums font-semibold">{money(r.total)}</td><td className="text-right tabular-nums text-fg-muted">{t.total ? Math.round((r.total / t.total) * 100) : 0}%</td></tr>)}</tbody></Table>
          </div>
        )}
      </Card>
    </div>
  );
}

function OrdersHistory({ p }: { p: { from: string; to: string } }) {
  const { data, isLoading } = useOrders({ status: 'closed', ...p });
  const [detail, setDetail] = useState<Order | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const voidOrder = useInvalidatingMutation((id: number) => api.post(`/orders/${id}/void`), [['orders'], ...ORDER_RELATED, ['sales'], ['transactions']]);
  const onVoid = async (o: Order) => {
    const ok = await confirm({ title: `Anular venta #${o.id}`, message: `Se elimina el ingreso de ${money(o.total)}, los productos vuelven al inventario y la cuenta queda cancelada.`, danger: true, confirmText: 'Anular venta' });
    if (!ok) return;
    try { await voidOrder.mutateAsync(o.id); toast.success('Venta anulada'); } catch (e) { toast.error((e as Error).message); }
  };
  if (isLoading) return <PageLoader />;
  const rows = data ?? [];
  const exportCsv = () => downloadCsv(`cuentas_${p.from}_${p.to}.csv`, ['#', 'Mesa', 'Estado', 'Abrió', 'Cobró', 'Apertura', 'Cierre', 'Pago', 'Subtotal', 'Descuento', 'Total'],
    rows.map((o) => [o.id, o.table_name ?? o.label ?? '', ORDER_STATUS_LABEL[o.status], o.opened_by_name, o.closed_by_name ?? '', fmtDateTime(o.opened_at), fmtDateTime(o.closed_at), PAYMENT_LABEL[o.payment_method ?? ''] ?? '', o.subtotal, o.discount, o.total]));
  return (
    <Card>
      <CardHeader title={plural(rows.length, 'cuenta cerrada', 'cuentas cerradas')} action={<Button size="sm" icon={Download} onClick={exportCsv} className="print-hidden">CSV</Button>} />
      {rows.length === 0 ? <EmptyState icon={Receipt} title="Sin cuentas en este periodo" /> : (
        <Table><thead><tr><th>Cuenta</th><th>Mesero</th><th>Cierre</th><th>Pago</th><th className="text-right">Total</th><th></th></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id} className={cn(o.status === 'cancelled' && 'opacity-60')}>
              <td className="font-medium">{o.table_name ?? o.label ?? `#${o.id}`}<span className="ml-1 text-xs text-fg-faint">#{o.id}</span></td>
              <td className="text-fg-muted">{o.opened_by_name}</td>
              <td className="text-fg-muted whitespace-nowrap">{fmtDateTime(o.closed_at)}</td>
              <td>{o.status === 'cancelled' ? <Badge tone="danger">Cancelada</Badge> : <Badge tone={o.payment_method === 'cash' ? 'ok' : o.payment_method === 'credit' ? 'warn' : 'info'}>{PAYMENT_LABEL[o.payment_method ?? '']}</Badge>}</td>
              <td className="text-right tabular-nums font-semibold">{money(o.total)}</td>
              <td className="whitespace-nowrap text-right"><button type="button" className="rounded-lg p-2 text-fg-muted hover:text-fg" aria-label="Ver" onClick={() => setDetail(o)}><Eye className="h-4 w-4" /></button>{o.status === 'paid' && <button type="button" className="rounded-lg p-2 text-fg-muted hover:text-danger" aria-label="Anular venta" title="Anular venta" onClick={() => onVoid(o)}><Ban className="h-4 w-4" /></button>}</td>
            </tr>))}</tbody></Table>
      )}
      <OrderDetail order={detail} onClose={() => setDetail(null)} />
    </Card>
  );
}

function OrderDetail({ order, onClose }: { order: Order | null; onClose: () => void }) {
  return (
    <Modal open={!!order} onClose={onClose} title={order ? `${order.table_name ?? order.label ?? 'Cuenta'} · #${order.id}` : ''} size="sm">
      {order && <OrderItemsView order={order} />}
    </Modal>
  );
}

function OrderItemsView({ order }: { order: Order }) {
  const { data } = useOrder(order.id);
  const o = data ?? order;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-fg-muted">Abrió {o.opened_by_name} · {fmtDateTime(o.opened_at)}<br />{o.status === 'paid' ? `Cobró ${o.closed_by_name} · ${fmtDateTime(o.closed_at)} · ${PAYMENT_LABEL[o.payment_method ?? '']}` : `Cancelada por ${o.closed_by_name} · ${fmtDateTime(o.closed_at)}`}</p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {(o.items ?? []).map((it) => <li key={it.id} className="flex justify-between px-3 py-2"><span>{it.quantity} × {it.product_name}{it.promo === 1 && ' (2x1)'}<span className="ml-2 text-xs text-fg-faint">{it.added_by_name.split(' ')[0]}</span></span><span className="tabular-nums">{money(it.quantity * it.unit_price)}</span></li>)}
      </ul>
      {o.discount > 0 && <div className="flex justify-between text-warn"><span>Descuento</span><span>− {money(o.discount)}</span></div>}
      <div className="flex justify-between text-base font-bold"><span>Total</span><span className="text-gold">{money(o.total)}</span></div>
      {o.notes && <p className="text-xs text-fg-muted">Nota: {o.notes}</p>}
    </div>
  );
}

function Movements({ p }: { p: { from: string; to: string } }) {
  const { data, isLoading } = useTransactions(p);
  if (isLoading) return <PageLoader />;
  const rows = data ?? [];
  const income = rows.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = rows.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const cashIn = rows.filter((t) => t.type === 'income' && t.payment_method === 'cash').reduce((s, t) => s + t.amount, 0);
  const exportCsv = () => downloadCsv(`movimientos_${p.from}_${p.to}.csv`, ['Fecha', 'Tipo', 'Descripción', 'Monto', 'Método', 'Usuario'], rows.map((t) => [fmtDateTime(t.created_at), t.type === 'income' ? 'Ingreso' : 'Gasto', t.description, t.type === 'expense' ? -t.amount : t.amount, PAYMENT_LABEL[t.payment_method], t.created_by_name]));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Ingresos" value={money(income)} tone="ok" hint={`Efectivo ${money(cashIn)} · Transfer. ${money(income - cashIn)}`} />
        <Stat label="Gastos" value={money(expense)} tone="danger" />
        <Stat label="Balance" value={money(income - expense)} tone={income - expense >= 0 ? 'gold' : 'danger'} />
        <Stat label="Movimientos" value={number(rows.length)} tone="muted" />
      </div>
      <Card>
        <CardHeader title="Detalle" action={<Button size="sm" icon={Download} onClick={exportCsv} className="print-hidden">CSV</Button>} />
        {rows.length === 0 ? <EmptyState title="Sin movimientos" /> : (
          <Table><thead><tr><th>Fecha</th><th>Descripción</th><th>Método</th><th>Usuario</th><th className="text-right">Monto</th></tr></thead>
            <tbody>{rows.map((t) => <tr key={t.id}><td className="whitespace-nowrap text-fg-muted">{fmtDateTime(t.created_at)}</td><td>{t.description}</td><td className="text-fg-muted">{PAYMENT_LABEL[t.payment_method]}</td><td className="text-fg-muted">{t.created_by_name}</td><td className={cn('text-right tabular-nums font-semibold', t.type === 'income' ? 'text-ok' : 'text-danger')}>{t.type === 'expense' && '− '}{money(t.amount)}</td></tr>)}</tbody></Table>
        )}
      </Card>
    </div>
  );
}
