import { useEffect, useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';
import { TYPE_ORDER, TYPE_COLORS } from '../utils/storeTypes';
import { formatNum, formatTL } from '../utils/formatters';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

// ─── Sabitler ────────────────────────────────────────────────────────────────



// ─── Tipler ──────────────────────────────────────────────────────────────────

interface SatisRow { tip: string; qty: string | number; rev: string | number; magaza: string | number; }
interface StokRow  { tip: string; stok: string | number; tutar: string | number; magaza: string | number; raf_bos: string | number; }
interface ApiResp {
  satisTarihi: string | null;
  stokTarihi: string | null;
  satisToplam: SatisRow[];
  satisGunluk: SatisRow[];
  stok: StokRow[];
  error?: string;
}

interface TypeRow {
  tip: string; color: string;
  gunlukQty: number; gunlukRev: number; gunlukMagaza: number;
  toplamQty: number; toplamRev: number; toplamMagaza: number;
  stokAdet: number; stokTutar: number; stokMagaza: number; rafBos: number;
  rafBosOrani: number;   // %
  stokGun: number | null; // stok / günlük satış
}

const n = (v: string | number | undefined | null) => Number(v || 0);

function formatDateTR(d: string | null) {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  const months = ['','Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  return `${parseInt(day)} ${months[parseInt(m)]} ${y}`;
}

// ─── Bileşen ─────────────────────────────────────────────────────────────────

export default function StoreTypes() {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/magaza-tipi')
      .then(r => r.json())
      .then((d: ApiResp) => { if (d.error) setError(d.error); else setData(d); })
      .catch(e => setError(e instanceof Error ? e.message : 'Bilinmeyen hata'))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo<TypeRow[]>(() => {
    if (!data) return [];
    const gunluk = Object.fromEntries(data.satisGunluk.map(r => [r.tip, r]));
    const toplam = Object.fromEntries(data.satisToplam.map(r => [r.tip, r]));
    const stok   = Object.fromEntries(data.stok.map(r => [r.tip, r]));

    const tipler = TYPE_ORDER.filter(t => gunluk[t] || toplam[t] || stok[t]);
    return tipler.map(tip => {
      const g = gunluk[tip], t = toplam[tip], s = stok[tip];
      const gunlukQty = n(g?.qty);
      const stokAdet  = n(s?.stok);
      const stokMagaza = n(s?.magaza);
      const rafBos = n(s?.raf_bos);
      return {
        tip, color: TYPE_COLORS[tip] || '#6b7280',
        gunlukQty, gunlukRev: n(g?.rev), gunlukMagaza: n(g?.magaza),
        toplamQty: n(t?.qty), toplamRev: n(t?.rev), toplamMagaza: n(t?.magaza),
        stokAdet, stokTutar: n(s?.tutar), stokMagaza, rafBos,
        rafBosOrani: stokMagaza > 0 ? rafBos / stokMagaza * 100 : 0,
        stokGun: gunlukQty > 0 ? stokAdet / gunlukQty : null,
      };
    });
  }, [data]);

  const totals = useMemo(() => {
    const acc = { gunlukQty: 0, gunlukRev: 0, toplamQty: 0, toplamRev: 0, stokAdet: 0, stokTutar: 0, stokMagaza: 0, rafBos: 0 };
    rows.forEach(r => {
      acc.gunlukQty += r.gunlukQty; acc.gunlukRev += r.gunlukRev;
      acc.toplamQty += r.toplamQty; acc.toplamRev += r.toplamRev;
      acc.stokAdet += r.stokAdet;   acc.stokTutar += r.stokTutar;
      acc.stokMagaza += r.stokMagaza; acc.rafBos += r.rafBos;
    });
    return acc;
  }, [rows]);

  if (loading) return <div className="p-8"><LoadingSkeleton rows={8} /></div>;

  if (error) return (
    <div className="p-8">
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
        <span className="text-xl">⚠️</span><div className="text-red-700 text-sm font-medium">{error}</div>
      </div>
    </div>
  );

  if (!rows.length) return (
    <div className="p-8 flex items-center justify-center h-64">
      <div className="text-center">
        <div className="text-4xl mb-3">📭</div>
        <div className="text-gray-500 font-medium">Mağaza tipi verisi yok</div>
        <a href="/tools" className="text-blue-600 underline text-sm mt-2 inline-block">Veri Araçları'ndan veri çek</a>
      </div>
    </div>
  );

  const gunlukBar = rows.map(r => ({ tip: r.tip, adet: Math.round(r.gunlukQty), color: r.color }));
  const stokBar   = rows.map(r => ({ tip: r.tip, adet: Math.round(r.stokAdet), color: r.color }));
  const ciroPie   = rows.filter(r => r.toplamRev > 0).map(r => ({ name: r.tip, value: Math.round(r.toplamRev), color: r.color }));
  const rafBosBar = rows.map(r => ({ tip: r.tip, bos: r.rafBos, oran: Math.round(r.rafBosOrani), color: r.color }));

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">

      {/* Tarih bilgisi */}
      <div className="flex items-center gap-4 flex-wrap text-xs text-gray-400">
        <span>Günlük satış: <b className="text-gray-600">{formatDateTR(data?.satisTarihi ?? null)}</b></span>
        <span>·</span>
        <span>Stok: <b className="text-gray-600">{formatDateTR(data?.stokTarihi ?? null)}</b></span>
        <span className="ml-auto">{rows.length} mağaza tipi</span>
      </div>

      {/* KPI kartları — tip başına günlük satış */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {rows.map(r => (
          <div key={r.tip} className="bg-white rounded-xl border border-gray-200 p-4" style={{ borderTop: `3px solid ${r.color}` }}>
            <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: r.color }}>{r.tip}</div>
            <div className="text-2xl font-black text-gray-800 leading-none">{formatNum(Math.round(r.gunlukQty))}</div>
            <div className="text-[11px] text-gray-400 mb-2">günlük adet</div>
            <div className="flex justify-between text-[11px]">
              <span className="text-gray-500">Mağaza</span><span className="font-semibold text-gray-700">{formatNum(r.stokMagaza || r.toplamMagaza)}</span>
            </div>
            <div className="flex justify-between text-[11px] mt-0.5">
              <span className="text-gray-500">Raf Boş</span>
              <span className={`font-semibold ${r.rafBos > 0 ? 'text-red-600' : 'text-green-600'}`}>{r.rafBos} <span className="text-gray-400 font-normal">(%{r.rafBosOrani.toFixed(0)})</span></span>
            </div>
          </div>
        ))}
      </div>

      {/* Ana tablo */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <div className="px-5 py-4 border-b border-gray-100 font-semibold text-gray-800">Mağaza Tipine Göre Özet</div>
        <table className="w-full text-xs min-w-[720px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-2.5 text-left font-semibold">Tip</th>
              <th className="px-3 py-2.5 text-right font-semibold">Mağaza</th>
              <th className="px-3 py-2.5 text-right font-semibold">Günlük Adet</th>
              <th className="px-3 py-2.5 text-right font-semibold">Günlük Ciro</th>
              <th className="px-3 py-2.5 text-right font-semibold">Toplam Adet</th>
              <th className="px-3 py-2.5 text-right font-semibold">Toplam Ciro</th>
              <th className="px-3 py-2.5 text-right font-semibold">Stok Adet</th>
              <th className="px-3 py-2.5 text-right font-semibold">Raf Boş</th>
              <th className="px-3 py-2.5 text-right font-semibold">Stok Günü</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.tip} className="border-t border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-2 font-medium text-gray-800">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />{r.tip}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-gray-600">{formatNum(r.stokMagaza || r.toplamMagaza)}</td>
                <td className="px-3 py-2.5 text-right font-mono font-semibold text-gray-800">{formatNum(Math.round(r.gunlukQty))}</td>
                <td className="px-3 py-2.5 text-right font-mono text-gray-600">{formatTL(r.gunlukRev)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-gray-800">{formatNum(Math.round(r.toplamQty))}</td>
                <td className="px-3 py-2.5 text-right font-mono text-gray-600">{formatTL(r.toplamRev)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-gray-800">{formatNum(Math.round(r.stokAdet))}</td>
                <td className={`px-3 py-2.5 text-right font-mono font-bold ${r.rafBos > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {r.rafBos}<span className="text-gray-400 font-normal"> / %{r.rafBosOrani.toFixed(0)}</span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-gray-600">{r.stokGun != null ? r.stokGun.toFixed(1) + ' gün' : '—'}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
              <td className="px-4 py-2.5 text-gray-800">TOPLAM</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-900">{formatNum(totals.stokMagaza)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-900">{formatNum(Math.round(totals.gunlukQty))}</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-900">{formatTL(totals.gunlukRev)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-900">{formatNum(Math.round(totals.toplamQty))}</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-900">{formatTL(totals.toplamRev)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-900">{formatNum(Math.round(totals.stokAdet))}</td>
              <td className="px-3 py-2.5 text-right font-mono text-red-600">{totals.rafBos}</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-400">—</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Grafikler */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">

        {/* Günlük satış (adet) */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="font-semibold text-gray-800 mb-1">Günlük Satış — Tip Bazında</div>
          <div className="text-xs text-gray-400 mb-4">{formatDateTR(data?.satisTarihi ?? null)} · adet</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={gunlukBar} margin={{ left: 0, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="tip" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <Tooltip formatter={(v: unknown) => [formatNum(Number(v)), 'Adet']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="adet" radius={[4, 4, 0, 0]} maxBarSize={54}>
                {gunlukBar.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.9} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Toplam ciro payı (pie) */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="font-semibold text-gray-800 mb-1">Toplam Ciro Payı</div>
          <div className="text-xs text-gray-400 mb-4">Tüm zamanlar · tip bazında</div>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={ciroPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={92} paddingAngle={2}>
                {ciroPie.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip formatter={(v: unknown) => [formatTL(Number(v)), 'Ciro']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Stok (adet) */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="font-semibold text-gray-800 mb-1">Güncel Stok — Tip Bazında</div>
          <div className="text-xs text-gray-400 mb-4">{formatDateTR(data?.stokTarihi ?? null)} · adet</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={stokBar} margin={{ left: 0, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="tip" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <Tooltip formatter={(v: unknown) => [formatNum(Number(v)), 'Adet']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="adet" radius={[4, 4, 0, 0]} maxBarSize={54}>
                {stokBar.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.9} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Raf boş mağaza sayısı */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="font-semibold text-gray-800 mb-1">Raf Boş Mağaza — Tip Bazında</div>
          <div className="text-xs text-gray-400 mb-4">Stoğu sıfır mağaza sayısı</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={rafBosBar} margin={{ left: 0, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="tip" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <Tooltip formatter={(v: unknown, _nm, p: { payload?: { oran?: number } }) => [`${v} mağaza (%${p?.payload?.oran ?? 0})`, 'Raf Boş']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="bos" radius={[4, 4, 0, 0]} maxBarSize={54}>
                {rafBosBar.map((d, i) => <Cell key={i} fill="#dc2626" fillOpacity={d.bos > 0 ? 0.85 : 0.3} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
