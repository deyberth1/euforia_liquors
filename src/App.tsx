import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ToastProvider } from '@/lib/toast';
import { ConfirmProvider, PageLoader } from '@/components/ui';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { FloorPage } from '@/pages/FloorPage';
import { OrderPage } from '@/pages/OrderPage';
import { ApiError } from '@/lib/api';
import { hasRole } from '@/lib/format';

const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const QuickSalePage = lazy(() => import('@/pages/QuickSalePage').then((m) => ({ default: m.QuickSalePage })));
const CashPage = lazy(() => import('@/pages/CashPage').then((m) => ({ default: m.CashPage })));
const InventoryPage = lazy(() => import('@/pages/InventoryPage').then((m) => ({ default: m.InventoryPage })));
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const StaffPage = lazy(() => import('@/pages/StaffPage').then((m) => ({ default: m.StaffPage })));
const CreditsPage = lazy(() => import('@/pages/CreditsPage').then((m) => ({ default: m.CreditsPage })));
const SchedulesPage = lazy(() => import('@/pages/SchedulesPage').then((m) => ({ default: m.SchedulesPage })));
const UsersPage = lazy(() => import('@/pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const ProfilePage = lazy(() => import('@/pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const MyNightPage = lazy(() => import('@/pages/MyNightPage').then((m) => ({ default: m.MyNightPage })));
const ReceiptPage = lazy(() => import('@/pages/ReceiptPage').then((m) => ({ default: m.ReceiptPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && count < 2,
      staleTime: 5_000,
    },
  },
});

function Protected({ min = 'waiter', children }: { min?: 'waiter' | 'admin' | 'owner'; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasRole(user.role, min)) return <Navigate to="/mesas" replace />;
  return <>{children}</>;
}

function Home() {
  const { isAdmin } = useAuth();
  return <Navigate to={isAdmin ? '/inicio' : '/mi-noche'} replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <ConfirmProvider>
            <BrowserRouter>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/cuenta/:id/recibo" element={<Protected><ReceiptPage /></Protected>} />
                  <Route element={<Protected><AppShell /></Protected>}>
                    <Route index element={<Home />} />
                    <Route path="/mesas" element={<FloorPage />} />
                    <Route path="/mi-noche" element={<MyNightPage />} />
                    <Route path="/cuenta/:id" element={<OrderPage />} />
                    <Route path="/turnos" element={<SchedulesPage />} />
                    <Route path="/perfil" element={<ProfilePage />} />
                    <Route path="/inicio" element={<Protected min="admin"><DashboardPage /></Protected>} />
                    <Route path="/venta" element={<Protected min="admin"><QuickSalePage /></Protected>} />
                    <Route path="/caja" element={<Protected min="admin"><CashPage /></Protected>} />
                    <Route path="/inventario" element={<Protected min="admin"><InventoryPage /></Protected>} />
                    <Route path="/reportes" element={<Protected min="owner"><ReportsPage /></Protected>} />
                    <Route path="/equipo" element={<Protected min="admin"><StaffPage /></Protected>} />
                    <Route path="/creditos" element={<Protected min="admin"><CreditsPage /></Protected>} />
                    <Route path="/usuarios" element={<Protected min="owner"><UsersPage /></Protected>} />
                    <Route path="*" element={<Home />} />
                  </Route>
                </Routes>
              </Suspense>
            </BrowserRouter>
          </ConfirmProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
