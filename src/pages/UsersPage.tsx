import { useState } from 'react';
import { Plus, Pencil, Trash2, Users, ShieldCheck, UserRound, Crown } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Segmented, useConfirm } from '@/components/ui';
import { keys, useInvalidatingMutation, useUsers } from '@/lib/queries';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { fmtDateTime, ROLE_LABEL } from '@/lib/format';
import { initials } from '@/components/layout/AppShell';
import { cn } from '@/lib/cn';
import type { Role, User } from '@shared/types';

export function UsersPage() {
  const { data, isLoading } = useUsers();
  const { user: me } = useAuth();
  const [editing, setEditing] = useState<User | null | 'new'>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const del = useInvalidatingMutation((id: number) => api.delete<{ deactivated: boolean }>(`/users/${id}`), [keys.users]);
  if (isLoading) return <PageLoader />;
  const list = data ?? [];
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="Usuarios" subtitle={`${list.filter((u) => u.role === 'owner' && u.is_active).length} dueño(s) · ${list.filter((u) => u.role === 'admin' && u.is_active).length} administradores · ${list.filter((u) => u.role === 'waiter' && u.is_active).length} meseros`} actions={<Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Nuevo usuario</Button>} />
      {list.length === 0 ? <EmptyState icon={Users} title="Sin usuarios" /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((u) => (
            <Card key={u.id} className={cn(!u.is_active && 'opacity-60')}>
              <div className="flex items-center gap-3">
                <div className={cn('flex h-11 w-11 items-center justify-center rounded-full font-bold', u.role === 'owner' ? 'bg-gold text-gold-ink' : u.role === 'admin' ? 'bg-gold/15 text-gold' : 'bg-info/15 text-info')}>{initials(u.full_name)}</div>
                <div className="min-w-0 flex-1"><div className="truncate font-semibold">{u.full_name}{u.id === me?.id && <span className="ml-1 text-xs text-fg-faint">(tú)</span>}</div><div className="truncate text-xs text-fg-muted">@{u.username}</div></div>
                <Badge tone={u.role === 'waiter' ? 'info' : 'gold'}>{u.role === 'owner' ? <Crown className="h-3 w-3" /> : u.role === 'admin' ? <ShieldCheck className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}{ROLE_LABEL[u.role]}</Badge>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-fg-muted">
                <span>{u.is_active ? (u.last_login_at ? `Último acceso ${fmtDateTime(u.last_login_at)}` : 'Nunca ha entrado') : 'Desactivado'}</span>
                <div className="flex">
                  <button type="button" className="rounded-lg p-2 text-fg-muted hover:text-fg" aria-label="Editar" onClick={() => setEditing(u)}><Pencil className="h-4 w-4" /></button>
                  {u.id !== me?.id && <button type="button" className="rounded-lg p-2 text-fg-muted hover:text-danger" aria-label="Eliminar" onClick={async () => { if (await confirm({ title: `Eliminar a ${u.full_name}`, message: 'Si tiene ventas registradas se desactivará para conservar el historial.', danger: true, confirmText: 'Eliminar' })) { try { const r = await del.mutateAsync(u.id); toast.success(r.deactivated ? 'Usuario desactivado' : 'Usuario eliminado'); } catch (e) { toast.error((e as Error).message); } } }}><Trash2 className="h-4 w-4" /></button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <UserModal key={editing === 'new' ? 'new' : editing?.id ?? 'closed'} open={editing !== null} onClose={() => setEditing(null)} user={editing === 'new' ? null : editing} />
    </div>
  );
}

function UserModal({ open, onClose, user }: { open: boolean; onClose: () => void; user: User | null }) {
  const toast = useToast();
  const { user: me } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'waiter');
  const [password, setPassword] = useState('');
  const [active, setActive] = useState(user ? user.is_active === 1 : true);
  const m = useInvalidatingMutation((b: object) => (user ? api.put(`/users/${user.id}`, b) : api.post('/users', b)), [keys.users]);
  const valid = fullName.trim() && username.trim().length >= 3 && (user || password.length >= 4);
  return (
    <Modal open={open} onClose={onClose} title={user ? 'Editar usuario' : 'Nuevo usuario'} size="sm"
      footer={<Button full size="lg" variant="primary" loading={m.isPending} disabled={!valid} onClick={async () => { try { await m.mutateAsync({ full_name: fullName.trim(), username: username.trim().toLowerCase(), role, password: password || undefined, is_active: active }); toast.success('Guardado'); onClose(); } catch (e) { toast.error((e as Error).message); } }}>Guardar</Button>}>
      <div className="space-y-4">
        <Field label="Nombre completo"><Input autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} /></Field>
        <Field label="Usuario (para entrar)" hint="Solo letras, números, punto o guion"><Input autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} maxLength={30} /></Field>
        <Field label="Rol">
          <Segmented className="w-full [&>button]:flex-1" value={role} onChange={setRole} options={[{ value: 'waiter', label: 'Mesero' }, { value: 'admin', label: 'Admin' }, { value: 'owner', label: 'Dueño' }]} />
          <p className="mt-1.5 text-xs text-fg-faint">{role === 'waiter' ? 'Abre mesas y anota productos desde su celular. No cobra ni ve la caja.' : role === 'admin' ? 'Opera el negocio: cobra, maneja la caja, inventario, créditos, turnos y equipo. No ve reportes ni usuarios, y no puede eliminar ni anular.' : 'Acceso total: además de todo lo del administrador, ve Inicio y Reportes, administra usuarios y puede eliminar o anular cualquier cosa.'}</p>
        </Field>
        <Field label={user ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña'} hint="Mínimo 4 caracteres"><Input type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={200} /></Field>
        {user && user.id !== me?.id && <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-gold" checked={active} onChange={(e) => setActive(e.target.checked)} />Usuario activo (puede iniciar sesión)</label>}
      </div>
    </Modal>
  );
}
