import { useMemo, useState } from 'react';
import { MoreHorizontal, Minus, Plus, PackageX, Star } from 'lucide-react';
import { Button, EmptyState, Field, Input, Modal, SearchInput, Spinner } from '@/components/ui';
import { useCategories, useFrequent, useProducts } from '@/lib/queries';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Product } from '@shared/types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** En 2x1 (`promo`), `quantity` son pares: cada par agrega 2 botellas al precio 2x1. */
  onPick: (product: Product, quantity: number, notes?: string, promo?: boolean) => Promise<void> | void;
  /** Cantidad que ya tiene cada producto en la cuenta (para mostrar − / +). */
  quantities?: Record<number, number>;
  /** Quita una unidad del producto en la cuenta. */
  onRemove?: (product: Product) => Promise<void> | void;
  title?: string;
  total?: number;
}

/** Selector de productos: buscar, filtrar por categoría y tocar para agregar. Con − / + para corregir al instante. */
export function ProductPicker({ open, onClose, onPick, quantities = {}, onRemove, title = 'Agregar productos', total }: Props) {
  const { data: products, isLoading } = useProducts();
  const { data: categories } = useCategories();
  const { data: frequent } = useFrequent();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<number | 'all'>('all');
  const [detail, setDetail] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [promo, setPromo] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (products ?? []).filter((p) => (cat === 'all' || p.category_id === cat) && (!term || p.name.toLowerCase().includes(term) || (p.category_name ?? '').toLowerCase().includes(term)));
  }, [products, q, cat]);

  const cats = (categories ?? []).filter((c) => (products ?? []).some((p) => p.category_id === c.id));
  const favorites = (frequent ?? []).map((id) => (products ?? []).find((p) => p.id === id)).filter((p): p is Product => !!p).slice(0, 6);
  const showFavorites = favorites.length > 0 && cat === 'all' && !q.trim();
  const outOfStock = (p: Product) => p.track_stock === 1 && p.stock <= 0;
  const noPromoStock = (p: Product) => p.track_stock === 1 && p.stock < 2;

  const add = async (p: Product, n: number, note?: string, asPromo?: boolean) => {
    setBusyId(p.id);
    try { await onPick(p, n, note, asPromo); } finally { setBusyId(null); }
  };
  const remove = async (p: Product) => {
    if (!onRemove) return;
    setBusyId(p.id);
    try { await onRemove(p); } finally { setBusyId(null); }
  };
  const inOrder = Object.values(quantities).reduce((s, n) => s + n, 0);

  return (
    <Modal open={open} onClose={onClose} title={title} size="full" className="sm:h-[88dvh]"
      footer={<Button full size="lg" variant="primary" onClick={onClose}>Listo{inOrder > 0 && ` · ${inOrder} en la cuenta${total != null ? ` · ${money(total)}` : ''}`}</Button>}>
      <div className="sticky -top-px z-10 -mx-5 space-y-3 bg-surface px-5 pb-3 pt-1">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar producto…" autoFocus={typeof window !== 'undefined' && window.innerWidth >= 768} />
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
          <Chip active={cat === 'all'} onClick={() => setCat('all')}>Todos</Chip>
          {cats.map((c) => <Chip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</Chip>)}
        </div>
      </div>

      {showFavorites && (
        <div className="mb-3 pt-1">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted"><Star className="h-3.5 w-3.5 text-gold" />Los más pedidos</div>
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
            {favorites.map((p) => {
              const count = quantities[p.id] ?? 0;
              const off = outOfStock(p);
              return (
                <button key={p.id} type="button" disabled={off || busyId === p.id} onClick={() => add(p, 1)}
                  className={cn('relative flex h-[68px] w-[128px] shrink-0 flex-col justify-between rounded-xl border px-3 py-2 text-left transition active:scale-[0.97]', count > 0 ? 'border-gold bg-gold/12' : 'border-line bg-surface-2 hover:border-gold/50', off && 'opacity-40')}>
                  <span className="line-clamp-2 text-xs font-semibold leading-tight">{p.name}</span>
                  <span className="text-xs font-bold tabular-nums text-gold">{money(p.price)}</span>
                  {count > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-[11px] font-bold text-gold-ink">{count}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : list.length === 0 ? (
        <EmptyState icon={PackageX} title="Sin productos" text={q ? 'Prueba con otra búsqueda.' : 'El administrador aún no ha cargado productos en esta categoría.'} />
      ) : (
        <div className="grid grid-cols-2 gap-2.5 pt-1 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((p) => {
            const off = outOfStock(p);
            const count = quantities[p.id] ?? 0;
            const busy = busyId === p.id;
            return (
              <div key={p.id} className={cn('relative flex flex-col rounded-2xl border bg-surface-2 transition',
                count > 0 ? 'border-gold/60 bg-[linear-gradient(160deg,rgba(217,180,91,0.10),transparent_60%)]' : off ? 'border-line opacity-50' : 'border-line hover:border-gold/50', busy && 'animate-pulse-soft')}>
                <button type="button" disabled={off || busy} onClick={() => add(p, 1)} className="flex flex-1 flex-col items-start p-3 text-left active:scale-[0.98]">
                  <span className="line-clamp-2 min-h-[2.5rem] pr-6 text-sm font-semibold leading-snug text-fg">{p.name}</span>
                  <span className="mt-2 text-base font-bold tabular-nums text-gold">{money(p.price)}</span>
                  <span className="mt-0.5 text-[11px] text-fg-faint">{p.track_stock === 1 ? (off ? 'Agotado' : `${p.stock} disp.`) : p.category_name ?? ''}</span>
                </button>
                <button type="button" aria-label="Cantidad y nota" onClick={() => { setDetail(p); setQty(1); setNotes(''); setPromo(false); }} disabled={off}
                  className="absolute right-2 top-2 rounded-lg p-1.5 text-fg-muted hover:bg-surface-3 hover:text-fg"><MoreHorizontal className="h-4 w-4" /></button>
                {p.promo_price != null && (
                  <button type="button" disabled={noPromoStock(p) || busy} onClick={() => add(p, 1, undefined, true)} aria-label={`Agregar 2x1 de ${p.name}`}
                    className="mx-2 mb-2 flex h-9 items-center justify-between rounded-lg border border-gold/40 bg-gold/10 px-2.5 text-xs font-bold text-gold transition hover:bg-gold/20 active:scale-[0.98] disabled:opacity-40">
                    <span>2x1</span><span className="tabular-nums">{money(p.promo_price)}</span>
                  </button>
                )}
                {count > 0 && (
                  <div className="flex items-center justify-between border-t border-gold/25 px-1.5 py-1.5">
                    <button type="button" disabled={busy || !onRemove} onClick={() => remove(p)} className="flex h-9 w-11 items-center justify-center rounded-lg bg-surface-3 text-fg hover:bg-danger/20 hover:text-danger" aria-label="Quitar uno"><Minus className="h-4 w-4" /></button>
                    <span className="text-base font-bold tabular-nums text-gold">{count}</span>
                    <button type="button" disabled={busy || off} onClick={() => add(p, 1)} className="flex h-9 w-11 items-center justify-center rounded-lg bg-gold text-gold-ink hover:brightness-110" aria-label="Agregar uno"><Plus className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name} size="sm"
        footer={<Button full variant="primary" size="lg" loading={busyId === detail?.id} onClick={async () => { if (detail) { await add(detail, qty, notes.trim() || undefined, promo); setDetail(null); } }}>
          {promo ? `Agregar ${qty} × 2x1 · ${money((detail?.promo_price ?? 0) * qty)}` : `Agregar ${qty} · ${money((detail?.price ?? 0) * qty)}`}</Button>}>
        <div className="space-y-4">
          {detail?.promo_price != null && (
            <label className={cn('flex items-center gap-3 rounded-xl border p-3 text-sm transition', promo ? 'border-gold bg-gold/10' : 'border-line bg-surface-2', noPromoStock(detail) && 'opacity-50')}>
              <input type="checkbox" className="h-5 w-5 accent-gold" checked={promo} disabled={noPromoStock(detail)} onChange={(e) => setPromo(e.target.checked)} />
              <span><b>2x1</b><span className="block text-xs text-fg-muted">2 botellas por {money(detail.promo_price)}. Se descuentan las 2 del inventario.</span></span>
            </label>
          )}
          <div className="flex items-center justify-center gap-4 py-2">
            <Button size="lg" onClick={() => setQty((n) => Math.max(1, n - 1))} icon={Minus} aria-label="Menos" />
            <span className="w-12 text-center text-3xl font-bold tabular-nums">{qty}</span>
            <Button size="lg" onClick={() => setQty((n) => Math.min(99, n + 1))} icon={Plus} aria-label="Más" />
          </div>
          {promo && <p className="-mt-2 text-center text-xs text-fg-muted">{qty} {qty === 1 ? 'par' : 'pares'} = {qty * 2} botellas</p>}
          <Field label="Nota para la cuenta (opcional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: sin hielo, para llevar…" maxLength={120} /></Field>
        </div>
      </Modal>
    </Modal>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('h-9 shrink-0 rounded-full border px-4 text-sm font-medium transition', active ? 'border-gold bg-gold text-gold-ink' : 'border-line bg-surface-2 text-fg-muted hover:text-fg')}>
      {children}
    </button>
  );
}
