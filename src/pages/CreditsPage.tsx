import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, HandCoins, Trash2, Banknote } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, MoneyInput, PageHeader, PageLoader, Segmented, useConfirm } from '@/components/ui';
import { keys, useCredits, useInvalidatingMutation } from '@/lib/queries';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtDay, money, PAYMENT_LABEL } from '@/lib/format';
import type { Credit, CreditType, PaymentMethod } from '@shared/types';

const CREDIT_KEYS = [['credits'], keys.cash, keys.dashboard, ['transactions']] as const;

export function CreditsPage() {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [type, setType] = useState<'' | CreditType>('');
  const { data, isLoading } = useCredits({ status, type });
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Credit | null>(null);
  const { isOwner } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const del = useInvalidatingMutation((id: number) => api.delete(`/credits/${id}`), CREDIT_KEYS);
  const reopen = useInvalidatingMutation((id: number) => api.post(`/credits/${id}/reopen`), CREDIT_KEYS);
  const removeCredit = async (c: Credit) => {
    const ok = await confirm({ title: `Eliminar crédito de ${c.party}`, message: c.paid > 0 ? `Tiene abonos por ${money(c.paid)}. Se eliminarán también esos abonos y sus movimientos en caja.` : 'Esta acción no se puede deshacer.', danger: true, confirmText: 'Eliminar' });
    if (!ok) return;
    try { await del.mutateAsync(c.id); toast.success('Crédito eliminado'); } catch (e) { toast.error((e as Error).message); }
  };
  const rows = data ?? [];
  const recv = rows.filter((c) => c.type === 'receivable').reduce((s, c) => s + c.balance, 0);
  const pay = rows.filter((c) => c.type === 'payable').reduce((s, c) => s + c.balance, 0);

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="Créditos" subtitle="Cuentas por cobrar a clientes y por pagar a proveedores" actions={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Nuevo crédito</Button>} />
      {status === 'open' && <div className="grid grid-cols-2 gap-3"><Card><div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Nos deben</div><div className="mt-1 text-2xl font-bold text-ok">{money(recv)}</div></Card><Card><div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Debemos</div><div className="mt-1 text-2xl font-bold text-danger">{money(pay)}</div></Card></div>}
      <div className="flex flex-wrap gap-2">
        <Segmented size="sm" value={status} onChange={setStatus} options={[{ value: 'open', label: 'Pendientes' }, { value: 'closed', label: 'Pagados' }]} />
        <Segmented size="sm" value={type} onChange={setType} options={[{ value: '', label: 'Todos' }, { value: 'receivable', label: 'Por cobrar' }, { value: 'payable', label: 'Por pagar' }]} />
      </div>
      {isLoading ? <PageLoader /> : rows.length === 0 ? <EmptyState icon={HandCoins} title="Sin créditos" /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((c) => (
            <Card key={c.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="truncate font-semibold">{c.party}</div>{c.description && <div className="truncate text-sm text-fg-muted">{c.order_id ? <Link to={`/cuenta/${c.order_id}`} className="hover:text-gold hover:underline">{c.description}</Link> : c.description}</div>}<div className="mt-1 text-xs text-fg-faint">{fmtDateTime(c.created_at)}{c.due_date && ` · vence ${fmtDay(c.due_date)}`}</div></div>
                <Badge tone={c.type === 'receivable' ? 'ok' : 'danger'}>{c.type === 'receivable' ? 'Por cobrar' : 'Por pagar'}</Badge>
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div className="text-sm text-fg-muted">Total {money(c.total)} · Abonado {money(c.paid)}</div>
                <div className="text-xl font-bold tabular-nums text-gold">{money(c.balance)}</div>
              </div>
              {c.status === 'open' && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="primary" icon={Banknote} onClick={() => setPaying(c)} className="flex-1">Registrar abono</Button>
                  {isOwner && <Button size="sm" variant="danger" icon={Trash2} aria-label="Eliminar" onClick={() => removeCredit(c)} />}
                </div>
              )}
              {c.status === 'closed' && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={async () => { try { await reopen.mutateAsync(c.id); toast.success('Crédito reabierto'); } catch (e) { toast.error((e as Error).message); } }} className="flex-1">Reabrir</Button>
                  {isOwner && <Button size="sm" variant="danger" icon={Trash2} aria-label="Eliminar" onClick={() => removeCredit(c)} />}
                </div>
              )}
              {c.paid > 0 && <Payments id={c.id} />}
            </Card>
          ))}
        </div>
      )}
      <CreateModal open={creating} onClose={() => setCreating(false)} />
      <PayModal key={paying?.id ?? 'none'} credit={paying} onClose={() => setPaying(null)} />
    </div>
  );
}

