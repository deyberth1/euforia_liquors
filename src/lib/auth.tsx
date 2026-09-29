import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setUnauthorizedHandler, tokenStore } from './api';
import type { AuthResponse, User } from '@shared/types';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(!!tokenStore.get());
  const qc = useQueryClient();

  const logout = useCallback(() => {
    // Avisamos al servidor (para que deje de aparecer como conectado) y limpiamos sin esperar respuesta.
    if (tokenStore.get()) api.post('/auth/logout').catch(() => undefined);
    tokenStore.clear();
    setUser(null);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    const token = tokenStore.get();
    if (!token) return;
    api.get<{ user: User }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [logout]);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api.post<AuthResponse>('/auth/login', { username, password });
    tokenStore.set(r.token);
    setUser(r.user);
  }, []);

  const value = useMemo<AuthCtx>(() => ({ user, loading, isAdmin: user?.role === 'admin' || user?.role === 'owner', isOwner: user?.role === 'owner', login, logout }), [user, loading, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuera de AuthProvider');
  return v;
}
