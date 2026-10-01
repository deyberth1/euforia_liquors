import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, PackagePlus, Package, Tags, Armchair, GripVertical } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, MoneyInput, PageHeader, PageLoader, SearchInput, Segmented, Select, Table, useConfirm } from '@/components/ui';
import { keys, useCategories, useInvalidatingMutation, useProducts, useTables } from '@/lib/queries';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Category, Product, TableRow, TableType } from '@shared/types';

const PRODUCT_KEYS = [['products'], keys.categories, keys.dashboard] as const;

export function InventoryPage() {
  const [tab, setTab] = useState<'products' | 'categories' | 'tables'>('products');
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="Inventario" subtitle="Productos, categorías y mesas del local" />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'products', label: 'Productos' }, { value: 'categories', label: 'Categorías' }, { value: 'tables', label: 'Mesas' }]} />
      {tab === 'products' && <Products />}
      {tab === 'categories' && <Categories />}
      {tab === 'tables' && <Tables />}
    </div>
  );
}

/* ---------------- Productos ---------------- */
function Products() {
  const { data: products, isLoading } = useProducts(true);
  const { data: categories } = useCategories();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Product | null | 'new'>(null);
  const [stockOf, setStockOf] = useState<Product | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const { isOwner } = useAuth();
  const del = useInvalidatingMutation((id: number) => api.delete<{ deactivated: boolean }>(`/products/${id}`), PRODUCT_KEYS);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (products ?? []).filter((p) => (showInactive || p.is_active === 1) && (!cat || String(p.category_id) === cat) && (!term || p.name.toLowerCase().includes(term)));
  }, [products, q, cat, showInactive]);

  if (isLoading) return <PageLoader />;
  return (
    <Card>
      <CardHeader title={`${list.length} productos`} action={<Button variant="primary" size="sm" icon={Plus} onClick={() => setEditing('new')}>Nuevo producto</Button>} />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_200px_auto]">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar producto…" />
        <Select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas las categorías</option>{(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <label className="flex h-12 items-center gap-2 px-2 text-sm text-fg-muted"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-4 w-4 accent-gold" />Ver inactivos</label>
      </div>
      {list.length === 0 ? <EmptyState icon={Package} title="Sin productos" text="Crea tu primer producto para empezar a vender." action={<Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Nuevo producto</Button>} /> : (
        <Table>
          <thead><tr><th>Producto</th><th>Categoría</th><th className="text-right">Precio</th><th className="text-right">Stock</th><th></th></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className={cn(p.is_active === 0 && 'opacity-50')}>
                <td className="font-medium">{p.name}{p.is_active === 0 && <Badge tone="muted" className="ml-2">Inactivo</Badge>}</td>
                <td className="text-fg-muted">{p.category_name ?? '—'}</td>
                <td className="text-right tabular-nums"><button type="button" onClick={() => setEditing(p)} title="Editar precio" className="rounded-lg px-2 py-1 font-semibold text-gold hover:bg-surface-3">{money(p.price)}</button></td>
                <td className="text-right tabular-nums">{p.track_stock === 1 ? <button type="button" onClick={() => setStockOf(p)} className={cn('rounded-lg px-2 py-1 font-semibold hover:bg-surface-3', p.stock <= 0 ? 'text-danger' : p.stock <= 5 ? 'text-warn' : 'text-fg')}>{p.stock}</button> : <span className="text-xs text-fg-faint">sin control</span>}</td>
                <td className="text-right whitespace-nowrap">
                  <button type="button" className="rounded-lg p-2 text-fg-muted hover:text-fg" aria-label="Ajustar stock" title="Ajustar inventario" onClick={() => setStockOf(p)} disabled={p.track_stock === 0}><PackagePlus className="h-4 w-4" /></button>
                  <button type="button" className="rounded-lg p-2 text-fg-muted hover:text-fg" aria-label="Editar" onClick={() => setEditing(p)}><Pencil className="h-4 w-4" /></button>
                  {isOwner && <button type="button" className="rounded-lg p-2 text-fg-muted hover:text-danger" aria-label="Eliminar" onClick={async () => { if (await confirm({ title: `Eliminar ${p.name}`, message: 'Si el producto tiene ventas registradas se marcará como inactivo para conservar los reportes.', danger: true, confirmText: 'Eliminar' })) { try { const r = await del.mutateAsync(p.id); toast.success(r.deactivated ? 'Producto desactivado' : 'Producto eliminado'); } catch (e) { toast.error((e as Error).message); } } }}><Trash2 className="h-4 w-4" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ProductModal key={editing === 'new' ? 'new' : editing?.id ?? 'closed'} open={editing !== null} onClose={() => setEditing(null)} product={editing === 'new' ? null : editing} categories={categories ?? []} />
      <StockModal key={stockOf?.id ?? 'no-stock'} open={!!stockOf} onClose={() => setStockOf(null)} product={stockOf} />
    </Card>
  );
}

function ProductModal({ open, onClose, product, categories }: { open: boolean; onClose: () => void; product: Product | null; categories: Category[] }) {
  const toast = useToast();
  const [name, setName] = useState(product?.name ?? '');
  const [price, setPrice] = useState<number | null>(product?.price ?? null);
  const [catId, setCatId] = useState(product?.category_id ? String(product.category_id) : '');
  const [track, setTrack] = useState(product ? product.track_stock === 1 : true);
  const [stock, setStock] = useState(String(product?.stock ?? 0));
  const [active, setActive] = useState(product ? product.is_active === 1 : true);
  const m = useInvalidatingMutation((b: object) => (product ? api.put(`/products/${product.id}`, b) : api.post('/products', b)), PRODUCT_KEYS);
  const submit = async () => {
    try {
      await m.mutateAsync({ name: name.trim(), price: price ?? 0, category_id: catId ? Number(catId) : null, track_stock: track, stock: track ? Number(stock) || 0 : 0, is_active: active });
      toast.success(product ? 'Producto actualizado' : 'Producto creado'); onClose();
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Modal open={open} onClose={onClose} title={product ? 'Editar producto' : 'Nuevo producto'} size="sm"
      footer={<Button full size="lg" variant="primary" loading={m.isPending} disabled={!name.trim() || price == null} onClick={submit}>Guardar</Button>}>
      <div className="space-y-4">
        <Field label="Nombre"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Cerveza Corona 355ml" maxLength={80} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Precio de venta"><MoneyInput value={price} onChange={setPrice} /></Field>
          <Field label="Categoría"><Select value={catId} onChange={(e) => setCatId(e.target.value)}><option value="">Sin categoría</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        </div>
        <label className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-gold" checked={track} onChange={(e) => setTrack(e.target.checked)} /><span><b>Controlar inventario</b><span className="block text-xs text-fg-muted">Desactívalo para cócteles o preparados sin stock fijo.</span></span></label>
        {track && <Field label={product ? 'Stock actual (corrige si es necesario)' : 'Stock inicial'}><Input type="number" inputMode="numeric" min={0} value={stock} onChange={(e) => setStock(e.target.value)} /></Field>}
        {product && <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-gold" checked={active} onChange={(e) => setActive(e.target.checked)} />Producto activo (visible para los meseros)</label>}
      </div>
    </Modal>
  );
}

function StockModal({ open, onClose, product }: { open: boolean; onClose: () => void; product: Product | null }) {
  const toast = useToast();
  const [mode, setMode] = useState<'in' | 'out'>('in');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const m = useInvalidatingMutation((b: object) => api.post(`/products/${product!.id}/stock`, b), PRODUCT_KEYS);
  const n = Number(qty) || 0;
  return (
    <Modal open={open} onClose={onClose} title={`Inventario · ${product?.name ?? ''}`} size="sm"
      footer={<Button full size="lg" variant="primary" loading={m.isPending} disabled={n <= 0 || !reason.trim()} onClick={async () => { try { await m.mutateAsync({ delta: mode === 'in' ? n : -n, reason: reason.trim() }); toast.success('Inventario actualizado'); onClose(); } catch (e) { toast.error((e as Error).message); } }}>{mode === 'in' ? 'Registrar entrada' : 'Registrar salida'}</Button>}>
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">Stock actual: <b className="text-fg">{product?.stock}</b></p>
        <Segmented className="w-full [&>button]:flex-1" value={mode} onChange={setMode} options={[{ value: 'in', label: 'Entrada (compra)' }, { value: 'out', label: 'Salida (merma)' }]} />
        <Field label="Cantidad"><Input autoFocus type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Motivo"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === 'in' ? 'Ej: compra a proveedor' : 'Ej: botella rota, vencido'} maxLength={120} /></Field>
        {n > 0 && <p className="text-sm">Quedarán <b className={cn((product?.stock ?? 0) + (mode === 'in' ? n : -n) < 0 ? 'text-danger' : 'text-ok')}>{(product?.stock ?? 0) + (mode === 'in' ? n : -n)}</b> unidades.</p>}
      </div>
    </Modal>
  );
}

/* ---------------- Categorías ---------------- */
function Categories() {
  const { data, isLoading } = useCategories();
  const toast = useToast();
  const confirm = useConfirm();
  const { isOwner } = useAuth();
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const save = useInvalidatingMutation((b: { id?: number; name: string }) => (b.id ? api.put(`/categories/${b.id}`, { name: b.name }) : api.post('/categories', { name: b.name })), PRODUCT_KEYS);
  const del = useInvalidatingMutation((id: number) => api.delete(`/categories/${id}`), PRODUCT_KEYS);
  const reorder = useInvalidatingMutation((b: { id: number; name: string; sort_order: number }) => api.put(`/categories/${b.id}`, b), PRODUCT_KEYS);
  if (isLoading) return <PageLoader />;
  const list = data ?? [];
  const submit = async () => {
    try { await save.mutateAsync({ id: editing?.id, name: name.trim() }); toast.success('Guardado'); setEditing(null); setCreating(false); setName(''); }
    catch (e) { toast.error((e as Error).message); }
  };
  const moveCat = async (i: number, dir: -1 | 1) => {
    const a = list[i]; const b = list[i + dir]; if (!a || !b) return;
    await Promise.all([reorder.mutateAsync({ id: a.id, name: a.name, sort_order: b.sort_order }), reorder.mutateAsync({ id: b.id, name: b.name, sort_order: a.sort_order })]);
  };
  return (
    <Card>
      <CardHeader title="Categorías" subtitle="El orden aquí es el orden en que las ven los meseros." action={<Button variant="primary" size="sm" icon={Plus} onClick={() => { setCreating(true); setName(''); }}>Nueva</Button>} />
      {list.length === 0 ? <EmptyState icon={Tags} title="Sin categorías" /> : (
        <ul className="divide-y divide-line">
          {list.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
              <div className="flex flex-col"><button type="button" className="rounded p-0.5 text-fg-faint hover:text-fg disabled:opacity-20" disabled={i === 0} onClick={() => moveCat(i, -1)} aria-label="Subir">▲</button><button type="button" className="rounded p-0.5 text-fg-faint hover:text-fg disabled:opacity-20" disabled={i === list.length - 1} onClick={() => moveCat(i, 1)} aria-label="Bajar">▼</button></div>
              <GripVertical className="h-4 w-4 text-fg-faint" />
              <span className="flex-1 font-medium">{c.name}<span className="ml-2 text-xs text-fg-muted">{c.product_count} productos</span></span>
              <button type="button" className="rounded-lg p-2 text-fg-muted hover:text-fg" aria-label="Editar" onClick={() => { setEditing(c); setName(c.name); }}><Pencil className="h-4 w-4" /></button>
              {isOwner && <button type="button" className="rounded-lg p-2 text-fg-muted hover:text-danger" aria-label="Eliminar" onClick={async () => { if (await confirm({ title: `Eliminar ${c.name}`, danger: true, confirmText: 'Eliminar' })) { try { await del.mutateAsync(c.id); toast.success('Eliminada'); } catch (e) { toast.error((e as Error).message); } } }}><Trash2 className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={creating || !!editing} onClose={() => { setCreating(false); setEditing(null); }} title={editing ? 'Editar categoría' : 'Nueva categoría'} size="sm"
        footer={<Button full size="lg" variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={submit}>Guardar</Button>}>
        <Field label="Nombre"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} onKeyDown={(e) => e.key === 'Enter' && name.trim() && submit()} /></Field>
      </Modal>
    </Card>
  );
}

/* ---------------- Mesas ---------------- */
function Tables() {
  const { data, isLoading } = useTables();
  const toast = useToast();
  const confirm = useConfirm();
  const { isOwner } = useAuth();
  const [editing, setEditing] = useState<TableRow | null | 'new'>(null);
  const del = useInvalidatingMutation((id: number) => api.delete<{ deactivated: boolean }>(`/tables/${id}`), [keys.tables, keys.floor]);
  if (isLoading) return <PageLoader />;
  const list = data ?? [];
  return (
    <Card>
      <CardHeader title={`${list.filter((t) => t.is_active).length} mesas`} action={<Button variant="primary" size="sm" icon={Plus} onClick={() => setEditing('new')}>Nueva mesa</Button>} />
      {list.length === 0 ? <EmptyState icon={Armchair} title="Sin mesas" /> : (
        <Table>
          <thead><tr><th>Nombre</th><th>Tipo</th><th className="text-right">Puestos</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id} className={cn(!t.is_active && 'opacity-50')}>
                <td className="font-medium">{t.name}</td>
                <td className="text-fg-muted">{t.type === 'bar' ? 'Barra' : 'Mesa'}</td>
                <td className="text-right tabular-nums">{t.capacity}</td>
                <td>{t.is_active ? <Badge tone="ok">Activa</Badge> : <Badge tone="muted">Inactiva</Badge>}</td>
                <td className="text-right whitespace-nowrap">
                  <button type="button" className="rounded-lg p-2 text-fg-muted hover:text-fg" aria-label="Editar" onClick={() => setEditing(t)}><Pencil className="h-4 w-4" /></button>
                  {isOwner && <button type="button" className="rounded-lg p-2 text-fg-muted hover:text-danger" aria-label="Eliminar" onClick={async () => { if (await confirm({ title: `Eliminar ${t.name}`, message: 'Si tiene historial de cuentas se marcará como inactiva.', danger: true, confirmText: 'Eliminar' })) { try { const r = await del.mutateAsync(t.id); toast.success(r.deactivated ? 'Mesa desactivada' : 'Mesa eliminada'); } catch (e) { toast.error((e as Error).message); } } }}><Trash2 className="h-4 w-4" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <TableModal key={editing === 'new' ? 'new' : editing?.id ?? 'closed'} open={editing !== null} onClose={() => setEditing(null)} table={editing === 'new' ? null : editing} />
    </Card>
  );
}

function TableModal({ open, onClose, table }: { open: boolean; onClose: () => void; table: TableRow | null }) {
  const toast = useToast();
  const [name, setName] = useState(table?.name ?? '');
  const [type, setType] = useState<TableType>(table?.type ?? 'table');
  const [capacity, setCapacity] = useState(String(table?.capacity ?? 4));
  const [active, setActive] = useState(table ? table.is_active === 1 : true);
  const m = useInvalidatingMutation((b: object) => (table ? api.put(`/tables/${table.id}`, b) : api.post('/tables', b)), [keys.tables, keys.floor]);
  return (
    <Modal open={open} onClose={onClose} title={table ? 'Editar mesa' : 'Nueva mesa'} size="sm"
      footer={<Button full size="lg" variant="primary" loading={m.isPending} disabled={!name.trim()} onClick={async () => { try { await m.mutateAsync({ name: name.trim(), type, capacity: Number(capacity) || 4, is_active: active }); toast.success('Guardado'); onClose(); } catch (e) { toast.error((e as Error).message); } }}>Guardar</Button>}>
      <div className="space-y-4">
        <Field label="Nombre"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Mesa 12, Barra 3, Terraza 1" maxLength={40} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo"><Select value={type} onChange={(e) => setType(e.target.value as TableType)}><option value="table">Mesa</option><option value="bar">Barra</option></Select></Field>
          <Field label="Puestos"><Input type="number" inputMode="numeric" min={1} max={50} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>
        </div>
        {table && <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-gold" checked={active} onChange={(e) => setActive(e.target.checked)} />Mesa activa</label>}
      </div>
    </Modal>
  );
}
