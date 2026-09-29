import { useState } from 'react';
import { Lock, Unlock, Plus, Pencil, Trash2, History, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { Badge, Button, Card, CardHeader, DateRangePicker, EmptyState, Field, Input, Modal, MoneyInput, PageHeader, PageLoader, Segmented, Stat, Table, Textarea, useConfirm, useDateRange } from '@/components/ui';
import { keys, useCash, useCashSessions, useInvalidatingMutation, useTransactions } from '@/lib/queries';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtTime, money, PAYMENT_LABEL, plural } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { CashSession, PaymentMethod, Transaction, TransactionType } from '@shared/types';

const CASH_KEYS = [keys.cash, keys.dashboard, ['cash-sessions'], ['transactions']] as const;

export function CashPage() {
  const { data: cash, isLoading } = useCash();
  const [openModal, setOpenModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [tab, setTab] = useState<'today' | 'history'>('today');
  if (isLoading) return <PageLoader />;
  const s = cash?.summary;

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="Caja" subtitle={cash ? `Turno abierto ${fmtDateTime(cash.opened_at)} por ${cash.opened_by_name}` : 'No hay un turno abierto'}
        actions={cash ? <Button variant="danger" icon={Lock} onClick={() => setCloseModal(true)}>Cerrar caja</Button> : <Button variant="primary" icon={Unlock} onClick={() => setOpenModal(true)}>Abrir caja</Button>} />

      {cash && s ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Efectivo esperado" value={money(s.expectedCash)} hint={`Base ${money(cash.opening_balance)} + efectivo − gastos`} tone="ok" />
          <Stat label="Ventas del turno" value={money(s.salesTotal)} hint={plural(s.salesCount, 'cuenta')} />
          <Stat label="Efectivo / Transfer." value={<span className="text-lg">{money(s.salesCash)} <span className="text-fg-faint">/</span> {money(s.salesTransfer)}</span>} hint="ventas por método" tone="muted" />
          <Stat label="Gastos" value={money(s.expenseCash + s.expenseTransfer)} hint={[s.otherIncomeCash + s.otherIncomeTransfer > 0 ? `Otros ingresos ${money(s.otherIncomeCash + s.otherIncomeTransfer)}` : null, s.salesCredit > 0 ? `Fiado ${money(s.salesCredit)}` : null].filter(Boolean).join(' · ') || 'del turno'} tone="danger" />
        </div>
      ) : (
        <Card className="flex flex-col items-center py-8 text-center">
          <Unlock className="mb-3 h-8 w-8 text-gold" />
          <p className="font-semibold">Abre la caja para empezar el turno</p>
          <p className="mt-1 max-w-md text-sm text-fg-muted">Indica cuánto efectivo hay de base. Las ventas, ingresos y gastos que registres quedarán ligados a este turno para el cierre.</p>
        </Card>
      )}

      <Segmented value={tab} onChange={setTab} options={[{ value: 'today', label: 'Movimientos' }, { value: 'history', label: 'Historial de turnos' }]} />
      {tab === 'today' ? <Movements /> : <SessionsHistory />}

      <OpenModal open={openModal} onClose={() => setOpenModal(false)} />
      {cash && <CloseModal open={closeModal} onClose={() => setCloseModal(false)} session={cash} />}
    </div>
  );
}

function OpenModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const m = useInvalidatingMutation((b: object) => api.post('/cash/open', b), CASH_KEYS);
  return (
    <Modal open={open} onClose={onClose} title="Abrir caja" size="sm"
      footer={<Button full size="lg" variant="primary" icon={Unlock} loading={m.isPending} disabled={amount == null} onClick={async () => { try { await m.mutateAsync({ opening_balance: amount ?? 0, notes: notes || undefined }); toast.success('Caja abierta'); onClose(); setAmount(null); setNotes(''); } catch (e) { toast.error((e as Error).message); } }}>Abrir con {money(amount ?? 0)}</Button>}>
      <div className="space-y-4">
        <Field label="Base en efectivo"><MoneyInput autoFocus value={amount} onChange={setAmount} /></Field>
        <Field label="Notas (opcional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: turno viernes" /></Field>
      </div>
    </Modal>
  );
}

