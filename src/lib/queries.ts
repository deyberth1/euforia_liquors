import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from './api';
import type {
  CashSession, Category, Credit, DashboardData, Floor, MySummary, Order, Product, SalesReport, Schedule, TableRow, Transaction, User,
} from '@shared/types';

export const keys = {
  floor: ['floor'] as const,
  order: (id: number) => ['order', id] as const,
  orders: (params: Record<string, string>) => ['orders', params] as const,
  products: (all?: boolean) => ['products', !!all] as const,
  categories: ['categories'] as const,
  tables: ['tables'] as const,
  cash: ['cash'] as const,
  cashSessions: (p: Record<string, string>) => ['cash-sessions', p] as const,
  transactions: (p: Record<string, string>) => ['transactions', p] as const,
  credits: (p: Record<string, string>) => ['credits', p] as const,
  users: ['users'] as const,
  schedules: (p: Record<string, string>) => ['schedules', p] as const,
  dashboard: ['dashboard'] as const,
  sales: (p: Record<string, string>) => ['sales', p] as const,
};

const LIVE = { refetchInterval: 5000, refetchIntervalInBackground: false, refetchOnWindowFocus: true } as const;

export const useFloor = () => useQuery({ queryKey: keys.floor, queryFn: () => api.get<Floor>('/floor'), ...LIVE });
export const useOrder = (id: number) => useQuery({ queryKey: keys.order(id), queryFn: () => api.get<Order>(`/orders/${id}`), enabled: id > 0, ...LIVE });
export const useOrders = (params: Record<string, string>) => useQuery({ queryKey: keys.orders(params), queryFn: () => api.get<Order[]>(`/orders${qs(params)}`) });
export const useProducts = (all = false) => useQuery({ queryKey: keys.products(all), queryFn: () => api.get<Product[]>(`/products${all ? '?all=1' : ''}`), staleTime: 30_000 });
export const useCategories = () => useQuery({ queryKey: keys.categories, queryFn: () => api.get<Category[]>('/categories'), staleTime: 60_000 });
export const useTables = () => useQuery({ queryKey: keys.tables, queryFn: () => api.get<TableRow[]>('/tables') });
export const useCash = () => useQuery({ queryKey: keys.cash, queryFn: () => api.get<CashSession | null>('/cash/current'), ...LIVE });
export const useCashSessions = (p: Record<string, string>) => useQuery({ queryKey: keys.cashSessions(p), queryFn: () => api.get<CashSession[]>(`/cash/sessions${qs(p)}`) });
export const useTransactions = (p: Record<string, string>) => useQuery({ queryKey: keys.transactions(p), queryFn: () => api.get<Transaction[]>(`/transactions${qs(p)}`) });
export const useCredits = (p: Record<string, string>) => useQuery({ queryKey: keys.credits(p), queryFn: () => api.get<Credit[]>(`/credits${qs(p)}`) });
export const useUsers = () => useQuery({ queryKey: keys.users, queryFn: () => api.get<User[]>('/users') });
export const useSchedules = (p: Record<string, string>) => useQuery({ queryKey: keys.schedules(p), queryFn: () => api.get<Schedule[]>(`/schedules${qs(p)}`) });
export const useMySummary = () => useQuery({ queryKey: ['me-summary'], queryFn: () => api.get<MySummary>('/me/summary'), ...LIVE });
export const useFrequent = () => useQuery({ queryKey: ['products-frequent'], queryFn: () => api.get<number[]>('/products/frequent'), staleTime: 5 * 60_000 });
export const useDashboard = () => useQuery({ queryKey: keys.dashboard, queryFn: () => api.get<DashboardData>('/reports/dashboard'), refetchInterval: 15_000 });
export const useSalesReport = (p: Record<string, string>) => useQuery({ queryKey: keys.sales(p), queryFn: () => api.get<SalesReport>(`/reports/sales${qs(p)}`) });

/** Mutación genérica que invalida las consultas indicadas al terminar. */
export function useInvalidatingMutation<TVars, TData = unknown>(fn: (v: TVars) => Promise<TData>, invalidate: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { for (const k of invalidate) qc.invalidateQueries({ queryKey: k }); },
  });
}

export const ORDER_RELATED = [keys.floor, ['order'], ['orders'], keys.cash, keys.dashboard, ['products'], ['me-summary'], ['staff']] as const;
