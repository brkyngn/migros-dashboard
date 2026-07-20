import { useEffect, useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend
} from 'recharts';
import type { StockRecord } from '../types';
import { formatNum } from '../utils/formatters';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

const PROD_COLORS = ['#C0392B', '#1A3A5C', '#F5A623', '#2D6A4F', '#6D28D9', '#0891B2'];

type LocType = 'magaza' | 'dm' | 'iade' | 'bloke';

// DEPO_TUR: MA=Mağaza, A=Dağıtım Merkezi, I=İade Deposu, B=Bloke Deposu
function locType(r: StockRecord): LocType {
  const dt = (r.DEPO_TUR || '').toUpperCase().trim();
  if (dt === 'MA') return 'magaza';
  if (dt === 'A')  return 'dm';
  if (dt === 'I')  return 'iade';
  if (dt === 'B')  return 'bloke';
  const a = (r.TESLIM_NOKTASI_ACIKLAMA || '').toUpperCase();
  if (a.includes('BLOKE'))                        return 'bloke';
  if (a.includes('İADE') || a.includes('IADE'))   return 'iade';
  if (a.includes('DAĞITIM') || a.includes('DAGITIM') || / DM\b/.test(a)) return 'dm';
  return 'magaza';
}

function fmtTL(n: number) {
  return Math.round(n).toLocaleString('tr-TR') + ' ₺';
}

function stockStatus(sg: number, sm: number): { label: string; color: string; bg: string } {
  if (sm === 0)       return { label: 'Sıfır Stok',   color: '#dc2626', bg: '#fef2f2' };
  if (sg > 0 && sg < 7)  return { label: 'Kritik <7g',   color: '#d97706', bg: '#fffbeb' };
  if (sg >= 7 && sg < 14) return { label: 'Uyarı 7-14g', color: '#2563eb', bg: '#eff6ff' };
  if (sg >= 14 && sg < 30) return { label: 'Normal',      color: '#16a34a', bg: '#f0fdf4' };
  if (sg >= 30 && sg < 60) return { label: 'Yüksek',      color: '#7c3aed', bg: '#f5f3ff' };
  return { label: 'Aşırı 60+g', color: '#9333ea', bg: '#fdf4ff' };
}

