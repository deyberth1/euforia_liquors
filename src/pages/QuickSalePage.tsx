import { useNavigate } from 'react-router-dom';
import { Zap, Receipt } from 'lucide-react';
import { Button, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { keys, useFloor, useInvalidatingMutation } from '@/lib/queries';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { money, timeAgo } from '@/lib/format';
import type { Order } from '@shared/types';

/** Venta directa en barra: crea una cuenta sin mesa y lleva directo a agregar productos y cobrar. */
export function QuickSalePage() {
  const nav = useNavigate();
  const toast = useToast();
  const { data } = useFloor();
  const create = useInvalidatingMutation(() => api.post<Order>('/orders', { label: 'Venta directa' }), [keys.floor]);
  const start = async () => {
    try { const o = await create.mutateAsync(undefined); nav(`/cuenta/${o.id}`); }
    catch (e) { toast.error((e as Error).message); }
  };
  const loose = data?.looseOrders ?? [];
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="Venta rápida" subtitle="Para ventas en barra o para llevar, sin asignar mesa." />
      <Card className="flex flex-col items-center py-10 text-center">
        <div className="mb-4 rounded-2xl bg-gold/12 p-4 text-gold"><Zap className="h-8 w-8" /></div>
        <h2 className="text-lg font-semibold">Nueva venta</h2>
        <p className="mt-1 max-w-sm text-sm text-fg-muted">Se abre una cuenta, agregas los productos y la cobras de una vez.</p>
        <Button className="mt-5" size="xl" variant="primary" icon={Zap} loading={create.isPending} onClick={start}>Empezar venta</Button>
      </Card>
      <Card>
        <CardHeader title="Cuentas sin mesa abiertas" />
        {loose.length === 0 ? <EmptyState icon={Receipt} title="Ninguna pendiente" /> : (
          <ul className="divide-y divide-line">
            {loose.map((o) => (
              <li key={o.id}><button type="button" onClick={() => nav(`/cuenta/${o.id}`)} className="flex w-full items-center justify-between py-3 text-left hover:text-gold">
                <span><span className="font-semibold">{o.label || `Cuenta #${o.id}`}</span><span className="ml-2 text-xs text-fg-muted">{o.opened_by_name} · hace {timeAgo(o.opened_at)}</span></span>
                <span className="font-bold tabular-nums text-gold">{money(o.total)}</span></button></li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
