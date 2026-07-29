import { useEffect, useState, useMemo, Fragment } from 'react';
import { formatNum, formatTL } from '../utils/formatters';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

// ─── Tipler ──────────────────────────────────────────────────────────────────

interface Store {
  id: string;
  magaza_adi: string;
  il: string;
  bolge: string;
  tip: string;
  donem_qty: number | string;
  donem_rev: number | string;
  satis_gun: number | string;
  tum_qty: number | string;
  tum_rev: number | string;
  son_satis: string | null;
  stok: number | string | null;
  stok_tutar: number | string | null;
  stok_kaydi_var: boolean;
}

interface ApiResp {
  periyot: string;
  baslangic: string | null;
  bitis: string | null;
  stokTarihi: string | null;
  magazalar: Store[];
  error?: string;
}

type Durum = 'bulunuyor' | 'daha_once' | 'hic';

interface SRow extends Store {
  qty: number; rev: number; stokAdet: number; tumQty: number;
  durum: Durum; rafBos: boolean;
}

interface Agg {
  toplam: number; bulunan: number; dahaOnce: number; hic: number;
  qty: number; rev: number; stok: number; rafBos: number;
}

// ─── Sabitler ────────────────────────────────────────────────────────────────

const PERIYOTLAR = [
  { id: 'gun',  label: 'Son Gün' },
  { id: '7gun', label: 'Son 7 Gün' },
  { id: 'ay',   label: 'Son Ay' },
];

const DURUM_INFO: Record<Durum, { label: string; color: string; bg: string }> = {
  bulunuyor:  { label: 'Bulunuyor',   color: '#16a34a', bg: '#f0fdf4' },
  daha_once:  { label: 'Daha Önce',   color: '#d97706', bg: '#fffbeb' },
  hic:        { label: 'Hiç Satmadık', color: '#9ca3af', bg: '#f9fafb' },
};

const TYPE_COLORS: Record<string, string> = {
  'MMM': '#C0392B', 'MM': '#1A3A5C', '5M': '#F5A623', 'Macrocenter': '#6D28D9',
};
const TYPE_ORDER = ['MMM', 'MM', '5M', 'Macrocenter'];

const num = (v: number | string | null | undefined) => Number(v || 0);

function emptyAgg(): Agg {
  return { toplam: 0, bulunan: 0, dahaOnce: 0, hic: 0, qty: 0, rev: 0, stok: 0, rafBos: 0 };
}
function addToAgg(a: Agg, s: SRow) {
  a.toplam++;
  if (s.durum === 'bulunuyor') a.bulunan++;
  else if (s.durum === 'daha_once') a.dahaOnce++;
  else a.hic++;
  a.qty += s.qty; a.rev += s.rev; a.stok += s.stokAdet;
  if (s.rafBos) a.rafBos++;
}

