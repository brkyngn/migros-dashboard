import { useEffect, useState, useMemo } from 'react';
import { fetchStockReport, fetchStockDates } from '../api/migros';
import type { StockRecord } from '../types';
import { calcStockStatus, PRODUCTS } from '../utils/calculations';
import { formatTL, formatNum } from '../utils/formatters';
import DataTable from '../components/common/DataTable';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

interface Props { initialFilter?: string; }

export default function StockAlerts({ initialFilter }: Props) {
  const [stock, setStock] = useState<StockRecord[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'zero' | 'critical' | 'warning'>(
    (initialFilter as 'zero' | 'critical' | 'warning') || 'zero'
  );
  const [skuFilter, setSkuFilter] = useState('all');

  useEffect(() => {
    fetchStockDates().then(d => {
      setDates(d);
      if (d.length) { setSelectedDate(d[0]); return fetchStockReport(d[0]); }
      return fetchStockReport();
    }).then(setStock).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    fetchStockReport(selectedDate).then(setStock).finally(() => setLoading(false));
  }, [selectedDate]);

  const categorized = useMemo(() => {
    return stock.filter(r => {
      const status = calcStockStatus(parseFloat(r.STOK_GUN) || 0, parseFloat(r.STOK_MIKTARI) || 0);
      const skuOk = skuFilter === 'all' || r.SATICI_URUN_KODU === skuFilter;
      return status === tab && skuOk;
    });
  }, [stock, tab, skuFilter]);

  const counts = useMemo(() => ({
    zero:     stock.filter(r => calcStockStatus(parseFloat(r.STOK_GUN)||0, parseFloat(r.STOK_MIKTARI)||0) === 'zero').length,
    critical: stock.filter(r => calcStockStatus(parseFloat(r.STOK_GUN)||0, parseFloat(r.STOK_MIKTARI)||0) === 'critical').length,
    warning:  stock.filter(r => calcStockStatus(parseFloat(r.STOK_GUN)||0, parseFloat(r.STOK_MIKTARI)||0) === 'warning').length,
  }), [stock]);

  const dailyLoss = stock.filter(r => calcStockStatus(parseFloat(r.STOK_GUN)||0, parseFloat(r.STOK_MIKTARI)||0) === 'zero')
    .reduce((s, r) => s + (parseFloat(r.GUNLUK_SATIS_TUTARI) || 0), 0);

  if (loading) return <div className="p-8"><LoadingSkeleton rows={8} /></div>;

  const zeroData = categorized.map(r => ({
    ...r,
    product: r.URUN_SATICI_ADI || r.SATICI_URUN_KODU,
    store: r.TESLIM_NOKTASI_ACIKLAMA || '—',
    dailySalesQty: parseFloat(r.GUNLUK_SATIS_MIKTARI) || 0,
    dailyLoss: parseFloat(r.GUNLUK_SATIS_TUTARI) || 0,
    monthlyLoss: (parseFloat(r.GUNLUK_SATIS_TUTARI) || 0) * 30,
  }));

  const critData = categorized.map(r => ({
    ...r,
    product: r.URUN_SATICI_ADI || r.SATICI_URUN_KODU,
    store: r.TESLIM_NOKTASI_ACIKLAMA || '—',
    stockQty: parseFloat(r.STOK_MIKTARI) || 0,
    daysLeft: parseFloat(r.STOK_GUN) || 0,
    dailySalesQty: parseFloat(r.GUNLUK_SATIS_MIKTARI) || 0,
  }));

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">
      {/* Banner */}
      {(counts.zero + counts.critical) > 0 && (
        <div className="bg-red-700 text-white rounded-xl px-6 py-4 flex items-center justify-between">
          <div>
            <div className="font-bold text-lg">⛔ {counts.zero + counts.critical} lokasyon acil müdahale gerektiriyor</div>
            <div className="text-red-200 text-sm mt-0.5">Günlük tahmini ciro kaybı: {formatTL(dailyLoss)}</div>
          </div>
          {dates.length > 0 && (
            <select value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              className="bg-red-800 border border-red-500 text-white rounded-lg px-3 py-1.5 text-sm outline-none">
              {dates.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {[
          { key: 'zero' as const, icon: '⛔', label: 'Sıfır Stok', count: counts.zero, color: 'text-red-600 bg-red-50 border-red-200' },
          { key: 'critical' as const, icon: '⚠️', label: 'Kritik <7 Gün', count: counts.critical, color: 'text-orange-600 bg-orange-50 border-orange-200' },
          { key: 'warning' as const, icon: '🔵', label: 'Uyarı 7-14 Gün', count: counts.warning, color: 'text-blue-600 bg-blue-50 border-blue-200' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-5 py-2.5 rounded-lg border text-sm font-semibold transition-all ${tab === t.key ? t.color : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
          >
            {t.icon} {t.label} <span className="ml-1 font-bold">({t.count})</span>
          </button>
        ))}
        <div className="ml-auto">
          <select value={skuFilter} onChange={e => setSkuFilter(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none">
            <option value="all">Tüm Ürünler</option>
            {PRODUCTS.map(p => <option key={p.sku} value={p.sku}>{p.shortName}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        {tab === 'zero' && (
          <DataTable
            data={zeroData as unknown as Record<string, unknown>[]}
            searchKeys={['store', 'product']}
            columns={[
              { key: 'product', label: 'Ürün', render: row => <span className="text-xs font-medium">{row.product as string}</span> },
              { key: 'store', label: 'Mağaza', render: row => <span className="text-sm">{row.store as string}</span> },
              { key: 'IL_ADI', label: 'İl' },
              { key: 'dailySalesQty', label: 'G.Satış', align: 'right', render: row => formatNum(row.dailySalesQty as number) },
              { key: 'dailyLoss', label: 'G.Ciro Kaybı', align: 'right', render: row => <span className="text-red-600 font-semibold">{formatTL(row.dailyLoss as number)}</span> },
              { key: 'monthlyLoss', label: 'Aylık Tahmini', align: 'right', render: row => <span className="font-semibold">{formatTL(row.monthlyLoss as number)}</span> },
            ]}
          />
        )}
        {(tab === 'critical' || tab === 'warning') && (
          <DataTable
            data={critData as unknown as Record<string, unknown>[]}
            searchKeys={['store', 'product']}
            columns={[
              { key: 'product', label: 'Ürün', render: row => <span className="text-xs font-medium">{row.product as string}</span> },
              { key: 'store', label: 'Mağaza' },
              { key: 'IL_ADI', label: 'İl' },
              { key: 'stockQty', label: 'Stok', align: 'right', render: row => formatNum(row.stockQty as number) },
              { key: 'daysLeft', label: 'Kalan Gün', align: 'right',
                render: row => (
                  <div>
                    <div className="font-bold text-orange-600 text-sm text-right">{Math.round(row.daysLeft as number)} gün</div>
                    <div className="w-16 h-1.5 bg-gray-100 rounded-full ml-auto mt-1">
                      <div className="h-full rounded-full bg-orange-400" style={{ width: `${Math.min(100, Math.round((row.daysLeft as number) / 14 * 100))}%` }} />
                    </div>
                  </div>
                )
              },
              { key: 'dailySalesQty', label: 'G.Satış', align: 'right', render: row => formatNum(row.dailySalesQty as number) },
            ]}
          />
        )}
      </div>
    </div>
  );
}
