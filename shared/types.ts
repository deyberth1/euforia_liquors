// Tipos compartidos entre el API (server/) y la interfaz (src/).

export type Role = 'owner' | 'admin' | 'waiter';
export type PaymentMethod = 'cash' | 'transfer';
/** Forma de cierre de una cuenta: efectivo, transferencia, mixto (ambos) o crédito (queda por cobrar). */
export type OrderPayment = 'cash' | 'transfer' | 'mixed' | 'credit';
export type OrderStatus = 'open' | 'paid' | 'cancelled';
export type TableType = 'table' | 'bar';
export type TransactionType = 'income' | 'expense';
export type CreditType = 'receivable' | 'payable';

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  is_active: number;
  last_login_at: string | null;
  last_seen_at?: string | null;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  sort_order: number;
  product_count?: number;
}

export interface Product {
  id: number;
  name: string;
  price: number;
  category_id: number | null;
  category_name: string | null;
  stock: number;
  track_stock: number;
  is_active: number;
}

export interface TableRow {
  id: number;
  name: string;
  type: TableType;
  capacity: number;
  sort_order: number;
  is_active: number;
}

export interface OpenOrderSummary {
  id: number;
  table_id: number | null;
  label: string | null;
  opened_at: string;
  opened_by: number;
  opened_by_name: string;
  items_count: number;
  total: number;
  /** El mesero pidió la cuenta (cliente paga en caja) o ya recibió el dinero. */
  bill_requested_at: string | null;
  bill_requested_by_name: string | null;
}

export interface FloorTable extends TableRow {
  order: OpenOrderSummary | null;
}

export interface Floor {
  tables: FloorTable[];
  looseOrders: OpenOrderSummary[];
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  notes: string | null;
  added_by: number;
  added_by_name: string;
  created_at: string;
}

export interface Order {
  id: number;
  table_id: number | null;
  table_name: string | null;
  label: string | null;
  status: OrderStatus;
  opened_by: number;
  opened_by_name: string;
  opened_at: string;
  closed_by: number | null;
  closed_by_name: string | null;
  closed_at: string | null;
  payment_method: OrderPayment | null;
  subtotal: number;
  discount: number;
  total: number;
  paid_cash: number;
  paid_transfer: number;
  credit_id: number | null;
  cash_received: number | null;
  notes: string | null;
  bill_requested_at: string | null;
  bill_requested_by: number | null;
  bill_requested_by_name: string | null;
  items: OrderItem[];
}

export interface Transaction {
  id: number;
  type: TransactionType;
  amount: number;
  description: string;
  payment_method: PaymentMethod;
  order_id: number | null;
  credit_id: number | null;
  cash_session_id: number | null;
  created_by: number;
  created_by_name: string;
  created_at: string;
}

export interface CashSummary {
  salesCount: number;
  salesTotal: number;
  salesCash: number;
  salesTransfer: number;
  salesCredit: number;
  otherIncomeCash: number;
  otherIncomeTransfer: number;
  expenseCash: number;
  expenseTransfer: number;
  expectedCash: number;
}

export interface CashSession {
  id: number;
  status: 'open' | 'closed';
  opened_by: number;
  opened_by_name: string;
  opening_balance: number;
  closing_balance: number | null;
  expected_cash: number | null;
  difference: number | null;
  opened_at: string;
  closed_at: string | null;
  closed_by: number | null;
  closed_by_name: string | null;
  notes: string | null;
  summary?: CashSummary;
}

export interface Credit {
  id: number;
  type: CreditType;
  party: string;
  description: string;
  total: number;
  paid: number;
  balance: number;
  status: 'open' | 'closed';
  due_date: string | null;
  order_id: number | null;
  created_at: string;
  closed_at: string | null;
}

export interface Schedule {
  id: number;
  user_id: number;
  user_name: string;
  work_date: string;
  start_time: string;
  end_time: string;
  notes: string | null;
}

export interface DaySeries { date: string; total: number; count: number }
export interface HourSeries { hour: number; total: number; count: number }

export interface DashboardData {
  today: string;
  sales: { count: number; total: number; cash: number; transfer: number; credit: number };
  yesterday: { count: number; total: number };
  sameDayLastWeek: { count: number; total: number };
  month: { count: number; total: number; label: string };
  openOrders: { count: number; total: number };
  cash: CashSession | null;
  lowStock: Product[];
  last30Days: DaySeries[];
  todayByHour: HourSeries[];
  topProducts: { product_name: string; quantity: number; total: number }[];
  byCategoryToday: { category_name: string; total: number; quantity: number }[];
  byWaiterToday: { user_name: string; total: number; count: number }[];
}

export interface SalesReport {
  from: string;
  to: string;
  totals: { count: number; total: number; cash: number; transfer: number; credit: number; discount: number };
  byDay: { date: string; count: number; total: number }[];
  byProduct: { product_name: string; category_name: string | null; quantity: number; total: number }[];
  byCategory: { category_name: string; quantity: number; total: number }[];
  byWaiter: { user_name: string; count: number; total: number }[];
  byHour: { hour: number; count: number; total: number }[];
  byWeekday: { weekday: number; count: number; total: number; days: number }[];
  byPayment: { method: 'cash' | 'transfer' | 'credit'; total: number }[];
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface StaffLive {
  user_id: number;
  user_name: string;
  role: Role;
  /** Sesión activa: actividad en los últimos minutos y sin haber cerrado sesión. */
  online: boolean;
  last_seen_at: string | null;
  tables: { order_id: number; table_name: string; items: number; total: number; opened_at: string }[];
  items_added: number;
  amount_added: number;
}

export interface StaffStat {
  user_id: number;
  user_name: string;
  role: Role;
  orders_opened: number;
  items_sold: number;
  amount_sold: number;
  avg_ticket: number;
  top_product: string | null;
  first_activity: string | null;
  last_activity: string | null;
}

export interface StaffReport {
  from: string;
  to: string;
  session_id: number | null;
  live: StaffLive[];
  stats: StaffStat[];
}

/** Resumen personal del mesero ("Mi noche"). */
export interface MySummary {
  date: string;
  session_id: number | null;
  openTables: { order_id: number; table_name: string; total: number; my_items: number; my_amount: number; opened_at: string; bill_requested_at: string | null }[];
  today: { tables: number; items: number; amount: number; firstActivity: string | null; lastActivity: string | null };
  products: { product_name: string; quantity: number; total: number }[];
  bestTable: { table_name: string; total: number } | null;
}