function formatDateTR(d: string | null) {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  const months = ['','Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  return `${parseInt(day)} ${months[parseInt(m)]} ${y}`;
}

// ─── Bileşen ─────────────────────────────────────────────────────────────────

export default function Availability() {
  const [periyot, setPeriyot] = useState('gun');
  const [data, setData]       = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [durumFiltre, setDurumFiltre] = useState<Durum | 'hepsi'>('hepsi');
  const [arama, setArama] = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    fetch(`/api/bulunurluk?periyot=${periyot}`)
      .then(r => r.json())
      .then((d: ApiResp) => { if (d.error) setError(d.error); else setData(d); })
      .catch(e => setError(e instanceof Error ? e.message : 'Bilinmeyen hata'))
      .finally(() => setLoading(false));
  }, [periyot]);

  // Ham satırları durum bilgisiyle zenginleştir
  const stores = useMemo<SRow[]>(() => {
    if (!data) return [];
    return data.magazalar.map(s => {
      const qty = num(s.donem_qty);
      const stokAdet = num(s.stok);
      const tumQty = num(s.tum_qty);
      const durum: Durum = (qty > 0 || stokAdet > 0) ? 'bulunuyor'
                          : tumQty > 0 ? 'daha_once' : 'hic';
      return {
        ...s, qty, rev: num(s.donem_rev), stokAdet, tumQty, durum,
        rafBos: !!s.stok_kaydi_var && stokAdet === 0,
      };
    });
  }, [data]);

  // Filtre uygula
  const filtered = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase('tr');
    return stores.filter(s => {
      if (durumFiltre !== 'hepsi' && s.durum !== durumFiltre) return false;
      if (q && !(s.magaza_adi || '').toLocaleLowerCase('tr').includes(q)
            && !(s.il || '').toLocaleLowerCase('tr').includes(q)) return false;
      return true;
    });
  }, [stores, durumFiltre, arama]);

  // Genel toplam (filtreli)
  const total = useMemo(() => {
    const a = emptyAgg();
    filtered.forEach(s => addToAgg(a, s));
    return a;
  }, [filtered]);

  // Ağaç: bölge → tip → mağaza
  const tree = useMemo(() => {
    const bolgeMap: Record<string, { agg: Agg; tipler: Record<string, { agg: Agg; magazalar: SRow[] }> }> = {};
    filtered.forEach(s => {
      const b = s.bolge || 'Bilinmiyor';
      const t = s.tip || 'Diğer';
      if (!bolgeMap[b]) bolgeMap[b] = { agg: emptyAgg(), tipler: {} };
      if (!bolgeMap[b].tipler[t]) bolgeMap[b].tipler[t] = { agg: emptyAgg(), magazalar: [] };
      addToAgg(bolgeMap[b].agg, s);
      addToAgg(bolgeMap[b].tipler[t].agg, s);
      bolgeMap[b].tipler[t].magazalar.push(s);
    });
    return Object.entries(bolgeMap)
      .map(([bolge, d]) => ({
        bolge, agg: d.agg,
        tipler: Object.entries(d.tipler)
          .map(([tip, td]) => ({
            tip, agg: td.agg,
            magazalar: td.magazalar.sort((a, b) => b.qty - a.qty || a.magaza_adi.localeCompare(b.magaza_adi, 'tr')),
          }))
          .sort((a, b) => TYPE_ORDER.indexOf(a.tip) - TYPE_ORDER.indexOf(b.tip)),
      }))
      .sort((a, b) => b.agg.qty - a.agg.qty || a.bolge.localeCompare(b.bolge, 'tr'));
  }, [filtered]);

  const toggle = (key: string) => setExpanded(e => {
    const n = new Set(e);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const pct = (a: Agg) => a.toplam > 0 ? a.bulunan / a.toplam * 100 : 0;

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading && !data) return <div className="p-8"><LoadingSkeleton rows={8} /></div>;

  if (error) return (
    <div className="p-8">
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
        <span className="text-xl">⚠️</span><div className="text-red-700 text-sm font-medium">{error}</div>
      </div>
    </div>
  );

  if (!stores.length) return (
    <div className="p-8 flex items-center justify-center h-64">
      <div className="text-center">
        <div className="text-4xl mb-3">🗺️</div>
        <div className="text-gray-500 font-medium">Bulunurluk verisi yok</div>
        <div className="text-gray-400 text-sm mt-1">Önce Araçlar'dan mağaza listesini içe aktar.</div>
        <a href="/tools" className="text-blue-600 underline text-sm mt-2 inline-block">Araçlar'a git</a>
      </div>
    </div>
  );

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">

      {/* Filtreler */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {PERIYOTLAR.map(p => (
            <button key={p.id} onClick={() => setPeriyot(p.id)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all
                ${periyot === p.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          {(['hepsi', 'bulunuyor', 'daha_once', 'hic'] as const).map(d => {
            const aktif = durumFiltre === d;
            const info = d === 'hepsi' ? { label: 'Tümü', color: '#374151' } : DURUM_INFO[d];
            return (
              <button key={d} onClick={() => setDurumFiltre(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all
                  ${aktif ? 'text-white' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                style={aktif ? { background: info.color, borderColor: info.color } : undefined}>
                {info.label}
              </button>
            );
          })}
        </div>

        <input value={arama} onChange={e => setArama(e.target.value)} placeholder="Mağaza veya il ara..."
          className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-gray-400 w-52" />

        <div className="ml-auto text-xs text-gray-400">
          Satış: <b className="text-gray-600">{formatDateTR(data?.baslangic ?? null)} – {formatDateTR(data?.bitis ?? null)}</b>
          {' · '}Stok: <b className="text-gray-600">{formatDateTR(data?.stokTarihi ?? null)}</b>
        </div>
      </div>

      {/* KPI kartları */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ borderTop: '3px solid #1A3A5C' }}>
          <div className="text-xs text-gray-500 font-medium mb-1">Hedef Mağaza</div>
          <div className="text-2xl font-black text-gray-800 leading-none">{formatNum(total.toplam)}</div>
          <div className="text-[11px] text-gray-400 mt-1">MM · MMM · 5M · Macro</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ borderTop: '3px solid #16a34a' }}>
          <div className="text-xs text-gray-500 font-medium mb-1">Bulunuyoruz</div>
          <div className="text-2xl font-black leading-none" style={{ color: '#16a34a' }}>{formatNum(total.bulunan)}</div>
          <div className="text-[11px] text-gray-400 mt-1">bulunurluk %{pct(total).toFixed(1)}</div>
          <div className="h-1.5 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
            <div className="h-full rounded-full bg-green-500" style={{ width: `${pct(total)}%` }} />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ borderTop: '3px solid #d97706' }}>
          <div className="text-xs text-gray-500 font-medium mb-1">Daha Önce Bulunduk</div>
          <div className="text-2xl font-black leading-none" style={{ color: '#d97706' }}>{formatNum(total.dahaOnce)}</div>
          <div className="text-[11px] text-gray-400 mt-1">şimdi satış/stok yok</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ borderTop: '3px solid #C0392B' }}>
          <div className="text-xs text-gray-500 font-medium mb-1">Dönem Satışı</div>
          <div className="text-2xl font-black text-gray-800 leading-none">{formatNum(Math.round(total.qty))}</div>
          <div className="text-[11px] text-gray-400 mt-1">{formatTL(total.rev)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ borderTop: '3px solid #F5A623' }}>
          <div className="text-xs text-gray-500 font-medium mb-1">Güncel Stok</div>
          <div className="text-2xl font-black text-gray-800 leading-none">{formatNum(Math.round(total.stok))}</div>
          <div className="text-[11px] text-red-500 mt-1">{total.rafBos} mağazada raf boş</div>
        </div>
      </div>

      {/* Ağaç tablo */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="font-semibold text-gray-800">Coğrafi Bölge → Mağaza Tipi → Mağaza</div>
          <div className="text-xs text-gray-400">Satıra tıklayarak kır</div>
        </div>
        <table className="w-full text-xs min-w-[760px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-2.5 text-left font-semibold">Bölge / Tip / Mağaza</th>
              <th className="px-3 py-2.5 text-right font-semibold">Mağaza</th>
              <th className="px-3 py-2.5 text-right font-semibold">Bulunurluk</th>
              <th className="px-3 py-2.5 text-right font-semibold">Dönem Adet</th>
              <th className="px-3 py-2.5 text-right font-semibold">Dönem Ciro</th>
              <th className="px-3 py-2.5 text-right font-semibold">Stok</th>
              <th className="px-3 py-2.5 text-right font-semibold">Raf Boş</th>
              <th className="px-3 py-2.5 text-right font-semibold">Durum / Son Satış</th>
            </tr>
          </thead>
          <tbody>
            {tree.map(b => {
              const bOpen = expanded.has(b.bolge);
              return (
                <Fragment key={b.bolge}>
                  {/* Bölge */}
                  <tr onClick={() => toggle(b.bolge)}
                    className="border-t border-gray-100 bg-gray-50/60 hover:bg-gray-100 cursor-pointer font-semibold">
                    <td className="px-4 py-2.5 text-gray-800">
                      <span className={`inline-block w-3 text-gray-400 transition-transform ${bOpen ? 'rotate-90' : ''}`}>▸</span>
                      <span className="ml-1">🗺️ {b.bolge}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-600">{b.agg.bulunan}/{b.agg.toplam}</td>
                    <td className="px-3 py-2.5 text-right">
                      <BulunurlukBar pct={pct(b.agg)} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-800">{formatNum(Math.round(b.agg.qty))}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-600">{formatTL(b.agg.rev)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-800">{formatNum(Math.round(b.agg.stok))}</td>
                    <td className={`px-3 py-2.5 text-right font-mono ${b.agg.rafBos > 0 ? 'text-red-600' : 'text-gray-400'}`}>{b.agg.rafBos}</td>
                    <td className="px-3 py-2.5"></td>
                  </tr>

                  {/* Tipler */}
                  {bOpen && b.tipler.map(t => {
                    const tKey = b.bolge + '|' + t.tip;
                    const tOpen = expanded.has(tKey);
                    return (
                      <Fragment key={tKey}>
                        <tr onClick={() => toggle(tKey)}
                          className="border-t border-gray-50 hover:bg-gray-50 cursor-pointer">
                          <td className="px-4 py-2 pl-10 text-gray-700 font-medium">
                            <span className={`inline-block w-3 text-gray-400 transition-transform ${tOpen ? 'rotate-90' : ''}`}>▸</span>
                            <span className="ml-1 inline-flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ background: TYPE_COLORS[t.tip] || '#6b7280' }} />
                              {t.tip}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-gray-600">{t.agg.bulunan}/{t.agg.toplam}</td>
                          <td className="px-3 py-2 text-right"><BulunurlukBar pct={pct(t.agg)} /></td>
                          <td className="px-3 py-2 text-right font-mono text-gray-800">{formatNum(Math.round(t.agg.qty))}</td>
                          <td className="px-3 py-2 text-right font-mono text-gray-600">{formatTL(t.agg.rev)}</td>
                          <td className="px-3 py-2 text-right font-mono text-gray-800">{formatNum(Math.round(t.agg.stok))}</td>
                          <td className={`px-3 py-2 text-right font-mono ${t.agg.rafBos > 0 ? 'text-red-600' : 'text-gray-400'}`}>{t.agg.rafBos}</td>
                          <td className="px-3 py-2"></td>
                        </tr>

                        {/* Mağazalar */}
                        {tOpen && t.magazalar.map(s => {
                          const info = DURUM_INFO[s.durum];
                          return (
                            <tr key={tKey + '|' + s.id} className="border-t border-gray-50 hover:bg-blue-50/40">
                              <td className="px-4 py-2 pl-16 text-gray-600">
                                <div className="leading-tight">{s.magaza_adi}</div>
                                <div className="text-[10px] text-gray-400">{s.il} · #{s.id}</div>
                              </td>
                              <td className="px-3 py-2"></td>
                              <td className="px-3 py-2"></td>
                              <td className="px-3 py-2 text-right font-mono text-gray-800">{s.qty > 0 ? formatNum(Math.round(s.qty)) : '—'}</td>
                              <td className="px-3 py-2 text-right font-mono text-gray-600">{s.rev > 0 ? formatTL(s.rev) : '—'}</td>
                              <td className={`px-3 py-2 text-right font-mono ${s.rafBos ? 'text-red-600 font-bold' : 'text-gray-800'}`}>
                                {s.stok_kaydi_var ? formatNum(Math.round(s.stokAdet)) : '—'}
                              </td>
                              <td className="px-3 py-2 text-right">{s.rafBos ? <span className="text-red-600 font-bold">●</span> : ''}</td>
                              <td className="px-3 py-2 text-right">
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                                  style={{ color: info.color, background: info.bg }}>
                                  {info.label}
                                </span>
                                {s.son_satis && (
                                  <div className="text-[10px] text-gray-400 mt-0.5">son: {formatDateTR(s.son_satis)}</div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}

            {/* Genel toplam */}
            <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
              <td className="px-4 py-2.5 text-gray-800">TOPLAM ({tree.length} bölge)</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-900">{total.bulunan}/{total.toplam}</td>
              <td className="px-3 py-2.5 text-right"><BulunurlukBar pct={pct(total)} /></td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-900">{formatNum(Math.round(total.qty))}</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-900">{formatTL(total.rev)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-900">{formatNum(Math.round(total.stok))}</td>
              <td className="px-3 py-2.5 text-right font-mono text-red-600">{total.rafBos}</td>
              <td className="px-3 py-2.5"></td>
            </tr>
          </tbody>
        </table>
        {!tree.length && (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">Filtreye uyan mağaza yok</div>
        )}
      </div>
    </div>
  );
}

// ─── Alt bileşen ─────────────────────────────────────────────────────────────

function BulunurlukBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626';
  return (
    <div className="inline-flex items-center gap-2 justify-end w-full">
      <div className="h-1.5 w-14 bg-gray-100 rounded-full overflow-hidden flex-shrink-0">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-mono text-[11px] font-semibold w-10 text-right" style={{ color }}>%{pct.toFixed(0)}</span>
    </div>
  );
}
