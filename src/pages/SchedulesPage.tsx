import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, Clock } from 'lucide-react';
import { Button, Card, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Select, useConfirm } from '@/components/ui';
import { useInvalidatingMutation, useSchedules, useUsers } from '@/lib/queries';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { fmtDay, localDate, shiftDate } from '@/lib/format';
import { initials } from '@/components/layout/AppShell';
import { cn } from '@/lib/cn';
import type { Schedule } from '@shared/types';

function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  return shiftDate(date, -dow);
}
const fmtHour = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };

export function SchedulesPage() {
  const { isAdmin, user } = useAuth();
  const today = localDate();
  const [start, setStart] = useState(weekStart(today));
  const end = shiftDate(start, 6);
  const { data, isLoading } = useSchedules({ from: start, to: end });
  const [adding, setAdding] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const del = useInvalidatingMutation((id: number) => api.delete(`/schedules/${id}`), [['schedules']]);
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(start, i));
  const mine = (data ?? []).filter((s) => s.user_id === user?.id);
  const isThisWeek = start === weekStart(today);

  const remove = async (s: Schedule) => {
    if (await confirm({ title: 'Eliminar turno', message: `${s.user_name} · ${fmtDay(s.work_date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${fmtHour(s.start_time)} a ${fmtHour(s.end_time)}`, danger: true, confirmText: 'Eliminar' })) {
      try { await del.mutateAsync(s.id); toast.success('Turno eliminado'); } catch (e) { toast.error((e as Error).message); }
    }
  };

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="Turnos" subtitle={isAdmin ? 'Programa quién trabaja cada día. Los meseros lo ven en su celular.' : 'Tus turnos aparecen resaltados en dorado.'}
        actions={isAdmin && <Button variant="primary" icon={Plus} onClick={() => setAdding(isThisWeek ? today : start)}>Agregar turno</Button>} />

      {/* Navegación de semana */}
      <div className="flex items-center justify-between rounded-2xl border border-line bg-surface p-2">
        <Button size="sm" icon={ChevronLeft} onClick={() => setStart(shiftDate(start, -7))} aria-label="Semana anterior" />
        <div className="text-center">
          <div className="text-sm font-semibold">{fmtDay(start, { day: 'numeric', month: 'short' })} – {fmtDay(end, { day: 'numeric', month: 'short' })}</div>
          <button type="button" onClick={() => setStart(weekStart(today))} className={cn('text-xs', isThisWeek ? 'text-fg-faint' : 'text-gold hover:underline')}>{isThisWeek ? 'Esta semana' : 'Volver a esta semana'}</button>
        </div>
        <Button size="sm" icon={ChevronRight} onClick={() => setStart(shiftDate(start, 7))} aria-label="Semana siguiente" />
      </div>

      {!isAdmin && !isLoading && (
        <Card className="border-gold/30">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Mis turnos esta semana</div>
          {mine.length === 0 ? <p className="mt-1 text-sm text-fg-muted">No tienes turnos programados en esta semana.</p> : (
            <ul className="mt-2 space-y-1 text-sm">{mine.map((s) => <li key={s.id} className="flex items-center gap-2"><Clock className="h-4 w-4 text-gold" /><span className="capitalize">{fmtDay(s.work_date, { weekday: 'long', day: 'numeric' })}</span><span className="text-fg-muted">{fmtHour(s.start_time)} – {fmtHour(s.end_time)}</span></li>)}</ul>
          )}
        </Card>
      )}

      {isLoading ? <PageLoader /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
          {days.map((d) => {
            const items = (data ?? []).filter((s) => s.work_date === d);
            const isToday = d === today;
            return (
              <Card key={d} className={cn('p-3', isToday && 'border-gold/50 ring-1 ring-gold/20')}>
                <div className="mb-2 flex items-center justify-between">
                  <div><div className={cn('text-xs font-semibold uppercase tracking-wider', isToday ? 'text-gold' : 'text-fg-muted')}>{fmtDay(d, { weekday: 'long' })}{isToday && ' · hoy'}</div><div className="whitespace-nowrap text-lg font-bold leading-tight">{fmtDay(d, { day: 'numeric', month: 'short' })}</div></div>
                  {isAdmin && <button type="button" onClick={() => setAdding(d)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 text-fg-muted hover:bg-gold/15 hover:text-gold" aria-label="Agregar turno este día"><Plus className="h-4 w-4" /></button>}
                </div>
                {items.length === 0 ? <p className="rounded-lg border border-dashed border-line px-2 py-3 text-center text-xs text-fg-faint">Sin turnos</p> : (
                  <ul className="space-y-1.5">
                    {items.map((s) => {
                      const me = s.user_id === user?.id;
                      return (
                        <li key={s.id} className={cn('flex items-center gap-2 rounded-xl border px-2 py-2 text-xs', me ? 'border-gold/50 bg-gold/10' : 'border-line bg-surface-2')}>
                          <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', me ? 'bg-gold text-gold-ink' : 'bg-surface-3 text-fg-muted')}>{initials(s.user_name)}</div>
                          <div className="min-w-0 flex-1"><div className="truncate font-semibold">{s.user_name.split(' ').slice(0, 2).join(' ')}</div><div className="text-fg-muted">{fmtHour(s.start_time)} – {fmtHour(s.end_time)}</div>{s.notes && <div className="truncate text-fg-faint">{s.notes}</div>}</div>
                          {isAdmin && <button type="button" className="rounded-lg p-1.5 text-fg-faint hover:text-danger" aria-label="Eliminar" onClick={() => remove(s)}><Trash2 className="h-3.5 w-3.5" /></button>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {isAdmin && !isLoading && (data ?? []).length === 0 && <EmptyState icon={CalendarDays} title="Esta semana no tiene turnos" text="Usa “Agregar turno” y marca “repetir cada semana” para programar el horario fijo del equipo." />}
      {isAdmin && <AddModal key={adding ?? 'closed'} date={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function AddModal({ date, onClose }: { date: string | null; onClose: () => void }) {
  const { data: users } = useUsers();
  const toast = useToast();
  const [day, setDay] = useState(date ?? localDate());
  const [userId, setUserId] = useState('');
  const [startT, setStartT] = useState('18:00');
  const [endT, setEndT] = useState('02:00');
  const [notes, setNotes] = useState('');
  const [repeat, setRepeat] = useState('1');
  const m = useInvalidatingMutation((b: object) => api.post('/schedules', b), [['schedules']]);
  const active = (users ?? []).filter((u) => u.is_active === 1);
  const weeks = Number(repeat) || 1;
  return (
    <Modal open={!!date} onClose={onClose} title="Agregar turno" size="sm"
      footer={<Button full size="lg" variant="primary" loading={m.isPending} disabled={!userId || !day} onClick={async () => { try { await m.mutateAsync({ user_id: Number(userId), work_date: day, start_time: startT, end_time: endT, notes: notes || undefined, repeat_weeks: weeks }); toast.success(weeks > 1 ? `Turno programado para ${weeks} semanas` : 'Turno agregado'); onClose(); } catch (e) { toast.error((e as Error).message); } }}>
        {weeks > 1 ? `Programar ${weeks} semanas` : 'Agregar turno'}</Button>}>
      <div className="space-y-4">
        <Field label="Persona"><Select autoFocus value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Selecciona a alguien</option>{active.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</Select></Field>
        <Field label="Día"><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Entra"><Input type="time" value={startT} onChange={(e) => setStartT(e.target.value)} /></Field><Field label="Sale"><Input type="time" value={endT} onChange={(e) => setEndT(e.target.value)} /></Field></div>
        <Field label="Repetir cada semana" hint="Útil para horarios fijos: crea el mismo turno el mismo día de las próximas semanas.">
          <Select value={repeat} onChange={(e) => setRepeat(e.target.value)}>
            <option value="1">No, solo este día</option>
            {[2, 3, 4, 6, 8, 12].map((n) => <option key={n} value={n}>Sí, durante {n} semanas</option>)}
          </Select>
        </Field>
        <Field label="Nota (opcional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: cubre la barra" maxLength={120} /></Field>
      </div>
    </Modal>
  );
}
