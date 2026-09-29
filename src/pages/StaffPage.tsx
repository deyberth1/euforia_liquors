import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { UsersRound, Radio } from 'lucide-react';
import { Card, CardHeader, DateRangePicker, EmptyState, PageHeader, PageLoader, Segmented, Select, Table, useDateRange } from '@/components/ui';
import { RankList } from '@/components/charts';
import { useCashSessions } from '@/lib/queries';
import { api, qs } from '@/lib/api';
import { fmtDateTime, fmtTime, money, number, plural, timeAgo } from '@/lib/format';
import { initials } from '@/components/layout/AppShell';
import { cn } from '@/lib/cn';
import type { StaffReport } from '@shared/types';

export function StaffPage() {
  const { range, setRange, presets } = useDateRange('today');
  const [mode, setMode] = useState<'range' | 'session'>('range');
  const [session, setSession] = useState('');
  const { data: sessions } = useCashSessions({});
  const params = mode === 'session' && session ? { session } : { from: range.from, to: range.to };
  const { data, isLoading } = useQuery({ queryKey: ['staff', params], queryFn: () => api.get<StaffReport>(`/reports/staff${qs(params)}`), refetchInterval: 10_000 });

  if (isLoading || !data) return <PageLoader />;
  const maxSold = Math.max(1, ...data.stats.map((s) => s.amount_sold));

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="Equipo" subtitle="Quién atiende qué y cuánto vende cada mesero" />

      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Radio className="h-4 w-4 text-ok animate-pulse-soft" />Ahora mismo</span>} subtitle="Meseros con sesión abierta y las mesas que tiene cada uno" />
        {data.live.length === 0 ? <EmptyState icon={UsersRound} title="Ningún mesero conectado" text="Aparecen aquí cuando inician sesión en su celular." /> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.live.map((w) => (
              <div key={w.user_id} className="rounded-2xl border border-line bg-surface-2 p-4">
                <div className="flex items-center gap-3">
                  <div className="relative"><div className={cn('flex h-10 w-10 items-center justify-center rounded-full font-bold', w.online ? 'bg-gold/15 text-gold' : 'bg-surface-3 text-fg-muted')}>{initials(w.user_name)}</div><span className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-2', w.online ? 'bg-ok' : 'bg-fg-faint')} /></div>
                  <div className="min-w-0 flex-1"><div className="truncate font-semibold">{w.user_name}</div><div className="text-xs text-fg-muted">{w.online ? <span className="text-ok">Conectado</span> : <span className="text-warn">Desconectado{w.last_seen_at && ` · hace ${timeAgo(w.last_seen_at)}`}</span>} · {plural(w.tables.length, 'mesa')} · {plural(w.items_added, 'ítem', 'ítems')}</div></div>
                  <div className="font-bold tabular-nums text-gold">{money(w.amount_added)}</div>
                </div>

                {w.tables.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {w.tables.map((t) => <li key={t.order_id}><Link to={`/cuenta/${t.order_id}`} className="flex justify-between rounded-lg px-2 py-1 hover:bg-surface-3"><span>{t.table_name}<span className="ml-2 text-xs text-fg-faint">{timeAgo(t.opened_at)}</span></span><span className="tabular-nums text-fg-muted">{money(t.total)}</span></Link></li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Análisis del turno" subtitle="Cada venta cuenta para el mesero que abrió la mesa, sin importar quién anotó los productos" />
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'range', label: 'Por fechas' }, { value: 'session', label: 'Por turno de caja' }]} />
          {mode === 'range' ? <DateRangePicker range={range} onChange={setRange} presets={presets} /> : (
            <Select className="h-9 w-auto text-sm" value={session} onChange={(e) => setSession(e.target.value)}>
              <option value="">Selecciona un turno</option>
              {(sessions ?? []).map((s) => <option key={s.id} value={s.id}>{fmtDateTime(s.opened_at)} {s.status === 'open' ? '(abierto)' : `→ ${fmtTime(s.closed_at)}`} · {s.opened_by_name}</option>)}
            </Select>
          )}
        </div>
        {data.stats.length === 0 ? <EmptyState title="Sin ventas en este periodo" /> : (
          <>
            <RankList className="mb-6" rows={data.stats.map((s) => ({ label: s.user_name, value: s.amount_sold, hint: plural(s.orders_opened, 'cuenta') }))} format={money} max={maxSold} />
            <Table>
              <thead><tr><th>Mesero</th><th className="text-right">Cuentas que abrió</th><th className="text-right">Ítems</th><th className="text-right">Vendido</th><th className="text-right">Ticket prom.</th><th>Más vendido</th><th>Actividad</th></tr></thead>
              <tbody>{data.stats.map((s) => (
                <tr key={s.user_id}>
                  <td className="font-medium">{s.user_name}</td>
                  <td className="text-right tabular-nums">{number(s.orders_opened)}</td>
                  <td className="text-right tabular-nums">{number(s.items_sold)}</td>
                  <td className="text-right tabular-nums font-semibold text-gold">{money(s.amount_sold)}</td>
                  <td className="text-right tabular-nums">{money(s.avg_ticket)}</td>
                  <td className="text-fg-muted">{s.top_product ?? '—'}</td>
                  <td className="whitespace-nowrap text-xs text-fg-muted">{s.first_activity ? `${fmtTime(s.first_activity)} – ${fmtTime(s.last_activity)}` : '—'}</td>
                </tr>))}</tbody>
            </Table>
          </>
        )}
      </Card>
    </div>
  );
}
