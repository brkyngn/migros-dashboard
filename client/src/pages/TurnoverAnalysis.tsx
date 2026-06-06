import { useEffect, useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchStockReport, fetchStockDates } from '../api/migros';
import type { StockRecord } from '../types';
import { calcStockStatus, PRODUCTS } from '../utils/calculations';
import { formatTL, formatNum } from '../utils/formatters';
import KPICard from '../components/common/KPICard';
import DataTable from '../components/common/DataTable';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

export default function TurnoverAnalysis() {
  const [stock, setStock] = useState<StockRecord[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [loading, setLoading] = useState(true);

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

  const metrics = useMemo(() => {
    const totalStock = stock.reduce((s, r) => s + (parseFloat(r.STOK_MIKTARI) || 0), 0);
    const totalValue = stock.reduce((s, r) => s + (parseFloat(r.STOK_TUTARI) || 0), 0);
    const dailySalesTotal = stock.reduce((s, r) => s + (parseFloat(r.GUNLUK_SATIS_MIKTARI) || 0), 0);
    const dailyLoading = stock.reduce((s, r) => s + (parseFloat(r.GUNLUK_YUKLEME_MIKTARI) || 0), 0);
    const monthlySales = dailySalesTotal * 30;
    const turnover = totalStock > 0 ? monthlySales / totalStock : 0;
    const sgArr = stock.filter(r => parseFloat(r.STOK_GUN) > 0).map(r => parseFloat(r.STOK_GUN));
    const avgDays = sgArr.length ? sgArr.reduce((a, b) => a + b, 0) / sgArr.length : 0;
    const idleValue = stock.filter(r => (parseFloat(r.GUNLUK_SATIS_MIKTARI) || 0) === 0 && (parseFloat(r.STOK_MIKTARI) || 0) > 0)
      .reduce((s, r) => s + (parseFloat(r.STOK_TUTARI) || 0), 0);
    return { totalStock, totalValue, dailySalesTotal, dailyLoading, monthlySales, turnover, avgDays, idleValue, loadRatio: dailySalesTotal > 0 ? dailyLoading / dailySalesTotal : 0 };
  }, [stock]);

  // Histogram data
  const histData = useMemo(() => {
    const ranges = [
      { label: '<7', min: 0, max: 7 },
      { label: '7-14', min: 7, max: 14 },
      { label: '15-30', min: 14, max: 30 },
      { label: '31-60', min: 30, max: 60 },
      { label: '60+', min: 60, max: Infinity },
    ];
    return ranges.map(r => {
      const result: Record<string, number | string> = { range: r.label };
      PRODUCTS.forEach(p => {
        result[p.sku] = stock.filter(s =>
          s.SATICI_URUN_KODU === p.sku &&
          (parseFloat(s.STOK_GUN) || 0) >= r.min &&
          (parseFloat(s.STOK_GUN) || 0) < r.max
        ).length;
      });
      return result;
    });
  }, [stock]);

  // Category table
  const catRows = useMemo(() => {
    const cats = [
      { key: 'zero', label: '⛔ Sıfır Stok', cls: 'bg-red-50' },
      { key: 'critical', label: '⚠️ Kritik', cls: 'bg-orange-50' },
      { key: 'warning', label: '🔵 Uyarı', cls: 'bg-blue-50' },
      { key: 'healthy', label: '✅ Sağlıklı', cls: 'bg-green-50' },
    ];
    const totalValue = stock.reduce((s, r) => s + (parseFloat(r.STOK_TUTARI) || 0), 0);
    return cats.flatMap(cat => PRODUCTS.map(p => {
      const rows = stock.filter(r => {
        const status = calcStockStatus(parseFloat(r.STOK_GUN) || 0, parseFloat(r.STOK_MIKTARI) || 0);
        return status === cat.key && r.SATICI_URUN_KODU === p.sku;
      });
      const val = rows.reduce((s, r) => s + (parseFloat(r.STOK_TUTARI) || 0), 0);
      return { category: cat.label, product: p.shortName, locations: rows.length, qty: rows.reduce((s, r) => s + (parseFloat(r.STOK_MIKTARI) || 0), 0), value: val, share: totalValue > 0 ? val / totalValue * 100 : 0, cls: cat.cls };
    }));
  }, [stock]);

  // Idle stock
  const idleRows = useMemo(() =>
    stock.filter(r => (parseFloat(r.GUNLUK_SATIS_MIKTARI) || 0) === 0 && (parseFloat(r.STOK_MIKTARI) || 0) > 0)
      .map(r => ({ ...r, product: r.URUN_SATICI_ADI || r.SATICI_URUN_KODU, store: r.TESLIM_NOKTASI_ACIKLAMA || '—', stockQty: parseFloat(r.STOK_MIKTARI) || 0, stockVal: parseFloat(r.STOK_TUTARI) || 0, days: parseFloat(r.STOK_GUN) || 0 }))
      .sort((a, b) => b.stockVal - a.stockVal), [stock]);

  // Top turnover stores
  const topTurnover = useMemo(() =>
    stock.filter(r => (parseFloat(r.STOK_MIKTARI) || 0) > 0 && (parseFloat(r.GUNLUK_SATIS_MIKTARI) || 0) > 0)
      .map(r => {
        const stok = parseFloat(r.STOK_MIKTARI) || 0;
        const satis = parseFloat(r.GUNLUK_SATIS_MIKTARI) || 0;
        return { ...r, product: r.URUN_SATICI_ADI || r.SATICI_URUN_KODU, store: r.TESLIM_NOKTASI_ACIKLAMA || '—', stockQty: stok, daysLeft: parseFloat(r.STOK_GUN) || 0, dailySales: satis, turnover: stok > 0 ? (satis * 30) / stok : 0 };
      })
      .sort((a, b) => b.turnover - a.turnover).slice(0, 20), [stock]);

  if (loading) return <div className="p-8"><LoadingSkeleton rows={8} /></div>;

  return (
    <div className="p-8 space-y-6">
      {dates.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">Veri Tarihi:</span>
          <select value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none">
            {dates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-5 gap-4">
        <KPICard label="Stok Devir Hızı" value={`${metrics.turnover.toFixed(2)}×`} sub="aylık" color="#1E6B4A" />
        <KPICard label="Ort. Stok Günü" value={`${Math.round(metrics.avgDays)} gün`} color="#1A3A5C" />
        <KPICard label="Yıllık Devir Tahmini" value={`${(metrics.turnover * 12).toFixed(1)}×`} color="#f5a623" />
        <KPICard label="Atıl Stok Değeri" value={formatTL(metrics.idleValue)} sub="satış=0" color="#C0392B" />
        <KPICard label="Yükleme/Satış" value={`${metrics.loadRatio.toFixed(2)}×`} color="#6d28d9" />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="font-semibold text-gray-800 mb-4">Stok Gün Dağılımı (Lokasyon Sayısı)</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={histData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="range" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <Tooltip />
              {PRODUCTS.map(p => <Bar key={p.sku} dataKey={p.sku} name={p.shortName} fill={p.color} radius={[3,3,0,0]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="font-semibold text-gray-800 mb-4">Kategori Dağılım Tablosu</div>
          <table className="w-full text-xs">
            <thead><tr className="bg-gray-50 text-gray-500 uppercase tracking-wide">
              <th className="px-3 py-2 text-left">Kategori</th>
              <th className="px-3 py-2 text-left">Ürün</th>
              <th className="px-3 py-2 text-right">Lok.</th>
              <th className="px-3 py-2 text-right">Değer</th>
              <th className="px-3 py-2 text-right">Pay %</th>
            </tr></thead>
            <tbody>
              {catRows.filter(r => r.locations > 0).map((r, i) => (
                <tr key={i} className={`border-t border-gray-100 ${r.cls}`}>
                  <td className="px-3 py-1.5 font-medium">{r.category}</td>
                  <td className="px-3 py-1.5 text-gray-600">{r.product}</td>
                  <td className="px-3 py-1.5 text-right">{r.locations}</td>
                  <td className="px-3 py-1.5 text-right">{formatTL(r.value)}</td>
                  <td className="px-3 py-1.5 text-right">%{r.share.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="font-semibold text-gray-800 mb-4">Atıl Stok Listesi ({idleRows.length} lokasyon)</div>
        <DataTable
          data={idleRows as unknown as Record<string, unknown>[]}
          searchKeys={['store', 'product']}
          maxRows={50}
          columns={[
            { key: 'product', label: 'Ürün', render: row => <span className="text-xs font-medium">{row.product as string}</span> },
            { key: 'store', label: 'Mağaza' },
            { key: 'IL_ADI', label: 'İl' },
            { key: 'stockQty', label: 'Stok', align: 'right', render: row => formatNum(row.stockQty as number) },
            { key: 'stockVal', label: 'Stok Değeri', align: 'right', render: row => formatTL(row.stockVal as number) },
            { key: 'days', label: 'Stok Gün', align: 'right', render: row => <span className="text-purple-600 font-semibold">{Math.round(row.days as number)}</span> },
            { key: 'action', label: 'Aksiyon', sortable: false, render: () => <button className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-2 py-1 rounded hover:bg-blue-100">Transfer/Rotasyon</button> },
          ]}
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="font-semibold text-gray-800 mb-4">En Yüksek Devir Hızı Mağazaları (Top 20)</div>
        <DataTable
          data={topTurnover as unknown as Record<string, unknown>[]}
          searchKeys={['store', 'product']}
          columns={[
            { key: 'product', label: 'Ürün', render: row => <span className="text-xs font-medium">{row.product as string}</span> },
            { key: 'store', label: 'Mağaza' },
            { key: 'stockQty', label: 'Stok', align: 'right', render: row => formatNum(row.stockQty as number) },
            { key: 'daysLeft', label: 'Kalan Gün', align: 'right', render: row => `${Math.round(row.daysLeft as number)} gün` },
            { key: 'dailySales', label: 'G.Satış', align: 'right', render: row => formatNum(row.dailySales as number) },
            { key: 'turnover', label: 'Devir Hızı', align: 'right',
              render: row => <span className="font-bold" style={{ color: `hsl(${Math.min(120, (row.turnover as number) * 10)}, 60%, 40%)` }}>{(row.turnover as number).toFixed(2)}×</span>
            },
          ]}
        />
      </div>
    </div>
  );
}
