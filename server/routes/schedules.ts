import { Hono } from 'hono';
import { z } from 'zod';
import { all, getClient, nowIso, one, run } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { idParam, isDate, parseBody, todayLocal } from '../util.js';
import { requireAdmin, type Env } from '../auth.js';
import type { Schedule } from '../../shared/types.js';

const schedules = new Hono<Env>();

schedules.get('/schedules', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  const f = isDate(from) ? from : todayLocal();
  const t = isDate(to) ? to : f;
  const rows = await all<Schedule>(
    getClient(),
    `SELECT s.*, u.full_name AS user_name FROM schedules s JOIN users u ON u.id = s.user_id
     WHERE s.work_date >= ? AND s.work_date <= ? ORDER BY s.work_date, s.start_time, u.full_name`,
    [f, t],
  );
  return c.json(rows);
});

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const schema = z.object({
  user_id: z.number().int().positive(),
  work_date: z.string(),
  start_time: z.string().regex(TIME_RE, 'Hora inválida'),
  end_time: z.string().regex(TIME_RE, 'Hora inválida'),
  notes: z.string().trim().max(120).optional(),
  repeat_weeks: z.number().int().min(1).max(12).default(1),
});

schedules.post('/schedules', requireAdmin, async (c) => {
  const body = await parseBody(c, schema);
  if (!isDate(body.work_date)) throw badRequest('Fecha inválida');
  const db = getClient();
  const ids: number[] = [];
  for (let w = 0; w < body.repeat_weeks; w++) {
    const d = new Date(`${body.work_date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + w * 7);
    const date = d.toISOString().slice(0, 10);
    const dup = await one(db, 'SELECT id FROM schedules WHERE user_id = ? AND work_date = ? AND start_time = ?', [body.user_id, date, body.start_time]);
    if (dup) continue;
    const { lastId } = await run(db, 'INSERT INTO schedules (user_id, work_date, start_time, end_time, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      body.user_id, date, body.start_time, body.end_time, body.notes ?? null, nowIso(),
    ]);
    ids.push(lastId);
  }
  return c.json({ ids }, 201);
});

schedules.delete('/schedules/:id', requireAdmin, async (c) => {
  const { changes } = await run(getClient(), 'DELETE FROM schedules WHERE id = ?', [idParam(c)]);
  if (!changes) throw notFound('Turno no encontrado');
  return c.json({ ok: true });
});

export default schedules;
