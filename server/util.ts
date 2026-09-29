import type { Context } from 'hono';
import type { ZodType } from 'zod';
import { badRequest } from './errors.js';

/** Zona horaria del negocio. Colombia no tiene horario de verano: siempre UTC-5. */
export const TZ_OFFSET_HOURS = 5;

/** Fecha de hoy (YYYY-MM-DD) en hora de Colombia. */
export function todayLocal(d = new Date()): string {
  const shifted = new Date(d.getTime() - TZ_OFFSET_HOURS * 3600_000);
  return shifted.toISOString().slice(0, 10);
}

/** Rango UTC [inicio, fin) que corresponde a un día local YYYY-MM-DD. */
export function dayRangeUtc(date: string): { start: string; end: string } {
  const start = new Date(`${date}T00:00:00.000Z`);
  start.setUTCHours(start.getUTCHours() + TZ_OFFSET_HOURS);
  const end = new Date(start.getTime() + 24 * 3600_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Rango UTC [inicio, fin) para un intervalo de fechas locales inclusivo. */
export function rangeUtc(from: string, to: string) {
  return { start: dayRangeUtc(from).start, end: dayRangeUtc(to).end };
}

/** Expresión SQL que convierte un timestamp ISO UTC a fecha local YYYY-MM-DD. */
export const sqlLocalDate = (col: string) => `date(${col}, '-${TZ_OFFSET_HOURS} hours')`;
export const sqlLocalHour = (col: string) => `CAST(strftime('%H', ${col}, '-${TZ_OFFSET_HOURS} hours') AS INTEGER)`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isDate(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s));
}

export async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('Cuerpo JSON inválido');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.length ? `${first.path.join('.')}: ` : '';
    throw badRequest(`${path}${first?.message ?? 'Datos inválidos'}`, result.error.issues);
  }
  return result.data;
}

export function idParam(c: Context, name = 'id'): number {
  const n = Number(c.req.param(name));
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Parámetro ${name} inválido`);
  return n;
}

/** Redondea a pesos enteros. */
export const cop = (n: unknown) => Math.round(Number(n) || 0);