function CloseModal({ open, onClose, session }: { open: boolean; onClose: () => void; session: CashSession }) {
  const toast = useToast();
  const [amount, setAmount] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const m = useInvalidatingMutation((b: object) => api.post('/cash/close', b), CASH_KEYS);
  const expected = session.summary!.expectedCash;
  const diff = amount != null ? amount - expected : null;
  return (
    <Modal open={open} onClose={onClose} title="Cerrar caja" size="sm"
      footer={<Button full size="lg" variant={diff !== null && diff !== 0 ? 'danger' : 'primary'} icon={Lock} loading={m.isPending} disabled={amount == null} onClick={async () => { try { await m.mutateAsync({ closing_balance: amount ?? 0, notes: notes || undefined }); toast.success('Caja cerrada'); onClose(); } catch (e) { toast.error((e as Error).message); } }}>{diff !== null && diff !== 0 ? `Cerrar con diferencia de ${money(diff)}` : 'Cerrar caja'}</Button>}>
      <div className="space-y-4">
        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <div className="flex justify-between text-fg-muted"><span>Base</span><span className="tabular-nums">{money(session.opening_balance)}</span></div>
          <div className="flex justify-between text-fg-muted"><span>+ Ventas en efectivo</span><span className="tabular-nums">{money(session.summary!.salesCash)}</span></div>
          <div className="flex justify-between text-fg-muted"><span>+ Otros ingresos en efectivo</span><span className="tabular-nums">{money(session.summary!.otherIncomeCash)}</span></div>
          <div className="flex justify-between text-fg-muted"><span>− Gastos en efectivo</span><span className="tabular-nums">{money(session.summary!.expenseCash)}</span></div>
          <div className="mt-1 flex justify-between border-t border-line pt-1 font-bold"><span>Efectivo esperado</span><span className="tabular-nums text-ok">{money(expected)}</span></div>
        </div>
        <Field label="Efectivo contado en caja" hint={diff == null ? 'Cuenta el dinero físico y escríbelo aquí' : diff === 0 ? '¡Cuadra perfecto!' : diff > 0 ? `Sobran ${money(diff)}` : `Faltan ${money(-diff)}`}><MoneyInput autoFocus value={amount} onChange={setAmount} /></Field>
        <Field label="Notas (opcional)"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones del cierre" /></Field>
      </div>
    </Modal>
  );
}

