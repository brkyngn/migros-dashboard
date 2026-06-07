import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { fetchDailySales, fetchStockReport } from '../api/migros';
import type { DailySale, StockRecord, Page } from '../types';
import { groupByProduct, groupByWeek, calcStockStatus, SKU_AC, SKU_MB } from '../utils/calculations';
import { formatTL, formatNum, formatPct } from '../utils/formatters';
import KPICard from '../components/common/KPICard';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

interface Props { onNavigate: (page: Page, filter?: string) => void; }

export default function Dashboard({ onNavigate }: Props) {
  const [sales, setSales] = useState<DailySale[]>([]);
  const [stock, setStock] = useState<StockRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchDailySales(), fetchStockReport()])
      .then(([s, st]) => { setSales(s); setStock(st); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8"><LoadingSkeleton rows={6} /></div>;

  const products = groupByProduct(sales);
  const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);
  const totalQty = products.reduce((s, p) => s + p.quantity, 0);
  const allStores = new Set(sales.map(s => s.StoreNumber)).size;
  const days = new Set(sales.map(s => {
    const raw = new Date(s.DateTransaction.slice(0, 10) + 'T00:00:00Z');
    raw.setUTCDate(raw.getUTCDate() + 1);
    return raw.toISOString().slice(0, 10);
  })).size;
  const avgDailyRevenue = days > 0 ? totalRevenue / days : 0;

  const stockStatus = { zero: 0, critical: 0, warning: 0, healthy: 0 };
  let dailyLoss = 0;
  stock.forEach(r => {
    const status = calcStockStatus(parseFloat(r.STOK_GUN) || 0, parseFloat(r.STOK_MIKTARI) || 0);
    stockStatus[status]++;
    if (status === 'zero') dailyLoss += parseFloat(r.GUNLUK_SATIS_TUTARI) || 0;
  });

  const weeklyData = groupByWeek(sales);
  const empty = sales.length === 0;

  return (
    <div className="p-8 space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard label="Toplam Net Ciro" value={formatTL(totalRevenue)} sub="KDV hariç" color="#16a34a" />
        <KPICard label="Toplam Satış Adedi" value={formatNum(totalQty)} color="#C0392B" />
        <KPICard label="Aktif Mağaza" value={formatNum(allStores)} color="#f5a623" />
        <KPICard label="Ort. Günlük Ciro" value={formatTL(avgDailyRevenue)} color="#1A3A5C" />
      </div>

      {empty && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm">
          ⚠️ Veritabanında satış kaydı yok. <a href="/tools" className="underline font-medium">Veri Araçları</a> sayfasından veri çekebilirsiniz.
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Sol: Ürün tablosu + Haftalık chart */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="font-semibold text-gray-800">Ürün Karşılaştırması</div>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-2 text-left">Ürün</th>
                <th className="px-4 py-2 text-right">Adet</th>
                <th className="px-4 py-2 text-right">Ciro</th>
                <th className="px-4 py-2 text-right">Pay %</th>
                <th className="px-4 py-2 text-right">Mağaza</th>
              </tr></thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.sku} className="border-t border-gray-100">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800 text-xs">{p.name}</div>
                      <div className="text-xs text-gray-400">SKU: {p.sku}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{formatNum(p.quantity)}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatTL(p.revenue)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="text-xs font-semibold mb-1">{formatPct(p.shareRevenue)}</div>
                      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${p.shareRevenue}%`, background: p.color }} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">{formatNum(p.stores)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="font-semibold text-gray-800 mb-4">Haftalık Satış Trendi</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={weeklyData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <Tooltip formatter={(v: unknown) => formatNum(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey={SKU_AC} name="Active Carbon" fill="#C0392B" radius={[3,3,0,0]} />
                <Bar dataKey={SKU_MB} name="Marseille Breeze" fill="#1A3A5C" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sağ: Stok + Ciro kaybı */}
        <div className="space-y-4">
          <div className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Stok Sağlık Durumu</div>
          {[
            { key: 'zero', icon: '⛔', label: 'Sıfır Stok', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' },
            { key: 'critical', icon: '⚠️', label: 'Kritik (<7 gün)', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' },
            { key: 'warning', icon: '🔵', label: 'Uyarı (7-14 gün)', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
            { key: 'healthy', icon: '✅', label: 'Sağlıklı (15+ gün)', bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' },
          ].map(item => (
            <button
              key={item.key}
              onClick={() => onNavigate('stock-alerts', item.key)}
              className={`w-full flex items-center justify-between p-4 rounded-xl border ${item.bg} ${item.border} hover:opacity-80 transition-opacity`}
            >
              <div className={`flex items-center gap-2 font-medium text-sm ${item.text}`}>
                <span>{item.icon}</span>{item.label}
              </div>
              <div className={`text-2xl font-bold ${item.text}`}>
                {formatNum(stockStatus[item.key as keyof typeof stockStatus])}
                <span className="text-sm font-normal ml-1">lok.</span>
              </div>
            </button>
          ))}

          {dailyLoss > 0 && (
            <div className="bg-red-900 text-white rounded-xl p-5 space-y-3">
              <div className="font-semibold text-sm opacity-80">Tahmini Ciro Kaybı (Sıfır Stok)</div>
              <div className="grid grid-cols-3 gap-3">
                <div><div className="text-xs opacity-60">Günlük</div><div className="font-bold text-lg">{formatTL(dailyLoss)}</div></div>
                <div><div className="text-xs opacity-60">Haftalık</div><div className="font-bold text-lg">{formatTL(dailyLoss * 7)}</div></div>
                <div><div className="text-xs opacity-60">Aylık</div><div className="font-bold text-lg">{formatTL(dailyLoss * 30)}</div></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