export default function DailyStock() {
  const [allDates, setAllDates]     = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [rows, setRows]             = useState<StockRecord[]>([]);
  const [loading, setLoading]       = useState(true);
  const [datesLoading, setDatesLoading] = useState(true);

  // Tarih listesi
  useEffect(() => {
    fetch('/api/db-stok-gecmis')
      .then(r => r.json())
      .then((dates: string[]) => {
        setAllDates(dates);
        if (dates.length > 0) setSelectedDate(dates[0]);
      })
      .finally(() => setDatesLoading(false));
  }, []);

  // Seçili tarih verisi
  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    fetch(`/api/db-stok-tarih?tarih=${selectedDate}`)
      .then(r => r.json())
      .then(setRows)
      .finally(() => setLoading(false));
  }, [selectedDate]);

  // Lokasyonları türe göre ayır — mağaza / DM / iade / bloke
  const { magazaRows, dmRows } = useMemo(() => {
    const magaza: StockRecord[] = [], dm: StockRecord[] = [];
    rows.forEach(r => {
      const t = locType(r);
      if (t === 'dm') dm.push(r);
      else if (t === 'magaza') magaza.push(r);
      // iade / bloke: ana panoya dahil edilmez
    });
    return { magazaRows: magaza, dmRows: dm };
  }, [rows]);

  const stats = useMemo(() => {
    let toplamStok = 0, toplamTutar = 0, gunlukSatis = 0, gunlukSatisTutar = 0, gunlukYukleme = 0;
    const stokGunArr: number[] = [];
    let sifir = 0, kritik = 0, uyari = 0, normal = 0, yuksek = 0, asiri = 0;
    const ilMap: Record<string, { stok: number; satis: number; tutar: number }> = {};
    const urunMap: Record<string, { stok: number; satis: number; tutar: number; sgSum: number; sgCnt: number; kod: string }> = {};

    magazaRows.forEach(r => {
      const sm  = parseFloat(r.STOK_MIKTARI) || 0;
      const st  = parseFloat(r.STOK_TUTARI) || 0;
      const gs  = parseFloat(r.GUNLUK_SATIS_MIKTARI) || 0;
      const gst = parseFloat(r.GUNLUK_SATIS_TUTARI) || 0;
      const gy  = parseFloat(r.GUNLUK_YUKLEME_MIKTARI) || 0;
      const sg  = parseFloat(r.STOK_GUN) || 0;
      const il  = r.IL_ADI || 'Bilinmiyor';
      const urun = r.URUN_SATICI_ADI || r.SATICI_URUN_KODU || '—';

      toplamStok += sm; toplamTutar += st;
      gunlukSatis += gs; gunlukSatisTutar += gst; gunlukYukleme += gy;
      if (sg > 0) stokGunArr.push(sg);

      if (sm === 0) sifir++;
      else if (sg > 0 && sg < 7) kritik++;
      else if (sg >= 7 && sg < 14) uyari++;
      else if (sg >= 14 && sg < 30) normal++;
      else if (sg >= 30 && sg < 60) yuksek++;
      else asiri++;

      if (!ilMap[il]) ilMap[il] = { stok: 0, satis: 0, tutar: 0 };
      ilMap[il].stok += sm; ilMap[il].satis += gs; ilMap[il].tutar += st;

      if (!urunMap[urun]) urunMap[urun] = { stok: 0, satis: 0, tutar: 0, sgSum: 0, sgCnt: 0, kod: r.SATICI_URUN_KODU || '—' };
      urunMap[urun].stok += sm; urunMap[urun].satis += gs; urunMap[urun].tutar += st;
      if (sg > 0) { urunMap[urun].sgSum += sg; urunMap[urun].sgCnt++; }
    });

    const ortStokGun = stokGunArr.length
      ? Math.round(stokGunArr.reduce((a, b) => a + b, 0) / stokGunArr.length)
      : 0;

    const iller  = Object.entries(ilMap).sort((a, b) => b[1].stok - a[1].stok);
    const urunler = Object.entries(urunMap).sort((a, b) => b[1].stok - a[1].stok);

    const durumPie = [
      { name: 'Sıfır',      value: sifir,  color: '#dc2626' },
      { name: 'Kritik',     value: kritik, color: '#d97706' },
      { name: 'Uyarı',      value: uyari,  color: '#2563eb' },
      { name: 'Normal',     value: normal, color: '#16a34a' },
      { name: 'Yüksek',     value: yuksek, color: '#7c3aed' },
      { name: 'Aşırı',      value: asiri,  color: '#9333ea' },
    ].filter(d => d.value > 0);

    return {
      toplamStok: Math.round(toplamStok),
      toplamTutar: Math.round(toplamTutar),
      gunlukSatis: Math.round(gunlukSatis),
      gunlukSatisTutar: Math.round(gunlukSatisTutar),
      gunlukYukleme: Math.round(gunlukYukleme),
      ortStokGun,
      sifir, kritik, uyari, normal, yuksek, asiri,
      iller, urunler,
      durumPie,
      urunBarData: urunler.slice(0, 6).map(([name, d], i) => ({
        name: name.length > 18 ? name.slice(0, 16) + '…' : name,
        stok: Math.round(d.stok),
        color: PROD_COLORS[i % PROD_COLORS.length],
      })),
    };
  }, [magazaRows]);

  // DM (Dağıtım Merkezi) istatistikleri
  const dmStats = useMemo(() => {
    let toplamStok = 0, toplamTutar = 0, gunlukYukleme = 0;
    // DM adı → { ürün kısa adı → stok }
    const dmMap: Record<string, { il: string; urunler: Record<string, { stok: number; tutar: number; yukleme: number }> }> = {};
    const urunSet = new Set<string>();

    dmRows.forEach(r => {
      const sm = parseFloat(r.STOK_MIKTARI) || 0;
      const st = parseFloat(r.STOK_TUTARI) || 0;
      const gy = parseFloat(r.GUNLUK_YUKLEME_MIKTARI) || 0;
      const dm = r.TESLIM_NOKTASI_ACIKLAMA || '—';
      const urun = r.URUN_SATICI_ADI || r.SATICI_URUN_KODU || '—';
      toplamStok += sm; toplamTutar += st; gunlukYukleme += gy;
      urunSet.add(urun);
      if (!dmMap[dm]) dmMap[dm] = { il: r.IL_ADI || '', urunler: {} };
      if (!dmMap[dm].urunler[urun]) dmMap[dm].urunler[urun] = { stok: 0, tutar: 0, yukleme: 0 };
      dmMap[dm].urunler[urun].stok += sm;
      dmMap[dm].urunler[urun].tutar += st;
      dmMap[dm].urunler[urun].yukleme += gy;
    });

    const urunler = Array.from(urunSet).sort();
    const merkezler = Object.entries(dmMap)
      .map(([ad, d]) => ({
        ad, il: d.il, urunler: d.urunler,
        toplam: Object.values(d.urunler).reduce((s, u) => s + u.stok, 0),
      }))
      .sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));

    return {
      toplamStok: Math.round(toplamStok),
      toplamTutar: Math.round(toplamTutar),
      gunlukYukleme: Math.round(gunlukYukleme),
      adet: merkezler.length,
      urunler, merkezler,
    };
  }, [dmRows]);

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
          <div className="text-gray-500 font-medium">Veritabanında stok kaydı yok</div>
          <a href="/tools" className="text-blue-600 underline text-sm mt-2 inline-block">Veri Araçları'ndan veri çek</a>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">

      {/* Tarih seçici */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600">Tarih:</span>
          <select
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 outline-none shadow-sm hover:border-gray-300 transition-colors"
          >
            {allDates.map((d, i) => (
              <option key={d} value={d}>{formatDateTR(d)}{i === 0 ? ' (En Güncel)' : ''}</option>
            ))}
          </select>
        </div>
        {selectedDate && (
          <div className="flex items-center gap-2 bg-sidebar/10 border border-sidebar/20 rounded-lg px-4 py-2">
            <span className="text-sidebar text-sm font-semibold">{formatDateTR(selectedDate)}</span>
            <span className="text-gray-400 text-xs">stok raporu</span>
          </div>
        )}
        <div className="ml-auto text-xs text-gray-400">{magazaRows.length} mağaza · {dmStats.adet} DM · {allDates.length} günlük veri</div>
      </div>

      {loading ? <LoadingSkeleton rows={8} /> : (
        <>
          {/* KPI Kartları */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            {[
              { label: 'Toplam Stok',    value: formatNum(stats.toplamStok),       icon: '📦', color: '#f5a623' },
              { label: 'Stok Tutarı',    value: fmtTL(stats.toplamTutar),          icon: '💰', color: '#0f3460' },
              { label: 'Günlük Satış',   value: formatNum(stats.gunlukSatis) + ' adet', icon: '📈', color: '#C0392B' },
              { label: 'Ort. Stok Günü', value: stats.ortStokGun + ' gün',         icon: '📅', color: '#16a34a' },
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

          {/* Durum kartları */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: '⛔ Sıfır Stok',    val: stats.sifir,  color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
              { label: '⚠️ Kritik <7g',    val: stats.kritik, color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
              { label: '🔵 Uyarı 7-14g',   val: stats.uyari,  color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
              { label: '✅ Normal 14-30g',  val: stats.normal, color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
              { label: '📦 Yüksek 30-60g', val: stats.yuksek, color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
              { label: '🔺 Aşırı 60+g',    val: stats.asiri,  color: '#9333ea', bg: '#fdf4ff', border: '#f0abfc' },
            ].map(s => (
              <div key={s.label} className="rounded-xl p-4 border" style={{ background: s.bg, borderColor: s.border }}>
                <div className="text-xs font-semibold mb-1.5" style={{ color: s.color }}>{s.label}</div>
                <div className="text-3xl font-bold leading-none" style={{ color: s.color }}>{s.val}</div>
                <div className="text-xs text-gray-400 mt-1">lokasyon</div>
              </div>
            ))}
          </div>

          {/* Grafikler */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">

            {/* Ürün bazında bar */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="font-semibold text-gray-800 mb-1">Ürün Bazında Stok</div>
              <div className="text-xs text-gray-400 mb-4">Adet bazında dağılım</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={stats.urunBarData} margin={{ left: 0, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  <Tooltip
                    formatter={(v: unknown) => [formatNum(Number(v)), 'Adet']}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="stok" radius={[4, 4, 0, 0]} maxBarSize={50}>
                    {stats.urunBarData.map((d, i) => (
                      <Cell key={i} fill={d.color} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Durum pie */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="font-semibold text-gray-800 mb-1">Stok Durumu Dağılımı</div>
              <div className="text-xs text-gray-400 mb-4">Lokasyon sayısına göre</div>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={stats.durumPie}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={95}
                    paddingAngle={2}
                  >
                    {stats.durumPie.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: unknown) => [formatNum(Number(v)), 'lokasyon']}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tablolar */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">

            {/* İl tablosu */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="font-semibold text-gray-800">İl Bazında Stok</div>
                <div className="text-xs text-gray-400">Top 10</div>
              </div>
              <div className="overflow-auto max-h-80">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide sticky top-0">
                      <th className="px-4 py-2 text-left">#</th>
                      <th className="px-4 py-2 text-left">İl</th>
                      <th className="px-4 py-2 text-right">Stok</th>
                      <th className="px-4 py-2 text-right">Gnlk Satış</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.iller.slice(0, 10).map(([il, d], i) => (
                      <tr key={il} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5 text-gray-400 text-xs font-medium w-8">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-800 text-xs">{il}</div>
                          <div className="h-1 bg-gray-100 rounded-full mt-1 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-navy"
                              style={{ width: `${stats.iller[0] ? d.stok / stats.iller[0][1].stok * 100 : 0}%`, background: '#1A3A5C' }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-gray-800">{formatNum(d.stok)}</td>
                        <td className="px-4 py-2.5 text-right text-red-600 font-medium text-xs">{formatNum(d.satis)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Ürün tablosu */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="font-semibold text-gray-800">Ürün Bazında Stok</div>
                <div className="text-xs text-gray-400">{stats.urunler.length} ürün çeşidi</div>
              </div>
              <div className="overflow-auto max-h-80">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide sticky top-0">
                      <th className="px-4 py-2 text-left">#</th>
                      <th className="px-4 py-2 text-left">Ürün</th>
                      <th className="px-4 py-2 text-right">Stok</th>
                      <th className="px-4 py-2 text-right">Ort. Gün</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.urunler.slice(0, 10).map(([urun, d], i) => {
                      const sg = d.sgCnt ? Math.round(d.sgSum / d.sgCnt) : 0;
                      const st = stockStatus(sg, d.stok);
                      return (
                        <tr key={urun} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-2.5 text-gray-400 text-xs font-medium w-8">{i + 1}</td>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-gray-800 text-xs leading-tight max-w-[180px] truncate" title={urun}>{urun}</div>
                            <div className="h-1 bg-gray-100 rounded-full mt-1 overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${stats.urunler[0] ? d.stok / stats.urunler[0][1].stok * 100 : 0}%`, background: PROD_COLORS[i % PROD_COLORS.length] }}
                              />
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right font-bold text-gray-800">{formatNum(d.stok)}</td>
                          <td className="px-4 py-2.5 text-right">
                            <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ color: st.color, background: st.bg }}>
                              {sg}g
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Tüm mağazalar */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="font-semibold text-gray-800">Tüm Mağazalar</div>
              <div className="text-xs text-gray-400">{magazaRows.length} mağaza (DM hariç)</div>
            </div>
            <div className="overflow-auto max-h-96">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide sticky top-0">
                    <th className="px-4 py-2 text-left">İl</th>
                    <th className="px-4 py-2 text-left">Ürün</th>
                    <th className="px-4 py-2 text-right">Stok</th>
                    <th className="px-4 py-2 text-right">Tutar</th>
                    <th className="px-4 py-2 text-right">Gnlk Satış</th>
                    <th className="px-4 py-2 text-right">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {magazaRows.slice(0, 500).map((r, i) => {
                    const sm = parseFloat(r.STOK_MIKTARI) || 0;
                    const st = parseFloat(r.STOK_TUTARI) || 0;
                    const gs = parseFloat(r.GUNLUK_SATIS_MIKTARI) || 0;
                    const sg = parseFloat(r.STOK_GUN) || 0;
                    const status = stockStatus(sg, sm);
                    return (
                      <tr key={i} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2 text-xs text-gray-500">{r.IL_ADI || '—'}</td>
                        <td className="px-4 py-2 text-xs font-medium text-gray-800 max-w-[200px] truncate" title={r.URUN_SATICI_ADI || r.SATICI_URUN_KODU}>
                          {r.URUN_SATICI_ADI || r.SATICI_URUN_KODU || '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-bold text-gray-800 text-xs">{formatNum(sm)}</td>
                        <td className="px-4 py-2 text-right text-gray-500 text-xs">{fmtTL(st)}</td>
                        <td className="px-4 py-2 text-right text-red-600 font-medium text-xs">{formatNum(gs)}</td>
                        <td className="px-4 py-2 text-right">
                          <span className="text-xs font-bold px-1.5 py-0.5 rounded whitespace-nowrap" style={{ color: status.color, background: status.bg }}>
                            {status.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {magazaRows.length > 500 && (
                    <tr><td colSpan={6} className="px-4 py-3 text-center text-xs text-gray-400">İlk 500 kayıt gösteriliyor · Toplam {formatNum(magazaRows.length)} mağaza</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Dağıtım Merkezleri (DM) */}
          {dmStats.adet > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: '#d97706' }} />
                <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Dağıtım Merkezleri (DM)</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>

              {/* DM özet KPI */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'DM Sayısı',        value: String(dmStats.adet),              icon: '🏭', color: '#d97706' },
                  { label: 'DM Toplam Stok',   value: formatNum(dmStats.toplamStok),     icon: '📦', color: '#f5a623' },
                  { label: 'DM Stok Tutarı',   value: fmtTL(dmStats.toplamTutar),        icon: '💰', color: '#0f3460' },
                  { label: 'DM Günlük Yükleme',value: formatNum(dmStats.gunlukYukleme),  icon: '🚚', color: '#16a34a' },
                ].map(card => (
                  <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4"
                    style={{ borderTop: '3px solid #d97706' }}>
                    <div className="text-2xl">{card.icon}</div>
                    <div>
                      <div className="text-xs text-gray-500 font-medium mb-1">{card.label}</div>
                      <div className="text-2xl font-bold" style={{ color: card.color }}>{card.value}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* DM detay tablosu */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <div className="font-semibold text-gray-800">Dağıtım Merkezi Bazında Stok</div>
                  <div className="text-xs text-gray-400">{dmStats.adet} merkez</div>
                </div>
                <table className="w-full text-xs min-w-[520px]">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide">
                      <th className="px-4 py-2.5 text-left font-semibold">Dağıtım Merkezi</th>
                      <th className="px-3 py-2.5 text-left font-semibold">İl</th>
                      {dmStats.urunler.map(u => (
                        <th key={u} className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">{u.length > 20 ? u.slice(0, 18) + '…' : u}</th>
                      ))}
                      <th className="px-4 py-2.5 text-right font-semibold">Toplam</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dmStats.merkezler.map(m => (
                      <tr key={m.ad} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-700 font-medium">{m.ad}</td>
                        <td className="px-3 py-2 text-gray-500">{m.il}</td>
                        {dmStats.urunler.map(u => {
                          const stok = m.urunler[u]?.stok ?? 0;
                          const has = u in m.urunler;
                          return (
                            <td key={u} className={`px-3 py-2 text-right font-mono ${!has ? 'text-gray-300' : stok === 0 ? 'text-red-600 font-bold' : 'text-gray-700'}`}>
                              {has ? formatNum(Math.round(stok)) : '—'}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2 text-right font-mono font-bold text-gray-800">{formatNum(Math.round(m.toplam))}</td>
                      </tr>
                    ))}
                    {/* Toplam satırı */}
                    <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                      <td className="px-4 py-2.5 text-gray-800" colSpan={2}>TOPLAM ({dmStats.adet} DM)</td>
                      {dmStats.urunler.map(u => {
                        const t = dmStats.merkezler.reduce((s, m) => s + (m.urunler[u]?.stok ?? 0), 0);
                        return <td key={u} className="px-3 py-2.5 text-right font-mono text-gray-800">{formatNum(Math.round(t))}</td>;
                      })}
                      <td className="px-4 py-2.5 text-right font-mono text-gray-900">{formatNum(dmStats.toplamStok)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
