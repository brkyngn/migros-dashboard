import { useEffect, useState, useMemo } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { SatisOzet } from '../api/migros';
import { productsFromOzet, gunlukSeriFromOzet, haftaninGunuFromOzet, PRODUCTS, SKU_AC, SKU_MB } from '../utils/calculations';
import { formatTL, formatNum, formatPct } from '../utils/formatters';
import DataTable from '../components/common/DataTable';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

const PERIODS = [
  { label: '7 gün', days: 7 },
  { label: '30 gün', days: 30 },
  { label: '90 gün', days: 90 },
  { label: 'Tümü', days: 0 },
];

export default function SalesPerformance() {
  const [ozet, setOzet]     = useState<SatisOzet | null>(null);
  const [loading, setLoading] = useState(true);
  const [hata, setHata]     = useState('');
  const [period, setPeriod] = useState(30);
  const [skuFilter, setSkuFilter] = useState('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const isCustom = !!(customStart && customEnd);

  // gun × SKU serisi dönem filtresinden ETKİLENMEZ, daima tüm geçmiştir;
  // tarih seçicinin sınırları ve "son N gün" hesabı buradan türer.
  // urunler'den türetmek, veri içermeyen bir dönem seçildiğinde sonTarih'i
  // boşaltıp sonsuz yeniden-çekim döngüsü yaratırdı.
  const tumGunler = useMemo(() => ozet?.gunluk ?? [], [ozet]);

  // "Son 30 gün" bugüne değil son satış gününe göre — veri geriden gelebiliyor
  const sonTarih = tumGunler.length ? tumGunler[tumGunler.length - 1].tarih : '';

  const [from, to] = useMemo(() => {
    if (isCustom) return [customStart, customEnd];
    if (!period || !sonTarih) return ['', ''];
    const d = new Date(sonTarih + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - (period - 1));
    return [d.toISOString().slice(0, 10), sonTarih];
  }, [isCustom, customStart, customEnd, period, sonTarih]);

  // Toplamlar ve mağaza kırılımı sunucuda, dönem filtresiyle hesaplanır.
  // (Eskiden tüm satırlar çekilip istemcide toplanıyordu; /api/db-gunluk
  //  LIMIT 20000 uyguladığı için eski günler sessizce toplama girmiyordu.)
  useEffect(() => {
    let iptal = false;
    // Dönem değişiminde loading'e düşmüyoruz: eski veri ekranda kalsın,
    // grafikler her tıklamada boşalıp geri gelmesin.
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to)   qs.set('to', to);
    fetch(`/api/satis-ozet?${qs}`)
      .then(r => r.json())
      .then((d: SatisOzet & { error?: string }) => {
        if (iptal) return;
        if (d.error) setHata(d.error); else { setOzet(d); setHata(''); }
      })
      .catch(e => { if (!iptal) setHata(e instanceof Error ? e.message : 'Bilinmeyen hata'); })
      .finally(() => { if (!iptal) setLoading(false); });
    return () => { iptal = true; };
  }, [from, to]);

  const dateRange = useMemo(() => {
    if (!tumGunler.length) return { min: '', max: '' };
    const t = tumGunler.map(g => g.tarih).sort();
    return { min: t[0], max: t[t.length - 1] };
  }, [tumGunler]);

  // Grafikler dönem + SKU filtresine göre kırpılır
  const donemGunler = useMemo(() => tumGunler.filter(g => {
    if (from && g.tarih < from) return false;
    if (to   && g.tarih > to)   return false;
    if (skuFilter !== 'all' && g.sku !== skuFilter) return false;
    return true;
  }), [tumGunler, from, to, skuFilter]);

  if (loading && !ozet) return <div className="p-8"><LoadingSkeleton rows={8} /></div>;

  if (hata) return (
    <div className="p-8">
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
        <span className="text-xl">⚠️</span><div className="text-red-700 text-sm font-medium">{hata}</div>
      </div>
    </div>
  );

  const dailyData = gunlukSeriFromOzet(donemGunler);
  const dowData   = haftaninGunuFromOzet(donemGunler);

  const seciliSku = (sku: string) => skuFilter === 'all' || sku === skuFilter;
  const donemUrun = (ozet?.urunler ?? []).filter(u => seciliSku(u.sku));
  const products  = productsFromOzet(donemUrun);

  const totalQty = products.reduce((s, p) => s + p.quantity, 0);
  const totalRev = products.reduce((s, p) => s + p.revenue, 0);
  const totalAvgPrice = totalQty > 0 ? totalRev / totalQty : 0;

  // Mağaza kırılımı zaten dönem filtreli geldiği için benzersiz id saymak yeter
  const donemMagaza = (ozet?.magazalar ?? []).filter(m => seciliSku(m.sku));
  const totalStores = new Set(donemMagaza.map(m => m.id)).size;

  const storeMap: Record<string, { store: string; [key: string]: number | string }> = {};
  donemMagaza.forEach(m => {
    const k = m.magaza_adi || m.id;
    if (!storeMap[k]) storeMap[k] = { store: k, totalQty: 0, totalRev: 0, sku: m.sku };
    storeMap[k].totalQty = (storeMap[k].totalQty as number) + Number(m.qty || 0);
    storeMap[k].totalRev = (storeMap[k].totalRev as number) + Number(m.rev || 0);
  });
  const topStores = Object.values(storeMap)
    .sort((a, b) => (b.totalRev as number) - (a.totalRev as number)).slice(0, 20);
  const maxStoreQty = topStores[0] ? (topStores[0].totalQty as number) : 1;

  // Ayın 1-10 / 11-20 / 21-31 dilimleri
  const periods3 = [
    { label: '1–10', from: 1, to: 10 },
    { label: '11–20', from: 11, to: 20 },
    { label: '21–31', from: 21, to: 31 },
  ].map(p => {
    const dilim = donemGunler.filter(g => {
      const gun = parseInt(g.tarih.slice(8, 10), 10);
      return gun >= p.from && gun <= p.to;
    });
    return {
      ...p,
      qty: dilim.reduce((s, r) => s + Number(r.qty || 0), 0),
      rev: dilim.reduce((s, r) => s + Number(r.rev || 0), 0),
    };
  });
  const maxRev = Math.max(...periods3.map(p => p.rev));

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Hızlı dönem butonları */}
        <div className="flex bg-white border border-gray-200 rounded-lg overflow-hidden">
          {PERIODS.map(p => (
            <button key={p.days} onClick={() => { setPeriod(p.days); setCustomStart(''); setCustomEnd(''); }}
              className={`px-4 py-2 text-sm font-medium transition-colors ${!isCustom && period === p.days ? 'bg-sidebar text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >{p.label}</button>
          ))}
        </div>

        {/* Özel aralık */}
        <div className={`flex items-center gap-2 bg-white border rounded-lg px-3 py-1.5 transition-colors ${isCustom ? 'border-sidebar ring-1 ring-sidebar/20' : 'border-gray-200'}`}>
          <span className="text-xs text-gray-400 font-medium whitespace-nowrap">Özel:</span>
          <input
            type="date"
            value={customStart}
            min={dateRange.min}
            max={customEnd || dateRange.max}
            onChange={e => setCustomStart(e.target.value)}
            className="text-sm text-gray-700 outline-none bg-transparent"
          />
          <span className="text-gray-300">—</span>
          <input
            type="date"
            value={customEnd}
            min={customStart || dateRange.min}
            max={dateRange.max}
            onChange={e => setCustomEnd(e.target.value)}
            className="text-sm text-gray-700 outline-none bg-transparent"
          />
          {isCustom && (
            <button onClick={() => { setCustomStart(''); setCustomEnd(''); }}
              className="text-gray-400 hover:text-gray-600 text-xs ml-1">✕</button>
          )}
        </div>

        {/* SKU filtresi */}
        <select value={skuFilter} onChange={e => setSkuFilter(e.target.value)}
          className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none ml-auto">
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

      {/* Toplam + SKU kartları */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Toplam kartı */}
        <div className="bg-white rounded-xl border-2 border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100" style={{ borderBottom: '3px solid #16a34a' }}>
            <div className="text-xs font-bold tracking-wide uppercase px-2 py-1 rounded-full inline-block mb-2"
              style={{ background: '#16a34a18', color: '#16a34a' }}>
              Toplam
            </div>
            <div className="font-semibold text-gray-800">Tüm Ürünler</div>
          </div>
          <div className="grid grid-cols-3 gap-0 divide-x divide-gray-100 p-4">
            {[
              { label: 'Satış Adedi', value: formatNum(Math.round(totalQty)), color: '#16a34a' },
              { label: 'Net Ciro',    value: formatTL(totalRev) },
              { label: 'Ort. Fiyat', value: formatTL(totalAvgPrice) },
              { label: 'Mağaza',     value: formatNum(totalStores) },
              { label: 'AC Payı',    value: formatPct(totalQty > 0 ? (products.find(p => p.sku === SKU_AC)?.quantity || 0) / totalQty * 100 : 0) },
              { label: 'MB Payı',    value: formatPct(totalQty > 0 ? (products.find(p => p.sku === SKU_MB)?.quantity || 0) / totalQty * 100 : 0) },
            ].map((item, i) => (
              <div key={i} className="px-3 py-2">
                <div className="text-xs text-gray-400 mb-1">{item.label}</div>
                <div className="font-bold text-base" style={item.color ? { color: item.color } : {}}>{item.value}</div>
              </div>
            ))}
          </div>
          <div className="px-5 pb-4">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-ac inline-block" />AC</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-mb inline-block" />MB</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
              <div className="h-full" style={{ width: `${totalQty > 0 ? (products.find(p => p.sku === SKU_AC)?.quantity || 0) / totalQty * 100 : 50}%`, background: '#C0392B' }} />
              <div className="h-full flex-1" style={{ background: '#1A3A5C' }} />
            </div>
          </div>
        </div>

        {/* SKU kartları */}
        {products.map(p => (
          <div key={p.sku} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="text-xs font-bold tracking-wide uppercase px-2 py-1 rounded-full inline-block mb-2"
                style={{ background: p.color + '18', color: p.color }}>
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
