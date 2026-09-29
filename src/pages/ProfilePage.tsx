import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, KeyRound, Smartphone, ChevronRight } from 'lucide-react';
import { Button, Card, CardHeader, Field, Input, PageHeader } from '@/components/ui';
import { NAV_ITEMS, initials } from '@/components/layout/AppShell';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { api } from '@/lib/api';
import { ROLE_LABEL, hasRole } from '@/lib/format';

interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void> }

export function ProfilePage() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [install, setInstall] = useState<BeforeInstallPromptEvent | null>(null);
  const standalone = typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone);

  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setInstall(e as BeforeInstallPromptEvent); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  const changePwd = async () => {
    setBusy(true);
    try { await api.put('/auth/me/password', { current_password: cur, new_password: next }); toast.success('Contraseña actualizada'); setCur(''); setNext(''); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const items = NAV_ITEMS.filter((n) => hasRole(user?.role, n.min) && (!n.only || n.only === user?.role) && n.to !== '/perfil');
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="Perfil" />
      <Card className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gold/15 text-lg font-bold text-gold">{initials(user?.full_name ?? '')}</div>
        <div className="min-w-0 flex-1"><div className="truncate text-lg font-semibold">{user?.full_name}</div><div className="text-sm text-fg-muted">@{user?.username} · {ROLE_LABEL[user?.role ?? '']}</div></div>
        <Button variant="danger" size="sm" icon={LogOut} onClick={logout}>Cerrar sesión</Button>
      </Card>

      <Card className="md:hidden">
        <CardHeader title="Todos los módulos" />
        <ul className="divide-y divide-line">
          {items.map((n) => <li key={n.to}><Link to={n.to} className="flex items-center gap-3 py-3 text-sm font-medium hover:text-gold"><n.icon className="h-5 w-5 text-fg-muted" />{n.label}<ChevronRight className="ml-auto h-4 w-4 text-fg-faint" /></Link></li>)}
        </ul>
      </Card>

      {!standalone && (install || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) && (
        <Card>
          <CardHeader title="Instalar en el celular" subtitle="Ábrela como una app, a pantalla completa y con su ícono." />
          {install ? <Button variant="primary" icon={Smartphone} onClick={() => install.prompt()}>Instalar aplicación</Button>
            : <p className="text-sm text-fg-muted">{isIOS ? 'En Safari toca el botón Compartir y luego “Añadir a pantalla de inicio”.' : 'En Chrome abre el menú ⋮ y elige “Instalar aplicación” o “Añadir a pantalla de inicio”.'}</p>}
        </Card>
      )}

      <Card>
        <CardHeader title="Cambiar contraseña" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contraseña actual"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
          <Field label="Nueva contraseña" hint="Mínimo 4 caracteres"><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        </div>
        <Button className="mt-3" icon={KeyRound} loading={busy} disabled={!cur || next.length < 4} onClick={changePwd}>Actualizar contraseña</Button>
      </Card>

      <Button full size="lg" variant="danger" icon={LogOut} onClick={logout}>Cerrar sesión</Button>
    </div>
  );
}
