import { useEffect, useState, useMemo } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { fetchDailySales } from '../api/migros';
import type { DailySale } from '../types';
import { groupByProduct, groupByDay, groupByDayOfWeek, PRODUCTS, SKU_AC, SKU_MB } from '../utils/calculations';
import { formatTL, formatNum, formatPct } from '../utils/formatters';
import DataTable from '../components/common/DataTable';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

const PERIODS = [
  { label: 'Son 7 gün', days: 7 },
  { label: 'Son 30 gün', days: 30 },
  { label: 'Son 90 gün', days: 90 },
  { label: 'Tümü', days: 0 },
];

export default function SalesPerformance() {
  const [all, setAll] = useState<DailySale[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(30);
  const [skuFilter, setSkuFilter] = useState('all');

  useEffect(() => {
    fetchDailySales().then(setAll).finally(() => setLoading(false));
  }, []);

  const sales = useMemo(() => {
    let d = all;
    if (period > 0) {
      const cutoff = new Date(Date.now() - period * 86400000).toISOString().slice(0, 10);
      d = d.filter(s => s.DateTransaction.slice(0, 10) >= cutoff);
    }
    if (skuFilter !== 'all') d = d.filter(s => s.SupplierItemNumber === skuFilter);
    return d;
  }, [all, period, skuFilter]);

  if (loading) return <div className="p-8"><LoadingSkeleton rows={8} /></div>;

  const products = groupByProduct(sales);
  const dailyData = groupByDay(sales);
  const dowData = groupByDayOfWeek(sales);

  // Top stores
  const storeMap: Record<string, { store: string; [key: string]: number | string }> = {};
  sales.forEach(s => {
    const k = s.StoreName || s.StoreNumber;
    if (!storeMap[k]) storeMap[k] = { store: k, totalQty: 0, totalRev: 0, sku: s.SupplierItemNumber };
    (storeMap[k] as Record<string, number | string>).totalQty = ((storeMap[k] as Record<string, number | string>).totalQty as number) + (parseFloat(s.QuantitySold) || 0);
    (storeMap[k] as Record<string, number | string>).totalRev = ((storeMap[k] as Record<string, number | string>).totalRev as number) + (parseFloat(s.NetSalesValue) || 0);
  });
  const topStores = Object.values(storeMap).sort((a, b) => (b.totalRev as number) - (a.totalRev as number)).slice(0, 20);
  const maxStoreQty = topStores[0] ? (topStores[0].totalQty as number) : 1;

  // Periodic analysis (1-10, 11-20, 21+)
  const periods3 = [
    { label: '1–10', from: 1, to: 10 },
    { label: '11–20', from: 11, to: 20 },
    { label: '21–31', from: 21, to: 31 },
  ].map(p => {
    const filtered = sales.filter(s => {
      const raw = new Date(s.DateTransaction.slice(0, 10) + 'T00:00:00Z');
      if (isNaN(raw.getTime())) return false;
      const day = raw.getUTCDate();
      return day >= p.from && day <= p.to;
    });
    return { ...p, qty: filtered.reduce((s, r) => s + (parseFloat(r.QuantitySold) || 0), 0), rev: filtered.reduce((s, r) => s + (parseFloat(r.NetSalesValue) || 0), 0) };
  });
  const maxRev = Math.max(...periods3.map(p => p.rev));

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex bg-white border border-gray-200 rounded-lg overflow-hidden">
          {PERIODS.map(p => (
            <button key={p.days} onClick={() => setPeriod(p.days)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${period === p.days ? 'bg-sidebar text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >{p.label}</button>
          ))}
        </div>
        <select value={skuFilter} onChange={e => setSkuFilter(e.target.value)}
          className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none">
          <option value="all">Tüm Ürünler</option>
          {PRODUCTS.map(p => <option key={p.sku} value={p.sku}>{p.name}</option>)}
        </select>
      </div>

      {/* Daily trend */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="font-semibold text-gray-800 mb-4">Günlük Satış Trendi (Adet)</div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={dailyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
            <Tooltip formatter={(v: unknown) => formatNum(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line dataKey="toplam" name="Toplam" stroke="#16a34a" strokeWidth={2.5} dot={false} strokeDasharray="6 3" />
            <Line dataKey={SKU_AC} name="Active Carbon" stroke="#C0392B" strokeWidth={2} dot={false} />
            <Line dataKey={SKU_MB} name="Marseille Breeze" stroke="#1A3A5C" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Product cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {products.map(p => (
          <div key={p.sku} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="text-xs font-bold tracking-wide uppercase px-2 py-1 rounded-full inline-block mb-2" style={{ background: p.color + '18', color: p.color }}>
                SKU · {p.sku}
              </div>
              <div className="font-semibold text-gray-800">{p.name}</div>
            </div>
            <div className="grid grid-cols-3 gap-0 divide-x divide-gray-100 p-4">
              {[
                { label: 'Satış Adedi', value: formatNum(p.quantity), color: p.color },
                { label: 'Net Ciro', value: formatTL(p.revenue) },
                { label: 'Ort. Fiyat', value: formatTL(p.avgPrice) },
                { label: 'Mağaza', value: formatNum(p.stores) },
                { label: 'Ciro Payı', value: formatPct(p.shareRevenue) },
                { label: 'Adet Payı', value: formatPct(p.shareQty) },
              ].map((item, i) => (
                <div key={i} className="px-3 py-2">
                  <div className="text-xs text-gray-400 mb-1">{item.label}</div>
                  <div className="font-bold text-base" style={item.color ? { color: item.color } : {}}>{item.value}</div>
                </div>
              ))}
            </div>
            <div className="px-5 pb-4">
              <div className="flex justify-between text-xs text-gray-400 mb-1"><span>Ciro payı</span><span>{formatPct(p.shareRevenue)}</span></div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${p.shareRevenue}%`, background: p.color }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* DOW + Periodic */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="font-semibold text-gray-800 mb-4">Haftanın Günlerine Göre</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={dowData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <Tooltip formatter={(v: unknown) => formatNum(Number(v))} />
              <Bar dataKey={SKU_AC} name="Active Carbon" fill="#C0392B" radius={[3,3,0,0]} />
              <Bar dataKey={SKU_MB} name="Marseille Breeze" fill="#1A3A5C" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="font-semibold text-gray-800 mb-4">Dönemsel Analiz</div>
          <div className="grid grid-cols-3 gap-3">
            {periods3.map(p => (
              <div key={p.label} className={`p-4 rounded-xl border-2 ${p.rev === maxRev && p.rev > 0 ? 'border-ac' : 'border-gray-100'}`}>
                <div className="text-xs font-semibold text-gray-500 mb-2">{p.label}. gün</div>
                {p.rev === maxRev && p.rev > 0 && <div className="text-xs text-ac font-bold mb-1">★ En Güçlü</div>}
                <div className="text-lg font-bold text-gray-800">{formatNum(p.qty)}</div>
                <div className="text-xs text-gray-400 mt-0.5">{formatTL(p.rev)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top stores */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="font-semibold text-gray-800 mb-4">En Çok Satan Mağazalar (Top 20)</div>
        <DataTable
          data={topStores as Record<string, unknown>[]}
          searchKeys={['store']}
          columns={[
            { key: 'rank', label: '#', sortable: false, render: () => <span className="text-gray-400 text-xs">·</span> },
            { key: 'store', label: 'Mağaza', render: row => <span className="font-medium text-sm">{row.store as string}</span> },
            { key: 'totalQty', label: 'Satış Adedi', align: 'right',
              render: row => (
                <div>
                  <div className="text-right text-sm font-medium">{formatNum(row.totalQty as number)}</div>
                  <div className="h-1 bg-gray-100 rounded-full mt-1">
                    <div className="h-full bg-ac rounded-full" style={{ width: `${Math.round((row.totalQty as number) / maxStoreQty * 100)}%` }} />
                  </div>
                </div>
              )
            },
            { key: 'totalRev', label: 'Ciro', align: 'right', render: row => <span className="font-semibold">{formatTL(row.totalRev as number)}</span> },
          ]}
        />
      </div>
    </div>
  );
}
