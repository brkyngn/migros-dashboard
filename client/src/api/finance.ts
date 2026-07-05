import type {
  Expense, ExpenseCategory, RecurringExpense, Product,
  FinanceSettingsData, PnlWaterfall, PnlTrendRow, UnitEconomics, ParsedInvoice,
  BankAccount, BankTransaction, BankUploadResult, CariAccount, CariDetail,
} from '../types/finance';

const BASE = '';

async function j<T>(res: Response, errMsg: string): Promise<T> {
  if (!res.ok) {
    let msg = errMsg;
    try { const b = await res.json(); if (b.error) msg = b.error; } catch { /* gövde yok */ }
    throw new Error(msg);
  }
  return res.json();
}

const jsonHeaders = { 'Content-Type': 'application/json' };

// --- Kategoriler ---
export const fetchCategories = async (): Promise<ExpenseCategory[]> =>
  j(await fetch(`${BASE}/api/expense-categories`), 'Kategoriler alınamadı');

export const createCategory = async (body: Partial<ExpenseCategory>): Promise<ExpenseCategory> =>
  j(await fetch(`${BASE}/api/expense-categories`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }), 'Kategori eklenemedi');

export const updateCategory = async (id: number, body: Partial<ExpenseCategory>): Promise<ExpenseCategory> =>
  j(await fetch(`${BASE}/api/expense-categories/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }), 'Kategori güncellenemedi');

// --- Giderler ---
export const fetchExpenses = async (filters?: { from?: string; to?: string; kategori_id?: number; q?: string }): Promise<Expense[]> => {
  const params = new URLSearchParams();
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  if (filters?.kategori_id) params.set('kategori_id', String(filters.kategori_id));
  if (filters?.q) params.set('q', filters.q);
  return j(await fetch(`${BASE}/api/expenses?${params}`), 'Giderler alınamadı');
};

export const createExpense = async (body: Partial<Expense>): Promise<Expense> =>
  j(await fetch(`${BASE}/api/expenses`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }), 'Gider eklenemedi');

export const updateExpense = async (id: number, body: Partial<Expense>): Promise<Expense> =>
  j(await fetch(`${BASE}/api/expenses/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }), 'Gider güncellenemedi');

export const deleteExpense = async (id: number): Promise<void> => {
  const res = await fetch(`${BASE}/api/expenses/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Gider silinemedi');
};

export const checkDuplicate = async (fatura_no: string, tedarikci: string): Promise<{ exists: boolean; id?: number }> =>
  j(await fetch(`${BASE}/api/expenses/duplicate-check?fatura_no=${encodeURIComponent(fatura_no)}&tedarikci=${encodeURIComponent(tedarikci)}`), 'Kontrol yapılamadı');

// --- Tekrarlayan giderler ---
export const fetchRecurring = async (): Promise<RecurringExpense[]> =>
  j(await fetch(`${BASE}/api/recurring-expenses`), 'Tekrarlayan giderler alınamadı');

export const createRecurring = async (body: Partial<RecurringExpense>): Promise<RecurringExpense> =>
  j(await fetch(`${BASE}/api/recurring-expenses`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }), 'Şablon eklenemedi');

export const updateRecurring = async (id: number, body: Partial<RecurringExpense>): Promise<RecurringExpense> =>
  j(await fetch(`${BASE}/api/recurring-expenses/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }), 'Şablon güncellenemedi');

export const deactivateRecurring = async (id: number): Promise<void> => {
  const res = await fetch(`${BASE}/api/recurring-expenses/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Şablon pasife alınamadı');
};

// --- Ayarlar ---
export const fetchSettings = async (): Promise<FinanceSettingsData> =>
  j(await fetch(`${BASE}/api/settings`), 'Ayarlar alınamadı');

export const updateSettings = async (body: Partial<FinanceSettingsData>): Promise<FinanceSettingsData> =>
  j(await fetch(`${BASE}/api/settings`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }), 'Ayarlar kaydedilemedi');

// --- Ürünler ---
export const fetchProducts = async (): Promise<Product[]> =>
  j(await fetch(`${BASE}/api/products`), 'Ürünler alınamadı');

export const updateProduct = async (id: number, body: Partial<Product>): Promise<Product> =>
  j(await fetch(`${BASE}/api/products/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }), 'Ürün güncellenemedi');

