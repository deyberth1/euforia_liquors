import { Link } from 'react-router-dom';
import { LayoutGrid, Wallet, Receipt, Trophy, Clock, ArrowRight } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, PageLoader } from '@/components/ui';
import { RankList } from '@/components/charts';
import { useMySummary } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { fmtTime, money, number, plural, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';

/** Inicio del mesero: sus mesas, lo que debe entregar y su resumen del turno. */
export function MyNightPage() {
  const { user } = useAuth();
  const { data, isLoading } = useMySummary();
  if (isLoading || !data) return <PageLoader />;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={`${greet}, ${user?.full_name.split(' ')[0]}`} subtitle={data.session_id ? 'Así va tu turno.' : 'La caja está cerrada; esto es lo de hoy.'} actions={<Link to="/mesas"><Button variant="primary" icon={LayoutGrid}>Ir a mesas</Button></Link>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Mis mesas abiertas" value={number(data.openTables.length)} hint={data.openTables.length ? money(data.openTables.reduce((s, t) => s + t.my_amount, 0)) + ' anotado' : 'ninguna por ahora'} icon={LayoutGrid} tone="gold" />
        <Tile label="Mi venta del turno" value={money(data.today.amount)} hint={`${plural(data.today.tables, 'cuenta cobrada', 'cuentas cobradas')}`} icon={Wallet} tone="ok" />
        <Tile label="Productos anotados" value={number(data.today.items)} hint="en cuentas ya cobradas" icon={Receipt} />
        <Tile label="Mejor mesa" value={data.bestTable ? money(data.bestTable.total) : '—'} hint={data.bestTable?.table_name ?? 'aún nada cobrado'} icon={Trophy} />
      </div>

      <Card>
        <CardHeader title="Mis mesas ahora" subtitle="Las que abriste. Toca una para seguir anotando" />
        {data.openTables.length === 0 ? <EmptyState icon={LayoutGrid} title="No tienes mesas abiertas" text="Ve a Mesas y toca una libre para empezar." action={<Link to="/mesas"><Button variant="primary" icon={ArrowRight}>Ir a mesas</Button></Link>} /> : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.openTables.map((t) => (
              <li key={t.order_id}>
                <Link to={`/cuenta/${t.order_id}`} className={cn('card flex items-center gap-3 p-3 transition hover:border-gold/50', t.bill_requested_at && 'border-warn/50')}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="font-semibold">{t.table_name}</span>{t.bill_requested_at && <Badge tone="warn" dot>Cuenta pedida</Badge>}</div>
                    <div className="text-xs text-fg-muted"><Clock className="mr-1 inline h-3 w-3" />{timeAgo(t.opened_at)} · {plural(t.my_items, 'ítem tuyo', 'ítems tuyos')}</div>
                  </div>
                  <div className="text-right"><div className="font-bold tabular-nums text-gold">{money(t.total)}</div></div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Lo que has vendido" subtitle={data.today.firstActivity ? `Desde ${fmtTime(data.today.firstActivity)} · solo cuentas ya cobradas` : 'Aparece aquí cuando el administrador cobre tus mesas'} />
        <RankList limit={12} rows={data.products.map((p) => ({ label: p.product_name, value: p.total, hint: `${number(p.quantity)} und` }))} />
      </Card>
    </div>
  );
}

function Tile({ label, value, hint, icon: Icon, tone = 'muted' }: { label: string; value: string; hint: string; icon: typeof Wallet; tone?: 'gold' | 'ok' | 'muted' }) {
  const color = { gold: 'text-gold', ok: 'text-ok', muted: 'text-fg' }[tone];
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span><Icon className={cn('h-4 w-4', color)} /></div>
      <div className={cn('mt-2 text-2xl font-bold tabular-nums leading-none', color)}>{value}</div>
      <div className="mt-2 truncate text-xs text-fg-muted">{hint}</div>
    </div>
  );
}
