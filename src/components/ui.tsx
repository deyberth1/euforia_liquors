import { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { localDate, shiftDate } from '@/lib/format';

/* ---------- Botones ---------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'success';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const variantCls: Record<Variant, string> = {
  primary: 'bg-gradient-to-b from-gold-bright to-gold text-gold-ink font-semibold shadow-[0_6px_20px_-8px_rgba(217,180,91,0.6)] hover:brightness-105 active:brightness-95',
  secondary: 'bg-surface-2 border border-line text-fg hover:bg-surface-3',
  outline: 'border border-gold/50 text-gold hover:bg-gold/10',
  ghost: 'text-fg-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-danger/15 border border-danger/40 text-danger hover:bg-danger/25',
  success: 'bg-ok/15 border border-ok/40 text-ok hover:bg-ok/25',
};
const sizeCls: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm rounded-lg gap-1.5',
  md: 'h-11 px-4 text-sm rounded-xl gap-2',
  lg: 'h-12 px-5 text-base rounded-xl gap-2',
  xl: 'h-14 px-6 text-lg rounded-2xl gap-2.5',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: Size; loading?: boolean; icon?: LucideIcon; full?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon: Icon, full, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref} type={type} disabled={disabled || loading}
      className={cn('inline-flex items-center justify-center font-medium transition select-none disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        variantCls[variant], sizeCls[size], full && 'w-full', className)}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className={cn(size === 'sm' ? 'h-4 w-4' : 'h-5 w-5')} /> : null}
      {children}
    </button>
  );
});

export function IconButton({ icon: Icon, label, className, size = 'md', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; size?: 'sm' | 'md' }) {
  return (
    <button type="button" aria-label={label} title={label}
      className={cn('inline-flex items-center justify-center rounded-xl text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40',
        size === 'sm' ? 'h-9 w-9' : 'h-11 w-11', className)} {...rest}>
      <Icon className="h-5 w-5" />
    </button>
  );
}

/* ---------- Campos ---------- */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn('input', className)} {...rest} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn('input h-auto min-h-[88px] py-3', className)} {...rest} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cn('input appearance-none pr-10', className)} {...rest}>{children}</select>
      <svg className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" viewBox="0 0 20 20" fill="none"><path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </div>
  );
});

export function Field({ label, hint, error, children, className }: { label?: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-fg-faint">{hint}</span> : null}
    </label>
  );
}

/** Campo de dinero en pesos: muestra separadores de miles, guarda un entero. */
export function MoneyInput({ value, onChange, className, autoFocus, placeholder = '$ 0', ...rest }:
  { value: number | null; onChange: (n: number | null) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const display = value == null || Number.isNaN(value) ? '' : `$ ${new Intl.NumberFormat('es-CO').format(value)}`;
  return (
    <input
      inputMode="numeric" autoComplete="off" autoFocus={autoFocus} placeholder={placeholder}
      className={cn('input font-semibold tabular-nums', className)}
      value={display}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '');
        onChange(digits ? Number(digits) : null);
      }}
      {...rest}
    />
  );
}

/* ---------- Superficies ---------- */
export function Card({ className, children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  return <div className={cn('card p-4 sm:p-5', onClick && 'cursor-pointer transition hover:border-line-strong', className)} onClick={onClick}>{children}</div>;
}
export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-start justify-between gap-3', className)}>
      <div><h3 className="text-base font-semibold text-fg">{title}</h3>{subtitle && <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p>}</div>
      {action}
    </div>
  );
}

type Tone = 'gold' | 'ok' | 'warn' | 'danger' | 'muted' | 'info';
const toneCls: Record<Tone, string> = {
  gold: 'bg-gold/15 text-gold border-gold/30', ok: 'bg-ok/15 text-ok border-ok/30', warn: 'bg-warn/15 text-warn border-warn/30',
  danger: 'bg-danger/15 text-danger border-danger/30', muted: 'bg-surface-3 text-fg-muted border-line', info: 'bg-info/15 text-info border-info/30',
};
export function Badge({ tone = 'muted', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold', toneCls[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}{children}
    </span>
  );
}