// --- P&L ---
export const fetchPnl = async (from: string, to: string): Promise<PnlWaterfall> =>
  j(await fetch(`${BASE}/api/pnl?from=${from}&to=${to}`), 'P&L hesaplanamadı');

export const fetchPnlTrend = async (months = 12): Promise<PnlTrendRow[]> =>
  j(await fetch(`${BASE}/api/pnl/trend?months=${months}`), 'Trend alınamadı');

export const fetchUnitEconomics = async (from: string, to: string): Promise<UnitEconomics> =>
  j(await fetch(`${BASE}/api/pnl/unit-economics?from=${from}&to=${to}`), 'Birim ekonomisi alınamadı');

export const fetchStokSermayesi = async (): Promise<{ toplam: number; tarih: string | null; detay: { sku: string; ad: string; miktar: number; birimMaliyet: number | null; tutar: number | null }[] }> =>
  j(await fetch(`${BASE}/api/stok-sermayesi`), 'Stok sermayesi alınamadı');

// --- Fatura AI ---
export const analyzeInvoice = async (file: File): Promise<ParsedInvoice> => {
  const form = new FormData();
  form.append('file', file);
  return j(await fetch(`${BASE}/api/fatura-analiz`, { method: 'POST', body: form }), 'Fatura analiz edilemedi');
};

// --- Banka ---
export const uploadBankStatement = async (file: File): Promise<BankUploadResult> => {
  const form = new FormData();
  form.append('file', file);
  return j(await fetch(`${BASE}/api/banka/yukle`, { method: 'POST', body: form }), 'Ekstre yüklenemedi');
};

export const fetchBankAccounts = async (): Promise<BankAccount[]> =>
  j(await fetch(`${BASE}/api/banka/hesaplar`), 'Banka hesapları alınamadı');

export const fetchBankTransactions = async (filters?: {
  bank_account_id?: number; from?: string; to?: string; yon?: string; q?: string; eslesmemis?: boolean;
}): Promise<BankTransaction[]> => {
  const params = new URLSearchParams();
  if (filters?.bank_account_id) params.set('bank_account_id', String(filters.bank_account_id));
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  if (filters?.yon) params.set('yon', filters.yon);
  if (filters?.q) params.set('q', filters.q);
  if (filters?.eslesmemis) params.set('eslesmemis', '1');
  return j(await fetch(`${BASE}/api/banka/hareketler?${params}`), 'Banka hareketleri alınamadı');
};

export const assignTransactionCari = async (
  txId: number,
  opts: { cariId?: number | null; masraf?: boolean }
): Promise<void> => {
  const res = await fetch(`${BASE}/api/banka/hareket/${txId}/cari`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ cari_id: opts.cariId ?? null, masraf: !!opts.masraf }),
  });
  if (!res.ok) throw new Error('Eşleştirme yapılamadı');
};

export const deleteBankAccount = async (id: number): Promise<void> => {
  const res = await fetch(`${BASE}/api/banka/hesaplar/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Hesap silinemedi');
};

// --- Cari hesaplar ---
export const fetchCariAccounts = async (): Promise<CariAccount[]> =>
  j(await fetch(`${BASE}/api/cari`), 'Cari hesaplar alınamadı');

export const fetchCariDetail = async (id: number): Promise<CariDetail> =>
  j(await fetch(`${BASE}/api/cari/${id}`), 'Cari detayı alınamadı');

export const createCari = async (body: { ad: string; vkn?: string; iban?: string; notlar?: string }): Promise<CariAccount> =>
  j(await fetch(`${BASE}/api/cari`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }), 'Cari eklenemedi');

export const updateCari = async (id: number, body: { ad?: string; vkn?: string; iban?: string; notlar?: string }): Promise<CariAccount> =>
  j(await fetch(`${BASE}/api/cari/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }), 'Cari güncellenemedi');

export const deleteCari = async (id: number): Promise<void> => {
  const res = await fetch(`${BASE}/api/cari/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Cari silinemedi');
};
