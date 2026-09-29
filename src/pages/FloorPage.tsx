import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Receipt, Armchair, Wine, Lock, Unlock, BellRing } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, PageLoader, useConfirm } from '@/components/ui';
import { useCash, useFloor, useInvalidatingMutation, keys } from '@/lib/queries';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { useAuth } from '@/lib/auth';
import { money, plural, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { FloorTable, Order } from '@shared/types';

export function FloorPage() {
  const { data, isLoading } = useFloor();
  const { data: cash, isLoading: cashLoading } = useCash();
  const cashClosed = !cashLoading && !cash;
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { isAdmin } = useAuth();
  const [labelOpen, setLabelOpen] = useState(false);
  const [label, setLabel] = useState('');

  const openOrder = useInvalidatingMutation(
    (body: { table_id?: number; label?: string }) => api.post<Order>('/orders', body),
    [keys.floor],
  );

  const onTable = async (t: FloorTable) => {
    if (t.order) { nav(`/cuenta/${t.order.id}`); return; }
    if (cashClosed) { toast.error(isAdmin ? 'La caja está cerrada. Ábrela antes de abrir mesas.' : 'La caja está cerrada. Pide al administrador que la abra.'); return; }
    const ok = await confirm({ title: `Abrir ${t.name}`, message: 'Se creará una cuenta nueva para esta mesa.', confirmText: 'Abrir mesa' });
    if (!ok) return;
    try {
      const o = await openOrder.mutateAsync({ table_id: t.id });
      nav(`/cuenta/${o.id}`);
    } catch (e) { toast.error((e as Error).message); }
  };

  const createLoose = async () => {
    if (!label.trim()) return;
    if (cashClosed) { toast.error('La caja está cerrada.'); return; }
    try {
      const o = await openOrder.mutateAsync({ label: label.trim() });
      setLabelOpen(false); setLabel('');
      nav(`/cuenta/${o.id}`);
    } catch (e) { toast.error((e as Error).message); }
  };

  if (isLoading || !data) return <PageLoader />;
  const occupied = data.tables.filter((t) => t.order).length;
  const toCollect = data.tables.filter((t) => t.order?.bill_requested_at).length;
  const pending = data.tables.reduce((s, t) => s + (t.order?.total ?? 0), 0) + data.looseOrders.reduce((s, o) => s + o.total, 0);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Mesas"
        subtitle={<>{occupied} de {data.tables.length} ocupadas{pending > 0 && <> · <span className="text-gold font-semibold">{money(pending)}</span> abiertos</>}{toCollect > 0 && <> · <span className="font-semibold text-warn">{plural(toCollect, 'mesa pide cobrar', 'mesas piden cobrar')}</span></>} <span className="text-fg-faint">· se actualiza sola</span></>}
        actions={<>
          <Button size="sm" variant="outline" icon={Plus} onClick={() => setLabelOpen(true)}>Cuenta sin mesa</Button>
        </>}
      />

      {cashClosed && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <Lock className="h-5 w-5 shrink-0 text-warn" />
          <div className="min-w-0 flex-1"><b className="text-warn">Caja cerrada.</b> {isAdmin ? 'Abre la caja para poder abrir mesas y cobrar.' : 'Pide al administrador que abra la caja para empezar a atender mesas.'}</div>
          {isAdmin && <Link to="/caja"><Button size="sm" variant="primary" icon={Unlock}>Abrir caja</Button></Link>}
        </div>
      )}

      {data.tables.length === 0 ? (
        <EmptyState icon={Armchair} title="No hay mesas configuradas" text={isAdmin ? 'Crea las mesas desde Inventario → Mesas.' : 'Pide al administrador que configure las mesas.'} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {data.tables.map((t) => <TableCard key={t.id} table={t} locked={cashClosed} onClick={() => onTable(t)} />)}
        </div>
      )}

      {data.looseOrders.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-fg-muted">Cuentas sin mesa</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.looseOrders.map((o) => (
              <button key={o.id} type="button" onClick={() => nav(`/cuenta/${o.id}`)} className="card flex items-center gap-3 p-4 text-left transition hover:border-gold/50">
                <div className="rounded-xl bg-gold/12 p-2.5 text-gold"><Receipt className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{o.label || `Cuenta #${o.id}`}</div>
                  <div className="text-xs text-fg-muted">{o.opened_by_name} · hace {timeAgo(o.opened_at)} · {plural(o.items_count, 'ítem', 'ítems')}</div>
                </div>
                <div className="font-bold tabular-nums text-gold">{money(o.total)}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      <Modal open={labelOpen} onClose={() => setLabelOpen(false)} title="Cuenta sin mesa" size="sm"
        footer={<Button full variant="primary" size="lg" onClick={createLoose} loading={openOrder.isPending} disabled={!label.trim()}>Abrir cuenta</Button>}>
        <p className="mb-3 text-sm text-fg-muted">Para clientes en la barra, pedidos para llevar o ventas directas.</p>
        <Field label="Nombre de la cuenta"><Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ej: Carlos, Para llevar, Barra…" maxLength={60} onKeyDown={(e) => e.key === 'Enter' && createLoose()} /></Field>
      </Modal>
    </div>
  );
}

function TableCard({ table, locked, onClick }: { table: FloorTable; locked: boolean; onClick: () => void }) {
  const o = table.order;
  const Icon = table.type === 'bar' ? Wine : Armchair;
  return (
    <button type="button" onClick={onClick}
      className={cn('card group relative flex min-h-[124px] flex-col justify-between p-4 text-left transition active:scale-[0.98]',
        o?.bill_requested_at ? 'border-warn/60 bg-[linear-gradient(160deg,rgba(245,185,66,0.14),transparent_60%)] hover:border-warn' : o ? 'border-gold/40 bg-[linear-gradient(160deg,rgba(217,180,91,0.10),transparent_60%)] hover:border-gold' : locked ? 'opacity-60' : 'hover:border-ok/50')}>
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <div>
          <div className="text-base font-bold leading-tight sm:text-lg">{table.name}</div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-fg-faint"><Icon className="h-3 w-3" />{table.type === 'bar' ? 'Barra' : `${table.capacity} puestos`}</div>
        </div>
        <Badge tone={o?.bill_requested_at ? 'warn' : o ? 'gold' : 'ok'} dot>{o?.bill_requested_at ? 'Por cobrar' : o ? 'Ocupada' : 'Libre'}</Badge>
      </div>
      {o ? (
        <div className="mt-3">
          <div className={cn('text-xl font-bold tabular-nums', o.bill_requested_at ? 'text-warn' : 'text-gold')}>{money(o.total)}</div>
          <div className="mt-0.5 truncate text-xs text-fg-muted">{o.label && <span className="text-gold">{o.label} · </span>}{plural(o.items_count, 'ítem', 'ítems')} · {o.opened_by_name.split(' ')[0]} · {timeAgo(o.opened_at)}</div>
          {o.bill_requested_at && <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-warn"><BellRing className="h-3 w-3" />Pidió la cuenta · {o.bill_requested_by_name?.split(' ')[0]}</div>}
        </div>
      ) : (
        <div className={cn('mt-3 flex items-center gap-1 text-xs font-medium text-fg-faint transition', !locked && 'group-hover:text-ok')}>{locked ? <><Lock className="h-3 w-3" />Caja cerrada</> : 'Toca para abrir'}</div>
      )}
    </button>
  );
}
