import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Minus, Trash2, Banknote, ArrowRightLeft, Printer, Ban, Percent, MoreVertical, Lock, StickyNote, Pencil, Repeat, BellRing, X } from 'lucide-react';
import { Badge, Button, EmptyState, Field, Input, Modal, MoneyInput, PageLoader, Select, Textarea, useConfirm } from '@/components/ui';
import { ProductPicker } from '@/components/ProductPicker';
import { keys, ORDER_RELATED, useFloor, useInvalidatingMutation, useOrder } from '@/lib/queries';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { fmtTime, money, ORDER_STATUS_LABEL, PAYMENT_LABEL, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Order, OrderItem, OrderPayment, Product } from '@shared/types';

export function OrderPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const { user, isAdmin, isOwner } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: order, isLoading } = useOrder(id);
  const [picker, setPicker] = useState(false);
  const [pay, setPay] = useState(false);
  const [move, setMove] = useState(false);
  const [discount, setDiscount] = useState(false);
  const [menu, setMenu] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [request, setRequest] = useState(false);

  const invalidate = [keys.order(id), ...ORDER_RELATED];
  const addItem = useInvalidatingMutation((b: { product_id: number; quantity: number; notes?: string; promo?: boolean }) => api.post<Order>(`/orders/${id}/items`, b), invalidate);
  const setQty = useInvalidatingMutation((b: { itemId: number; quantity: number }) => api.patch<Order>(`/orders/${id}/items/${b.itemId}`, { quantity: b.quantity }), invalidate);
  const cancel = useInvalidatingMutation(() => api.post<Order>(`/orders/${id}/cancel`), invalidate);
  const voidPaid = useInvalidatingMutation(() => api.post<Order>(`/orders/${id}/void`), invalidate);
  const cancelRequest = useInvalidatingMutation(() => api.post<Order>(`/orders/${id}/cancel-request`), invalidate);
  const repeatLast = useInvalidatingMutation(() => api.post<Order>(`/orders/${id}/repeat-last`), invalidate);

  if (isLoading || !order) return <PageLoader />;
  const open = order.status === 'open';
  const title = order.table_name ?? order.label ?? `Cuenta #${order.id}`;
  const requested = open && !!order.bill_requested_at;
  const vibrate = () => { try { navigator.vibrate?.(15); } catch { /* sin soporte */ } };

  const onPick = async (p: Product, quantity: number, notes?: string, promo?: boolean) => {
    try { await addItem.mutateAsync({ product_id: p.id, quantity, notes, promo }); vibrate(); toast.success(promo ? `${quantity} × 2x1 ${p.name}` : `${quantity} × ${p.name}`); }
    catch (e) { toast.error((e as Error).message); throw e; }
  };

  const changeQty = async (item: OrderItem, quantity: number) => {
    if (quantity === 0) {
      const ok = await confirm({ title: `Quitar ${item.product_name}`, message: 'Se devolverá al inventario.', confirmText: 'Quitar', danger: true });
      if (!ok) return;
    }
    try { await setQty.mutateAsync({ itemId: item.id, quantity }); }
    catch (e) { toast.error((e as Error).message); }
  };

  const onCancel = async () => {
    setMenu(false);
    const ok = await confirm({ title: 'Cancelar cuenta', message: 'Los productos volverán al inventario y la mesa quedará libre. Esta acción no se puede deshacer.', confirmText: 'Cancelar cuenta', danger: true });
    if (!ok) return;
    try { await cancel.mutateAsync(undefined); toast.success('Cuenta cancelada'); nav('/mesas'); }
    catch (e) { toast.error((e as Error).message); }
  };

  const onVoid = async () => {
    const ok = await confirm({ title: 'Anular venta cobrada', message: 'Se elimina el ingreso en caja, los productos vuelven al inventario y la cuenta queda como cancelada. Úsalo para corregir un cobro equivocado.', confirmText: 'Anular venta', danger: true });
    if (!ok) return;
    try { await voidPaid.mutateAsync(undefined); toast.success('Venta anulada'); }
    catch (e) { toast.error((e as Error).message); }
  };

  // Solo el administrador cambia cantidades o quita productos. El mesero agrega; si se equivoca, avisa.
  const canEdit = (_it: OrderItem) => open && isAdmin;
  const editable = order.items.filter(canEdit);
  const quantities = editable.reduce<Record<number, number>>((acc, it) => { if (it.product_id) acc[it.product_id] = (acc[it.product_id] ?? 0) + it.quantity; return acc; }, {});
  const removeOne = async (p: Product) => {
    // Preferimos la línea normal sin nota agregada por mí; si no, cualquiera que pueda editar (un 2x1 se quita de a par).
    const candidates = editable.filter((it) => it.product_id === p.id);
    const item = candidates.find((it) => !it.promo && !it.notes && it.added_by === user?.id) ?? candidates.find((it) => !it.promo) ?? candidates[0];
    if (!item) return;
    try { await setQty.mutateAsync({ itemId: item.id, quantity: item.quantity - step(item) }); }
    catch (e) { toast.error((e as Error).message); throw e; }
  };

  return (
    <div className="animate-fade-up pb-28">
      {/* Cabecera */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 border-b border-line bg-ink/90 px-4 py-3 backdrop-blur safe-top sm:-mx-6 sm:-mt-6 sm:px-6">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => nav(-1)} className="rounded-xl p-2 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Volver"><ArrowLeft className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><h1 className="truncate text-lg font-bold">{title}</h1><Badge tone={requested ? 'warn' : open ? 'gold' : order.status === 'paid' ? 'ok' : 'danger'}>{requested ? 'Por cobrar' : ORDER_STATUS_LABEL[order.status]}</Badge></div>
            <p className="truncate text-xs text-fg-muted">{order.table_id && order.label ? <span className="text-gold">{order.label} · </span> : null}Abierta por {order.opened_by_name} · {fmtTime(order.opened_at)} {open && `· hace ${timeAgo(order.opened_at)}`}</p>
          </div>
          {open && <button type="button" onClick={() => setLabelOpen(true)} className="rounded-xl p-2 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Nombre o nota de la mesa"><Pencil className="h-5 w-5" /></button>}
          <button type="button" onClick={() => nav(`/cuenta/${id}/recibo`)} className="rounded-xl p-2 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Ver pre-cuenta"><Printer className="h-5 w-5" /></button>
          {((isAdmin && open) || (isOwner && order.status === 'paid')) && <button type="button" onClick={() => setMenu(true)} className="rounded-xl p-2 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Más opciones"><MoreVertical className="h-5 w-5" /></button>}
        </div>
      </div>

      {requested && (
        <div className="mb-4 rounded-2xl border border-warn/50 bg-warn/10 p-4">
          <div className="flex items-start gap-3">
            <BellRing className="mt-0.5 h-6 w-6 shrink-0 text-warn" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-semibold text-warn">La mesa pidió la cuenta</div>
              <div className="text-fg-muted">Avisó {order.bill_requested_by_name} · {fmtTime(order.bill_requested_at)}{isAdmin ? ' · Cóbrala cuando recibas el pago.' : ' · El administrador la cobrará y cerrará la mesa.'}</div>
            </div>
            <button type="button" onClick={async () => { try { await cancelRequest.mutateAsync(undefined); } catch (e) { toast.error((e as Error).message); } }} className="rounded-lg p-1.5 text-fg-muted hover:text-fg" aria-label="Deshacer"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}
      {order.notes && <div className="mb-4 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn"><StickyNote className="mt-0.5 h-4 w-4 shrink-0" />{order.notes}</div>}

      {/* Ítems */}
      {order.items.length === 0 ? (
        <EmptyState title="La cuenta está vacía" text="Agrega los productos que pida el cliente." action={open && <Button variant="primary" icon={Plus} onClick={() => setPicker(true)}>Agregar productos</Button>} />
      ) : (
        <ul className="card divide-y divide-line overflow-hidden p-0">
          {order.items.map((it) => (
            <li key={it.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold leading-snug">{it.product_name}{it.promo === 1 && <Badge tone="gold" className="ml-2 align-middle">2x1</Badge>}</div>
                  <div className="mt-0.5 text-xs text-fg-muted tabular-nums">{it.promo === 1 ? `${it.quantity / 2} × 2x1 de ${money(it.unit_price * 2)} (${it.quantity} und.)` : `${it.quantity} × ${money(it.unit_price)}`} · {it.added_by_name.split(' ')[0]} · {fmtTime(it.created_at)}</div>
                  {it.notes && <div className="mt-0.5 text-xs text-warn">{it.notes}</div>}
                </div>
                <div className="shrink-0 text-right font-semibold tabular-nums">{money(it.unit_price * it.quantity)}</div>
              </div>
              {canEdit(it) ? (
                <div className="mt-2 flex items-center justify-end gap-1">
                  <button type="button" onClick={() => changeQty(it, it.quantity - step(it))} disabled={setQty.isPending} className="flex h-10 w-12 items-center justify-center rounded-lg bg-surface-2 text-fg-muted hover:text-fg active:bg-surface-3" aria-label={it.quantity === step(it) ? 'Quitar' : 'Menos'}>{it.quantity === step(it) ? <Trash2 className="h-4 w-4 text-danger" /> : <Minus className="h-4 w-4" />}</button>
                  <span className="w-10 text-center text-lg font-bold tabular-nums">{it.quantity}</span>
                  <button type="button" onClick={() => changeQty(it, it.quantity + step(it))} disabled={setQty.isPending} className="flex h-10 w-12 items-center justify-center rounded-lg bg-surface-2 text-fg-muted hover:text-fg active:bg-surface-3" aria-label="Más"><Plus className="h-4 w-4" /></button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {open && !isAdmin && order.items.length > 0 && (
        <p className="mt-2 flex items-center gap-1.5 px-1 text-xs text-fg-faint"><Lock className="h-3 w-3 shrink-0" />¿Te equivocaste en algo? Avísale al administrador para quitarlo y agrega el producto correcto.</p>
      )}

      {open && order.items.length > 0 && (
        <button type="button" onClick={async () => { try { await repeatLast.mutateAsync(undefined); vibrate(); toast.success('Ronda repetida'); } catch (e) { toast.error((e as Error).message); } }} disabled={repeatLast.isPending}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line py-2.5 text-sm font-medium text-fg-muted transition hover:border-gold/50 hover:text-gold">
          <Repeat className="h-4 w-4" />Repetir la última ronda
        </button>
      )}

      {/* Totales */}
      <div className="card mt-4 space-y-1.5 p-4 text-sm">
        {(order.discount > 0 || order.subtotal !== order.total) && <Row label="Subtotal" value={money(order.subtotal)} />}
        {order.discount > 0 && <Row label="Descuento" value={`− ${money(order.discount)}`} className="text-warn" />}
        <div className="flex items-center justify-between pt-1 text-lg"><span className="font-semibold">Total</span><span className="text-2xl font-bold tabular-nums text-gold">{money(order.total)}</span></div>
        {order.status === 'paid' && (
          <div className="mt-2 border-t border-line pt-2 text-xs text-fg-muted">
            {order.payment_method === 'credit' ? <>Cerrada <b className="text-warn">a crédito</b></> : <>Pagada en <b className="text-fg">{PAYMENT_LABEL[order.payment_method ?? '']}</b></>} · {fmtTime(order.closed_at)} · cobró {order.closed_by_name}
            {order.payment_method === 'mixed' && <> · efectivo {money(order.paid_cash)} + transferencia {money(order.paid_transfer)}</>}
            {order.payment_method === 'cash' && order.cash_received != null && <> · recibido {money(order.cash_received)} · cambio {money(order.cash_received - order.total)}</>}
            {order.payment_method === 'credit' && order.credit_id && <> · <Link to="/creditos" className="text-gold hover:underline">ver en Créditos</Link></>}
          </div>
        )}
      </div>

      {/* Acciones */}
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 p-3 backdrop-blur safe-bottom md:left-64">
          <div className="mx-auto flex max-w-6xl gap-2">
            <Button size="xl" variant={isAdmin || (order.items.length > 0 && !requested) ? 'secondary' : 'primary'} icon={Plus} onClick={() => setPicker(true)} className={isAdmin || order.items.length > 0 ? 'shrink-0 px-4 sm:px-5' : 'flex-1'} aria-label="Agregar productos"><span className={isAdmin || order.items.length > 0 ? 'hidden sm:inline' : ''}>Agregar</span></Button>
            {isAdmin ? (
              <Button size="xl" variant="primary" icon={Banknote} onClick={() => setPay(true)} disabled={order.items.length === 0} className="min-w-0 flex-1 text-base"><span className="truncate">Cobrar {money(order.total)}</span></Button>
            ) : order.items.length > 0 && (
              requested ? <Button size="xl" variant="secondary" icon={BellRing} disabled className="min-w-0 flex-1 text-base"><span className="truncate">Cuenta pedida · {money(order.total)}</span></Button>
                : <Button size="xl" variant="primary" icon={BellRing} onClick={() => setRequest(true)} className="min-w-0 flex-1 text-base"><span className="truncate">Pedir la cuenta · {money(order.total)}</span></Button>
            )}
          </div>
        </div>
      )}

      <ProductPicker open={picker} onClose={() => setPicker(false)} onPick={onPick} quantities={isAdmin ? quantities : order.items.reduce<Record<number, number>>((acc, it) => { if (it.product_id) acc[it.product_id] = (acc[it.product_id] ?? 0) + it.quantity; return acc; }, {})} onRemove={isAdmin ? removeOne : undefined} title={`Agregar a ${title}`} total={order.total} />
      {isAdmin && <PayModal open={pay} onClose={() => setPay(false)} order={order} onPaid={() => { setPay(false); nav('/mesas'); }} />}
      <RequestModal open={request} onClose={() => setRequest(false)} order={order} />
      <LabelModal key={order.label ?? ''} open={labelOpen} onClose={() => setLabelOpen(false)} order={order} />
      {isAdmin && <MoveModal open={move} onClose={() => setMove(false)} order={order} />}
      {isAdmin && <DiscountModal open={discount} onClose={() => setDiscount(false)} order={order} />}

      <Modal open={menu} onClose={() => setMenu(false)} title="Opciones de la cuenta" size="sm">
        <div className="grid gap-2">
          {isOwner && order.status === 'paid' && <Button size="lg" variant="danger" icon={Ban} onClick={() => { setMenu(false); onVoid(); }} className="justify-start">Anular esta venta</Button>}
          {open && <Button size="lg" icon={Percent} onClick={() => { setMenu(false); setDiscount(true); }} className="justify-start">Descuento y notas</Button>}
          {open && <Button size="lg" icon={ArrowRightLeft} onClick={() => { setMenu(false); setMove(true); }} className="justify-start">Mover a otra mesa</Button>}
          <Button size="lg" icon={Printer} onClick={() => nav(`/cuenta/${id}/recibo`)} className="justify-start">{open ? 'Imprimir pre-cuenta' : 'Imprimir recibo'}</Button>
          {open && <Button size="lg" variant="danger" icon={Ban} onClick={onCancel} className="justify-start">Cancelar cuenta</Button>}
        </div>
      </Modal>
    </div>
  );
}

/** Las líneas 2x1 se suben o bajan de a par (2 botellas). */
const step = (it: OrderItem) => (it.promo === 1 ? 2 : 1);

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return <div className={cn('flex justify-between text-fg-muted', className)}><span>{label}</span><span className="tabular-nums">{value}</span></div>;
}

function PayModal({ open, onClose, order, onPaid }: { open: boolean; onClose: () => void; order: Order; onPaid: () => void }) {
  const toast = useToast();
  const [method, setMethod] = useState<OrderPayment>('cash');
  const [received, setReceived] = useState<number | null>(null);
  const [disc, setDisc] = useState<number | null>(order.discount || null);
  const [cashPart, setCashPart] = useState<number | null>(null);
  const [party, setParty] = useState('');
  const [due, setDue] = useState('');
  const pay = useInvalidatingMutation((b: object) => api.post<Order>(`/orders/${order.id}/pay`, b), [keys.order(order.id), ...ORDER_RELATED, ['credits']]);
  const total = Math.max(0, order.subtotal - (disc ?? 0));
  const change = received != null ? received - total : null;
  const transferPart = cashPart != null ? Math.max(0, total - cashPart) : null;
  const mixedInvalid = method === 'mixed' && (cashPart == null || cashPart <= 0 || cashPart >= total);
  const creditInvalid = method === 'credit' && party.trim().length === 0;
  const submit = async () => {
    try {
      await pay.mutateAsync({
        payment_method: method, discount: disc ?? 0,
        cash_received: method === 'cash' ? received : null,
        cash_part: method === 'mixed' ? cashPart : undefined,
        credit_party: method === 'credit' ? party.trim() : undefined,
        credit_due_date: method === 'credit' && due ? due : undefined,
      });
      toast.success(method === 'credit' ? `Cuenta cerrada a crédito de ${party.trim()}` : `Cobrado ${money(total)} en ${PAYMENT_LABEL[method].toLowerCase()}`);
      onPaid();
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Cobrar cuenta" size="sm"
      footer={<Button full size="xl" variant="primary" icon={Banknote} loading={pay.isPending} onClick={submit} disabled={mixedInvalid || creditInvalid || (method === 'cash' && received != null && received < total)}>
        {method === 'credit' ? `Cerrar a crédito · ${money(total)}` : `Confirmar ${money(total)}`}</Button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {([['cash', 'Efectivo'], ['transfer', 'Transferencia'], ['mixed', 'Mixto'], ['credit', 'A crédito']] as [OrderPayment, string][]).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setMethod(v)} className={cn('h-11 rounded-xl border text-sm font-semibold transition', method === v ? (v === 'credit' ? 'border-warn bg-warn/15 text-warn' : 'border-gold bg-gold text-gold-ink') : 'border-line bg-surface-2 text-fg-muted hover:text-fg')}>{l}</button>
          ))}
        </div>
        <Field label="Descuento (opcional)"><MoneyInput value={disc} onChange={setDisc} placeholder="$ 0" /></Field>
        {method === 'cash' && (
          <>
            <Field label="Efectivo recibido (opcional)" hint={change != null ? (change >= 0 ? `Cambio: ${money(change)}` : `Faltan ${money(-change)}`) : 'Escríbelo para calcular el cambio'}>
              <MoneyInput value={received} onChange={setReceived} />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              {[total, roundUp(total, 10000), roundUp(total, 50000)].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
                <button key={v} type="button" onClick={() => setReceived(v)} className={cn('h-10 rounded-lg border text-sm font-semibold tabular-nums', received === v ? 'border-gold bg-gold/15 text-gold' : 'border-line bg-surface-2 text-fg-muted')}>{money(v)}</button>
              ))}
            </div>
          </>
        )}
        {method === 'mixed' && (
          <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
            <Field label="Parte en efectivo"><MoneyInput autoFocus value={cashPart} onChange={setCashPart} /></Field>
            <div className="flex items-center justify-between text-sm"><span className="text-fg-muted">Parte por transferencia</span><span className="font-semibold tabular-nums">{transferPart != null ? money(transferPart) : '—'}</span></div>
            {mixedInvalid && cashPart != null && <p className="text-xs text-danger">El efectivo debe ser mayor a cero y menor que el total.</p>}
          </div>
        )}
        {method === 'credit' && (
          <div className="space-y-3 rounded-xl border border-warn/40 bg-warn/10 p-3">
            <p className="text-xs text-fg-muted">La cuenta se cierra sin que entre dinero a la caja. Queda en <b className="text-warn">Créditos por cobrar</b> a nombre del cliente y el inventario ya quedó descontado.</p>
            <Field label="Cliente"><Input autoFocus value={party} onChange={(e) => setParty(e.target.value)} placeholder="Nombre de quien debe" maxLength={80} /></Field>
            <Field label="Fecha límite (opcional)"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          </div>
        )}
        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <div className="flex justify-between text-fg-muted"><span>Subtotal</span><span className="tabular-nums">{money(order.subtotal)}</span></div>
          {(disc ?? 0) > 0 && <div className="flex justify-between text-warn"><span>Descuento</span><span className="tabular-nums">− {money(disc ?? 0)}</span></div>}
          <div className="mt-1 flex justify-between text-base font-bold"><span>Total</span><span className="tabular-nums text-gold">{money(total)}</span></div>
        </div>
      </div>
    </Modal>
  );
}

function roundUp(n: number, step: number) { return Math.ceil(n / step) * step; }

function MoveModal({ open, onClose, order }: { open: boolean; onClose: () => void; order: Order }) {
  const { data: floor } = useFloor();
  const toast = useToast();
  const [target, setTarget] = useState<string>('');
  const move = useInvalidatingMutation((table_id: number | null) => api.patch<Order>(`/orders/${order.id}`, { table_id }), [keys.order(order.id), ...ORDER_RELATED]);
  const free = (floor?.tables ?? []).filter((t) => !t.order && t.id !== order.table_id);
  return (
    <Modal open={open} onClose={onClose} title="Mover cuenta" size="sm"
      footer={<Button full variant="primary" size="lg" disabled={!target} loading={move.isPending} onClick={async () => { try { await move.mutateAsync(Number(target)); toast.success('Cuenta movida'); onClose(); } catch (e) { toast.error((e as Error).message); } }}>Mover</Button>}>
      <Field label="Mesa destino (solo libres)">
        <Select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Selecciona una mesa</option>
          {free.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </Field>
    </Modal>
  );
}

function DiscountModal({ open, onClose, order }: { open: boolean; onClose: () => void; order: Order }) {
  const toast = useToast();
  const [disc, setDisc] = useState<number | null>(order.discount || null);
  const [label, setLabel] = useState(order.label ?? '');
  const [notes, setNotes] = useState(order.notes ?? '');
  const save = useInvalidatingMutation((b: object) => api.patch<Order>(`/orders/${order.id}`, b), [keys.order(order.id), ...ORDER_RELATED]);
  return (
    <Modal open={open} onClose={onClose} title="Descuento y notas" size="sm"
      footer={<Button full variant="primary" size="lg" loading={save.isPending} onClick={async () => { try { await save.mutateAsync({ discount: disc ?? 0, notes: notes.trim() || null, label: order.table_id ? undefined : (label.trim() || null) }); toast.success('Guardado'); onClose(); } catch (e) { toast.error((e as Error).message); } }}>Guardar</Button>}>
      <div className="space-y-4">
        {!order.table_id && <Field label="Nombre de la cuenta"><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} /></Field>}
        <Field label="Descuento en pesos"><MoneyInput value={disc} onChange={setDisc} /></Field>
        <Field label="Notas"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: cliente frecuente, cumpleaños…" maxLength={300} /></Field>
      </div>
    </Modal>
  );
}

function RequestModal({ open, onClose, order }: { open: boolean; onClose: () => void; order: Order }) {
  const toast = useToast();
  const m = useInvalidatingMutation(() => api.post<Order>(`/orders/${order.id}/request-bill`), [keys.order(order.id), ...ORDER_RELATED]);
  return (
    <Modal open={open} onClose={onClose} title="Pedir la cuenta" size="sm"
      footer={<Button full size="xl" variant="primary" loading={m.isPending} icon={BellRing} onClick={async () => { try { await m.mutateAsync(undefined); toast.success('Listo. El administrador verá la mesa como "Por cobrar".'); onClose(); } catch (e) { toast.error((e as Error).message); } }}>Avisar al administrador</Button>}>
      <div className="space-y-3 text-sm text-fg-muted">
        <p>La mesa <b className="text-fg">{order.table_name ?? order.label ?? `#${order.id}`}</b> quedará marcada como <b className="text-warn">Por cobrar</b> con un total de <b className="text-fg">{money(order.total)}</b>.</p>
        <p>El administrador cobra y cierra la mesa. Si te equivocaste, puedes deshacer el aviso desde la cuenta.</p>
      </div>
    </Modal>
  );
}

function LabelModal({ open, onClose, order }: { open: boolean; onClose: () => void; order: Order }) {
  const toast = useToast();
  const [label, setLabel] = useState(order.label ?? '');
  const m = useInvalidatingMutation((b: object) => api.patch<Order>(`/orders/${order.id}/label`, b), [keys.order(order.id), ...ORDER_RELATED]);
  return (
    <Modal open={open} onClose={onClose} title={order.table_id ? 'Nombre o nota de la mesa' : 'Nombre de la cuenta'} size="sm"
      footer={<Button full size="lg" variant="primary" loading={m.isPending} onClick={async () => { try { await m.mutateAsync({ label: label.trim() || null }); toast.success('Guardado'); onClose(); } catch (e) { toast.error((e as Error).message); } }}>Guardar</Button>}>
      <Field label="Para identificar la mesa" hint="Ej: cumpleaños de Laura, los de la camisa roja, Juan (cliente frecuente)"><Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} onKeyDown={(e) => e.key === 'Enter' && m.mutate({ label: label.trim() || null })} /></Field>
    </Modal>
  );
}
