import { useEffect, useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { DailySale } from '../types';
import { SKU_AC, SKU_MB, PRODUCTS } from '../utils/calculations';
import { formatTL, formatNum } from '../utils/formatters';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

const AC_COLOR = '#C0392B';
const MB_COLOR = '#1A3A5C';

function getProductColor(sku: string) {
  if (sku === SKU_AC) return AC_COLOR;
  if (sku === SKU_MB) return MB_COLOR;
  return '#6b7280';
}
function getProductName(sku: string) {
  const p = PRODUCTS.find(p => p.sku === sku);
  return p ? p.shortName : sku;
}

export default function DailyReport() {
  const [allDates, setAllDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [sales, setSales] = useState<DailySale[]>([]);
  const [loading, setLoading] = useState(true);
  const [datesLoading, setDatesLoading] = useState(true);

  // Tarih listesini çek
  useEffect(() => {
    fetch('/api/db-satis-tarihler')
      .then(r => r.json())
      .then((dates: string[]) => {
        setAllDates(dates);
        if (dates.length > 0) setSelectedDate(dates[0]); // en son tarih
      })
      .finally(() => setDatesLoading(false));
  }, []);

  // Seçili tarihin satışlarını çek
  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    fetch(`/api/db-gunluk?startDate=${selectedDate}&endDate=${selectedDate}`)
      .then(r => r.json())
      .then(setSales)
      .finally(() => setLoading(false));
  }, [selectedDate]);

  // Hesaplamalar
  const stats = useMemo(() => {
    const byProduct: Record<string, { qty: number; rev: number; stores: Set<string> }> = {};
    let totalQty = 0, totalRev = 0;
    const storeMap: Record<string, { name: string; qty: number; rev: number; sku: string }> = {};

    sales.forEach(s => {
      const sku = s.SupplierItemNumber;
      const qty = parseFloat(s.QuantitySold) || 0;
      const rev = parseFloat(s.NetSalesValue) || 0;
      if (!byProduct[sku]) byProduct[sku] = { qty: 0, rev: 0, stores: new Set() };
      byProduct[sku].qty += qty;
      byProduct[sku].rev += rev;
      byProduct[sku].stores.add(s.StoreNumber);
      totalQty += qty;
      totalRev += rev;

      const key = s.StoreNumber;
      if (!storeMap[key]) storeMap[key] = { name: s.StoreName || s.StoreNumber, qty: 0, rev: 0, sku };
      storeMap[key].qty += qty;
      storeMap[key].rev += rev;
    });

    const products = [SKU_AC, SKU_MB].map(sku => ({
      sku,
      name: getProductName(sku),
      color: getProductColor(sku),
      qty: Math.round(byProduct[sku]?.qty || 0),
      rev: Math.round(byProduct[sku]?.rev || 0),
      stores: byProduct[sku]?.stores.size || 0,
      avgPrice: byProduct[sku] && byProduct[sku].qty > 0 ? byProduct[sku].rev / byProduct[sku].qty : 0,
      shareQty: totalQty > 0 ? (byProduct[sku]?.qty || 0) / totalQty * 100 : 0,
      shareRev: totalRev > 0 ? (byProduct[sku]?.rev || 0) / totalRev * 100 : 0,
    }));

    const topStores = Object.values(storeMap)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 15);

    // Şehir bazlı (StoreName'den ilk kelime)
    const cityMap: Record<string, { qty: number; rev: number }> = {};
    sales.forEach(s => {
      const city = (s.StoreName || '').split(' ')[0] || 'Diğer';
      if (!cityMap[city]) cityMap[city] = { qty: 0, rev: 0 };
      cityMap[city].qty += parseFloat(s.QuantitySold) || 0;
      cityMap[city].rev += parseFloat(s.NetSalesValue) || 0;
    });
    const topCities = Object.entries(cityMap)
      .map(([city, d]) => ({ city, qty: Math.round(d.qty), rev: Math.round(d.rev) }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

    return { products, totalQty: Math.round(totalQty), totalRev: Math.round(totalRev),
      totalStores: new Set(sales.map(s => s.StoreNumber)).size,
      topStores, topCities };
  }, [sales]);

  const formatDateTR = (d: string) => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    const months = ['','Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
    return `${parseInt(day)} ${months[parseInt(m)]} ${y}`;
  };

  if (datesLoading) return <div className="p-8"><LoadingSkeleton rows={6} /></div>;

  if (allDates.length === 0) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-4xl mb-3">📭</div>
          <div className="text-gray-500 font-medium">Veritabanında satış kaydı yok</div>
          <a href="/tools" className="text-blue-600 underline text-sm mt-2 inline-block">Veri Araçları'ndan veri çek</a>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">

      {/* Tarih seçici */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600">Tarih:</span>
          <select
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 outline-none shadow-sm hover:border-gray-300 transition-colors"
          >
            {allDates.map(d => (
              <option key={d} value={d}>{formatDateTR(d)}</option>
            ))}
          </select>
        </div>
        {selectedDate && (
          <div className="flex items-center gap-2 bg-sidebar/10 border border-sidebar/20 rounded-lg px-4 py-2">
            <span className="text-sidebar text-sm font-semibold">{formatDateTR(selectedDate)}</span>
            <span className="text-gray-400 text-xs">günlük raporu</span>
          </div>
        )}
        <div className="ml-auto text-xs text-gray-400">{allDates.length} günlük veri mevcut</div>
      </div>

      {loading ? <LoadingSkeleton rows={8} /> : (
        <>
          {/* KPI Kartları */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Toplam Satış Adedi', value: formatNum(stats.totalQty), icon: '📦', color: AC_COLOR },
              { label: 'Net Ciro', value: formatTL(stats.totalRev), icon: '💰', color: '#16a34a' },
              { label: 'Satış Yapılan Mağaza', value: formatNum(stats.totalStores), icon: '🏪', color: '#f59e0b' },
              { label: 'Ort. Mağaza Sepeti', value: stats.totalStores > 0 ? formatTL(stats.totalRev / stats.totalStores) : '₺0', icon: '🧺', color: MB_COLOR },
            ].map(card => (
              <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4">
                <div className="text-2xl">{card.icon}</div>
                <div>
                  <div className="text-xs text-gray-500 font-medium mb-1">{card.label}</div>
                  <div className="text-2xl font-bold" style={{ color: card.color }}>{card.value}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Ürün Kartları */}
          <div className="grid grid-cols-2 gap-5">
            {stats.products.map(p => (
              <div key={p.sku} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `3px solid ${p.color}` }}>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider mb-0.5" style={{ color: p.color }}>
                      {p.name}
                    </div>
                    <div className="text-xs text-gray-400">SKU · {p.sku}</div>
                  </div>
                  <div className="text-3xl font-black" style={{ color: p.color }}>{formatNum(p.qty)}</div>
                </div>
                <div className="grid grid-cols-4 divide-x divide-gray-100 px-0 py-3">
                  {[
                    { label: 'Net Ciro', value: formatTL(p.rev) },
                    { label: 'Ort. Fiyat', value: formatTL(p.avgPrice) },
                    { label: 'Mağaza', value: formatNum(p.stores) },
                    { label: 'Ciro Payı', value: `%${p.shareRev.toFixed(0)}` },
                  ].map(item => (
                    <div key={item.label} className="px-4 py-1 text-center">
                      <div className="text-xs text-gray-400 mb-0.5">{item.label}</div>
                      <div className="font-bold text-sm text-gray-800">{item.value}</div>
                    </div>
                  ))}
                </div>
                {/* Pay barı */}
                <div className="px-5 pb-4 pt-1">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Adet payı</span><span>%{p.shareQty.toFixed(1)}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${p.shareQty}%`, background: p.color }} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Alt grid: mağaza tablosu + şehir grafiği */}
          <div className="grid grid-cols-2 gap-6">

            {/* Top mağazalar */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="font-semibold text-gray-800">En Çok Satan Mağazalar</div>
                <div className="text-xs text-gray-400">Top 15</div>
              </div>
              <div className="overflow-auto max-h-96">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide sticky top-0">
                      <th className="px-4 py-2 text-left">#</th>
                      <th className="px-4 py-2 text-left">Mağaza</th>
                      <th className="px-4 py-2 text-right">Adet</th>
                      <th className="px-4 py-2 text-right">Ciro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topStores.map((s, i) => (
                      <tr key={s.name} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5 text-gray-400 text-xs font-medium w-8">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-800 text-xs leading-tight">{s.name}</div>
                          <div className="h-1 bg-gray-100 rounded-full mt-1 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${stats.topStores[0] ? s.qty / stats.topStores[0].qty * 100 : 0}%`,
                                background: getProductColor(s.sku)
                              }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-gray-800">{formatNum(s.qty)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600 text-xs">{formatTL(s.rev)}</td>
                      </tr>
                    ))}
                    {stats.topStores.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400 text-sm">Veri yok</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Şehir bar grafiği */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="font-semibold text-gray-800 mb-4">Şehirlere Göre Satış (Adet)</div>
              {stats.topCities.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={stats.topCities} layout="vertical" margin={{ left: 0, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                    <YAxis type="category" dataKey="city" tick={{ fontSize: 11, fill: '#6b7280' }} width={80} />
                    <Tooltip
                      formatter={(v: unknown) => [formatNum(Number(v)), 'Adet']}
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    />
                    <Bar dataKey="qty" radius={[0, 4, 4, 0]} maxBarSize={22}>
                      {stats.topCities.map((_, i) => (
                        <Cell key={i} fill={i % 2 === 0 ? AC_COLOR : MB_COLOR} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Veri yok</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
