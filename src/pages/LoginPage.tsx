import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Button, Field, Input } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export function LoginPage() {
  const { user, login, loading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try { await login(username.trim(), password); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[radial-gradient(ellipse_at_top,rgba(217,180,91,0.12),transparent_55%)] px-4 py-10">
      <div className="w-full max-w-sm animate-fade-up">
        <Logo size="lg" className="mb-10" />
        <form onSubmit={submit} className="card space-y-4 p-6">
          <Field label="Usuario">
            <Input autoFocus autoCapitalize="none" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="tu usuario" required />
          </Field>
          <Field label="Contraseña">
            <div className="relative">
              <Input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required className="pr-12" />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-fg-muted hover:text-fg" aria-label={show ? 'Ocultar' : 'Mostrar'}>
                {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </Field>
          {error && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <Button type="submit" variant="primary" size="lg" full loading={busy} icon={LogIn}>Entrar</Button>
        </form>
        <p className="mt-6 text-center text-xs text-fg-faint">Euforia Liquors · Sistema de mesas y caja</p>
      </div>
    </div>
  );
}
