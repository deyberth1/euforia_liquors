import { useMemo, useState, type ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';

/* Paleta: una sola serie = oro. Varias categorías = orden fijo, nunca rotado. */
export const GOLD = '#d9b45b';
export const GOLD_BRIGHT = '#f0cf7a';
export const CATEGORICAL = ['#d9b45b', '#6fa8ff', '#3ecf8e', '#ff8a6b', '#b48cff', '#4fd1c5', '#f5b942'];
const GRID = 'rgba(255,255,255,0.06)';
const AXIS = '#6f6a7a';

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.0', '')}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

interface TipProps { active?: boolean; payload?: readonly { value: number; name?: string; dataKey?: string; color?: string; payload: Record<string, unknown> }[]; label?: string | number }

function Tip({ active, payload, title, rows }: TipProps & { title?: (p: Record<string, unknown>) => ReactNode; rows?: (p: Record<string, unknown>) => ReactNode }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-line bg-surface-3 px-3 py-2 text-xs shadow-card">
      {title && <div className="mb-1 text-fg-muted">{title(p)}</div>}
      {rows ? rows(p) : <div className="font-semibold tabular-nums text-fg">{money(payload[0].value)}</div>}
    </div>
  );
}

/** Área de una serie (ingresos por día) con degradado dorado, cuadrícula recesiva y tooltip. */
export function RevenueArea({ data, height = 220, xKey = 'label', yKey = 'total', className, tooltipTitle, tooltipRows }:
  { data: Record<string, unknown>[]; height?: number; xKey?: string; yKey?: string; className?: string; tooltipTitle?: (p: Record<string, unknown>) => ReactNode; tooltipRows?: (p: Record<string, unknown>) => ReactNode }) {
  if (!data.some((d) => Number(d[yKey]) > 0)) return <Empty height={height} className={className} />;
  const interval = Math.max(0, Math.ceil(data.length / 8) - 1);
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gold-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={GOLD} stopOpacity={0.45} /><stop offset="100%" stopColor={GOLD} stopOpacity={0.02} /></linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey={xKey} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} interval={interval} dy={6} />
          <YAxis tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={compact} width={40} />
          <Tooltip cursor={{ stroke: 'rgba(255,255,255,0.15)' }} content={(p) => <Tip {...(p as unknown as TipProps)} title={tooltipTitle} rows={tooltipRows} />} />
          <Area type="monotone" dataKey={yKey} stroke={GOLD} strokeWidth={2} fill="url(#gold-area)" activeDot={{ r: 5, fill: GOLD_BRIGHT, stroke: '#15141a', strokeWidth: 2 }} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Barras verticales de una serie (por hora, por día de la semana). */