function Payments({ id }: { id: number }) {
  const { data } = useQuery({ queryKey: ['credit-payments', id], queryFn: () => api.get<{ id: number; amount: number; payment_method: PaymentMethod; created_at: string; created_by_name: string }[]>(`/credits/${id}/payments`) });
  if (!data?.length) return null;
  return <ul className="mt-3 space-y-1 border-t border-line pt-2 text-xs text-fg-muted">{data.map((p) => <li key={p.id} className="flex justify-between"><span>{fmtDateTime(p.created_at)} · {PAYMENT_LABEL[p.payment_method]}</span><span className="tabular-nums">{money(p.amount)}</span></li>)}</ul>;
}

function CreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<CreditType>('receivable');
  const [party, setParty] = useState('');
  const [desc, setDesc] = useState('');
  const [total, setTotal] = useState<number | null>(null);
  const [due, setDue] = useState('');
  const m = useInvalidatingMutation((b: object) => api.post('/credits', b), CREDIT_KEYS);
  return (
    <Modal open={open} onClose={onClose} title="Nuevo crédito" size="sm"
      footer={<Button full size="lg" variant="primary" loading={m.isPending} disabled={!party.trim() || !total} onClick={async () => { try { await m.mutateAsync({ type, party: party.trim(), description: desc.trim(), total, due_date: due || null }); toast.success('Crédito creado'); onClose(); setParty(''); setDesc(''); setTotal(null); setDue(''); } catch (e) { toast.error((e as Error).message); } }}>Guardar</Button>}>
      <div className="space-y-4">
        <Segmented className="w-full [&>button]:flex-1" value={type} onChange={setType} options={[{ value: 'receivable', label: 'Nos deben' }, { value: 'payable', label: 'Debemos' }]} />
        <Field label={type === 'receivable' ? 'Cliente' : 'Proveedor'}><Input autoFocus value={party} onChange={(e) => setParty(e.target.value)} maxLength={80} /></Field>
        <Field label="Descripción (opcional)"><Input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} placeholder="Ej: botella de whisky fiada" /></Field>
        <Field label="Monto total"><MoneyInput value={total} onChange={setTotal} /></Field>
        <Field label="Fecha límite (opcional)"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function PayModal({ credit, onClose }: { credit: Credit | null; onClose: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState<number | null>(credit?.balance ?? null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const m = useInvalidatingMutation((b: object) => api.post(`/credits/${credit!.id}/payments`, b), CREDIT_KEYS);
  return (
    <Modal open={!!credit} onClose={onClose} title={`Abono · ${credit?.party ?? ''}`} size="sm"
      footer={<Button full size="lg" variant="primary" loading={m.isPending} disabled={!amount} onClick={async () => { try { await m.mutateAsync({ amount, payment_method: method }); toast.success('Abono registrado'); onClose(); } catch (e) { toast.error((e as Error).message); } }}>Registrar {money(amount ?? 0)}</Button>}>
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">Saldo pendiente: <b className="text-fg">{money(credit?.balance ?? 0)}</b>. El abono se registra como {credit?.type === 'receivable' ? 'ingreso' : 'gasto'} en la caja.</p>
        <Field label="Monto del abono"><MoneyInput autoFocus value={amount} onChange={setAmount} /></Field>
        <Segmented className="w-full [&>button]:flex-1" value={method} onChange={setMethod} options={[{ value: 'cash', label: 'Efectivo' }, { value: 'transfer', label: 'Transferencia' }]} />
      </div>
    </Modal>
  );
}
