import { useEffect, useState, useMemo } from 'react';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import { formatNum, formatTL } from '../utils/formatters';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RawStock {
  URUN_SATICI_ADI: string;
  SATICI_URUN_KODU: string;
  TESLIM_NOKTASI_ID: string;
  TESLIM_NOKTASI_ACIKLAMA: string;
  IL_ADI: string;
  STOK_MIKTARI: string;
  STOK_TUTARI: string;
  GUNLUK_SATIS_MIKTARI: string;
  GUNLUK_SATIS_TUTARI: string;
  GUNLUK_YUKLEME_MIKTARI: string;
  DEPO_TUR?: string;
}

interface LocationDiff {
  teslimNoktasi: string;
  teslimNoktasiId: string;
  il: string;
  eskiStok: number;
  yeniStok: number;
  fark: number;
  eskiTutar: number;
  yeniTutar: number;
  tutarFark: number;
  gunlukSatis: number;
  gunlukYukleme: number;
  dm: boolean;
}

interface ProductInfo {
  kod: string;
  displayName: string;
  shortName: string;
  color: string;
  colorLight: string;
  border: string;
  locations: LocationDiff[];
  toplamEski: number;
  toplamYeni: number;
  toplamFark: number;
  toplamEskiTutar: number;
  toplamYeniTutar: number;
  rafBosEski: number;
  rafBosYeni: number;
  dmEski: number;
  dmYeni: number;
  retailYeni: number;
  azalanlar: LocationDiff[];
  artanlar: LocationDiff[];
  yeniRafBos: LocationDiff[];
  yenilenen: LocationDiff[];
  kritikRafBos: LocationDiff[];
  dmLocs: LocationDiff[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const pf = (v?: string | null) => parseFloat((v || '0').toString().replace(',', '.')) || 0;

const PROD_COLORS: Record<string, { short: string; color: string; colorLight: string; border: string }> = {
  'ACTIVE CARBON': { short: 'Active Carbon', color: '#C0392B', colorLight: '#fef2f2', border: '#fecaca' },
  'MARSEILLE BREEZE': { short: 'Marseille Breeze', color: '#1A3A5C', colorLight: '#eff6ff', border: '#bfdbfe' },
};

function getProductStyle(name: string) {
  const upper = (name || '').toUpperCase();
  for (const [key, val] of Object.entries(PROD_COLORS)) {
    if (upper.includes(key)) return val;
  }
  return { short: name.slice(0, 20), color: '#6b7280', colorLight: '#f9fafb', border: '#e5e7eb' };
}

function isDM(row: RawStock) {
  const aciklama = (row.TESLIM_NOKTASI_ACIKLAMA || '').toUpperCase();
  return aciklama.includes('DAGITIM') || aciklama.includes('DAĞITIM') || row.DEPO_TUR === 'A';
}

function formatDateTR(d: string) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  const months = ['','Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  return `${parseInt(day)} ${months[parseInt(m)]} ${y}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function StockComparison() {
  const [dates, setDates]           = useState<string[]>([]);
  const [tarih1, setTarih1]         = useState('');
  const [tarih2, setTarih2]         = useState('');
  const [datesLoading, setDatesLoading] = useState(true);
  const [loading, setLoading]       = useState(false);
  const [rawData, setRawData]       = useState<{ tarih1: string; tarih2: string; eski: RawStock[]; yeni: RawStock[] } | null>(null);
  const [error, setError]           = useState('');

  // Tarih listesi
  useEffect(() => {
    fetch('/api/db-stok-gecmis')
      .then(r => r.json())
      .then((d: string[]) => {
        setDates(d);
        if (d.length >= 2) { setTarih1(d[1]); setTarih2(d[0]); }
        else if (d.length === 1) { setTarih1(d[0]); setTarih2(d[0]); }
      })
      .finally(() => setDatesLoading(false));
  }, []);

  // İlk yükleme — otomatik karşılaştır
  useEffect(() => {
    if (tarih1 && tarih2 && tarih1 !== tarih2) compare(tarih1, tarih2);
  }, [tarih1, tarih2]);  // eslint-disable-line

  async function compare(t1: string, t2: string) {
    setLoading(true); setError('');
    try {
      const data = await fetch(`/api/stok-karsilastirma?tarih1=${t1}&tarih2=${t2}`).then(r => r.json());
      if (data.error) { setError(data.error); setRawData(null); }
      else setRawData(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Bilinmeyen hata');
    } finally {
      setLoading(false);
    }
  }

  // Hesaplamalar
  const products = useMemo<ProductInfo[]>(() => {
    if (!rawData) return [];

    const oldMap: Record<string, RawStock> = {};
    const newMap: Record<string, RawStock> = {};
    rawData.eski.forEach(r => { oldMap[r.URUN_SATICI_ADI + '|' + r.TESLIM_NOKTASI_ID] = r; });
    rawData.yeni.forEach(r => { newMap[r.URUN_SATICI_ADI + '|' + r.TESLIM_NOKTASI_ID] = r; });

    const allKeys = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
    const urunler: Record<string, { displayName: string; locations: LocationDiff[] }> = {};

    allKeys.forEach(key => {
      const oldR = oldMap[key];
      const newR = newMap[key];
      const ref  = newR || oldR;
      const urunAdi = ref.URUN_SATICI_ADI;
      const urunKod = ref.SATICI_URUN_KODU || getProductStyle(urunAdi).short || urunAdi;

      if (!urunler[urunKod]) urunler[urunKod] = { displayName: urunAdi, locations: [] };
      if (urunAdi && urunAdi.length > urunler[urunKod].displayName.length)
        urunler[urunKod].displayName = urunAdi;

      urunler[urunKod].locations.push({
        teslimNoktasi: ref.TESLIM_NOKTASI_ACIKLAMA,
        teslimNoktasiId: ref.TESLIM_NOKTASI_ID,
        il: ref.IL_ADI,
        eskiStok:  pf(oldR?.STOK_MIKTARI),
        yeniStok:  pf(newR?.STOK_MIKTARI),
        fark:      pf(newR?.STOK_MIKTARI) - pf(oldR?.STOK_MIKTARI),
        eskiTutar: pf(oldR?.STOK_TUTARI),
        yeniTutar: pf(newR?.STOK_TUTARI),
        tutarFark: pf(newR?.STOK_TUTARI) - pf(oldR?.STOK_TUTARI),
        gunlukSatis:   pf(newR?.GUNLUK_SATIS_MIKTARI   || oldR?.GUNLUK_SATIS_MIKTARI),
        gunlukYukleme: pf(newR?.GUNLUK_YUKLEME_MIKTARI || oldR?.GUNLUK_YUKLEME_MIKTARI),
        dm: isDM(ref),
      });
    });

    return Object.entries(urunler).map(([kod, d]) => {
      const style = getProductStyle(d.displayName);
      const locs  = d.locations;
      const toplamEski = locs.reduce((s, l) => s + l.eskiStok, 0);
      const toplamYeni = locs.reduce((s, l) => s + l.yeniStok, 0);
      const toplamFark = toplamYeni - toplamEski;
      const dmLocs     = locs.filter(l => l.dm);
      const retailLocs = locs.filter(l => !l.dm);
      return {
        kod, displayName: d.displayName, shortName: style.short,
        color: style.color, colorLight: style.colorLight, border: style.border,
        locations: locs,
        toplamEski, toplamYeni, toplamFark,
        toplamEskiTutar: locs.reduce((s, l) => s + l.eskiTutar, 0),
        toplamYeniTutar: locs.reduce((s, l) => s + l.yeniTutar, 0),
        rafBosEski: locs.filter(l => l.eskiStok === 0 && !l.dm).length,
        rafBosYeni: locs.filter(l => l.yeniStok === 0 && !l.dm).length,
        dmEski: dmLocs.reduce((s, l) => s + l.eskiStok, 0),
        dmYeni: dmLocs.reduce((s, l) => s + l.yeniStok, 0),
        retailYeni: retailLocs.reduce((s, l) => s + l.yeniStok, 0),
        azalanlar:    locs.filter(l => l.fark < 0).sort((a, b) => a.fark - b.fark),
        artanlar:     locs.filter(l => l.fark > 0).sort((a, b) => b.fark - a.fark),
        yeniRafBos:   locs.filter(l => l.eskiStok > 0 && l.yeniStok === 0 && !l.dm),
        yenilenen:    locs.filter(l => l.eskiStok === 0 && l.yeniStok > 0 && !l.dm),
        kritikRafBos: locs.filter(l => l.yeniStok === 0 && !l.dm && l.gunlukSatis > 0.3)
                          .sort((a, b) => b.gunlukSatis - a.gunlukSatis),
        dmLocs,
      };
    });
  }, [rawData]);

  // ─── Render ────────────────────────────────────────────────────────────────

  if (datesLoading) return <div className="p-8"><LoadingSkeleton rows={6} /></div>;

  if (!dates.length) return (
    <div className="p-8 flex items-center justify-center h-64">
      <div className="text-center">
        <div className="text-4xl mb-3">📭</div>
        <p className="text-gray-500 font-medium">Veritabanında stok kaydı yok</p>
        <a href="/tools" className="text-blue-600 underline text-sm mt-2 inline-block">Veri Araçları'ndan veri çek</a>
      </div>
    </div>
  );

  if (dates.length < 2) return (
    <div className="p-8">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex gap-3">
        <span className="text-2xl">⚠️</span>
        <div>
          <div className="font-semibold text-amber-800">Karşılaştırma için en az 2 günlük veri gerekli</div>
          <div className="text-amber-600 text-sm mt-1">Şu an sadece <b>{dates[0]}</b> tarihli veri mevcut.</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-8 space-y-6">

      {/* Tarih seçici */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600">Eski Tarih:</span>
          <select value={tarih1} onChange={e => setTarih1(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 outline-none shadow-sm hover:border-gray-300">
            {dates.map(d => <option key={d} value={d}>{formatDateTR(d)}</option>)}
          </select>
        </div>
        <span className="text-gray-400 font-bold">→</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600">Yeni Tarih:</span>
          <select value={tarih2} onChange={e => setTarih2(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 outline-none shadow-sm hover:border-gray-300">
            {dates.map(d => <option key={d} value={d}>{formatDateTR(d)}</option>)}
          </select>
        </div>
        <button onClick={() => compare(tarih1, tarih2)} disabled={!tarih1 || !tarih2 || tarih1 === tarih2}
          className="px-4 py-2 bg-sidebar text-white rounded-lg text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
          style={{ background: '#1A3A5C' }}>
          Karşılaştır
        </button>
        {rawData && (
          <div className="ml-auto text-xs text-gray-400">
            {formatDateTR(rawData.tarih1)} → {formatDateTR(rawData.tarih2)}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
          <span className="text-xl">⚠️</span>
          <div className="text-red-700 text-sm font-medium">{error}</div>
        </div>
      )}

      {loading && <LoadingSkeleton rows={10} />}

      {!loading && rawData && products.length > 0 && (
        <>
          {/* ── KPI KARTLAR ── */}
          <section>
            <SectionHead color="#6b7280">Güncel Durum — Karşılaştırma</SectionHead>
            <div className="grid grid-cols-2 gap-4">
              {products.map(p => (
                <div key={p.kod} className="grid grid-cols-4 gap-3">
                  {[
                    {
                      label: `${p.shortName} Net Stok`,
                      value: formatNum(Math.round(p.toplamYeni)),
                      sub: `Eski: ${formatNum(Math.round(p.toplamEski))}`,
                      delta: p.toplamFark,
                      color: p.color,
                    },
                    {
                      label: `${p.shortName} Raf Boş`,
                      value: String(p.rafBosYeni),
                      sub: `Eski: ${p.rafBosEski}`,
                      delta: p.rafBosYeni - p.rafBosEski,
                      invertDelta: true,
                      color: p.color,
                    },
                    {
                      label: `${p.shortName} Stok Tutarı`,
                      value: formatTL(Math.round(p.toplamYeniTutar)),
                      sub: `Fark: ${p.toplamYeniTutar - p.toplamEskiTutar >= 0 ? '+' : ''}${formatTL(Math.round(p.toplamYeniTutar - p.toplamEskiTutar))}`,
                      color: p.color,
                    },
                    {
                      label: `${p.shortName} DM Stok`,
                      value: formatNum(Math.round(p.dmYeni)),
                      sub: `Retail: ${formatNum(Math.round(p.retailYeni))}`,
                      color: p.color,
                    },
                  ].map((card, i) => (
                    <div key={i} className="bg-white rounded-xl border border-gray-200 p-4"
                      style={{ borderTop: `3px solid ${card.color}` }}>
                      <div className="text-xs text-gray-500 font-medium mb-2 leading-tight">{card.label}</div>
                      <div className="text-xl font-bold text-gray-800 leading-none mb-1">{card.value}</div>
                      {card.delta !== undefined && (
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                          (card.invertDelta ? card.delta < 0 : card.delta >= 0)
                            ? 'bg-green-50 text-green-700'
                            : 'bg-red-50 text-red-600'
                        }`}>
                          {card.delta >= 0 ? '+' : ''}{formatNum(Math.round(card.delta))}
                        </span>
                      )}
                      <div className="text-xs text-gray-400 mt-1">{card.sub}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          {/* ── STOK AZALANLAR ── */}
          <section>
            <SectionHead color="#dc2626">Stok Azalan Lokasyonlar (En Büyükler)</SectionHead>
            <div className="grid grid-cols-2 gap-4">
              {products.map(p => {
                const top = p.azalanlar.slice(0, 10);
                const maxDrop = top.length ? Math.abs(top[0].fark) : 1;
                return (
                  <div key={p.kod} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between"
                      style={{ borderLeft: `4px solid ${p.color}` }}>
                      <span className="font-semibold text-gray-800 text-sm">{p.shortName}</span>
                      <span className="text-xs text-gray-400">{p.azalanlar.length} lokasyon azaldı</span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {top.map((l, i) => {
                        const pct = maxDrop > 0 ? Math.round(Math.abs(l.fark) / maxDrop * 100) : 0;
                        return (
                          <div key={i} className="px-4 py-2.5">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-gray-700 truncate max-w-[55%]">{l.teslimNoktasi}</span>
                              <div className="flex items-center gap-2 text-xs font-mono flex-shrink-0">
                                {l.dm && <Tag color="#6b7280">DM</Tag>}
                                {l.yeniStok === 0 && !l.dm && <Tag color="#dc2626">RAF BOŞ</Tag>}
                                <span className="text-gray-400">{Math.round(l.eskiStok)}</span>
                                <span className="text-gray-300">→</span>
                                <span className={l.yeniStok === 0 ? 'text-red-600 font-bold' : 'text-gray-700'}>{Math.round(l.yeniStok)}</span>
                                <span className="text-red-600 font-bold">{Math.round(l.fark)}</span>
                              </div>
                            </div>
                            <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-red-400" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                      {top.length === 0 && <div className="px-4 py-4 text-xs text-gray-400 text-center">Azalan lokasyon yok ✅</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── STOK ARTANLAR ── */}
          <section>
            <SectionHead color="#16a34a">Stok Artan Lokasyonlar — Yükleme Yapıldı</SectionHead>
            <div className="grid grid-cols-2 gap-4">
              {products.map(p => {
                const top = p.artanlar.slice(0, 10);
                const maxUp = top.length ? top[0].fark : 1;
                return (
                  <div key={p.kod} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between"
                      style={{ borderLeft: `4px solid ${p.color}` }}>
                      <span className="font-semibold text-gray-800 text-sm">{p.shortName}</span>
                      <span className="text-xs text-gray-400">{p.artanlar.length} lokasyona yükleme</span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {top.map((l, i) => {
                        const pct = maxUp > 0 ? Math.round(l.fark / maxUp * 100) : 0;
                        return (
                          <div key={i} className="px-4 py-2.5">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-gray-700 truncate max-w-[55%]">{l.teslimNoktasi}</span>
                              <div className="flex items-center gap-2 text-xs font-mono flex-shrink-0">
                                {l.eskiStok === 0 && !l.dm && <Tag color="#16a34a">RAF BOŞTU</Tag>}
                                <span className="text-gray-400">{Math.round(l.eskiStok)}</span>
                                <span className="text-gray-300">→</span>
                                <span className="text-green-600 font-bold">{Math.round(l.yeniStok)}</span>
                                <span className="text-green-600 font-bold">+{Math.round(l.fark)}</span>
                              </div>
                            </div>
                            <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-green-400" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                      {top.length === 0 && <div className="px-4 py-4 text-xs text-gray-400 text-center">Artan lokasyon yok</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── RAF DURUM DEĞİŞİMİ ── */}
          <section>
            <SectionHead color="#2563eb">Raf Durumu Değişimleri</SectionHead>
            <div className="grid grid-cols-2 gap-4">
              {products.map(p => (
                <div key={p.kod + '-raf-bos'} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between"
                    style={{ borderLeft: `4px solid #dc2626` }}>
                    <span className="font-semibold text-gray-800 text-sm">{p.shortName} · Stoklu → Raf Boş</span>
                    <span className="text-xs text-red-500 font-bold">{p.yeniRafBos.length} mağaza</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead><tr className="bg-gray-50 text-gray-400 uppercase tracking-wide">
                      <th className="px-4 py-2 text-left font-semibold">Mağaza</th>
                      <th className="px-4 py-2 text-right font-semibold">Dün</th>
                      <th className="px-4 py-2 text-right font-semibold">Bugün</th>
                      <th className="px-4 py-2 text-right font-semibold">Gnlk Satış</th>
                    </tr></thead>
                    <tbody>
                      {p.yeniRafBos.sort((a, b) => b.eskiStok - a.eskiStok).map((l, i) => (
                        <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-2 text-gray-700">{l.teslimNoktasi}</td>
                          <td className="px-4 py-2 text-right font-mono text-gray-600">{Math.round(l.eskiStok)}</td>
                          <td className="px-4 py-2 text-right font-mono text-red-600 font-bold">0</td>
                          <td className={`px-4 py-2 text-right font-mono ${l.gunlukSatis > 0.5 ? 'text-amber-600 font-bold' : 'text-gray-400'}`}>
                            {l.gunlukSatis > 0 ? l.gunlukSatis.toFixed(3) : '—'}
                          </td>
                        </tr>
                      ))}
                      {p.yeniRafBos.length === 0 && <tr><td colSpan={4} className="px-4 py-4 text-center text-gray-400">Boşalan raf yok ✅</td></tr>}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              {products.map(p => (
                <div key={p.kod + '-raf-geldi'} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between"
                    style={{ borderLeft: `4px solid #16a34a` }}>
                    <span className="font-semibold text-gray-800 text-sm">{p.shortName} · Raf Boş → Stok Geldi ✅</span>
                    <span className="text-xs text-green-600 font-bold">{p.yenilenen.length} mağaza</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead><tr className="bg-gray-50 text-gray-400 uppercase tracking-wide">
                      <th className="px-4 py-2 text-left font-semibold">Mağaza</th>
                      <th className="px-4 py-2 text-right font-semibold">Bugün</th>
                      <th className="px-4 py-2 text-right font-semibold">Gnlk Satış</th>
                    </tr></thead>
                    <tbody>
                      {p.yenilenen.sort((a, b) => b.gunlukSatis - a.gunlukSatis).map((l, i) => (
                        <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-2 text-gray-700">{l.teslimNoktasi}</td>
                          <td className="px-4 py-2 text-right font-mono text-green-600 font-bold">{Math.round(l.yeniStok)}</td>
                          <td className={`px-4 py-2 text-right font-mono ${l.gunlukSatis > 0.5 ? 'text-amber-600 font-bold' : 'text-gray-400'}`}>
                            {l.gunlukSatis > 0 ? l.gunlukSatis.toFixed(3) : '—'}
                          </td>
                        </tr>
                      ))}
                      {p.yenilenen.length === 0 && <tr><td colSpan={3} className="px-4 py-4 text-center text-gray-400">Doldurulan raf yok</td></tr>}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>

          {/* ── DM ANALİZİ ── */}
          <section>
            <SectionHead color="#d97706">Dağıtım Merkezleri — Güncel Durum</SectionHead>
            <DmGrid products={products} />
          </section>

          {/* ── KRİTİK RAF BOŞ ── */}
          <section>
            <SectionHead color="#dc2626">Kritik: Raf Boş + Yüksek Satış Hızı</SectionHead>
            <div className="grid grid-cols-2 gap-4">
              {products.map(p => (
                <div key={p.kod} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between"
                    style={{ borderLeft: `4px solid #dc2626` }}>
                    <span className="font-semibold text-gray-800 text-sm">{p.shortName} · Raf Boş & Satış {'>'} 0.3</span>
                    <span className="text-xs text-red-500 font-bold">{p.kritikRafBos.length} mağaza</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead><tr className="bg-gray-50 text-gray-400 uppercase tracking-wide">
                      <th className="px-4 py-2 text-left font-semibold">Mağaza</th>
                      <th className="px-4 py-2 text-right font-semibold">Gnlk Satış</th>
                      <th className="px-4 py-2 text-right font-semibold">Günlük Kayıp</th>
                    </tr></thead>
                    <tbody>
                      {p.kritikRafBos.slice(0, 15).map((l, i) => {
                        const birimFiyat = p.toplamYeni > 0 ? p.toplamYeniTutar / p.toplamYeni : 215;
                        const kayip = l.gunlukSatis * birimFiyat;
                        return (
                          <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-700">{l.teslimNoktasi}</td>
                            <td className={`px-4 py-2 text-right font-mono font-bold ${l.gunlukSatis > 0.5 ? 'text-amber-600' : 'text-gray-700'}`}>
                              {l.gunlukSatis.toFixed(3)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-red-600 font-bold">{formatTL(Math.round(kayip))}</td>
                          </tr>
                        );
                      })}
                      {p.kritikRafBos.length === 0 && <tr><td colSpan={3} className="px-4 py-4 text-center text-gray-400">Kritik mağaza yok ✅</td></tr>}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHead({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="text-xs font-bold uppercase tracking-widest text-gray-500">{children}</span>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  );
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold px-1 py-0.5 rounded"
      style={{ background: color + '18', color }}>
      {children}
    </span>
  );
}

function DmGrid({ products }: { products: ProductInfo[] }) {
  const dmMap: Record<string, Record<string, LocationDiff>> = {};
  products.forEach(p => {
    p.dmLocs.forEach(l => {
      if (!dmMap[l.teslimNoktasi]) dmMap[l.teslimNoktasi] = {};
      dmMap[l.teslimNoktasi][p.shortName] = l;
    });
  });

  const sorted = Object.entries(dmMap).sort((a, b) => {
    const aMin = Math.min(...Object.values(a[1]).map(l => l.yeniStok));
    const bMin = Math.min(...Object.values(b[1]).map(l => l.yeniStok));
    return aMin - bMin;
  });

  if (!sorted.length) return <div className="text-gray-400 text-sm">DM lokasyonu bulunamadı</div>;

  return (
    <div className="grid grid-cols-3 gap-3">
      {sorted.map(([dmName, prods]) => {
        const anyEmpty = Object.values(prods).some(l => l.yeniStok === 0);
        const anyLow   = Object.values(prods).some(l => l.yeniStok > 0 && l.yeniStok < 30);
        const allEmpty = Object.values(prods).every(l => l.yeniStok === 0);
        const statusBg = allEmpty ? '#fef2f2' : anyEmpty ? '#fff7ed' : anyLow ? '#fffbeb' : '#f0fdf4';
        const statusBorder = allEmpty ? '#fecaca' : anyEmpty ? '#fed7aa' : anyLow ? '#fde68a' : '#bbf7d0';

        return (
          <div key={dmName} className="rounded-xl border p-4" style={{ background: statusBg, borderColor: statusBorder }}>
            <div className="text-xs font-bold text-gray-700 mb-3">📦 {dmName}</div>
            {Object.entries(prods).map(([short, l]) => {
              const valColor = l.yeniStok === 0 ? '#dc2626' : l.yeniStok < 30 ? '#d97706' : '#16a34a';
              return (
                <div key={short} className="mb-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-gray-500">{short} Stok</span>
                    <span className="text-xs font-bold font-mono" style={{ color: valColor }}>
                      {formatNum(Math.round(l.yeniStok))} ad
                      {l.fark !== 0 && <span className="font-normal text-gray-400 ml-1">({l.fark >= 0 ? '+' : ''}{Math.round(l.fark)})</span>}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-gray-400">Gnlk Yükleme</span>
                    <span className="text-[11px] font-mono text-gray-500">{l.gunlukYukleme.toFixed(1)} ad</span>
                  </div>
                </div>
              );
            })}
            <div className={`mt-2 text-[11px] font-bold px-2 py-1 rounded text-center ${
              allEmpty ? 'bg-red-100 text-red-700' : anyEmpty ? 'bg-orange-100 text-orange-700' : anyLow ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
            }`}>
              {allEmpty ? '🚨 TÜM ÜRÜNLER BOŞ' : anyEmpty ? '🚨 Bir ürün boş' : anyLow ? '⚠️ Stok kritik' : '✅ Stok yeterli'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