export function Bars({ data, height = 200, xKey = 'label', yKey = 'total', className, tooltipTitle, tooltipRows, highlight }:
  { data: Record<string, unknown>[]; height?: number; xKey?: string; yKey?: string; className?: string; tooltipTitle?: (p: Record<string, unknown>) => ReactNode; tooltipRows?: (p: Record<string, unknown>) => ReactNode; highlight?: (p: Record<string, unknown>) => boolean }) {
  if (!data.some((d) => Number(d[yKey]) > 0)) return <Empty height={height} className={className} />;
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey={xKey} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} dy={6} interval={data.length > 14 ? 1 : 0} />
          <YAxis tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={compact} width={40} />
          <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={(p) => <Tip {...(p as unknown as TipProps)} title={tooltipTitle} rows={tooltipRows} />} />
          <Bar dataKey={yKey} radius={[4, 4, 0, 0]} maxBarSize={28}>
            {data.map((d, i) => <Cell key={i} fill={highlight?.(d) ? GOLD_BRIGHT : GOLD} fillOpacity={highlight && !highlight(d) ? 0.7 : 1} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Dona con leyenda directa (identidad por color en orden fijo + etiqueta, nunca solo color). */
export function Donut({ data, height = 200, className, centerLabel, format = money }:
  { data: { name: string; value: number }[]; height?: number; className?: string; centerLabel?: string; format?: (n: number) => string }) {
  const rows = data.filter((d) => d.value > 0);
  const total = rows.reduce((s, d) => s + d.value, 0);
  const [hover, setHover] = useState<number | null>(null);
  if (!rows.length) return <Empty height={height} className={className} />;
  const shown = rows.slice(0, CATEGORICAL.length - 1);
  const rest = rows.slice(CATEGORICAL.length - 1);
  const parts = rest.length ? [...shown, { name: 'Otros', value: rest.reduce((s, d) => s + d.value, 0) }] : shown;
  const active = hover != null ? parts[hover] : null;
  return (
    <div className={cn('@container', className)}>
    <div className="flex flex-col items-center gap-3 @[380px]:flex-row @[380px]:gap-4" style={{ minHeight: height }}>
      <div className="relative h-[160px] w-[160px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={parts} dataKey="value" nameKey="name" innerRadius={52} outerRadius={76} paddingAngle={2} stroke="#15141a" strokeWidth={2} isAnimationActive={false}
              onMouseEnter={(_, i) => setHover(i)} onMouseLeave={() => setHover(null)}>
              {parts.map((_, i) => <Cell key={i} fill={CATEGORICAL[i]} fillOpacity={hover == null || hover === i ? 1 : 0.4} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] uppercase tracking-wider text-fg-muted">{active ? active.name : centerLabel ?? 'Total'}</span>
          <span className="text-sm font-bold tabular-nums text-fg">{format(active ? active.value : total)}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1.5 text-sm">
        {parts.map((d, i) => (
          <li key={i} className={cn('flex items-center gap-2 transition', hover != null && hover !== i && 'opacity-50')} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: CATEGORICAL[i] }} />
            <span className="min-w-0 flex-1 truncate text-fg">{d.name}</span>
            <span className="tabular-nums text-fg-muted">{Math.round((d.value / total) * 100)}%</span>
            <span className="w-20 text-right tabular-nums font-semibold text-fg">{format(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
    </div>
  );
}

/** Ranking con barras horizontales (productos, meseros, categorías). */
export function RankList({ rows, format = money, max: maxProp, className, limit = 8 }:
  { rows: { label: string; value: number; hint?: string }[]; format?: (n: number) => string; max?: number; className?: string; limit?: number }) {
  const list = rows.slice(0, limit);
  const max = maxProp ?? Math.max(1, ...list.map((r) => r.value));
  if (list.length === 0) return <p className="py-6 text-center text-sm text-fg-faint">Sin datos en este periodo</p>;
  return (
    <ul className={cn('space-y-2.5', className)}>
      {list.map((r, i) => (
        <li key={i} className="text-sm">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-fg"><span className="w-4 shrink-0 text-right text-xs tabular-nums text-fg-faint">{i + 1}</span><span className="truncate">{r.label}</span>{r.hint && <span className="shrink-0 text-xs text-fg-faint">{r.hint}</span>}</span>
            <span className="shrink-0 font-semibold tabular-nums text-fg">{format(r.value)}</span>
          </div>
          <div className="ml-6 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-gold transition-[width]" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

/** Mini serie para las tarjetas de indicadores. */
export function Sparkline({ data, height = 36, className }: { data: number[]; height?: number; className?: string }) {
  const rows = useMemo(() => data.map((v, i) => ({ i, v })), [data]);
  if (!data.some((v) => v > 0)) return null;
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs><linearGradient id="spark" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={GOLD} stopOpacity={0.35} /><stop offset="100%" stopColor={GOLD} stopOpacity={0} /></linearGradient></defs>
          <Area type="monotone" dataKey="v" stroke={GOLD} strokeWidth={1.5} fill="url(#spark)" dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Variación porcentual con signo y color (texto + flecha, no solo color). */
export function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  if (!before && !now) return <span className="text-xs text-fg-faint">sin referencia</span>;
  if (!before) return <span className="text-xs text-fg-muted">{label}: sin ventas</span>;
  const pct = Math.round(((now - before) / before) * 100);
  const up = pct >= 0;
  return <span className={cn('text-xs font-medium tabular-nums', up ? 'text-ok' : 'text-danger')}>{up ? '▲' : '▼'} {Math.abs(pct)}% <span className="font-normal text-fg-muted">{label}</span></span>;
}

/** Dos segmentos (efectivo vs transferencia) con etiqueta directa. */
export function SplitBar({ a, b, labelA, labelB, format = money }: { a: number; b: number; labelA: string; labelB: string; format?: (n: number) => string }) {
  const total = a + b;
  const pa = total ? (a / total) * 100 : 50;
  return (
    <div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-3">
        {total > 0 && <div className="h-full rounded-l-full" style={{ width: `${pa}%`, background: CATEGORICAL[0] }} />}
        {total > 0 && <div className="h-full rounded-r-full" style={{ width: `${100 - pa}%`, background: CATEGORICAL[1] }} />}
      </div>
      <div className="mt-2 flex justify-between text-xs">
        <span className="flex items-center gap-1.5 text-fg-muted"><span className="h-2 w-2 rounded-sm" style={{ background: CATEGORICAL[0] }} />{labelA} <b className="tabular-nums text-fg">{format(a)}</b>{total > 0 && <span className="text-fg-faint">({Math.round(pa)}%)</span>}</span>
        <span className="flex items-center gap-1.5 text-fg-muted"><span className="h-2 w-2 rounded-sm" style={{ background: CATEGORICAL[1] }} />{labelB} <b className="tabular-nums text-fg">{format(b)}</b>{total > 0 && <span className="text-fg-faint">({100 - Math.round(pa)}%)</span>}</span>
      </div>
    </div>
  );
}

function Empty({ height, className }: { height: number; className?: string }) {
  return <div className={cn('flex items-center justify-center rounded-xl border border-dashed border-line text-sm text-fg-faint', className)} style={{ height }}>Sin ventas en este periodo</div>;
}

/** Recorta ceros al inicio y al final de una serie horaria, dejando al menos las horas del negocio. */
export function trimHours<T extends { hour: number; total: number }>(rows: T[], min = 14, max = 3): T[] {
  const order = [...rows.filter((r) => r.hour >= 12), ...rows.filter((r) => r.hour < 12)]; // el día del bar empieza al mediodía
  let first = order.findIndex((r) => r.total > 0);
  let last = order.length - 1 - [...order].reverse().findIndex((r) => r.total > 0);
  if (first === -1) { first = order.findIndex((r) => r.hour === min); last = order.findIndex((r) => r.hour === max); }
  first = Math.min(first, order.findIndex((r) => r.hour === min));
  last = Math.max(last, order.findIndex((r) => r.hour === max));
  return order.slice(first, last + 1);
}

export const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