function Movements() {
  const { range, setRange, presets } = useDateRange('today');
  const { data, isLoading } = useTransactions({ from: range.from, to: range.to });
  const [editing, setEditing] = useState<Transaction | null | 'new'>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const { isOwner } = useAuth();
  const del = useInvalidatingMutation((id: number) => api.delete(`/transactions/${id}`), CASH_KEYS);
  const rows = data ?? [];
  const income = rows.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = rows.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  return (
    <Card>
      <CardHeader title="Ingresos y gastos" subtitle={<>Ingresos <b className="text-ok">{money(income)}</b> · Gastos <b className="text-danger">{money(expense)}</b> · Balance <b className="text-fg">{money(income - expense)}</b></>}
        action={<Button variant="primary" size="sm" icon={Plus} onClick={() => setEditing('new')}>Registrar</Button>} />
      <DateRangePicker range={range} onChange={setRange} presets={presets} className="mb-4" />
      {isLoading ? <PageLoader /> : rows.length === 0 ? <EmptyState icon={History} title="Sin movimientos en este periodo" /> : (
        <ul className="divide-y divide-line">
          {rows.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
              {t.type === 'income' ? <ArrowDownCircle className="h-5 w-5 shrink-0 text-ok" /> : <ArrowUpCircle className="h-5 w-5 shrink-0 text-danger" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{t.description}</div>
                <div className="text-xs text-fg-muted">{fmtDateTime(t.created_at)} · {PAYMENT_LABEL[t.payment_method]} · {t.created_by_name.split(' ')[0]}{t.order_id && <Badge tone="muted" className="ml-2">venta</Badge>}{t.credit_id && <Badge tone="muted" className="ml-2">crédito</Badge>}</div>
              </div>
              <div className={cn('font-semibold tabular-nums', t.type === 'income' ? 'text-ok' : 'text-danger')}>{t.type === 'expense' && '− '}{money(t.amount)}</div>
              {isOwner && !t.order_id && (
                <div className="flex">
                  <button type="button" className="rounded-lg p-2 text-fg-muted hover:text-fg" aria-label="Editar" onClick={() => setEditing(t)}><Pencil className="h-4 w-4" /></button>
                  <button type="button" className="rounded-lg p-2 text-fg-muted hover:text-danger" aria-label="Eliminar" onClick={async () => { if (await confirm({ title: 'Eliminar movimiento', message: t.description, danger: true, confirmText: 'Eliminar' })) { try { await del.mutateAsync(t.id); toast.success('Eliminado'); } catch (e) { toast.error((e as Error).message); } } }}><Trash2 className="h-4 w-4" /></button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <TxModal open={editing !== null} onClose={() => setEditing(null)} tx={editing === 'new' ? null : editing} />
    </Card>
  );
}

function TxModal({ open, onClose, tx }: { open: boolean; onClose: () => void; tx: Transaction | null }) {
  const toast = useToast();
  const [type, setType] = useState<TransactionType>(tx?.type ?? 'expense');
  const [amount, setAmount] = useState<number | null>(tx?.amount ?? null);
  const [desc, setDesc] = useState(tx?.description ?? '');
  const [method, setMethod] = useState<PaymentMethod>(tx?.payment_method ?? 'cash');
  const m = useInvalidatingMutation((b: object) => (tx ? api.put(`/transactions/${tx.id}`, b) : api.post('/transactions', b)), CASH_KEYS);
  // Reiniciar el formulario cada vez que se abre con otro movimiento.
  const [seen, setSeen] = useState<Transaction | null | undefined>(undefined);
  if (open && seen !== tx) { setSeen(tx); setType(tx?.type ?? 'expense'); setAmount(tx?.amount ?? null); setDesc(tx?.description ?? ''); setMethod(tx?.payment_method ?? 'cash'); }
  if (!open && seen !== undefined) setSeen(undefined);
  return (
    <Modal open={open} onClose={onClose} title={tx ? 'Editar movimiento' : 'Registrar movimiento'} size="sm"
      footer={<Button full size="lg" variant="primary" loading={m.isPending} disabled={!amount || !desc.trim()} onClick={async () => { try { await m.mutateAsync({ type, amount, description: desc.trim(), payment_method: method }); toast.success('Guardado'); onClose(); } catch (e) { toast.error((e as Error).message); } }}>Guardar</Button>}>
      <div className="space-y-4">
        <Segmented className="w-full [&>button]:flex-1" value={type} onChange={setType} options={[{ value: 'expense', label: 'Gasto' }, { value: 'income', label: 'Ingreso' }]} />
        <Field label="Descripción"><Input autoFocus value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={type === 'expense' ? 'Ej: hielo, propina, domicilio…' : 'Ej: aporte a caja'} maxLength={200} /></Field>
        <Field label="Monto"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Método"><Segmented className="w-full [&>button]:flex-1" value={method} onChange={setMethod} options={[{ value: 'cash', label: 'Efectivo' }, { value: 'transfer', label: 'Transferencia' }]} /></Field>
      </div>
    </Modal>
  );
}

function SessionsHistory() {
  const { range, setRange, presets } = useDateRange('month');
  const { data, isLoading } = useCashSessions({ from: range.from, to: range.to });
  return (
    <Card>
      <CardHeader title="Turnos de caja" />
      <DateRangePicker range={range} onChange={setRange} presets={presets} className="mb-4" />
      {isLoading ? <PageLoader /> : !data?.length ? <EmptyState icon={History} title="Sin turnos en este periodo" /> : (
        <Table>
          <thead><tr><th>Apertura</th><th>Cierre</th><th className="text-right">Base</th><th className="text-right">Ventas</th><th className="text-right">Esperado</th><th className="text-right">Contado</th><th className="text-right">Diferencia</th></tr></thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id}>
                <td>{fmtDateTime(s.opened_at)}<div className="text-xs text-fg-muted">{s.opened_by_name}</div></td>
                <td>{s.closed_at ? <>{fmtTime(s.closed_at)}<div className="text-xs text-fg-muted">{s.closed_by_name}</div></> : <Badge tone="ok" dot>Abierta</Badge>}</td>
                <td className="text-right tabular-nums">{money(s.opening_balance)}</td>
                <td className="text-right tabular-nums">{money(s.summary?.salesTotal ?? 0)}<div className="text-xs text-fg-muted">{plural(s.summary?.salesCount ?? 0, 'cuenta')}</div></td>
                <td className="text-right tabular-nums">{money(s.expected_cash ?? s.summary?.expectedCash ?? 0)}</td>
                <td className="text-right tabular-nums">{s.closing_balance != null ? money(s.closing_balance) : '—'}</td>
                <td className={cn('text-right font-semibold tabular-nums', (s.difference ?? 0) < 0 ? 'text-danger' : (s.difference ?? 0) > 0 ? 'text-warn' : 'text-ok')}>{s.difference != null ? money(s.difference) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
