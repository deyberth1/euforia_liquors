const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

export const TZ = 'America/Bogota';

export function money(n: number | string | null | undefined): string {
  return cop.format(Math.round(Number(n) || 0));
}
export function number(n: number | string | null | undefined): string {
  return num.format(Math.round(Number(n) || 0));
}

/** Fecha local del negocio (YYYY-MM-DD) para un instante dado. */
export function localDate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('es-CO', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('es-CO', { timeZone: TZ, day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}

/** Formatea una fecha YYYY-MM-DD como texto legible ("lun 29 sep"). */
export function fmtDay(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: '2-digit', month: 'short' }): string {
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', ...opts }).format(new Date(`${date}T00:00:00Z`));
}

export function fmtLongDay(date: string): string {
  return fmtDay(date, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** "hace 12 min", "hace 2 h". */
export function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
  return `${Math.floor(h / 24)} d`;
}

export const PAYMENT_LABEL: Record<string, string> = { cash: 'Efectivo', transfer: 'Transferencia', mixed: 'Mixto', credit: 'Crédito' };
export const ROLE_LABEL: Record<string, string> = { owner: 'Dueño', admin: 'Administrador', waiter: 'Mesero' };

const ROLE_RANK: Record<string, number> = { waiter: 0, admin: 1, owner: 2 };
/** ¿El rol alcanza el mínimo requerido? (dueño > administrador > mesero) */
export const hasRole = (role: string | undefined, min: 'waiter' | 'admin' | 'owner') => (ROLE_RANK[role ?? ''] ?? -1) >= ROLE_RANK[min];
export const ORDER_STATUS_LABEL: Record<string, string> = { open: 'Abierta', paid: 'Pagada', cancelled: 'Cancelada' };

/** Descarga un CSV generado en el navegador. */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/** "1 cuenta", "3 cuentas". */
export function plural(n: number, singular: string, pluralWord = `${singular}s`): string {
  return `${number(n)} ${n === 1 ? singular : pluralWord}`;
}
