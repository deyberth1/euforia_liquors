import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button, PageLoader } from '@/components/ui';
import { useOrder } from '@/lib/queries';
import { fmtDateTime, money, PAYMENT_LABEL } from '@/lib/format';

/** Pre-cuenta / recibo imprimible (formato tirilla 80 mm). */
export function ReceiptPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const { data: o, isLoading } = useOrder(id);
  useEffect(() => { if (o && new URLSearchParams(location.search).get('auto') === '1') setTimeout(() => window.print(), 300); }, [o]);
  if (isLoading || !o) return <PageLoader />;
  const title = o.table_name ?? o.label ?? `Cuenta #${o.id}`;
  return (
    <div className="min-h-dvh bg-ink print:bg-white">
      <div className="print-hidden sticky top-0 flex items-center justify-between border-b border-line bg-ink/90 px-4 py-3 backdrop-blur safe-top">
        <Button size="sm" icon={ArrowLeft} onClick={() => nav(-1)}>Volver</Button>
        <Button size="sm" variant="primary" icon={Printer} onClick={() => window.print()}>Imprimir</Button>
      </div>
      <div className="mx-auto my-6 w-[80mm] max-w-full bg-white p-4 font-mono text-[12px] leading-tight text-black print:my-0">
        <div className="text-center">
          <img src="/brand/logo.jpg" alt="" className="mx-auto mb-1 h-16 w-16 rounded-full" />
          <div className="text-base font-bold tracking-[0.2em]">EUFORIA</div>
          <div className="text-[10px] tracking-[0.4em]">LIQUORS</div>
          <div className="mt-2">{o.status === 'paid' ? 'RECIBO DE VENTA' : 'PRE-CUENTA'}</div>
        </div>
        <div className="my-2 border-t border-dashed border-black" />
        <div>{title} · Cuenta #{o.id}</div>
        <div>Atendió: {o.opened_by_name}</div>
        <div>{fmtDateTime(o.closed_at ?? o.opened_at)}</div>
        <div className="my-2 border-t border-dashed border-black" />
        <table className="w-full">
          <tbody>
            {o.items.map((it) => (
              <tr key={it.id} className="align-top">
                <td className="pr-1">{it.quantity}×</td>
                <td className="w-full">{it.product_name}{it.notes && <div className="text-[10px] italic">{it.notes}</div>}</td>
                <td className="whitespace-nowrap text-right">{money(it.unit_price * it.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="my-2 border-t border-dashed border-black" />
        {o.discount > 0 && <><div className="flex justify-between"><span>Subtotal</span><span>{money(o.subtotal)}</span></div><div className="flex justify-between"><span>Descuento</span><span>-{money(o.discount)}</span></div></>}
        <div className="flex justify-between text-base font-bold"><span>TOTAL</span><span>{money(o.total)}</span></div>
        {o.status === 'paid' && (
          <div className="mt-1">
            <div className="flex justify-between"><span>Pago</span><span>{PAYMENT_LABEL[o.payment_method ?? '']}</span></div>
            {o.payment_method === 'mixed' && <><div className="flex justify-between"><span>Efectivo</span><span>{money(o.paid_cash)}</span></div><div className="flex justify-between"><span>Transferencia</span><span>{money(o.paid_transfer)}</span></div></>}
            {o.cash_received != null && <><div className="flex justify-between"><span>Recibido</span><span>{money(o.cash_received)}</span></div><div className="flex justify-between"><span>Cambio</span><span>{money(o.cash_received - o.total)}</span></div></>}
          </div>
        )}
        <div className="my-2 border-t border-dashed border-black" />
        <div className="text-center text-[10px]">¡Gracias por tu visita!</div>
      </div>
    </div>
  );
}