export function Stat({ label, value, hint, tone = 'gold', className, icon: Icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; className?: string; icon?: LucideIcon }) {
  const color = { gold: 'text-gold', ok: 'text-ok', warn: 'text-warn', danger: 'text-danger', muted: 'text-fg', info: 'text-info' }[tone];
  return (
    <div className={cn('card p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
        {Icon && <Icon className={cn('h-4 w-4', color)} />}
      </div>
      <div className={cn('mt-2 text-2xl font-bold tabular-nums leading-none', color)}>{value}</div>
      {hint && <div className="mt-2 text-xs text-fg-muted">{hint}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, action, className }: { icon?: LucideIcon; title: string; text?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-12 text-center', className)}>
      {Icon && <div className="mb-3 rounded-2xl bg-surface-2 p-3"><Icon className="h-6 w-6 text-fg-muted" /></div>}
      <p className="font-semibold text-fg">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-fg-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) { return <Loader2 className={cn('h-5 w-5 animate-spin text-gold', className)} />; }
export function PageLoader() { return <div className="flex items-center justify-center py-20"><Spinner className="h-7 w-7" /></div>; }

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-2">
        {back}
        <div>
          <h1 className="text-xl font-bold tracking-tight text-fg sm:text-2xl">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, className, size = 'md' }:
  { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div className={cn('inline-flex rounded-xl bg-surface-2 p-1 border border-line', className)}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cn('rounded-lg font-medium transition whitespace-nowrap', size === 'sm' ? 'px-3 h-8 text-xs' : 'px-4 h-9 text-sm',
            value === o.value ? 'bg-gold text-gold-ink shadow' : 'text-fg-muted hover:text-fg')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Modal / hoja inferior ---------- */
export function Modal({ open, onClose, title, children, footer, size = 'md', className }:
  { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'full'; className?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  const width = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', full: 'sm:max-w-4xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn('relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-line bg-surface shadow-2xl animate-sheet-up sm:rounded-2xl sm:animate-fade-up', width, className)}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-line-strong sm:hidden" />
        {(
          <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-2 sm:pt-5">
            <h2 className="text-lg font-semibold text-fg">{title}</h2>
            <IconButton icon={X} label="Cerrar" size="sm" onClick={onClose} />
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="border-t border-line px-5 py-4 safe-bottom">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Confirmación ---------- */
interface ConfirmOpts { title: string; message?: ReactNode; confirmText?: string; cancelText?: string; danger?: boolean }
const ConfirmCtx = createContext<((o: ConfirmOpts) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal open={!!state} onClose={() => close(false)} title={state?.title} size="sm"
        footer={<div className="flex gap-2"><Button full onClick={() => close(false)}>{state?.cancelText ?? 'Cancelar'}</Button><Button full variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{state?.confirmText ?? 'Confirmar'}</Button></div>}>
        {state?.message && <p className="text-sm text-fg-muted">{state.message}</p>}
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export function useConfirm() {
  const v = useContext(ConfirmCtx);
  if (!v) throw new Error('useConfirm fuera de ConfirmProvider');
  return v;
}

/* ---------- Rango de fechas ---------- */
export interface DateRange { from: string; to: string }
export function useDateRange(initial: 'today' | 'week' | 'month' = 'today') {
  const today = localDate();
  const presets = useMemo(() => ({
    today: { from: today, to: today },
    yesterday: { from: shiftDate(today, -1), to: shiftDate(today, -1) },
    week: { from: shiftDate(today, -6), to: today },
    month: { from: `${today.slice(0, 7)}-01`, to: today },
  }), [today]);
  const [range, setRange] = useState<DateRange>(presets[initial]);
  return { range, setRange, presets };
}

export function DateRangePicker({ range, onChange, presets, className }: { range: DateRange; onChange: (r: DateRange) => void; presets: ReturnType<typeof useDateRange>['presets']; className?: string }) {
  const active = (Object.keys(presets) as (keyof typeof presets)[]).find((k) => presets[k].from === range.from && presets[k].to === range.to);
  const labels: Record<keyof typeof presets, string> = { today: 'Hoy', yesterday: 'Ayer', week: '7 días', month: 'Este mes' };
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="inline-flex rounded-xl bg-surface-2 p-1 border border-line">
        {(Object.keys(presets) as (keyof typeof presets)[]).map((k) => (
          <button key={k} type="button" onClick={() => onChange(presets[k])}
            className={cn('h-8 rounded-lg px-3 text-xs font-medium transition', active === k ? 'bg-gold text-gold-ink' : 'text-fg-muted hover:text-fg')}>{labels[k]}</button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input type="date" className="input h-9 w-auto px-2 text-sm" value={range.from} max={range.to} onChange={(e) => e.target.value && onChange({ ...range, from: e.target.value })} />
        <span className="text-fg-faint">–</span>
        <input type="date" className="input h-9 w-auto px-2 text-sm" value={range.to} min={range.from} onChange={(e) => e.target.value && onChange({ ...range, to: e.target.value })} />
      </div>
    </div>
  );
}

/* ---------- Búsqueda con foco automático opcional ---------- */
export function SearchInput({ value, onChange, placeholder = 'Buscar…', autoFocus, className }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  return (
    <div className={cn('relative', className)}>
      <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" /></svg>
      <input ref={ref} className="input pl-10 pr-9" type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {value && <button type="button" aria-label="Limpiar" onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-fg-muted hover:text-fg"><X className="h-4 w-4" /></button>}
    </div>
  );
}

/* ---------- Tabla simple ---------- */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('overflow-x-auto rounded-xl border border-line', className)}><table className="w-full text-sm [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-fg-muted [&_th]:bg-surface-2 [&_td]:px-3 [&_td]:py-2.5 [&_td]:border-t [&_td]:border-line [&_tr:hover_td]:bg-surface-2/50">{children}</table></div>;
}
