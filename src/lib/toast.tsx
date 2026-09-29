import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from './cn';

type Kind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: Kind; text: string }
interface ToastCtx { toast: (text: string, kind?: Kind) => void; success: (t: string) => void; error: (t: string) => void }

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback((text: string, kind: Kind = 'info') => {
    const id = ++seq.current;
    setItems((l) => [...l.slice(-3), { id, kind, text }]);
    setTimeout(() => dismiss(id), kind === 'error' ? 5000 : 3000);
  }, [dismiss]);
  const value = useMemo<ToastCtx>(() => ({ toast, success: (t) => toast(t, 'success'), error: (t) => toast(t, 'error') }), [toast]);
  const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4 safe-top">
        {items.map((t) => {
          const Icon = icons[t.kind];
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-card backdrop-blur animate-fade-up',
                t.kind === 'success' && 'border-ok/30 bg-surface-2/95 text-fg',
                t.kind === 'error' && 'border-danger/40 bg-surface-2/95 text-fg',
                t.kind === 'info' && 'border-line-strong bg-surface-2/95 text-fg',
              )}
            >
              <Icon className={cn('h-5 w-5 shrink-0', t.kind === 'success' && 'text-ok', t.kind === 'error' && 'text-danger', t.kind === 'info' && 'text-info')} />
              <span className="flex-1">{t.text}</span>
              <button onClick={() => dismiss(t.id)} className="rounded-md p-1 text-fg-muted hover:text-fg" aria-label="Cerrar"><X className="h-4 w-4" /></button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast fuera de ToastProvider');
  return v;
}
