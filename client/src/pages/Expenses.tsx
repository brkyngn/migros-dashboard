import { useCallback, useEffect, useState } from 'react';
import type { Expense, ExpenseCategory, Product, RecurringExpense } from '../types/finance';
import {
  fetchExpenses, fetchCategories, fetchProducts, fetchRecurring,
  createExpense, updateExpense, deleteExpense,
} from '../api/finance';
import ExpenseForm from '../components/finance/ExpenseForm';
import CategoryManager from '../components/finance/CategoryManager';
import RecurringManager from '../components/finance/RecurringManager';
import InvoiceUpload from '../components/finance/InvoiceUpload';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import { formatTLDec } from '../utils/formatters';

type Tab = 'giderler' | 'fatura' | 'kategoriler' | 'tekrarlayan';

const KAYNAK_LABEL: Record<string, string> = { manuel: 'Manuel', fatura_ai: 'Fatura AI', tekrar: 'Tekrarlayan' };

function exportCsv(rows: Expense[]) {
  const header = ['Tarih', 'Tedarikçi', 'Kategori', 'Açıklama', 'Net Tutar', 'KDV Oranı', 'KDV Tutarı', 'Brüt Tutar', 'Fatura No', 'Kaynak'];
  const lines = rows.map(e => [
    e.tarih?.slice(0, 10), e.tedarikci || '', e.kategori_ad || '', (e.aciklama || '').replace(/;/g, ','),
    String(e.net_tutar).replace('.', ','), `%${e.kdv_orani}`, String(e.kdv_tutari).replace('.', ','),
    String(e.brut_tutar).replace('.', ','), e.fatura_no || '', KAYNAK_LABEL[e.kaynak] || e.kaynak,
  ].join(';'));
  // UTF-8 BOM — Excel'in Türkçe karakterleri doğru açması için
  const blob = new Blob(['﻿' + [header.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `giderler-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Expenses() {
  const [tab, setTab] = useState<Tab>('giderler');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [recurring, setRecurring] = useState<RecurringExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<Expense | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Filtreler
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kategoriId, setKategoriId] = useState<number | ''>('');
  const [q, setQ] = useState('');

  const loadExpenses = useCallback(async () => {
    try {
      setLoadError('');
      const data = await fetchExpenses({
        from: from || undefined, to: to || undefined,
        kategori_id: kategoriId ? (kategoriId as number) : undefined, q: q || undefined,
      });
      setExpenses(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Giderler yüklenemedi');
    }
  }, [from, to, kategoriId, q]);

  const loadStatic = useCallback(async () => {
    try {
      const [cats, prods, recs] = await Promise.all([fetchCategories(), fetchProducts(), fetchRecurring()]);
      setCategories(cats); setProducts(prods); setRecurring(recs);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Veriler yüklenemedi');
    }
  }, []);

  useEffect(() => {
    Promise.all([loadStatic(), loadExpenses()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (!loading) loadExpenses(); }, [loadExpenses, loading]);

  const onCreate = async (body: Partial<Expense>) => {
    await createExpense(body);
    setShowForm(false);
    await loadExpenses();
  };

  const onUpdate = async (body: Partial<Expense>) => {
    if (!editing) return;
    await updateExpense(editing.id, body);
    setEditing(null);
    await loadExpenses();
  };

  const onDelete = async (e: Expense) => {
    if (!confirm(`${e.tarih?.slice(0, 10)} tarihli ${formatTLDec(e.brut_tutar)} tutarındaki gider silinsin mi?`)) return;
    await deleteExpense(e.id);
    await loadExpenses();
  };

  const toplam = expenses.reduce((s, e) => s + (e.net_tutar || 0), 0);
  const toplamKdv = expenses.reduce((s, e) => s + (e.kdv_tutari || 0), 0);

  const inputCls = 'text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-gray-400 bg-white';

  if (loading) return <div className="p-4 md:p-8"><LoadingSkeleton rows={6} /></div>;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'giderler', label: '🧾 Giderler' },
    { id: 'fatura', label: '🤖 Fatura Yükle (AI)' },
    { id: 'tekrarlayan', label: '🔁 Tekrarlayan' },
    { id: 'kategoriler', label: '🏷️ Kategoriler' },
  ];

  return (
    <div className="p-4 md:p-8 space-y-4">
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg -mb-px border ${tab === t.id
              ? 'bg-white border-gray-200 border-b-white text-gray-900'
              : 'bg-transparent border-transparent text-gray-500 hover:text-gray-800'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loadError && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{loadError}</div>}

      {tab === 'giderler' && (
        <div className="space-y-4">
          {/* Yeni gider / düzenleme formu */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5">
            {editing ? (
              <>
                <div className="text-sm font-semibold text-gray-700 mb-3">Gider düzenle</div>
                <ExpenseForm categories={categories} products={products} initial={editing}
                  onSave={onUpdate} onCancel={() => setEditing(null)} submitLabel="Güncelle" />
              </>
            ) : showForm ? (
              <>
                <div className="text-sm font-semibold text-gray-700 mb-3">Yeni gider</div>
                <ExpenseForm categories={categories} products={products}
                  onSave={onCreate} onCancel={() => setShowForm(false)} />
              </>
            ) : (
              <button onClick={() => setShowForm(true)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: '#1A3A5C' }}>
                + Yeni Gider
              </button>
            )}
          </div>

          {/* Filtreler + liste */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5 space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
              <span className="text-gray-400 text-sm">—</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
              <select value={kategoriId} onChange={e => setKategoriId(e.target.value ? Number(e.target.value) : '')} className={inputCls}>
                <option value="">Tüm kategoriler</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.ad}</option>)}
              </select>
              <input value={q} onChange={e => setQ(e.target.value)} className={`${inputCls} w-48`} placeholder="Ara (tedarikçi, açıklama...)" />
              <div className="flex-1" />
              <button onClick={() => exportCsv(expenses)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">
                ⬇ CSV
              </button>
            </div>

            <div className="text-xs text-gray-500">
              {expenses.length} kayıt · Net toplam <b>{formatTLDec(toplam)}</b> · KDV <b>{formatTLDec(toplamKdv)}</b>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Tarih</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Tedarikçi</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Kategori</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Açıklama</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Net</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">KDV</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Brüt</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase">Kaynak</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {expenses.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-8 text-gray-400">Gider kaydı yok</td></tr>
                  ) : expenses.slice(0, 500).map(e => (
                    <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap">{e.tarih?.slice(0, 10)}</td>
                      <td className="px-3 py-2">{e.tedarikci || '—'}</td>
                      <td className="px-3 py-2">{e.kategori_ad || '—'}</td>
                      <td className="px-3 py-2 max-w-48 truncate" title={e.aciklama || ''}>{e.aciklama || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatTLDec(e.net_tutar)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{formatTLDec(e.kdv_tutari)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{formatTLDec(e.brut_tutar)}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${e.kaynak === 'fatura_ai' ? 'bg-purple-50 text-purple-700'
                          : e.kaynak === 'tekrar' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                          {KAYNAK_LABEL[e.kaynak] || e.kaynak}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={() => { setEditing(e); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                          className="text-xs text-blue-700 hover:underline mr-2">Düzenle</button>
                        <button onClick={() => onDelete(e)} className="text-xs text-red-600 hover:underline">Sil</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {expenses.length > 500 && (
                <div className="text-center text-xs text-gray-400 py-2">İlk 500 kayıt gösteriliyor · Toplam {expenses.length}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'fatura' && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5">
          <InvoiceUpload categories={categories} products={products} onSaved={() => { loadExpenses(); setTab('giderler'); }} />
        </div>
      )}

      {tab === 'tekrarlayan' && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5">
          <RecurringManager recurring={recurring} categories={categories}
            onChanged={() => { fetchRecurring().then(setRecurring); loadExpenses(); }} />
        </div>
      )}

      {tab === 'kategoriler' && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5">
          <CategoryManager categories={categories} onChanged={() => fetchCategories().then(setCategories)} />
        </div>
      )}
    </div>
  );
}
