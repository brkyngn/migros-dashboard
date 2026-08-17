import { useEffect, useState, useMemo, Fragment } from 'react';
import { formatNum } from '../utils/formatters';
import { TYPE_ORDER, TYPE_COLORS } from '../utils/storeTypes';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

// ─── Tipler ──────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  sku: string;
  urun_adi: string;
  magaza_adi: string;
  il: string | null;
  bolge: string | null;
  tip: string;
  miktar: number | string;
  kayit_var: boolean;
  son_stok_tarihi: string | null;
  kayit_gun: number | string;
  bos_gun: number | string | null;
}

interface ApiResp { tarih: string | null; satirlar: Row[]; error?: string }

// Mağaza başına SKU'lar tek satırda toplanır — tablo mağaza bazlı, kolonlar SKU bazlı
interface SkuHucre { stok: number; bosGun: number | null; sonStok: string | null; kayitGun: number }
interface Magaza {
  id: string; ad: string; il: string | null; bolge: string; tip: string;
  sku: Record<string, SkuHucre>;
  bosSayisi: number;      // kaç SKU'nun rafı boş
  enUzunBos: number;      // en uzun süredir boş olan SKU'nun gün sayısı
}

interface Agg {
  magaza: number;
  bos: Record<string, number>;        // sku → rafı boş mağaza sayısı
  stok: Record<string, number>;       // sku → toplam stok
  bosGunTop: Record<string, number>;  // sku → boş gün toplamı (ortalama için)
  bosGunAdet: Record<string, number>;
  tamBos: number;                     // tüm SKU'ları boş olan mağaza sayısı
}

type Gruplama = 'bolge-tip' | 'tip-bolge';

// ─── Sabitler ────────────────────────────────────────────────────────────────

const GRUPLAMALAR: { id: Gruplama; label: string; baslik: string; sutun: string }[] = [
  { id: 'bolge-tip', label: '🗺️ Bölge → Tip', baslik: 'Coğrafi Bölge → Mağaza Tipi → Mağaza', sutun: 'Bölge / Tip / Mağaza' },
  { id: 'tip-bolge', label: '🏬 Tip → Bölge', baslik: 'Mağaza Tipi → Coğrafi Bölge → Mağaza', sutun: 'Tip / Bölge / Mağaza' },
];

const SKU_RENK = ['#C0392B', '#1A3A5C', '#0891B2', '#6D28D9'];

const num = (v: number | string | null | undefined) => Number(v || 0);

// Uzun Migros ürün adını kısalt: "KITTYCADY ACTIVE CARBON 5L KEDI KUMU" → "Active Carbon"
function kisaUrunAdi(ad: string, sku: string) {
  const u = (ad || '').toUpperCase();
  if (u.includes('ACTIVE CARBON')) return 'Active Carbon';
  if (u.includes('MARSEILLE'))     return 'Marseille Breeze';
  return (ad || sku).slice(0, 18);
}

function emptyAgg(): Agg {
  return { magaza: 0, bos: {}, stok: {}, bosGunTop: {}, bosGunAdet: {}, tamBos: 0 };
}
function addToAgg(a: Agg, m: Magaza, skular: string[]) {
  a.magaza++;
  let bosSayisi = 0;
  skular.forEach(sk => {
    const h = m.sku[sk];
    a.stok[sk] = (a.stok[sk] || 0) + (h?.stok ?? 0);
    if (!h || h.stok <= 0) {
      bosSayisi++;
      a.bos[sk] = (a.bos[sk] || 0) + 1;
      if (h?.bosGun != null) {
        a.bosGunTop[sk]  = (a.bosGunTop[sk] || 0) + h.bosGun;
        a.bosGunAdet[sk] = (a.bosGunAdet[sk] || 0) + 1;
      }
    }
  });
  if (bosSayisi === skular.length) a.tamBos++;
}
const ortBosGun = (a: Agg, sk: string) =>
  (a.bosGunAdet[sk] || 0) > 0 ? (a.bosGunTop[sk] || 0) / a.bosGunAdet[sk] : 0;

function formatDateTR(d: string | null) {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  const months = ['','Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  return `${parseInt(day)} ${months[parseInt(m)]} ${y}`;
}

// Boş gün sayısına göre renk — stok bulunurluk raporundaki kovalarla aynı eşikler
function bosRenk(gun: number | null) {
  if (gun === null) return '#6b7280';
  if (gun <= 0)  return '#16a34a';
  if (gun <= 7)  return '#eab308';
  if (gun <= 14) return '#f97316';
  if (gun <= 30) return '#dc2626';
  return '#7f1d1d';
}

// ─── Bileşen ─────────────────────────────────────────────────────────────────

export default function DailyStock() {
  const [dates, setDates]     = useState<string[]>([]);
  const [tarih, setTarih]     = useState('');
  const [data, setData]       = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [gruplama, setGruplama] = useState<Gruplama>('bolge-tip');
  const [sadeceBos, setSadeceBos] = useState(false);
  const [sadeceHedef, setSadeceHedef] = useState(true);
  const [arama, setArama] = useState('');

  useEffect(() => {
    fetch('/api/db-stok-gecmis')
      .then(r => r.json())
      .then((d: string[]) => { setDates(d); if (d.length) setTarih(d[0]); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!tarih) return;
    setLoading(true); setError('');
    fetch(`/api/gunluk-stok-durum?tarih=${tarih}`)
      .then(r => r.json())
      .then((d: ApiResp) => { if (d.error) setError(d.error); else setData(d); })
      .catch(e => setError(e instanceof Error ? e.message : 'Bilinmeyen hata'))
      .finally(() => setLoading(false));
  }, [tarih]);

  // Veride görülen SKU'lar — sabit kodlamak yerine gelen satırlardan türetiliyor
  const skular = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, string>();
    data.satirlar.forEach(r => { if (!m.has(r.sku)) m.set(r.sku, kisaUrunAdi(r.urun_adi, r.sku)); });
    return [...m.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], 'tr'))
      .map(([sku, ad], i) => ({ sku, ad, renk: SKU_RENK[i % SKU_RENK.length] }));
  }, [data]);

  const skuIds = useMemo(() => skular.map(s => s.sku), [skular]);

  // Satırları mağaza bazına çevir
  const magazalar = useMemo<Magaza[]>(() => {
    if (!data) return [];
    const map = new Map<string, Magaza>();
    data.satirlar.forEach(r => {
      let m = map.get(r.id);
      if (!m) {
        m = {
          id: r.id, ad: r.magaza_adi, il: r.il, bolge: r.bolge || 'Bilinmiyor',
          tip: r.tip || 'Diğer', sku: {}, bosSayisi: 0, enUzunBos: 0,
        };
        map.set(r.id, m);
      }
      m.sku[r.sku] = {
        stok: num(r.miktar),
        bosGun: r.bos_gun === null || r.bos_gun === undefined ? null : num(r.bos_gun),
        sonStok: r.son_stok_tarihi,
        kayitGun: num(r.kayit_gun),
      };
    });
    // Boş raf özetini hesapla
    map.forEach(m => {
      let bos = 0, enUzun = 0;
      skuIds.forEach(sk => {
        const h = m.sku[sk];
        if (!h || h.stok <= 0) {
          bos++;
          const g = h?.bosGun ?? h?.kayitGun ?? 0;
          if (g > enUzun) enUzun = g;
        }
      });
      m.bosSayisi = bos; m.enUzunBos = enUzun;
    });
    return [...map.values()];
  }, [data, skuIds]);

  const HEDEF = useMemo(() => new Set(['MM', 'MMM', '5M', 'Macrocenter']), []);

  const filtered = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase('tr');
    return magazalar.filter(m => {
      if (sadeceHedef && !HEDEF.has(m.tip)) return false;
      if (sadeceBos && m.bosSayisi === 0) return false;
      if (q && !(m.ad || '').toLocaleLowerCase('tr').includes(q)
            && !(m.il || '').toLocaleLowerCase('tr').includes(q)) return false;
      return true;
    });
  }, [magazalar, sadeceBos, sadeceHedef, arama, HEDEF]);

  const total = useMemo(() => {
    const a = emptyAgg();
    filtered.forEach(m => addToAgg(a, m, skuIds));
    return a;
  }, [filtered, skuIds]);

  const bosMagazaSayisi = useMemo(() => {
    return magazalar.filter(m => (!sadeceHedef || HEDEF.has(m.tip)) && m.bosSayisi > 0).length;
  }, [magazalar, sadeceHedef, HEDEF]);

  const tipUstte = gruplama === 'tip-bolge';

  const tree = useMemo(() => {
    const key1 = (m: Magaza) => tipUstte ? m.tip : m.bolge;
    const key2 = (m: Magaza) => tipUstte ? m.bolge : m.tip;

    const map: Record<string, { agg: Agg; alt: Record<string, { agg: Agg; magazalar: Magaza[] }> }> = {};
    filtered.forEach(m => {
      const k1 = key1(m), k2 = key2(m);
      if (!map[k1]) map[k1] = { agg: emptyAgg(), alt: {} };
      if (!map[k1].alt[k2]) map[k1].alt[k2] = { agg: emptyAgg(), magazalar: [] };
      addToAgg(map[k1].agg, m, skuIds);
      addToAgg(map[k1].alt[k2].agg, m, skuIds);
      map[k1].alt[k2].magazalar.push(m);
    });

    const sirala = <T extends { ad: string; agg: Agg }>(nodes: T[], tip: boolean) =>
      nodes.sort((a, b) => tip
        ? TYPE_ORDER.indexOf(a.ad) - TYPE_ORDER.indexOf(b.ad)
        : b.agg.tamBos - a.agg.tamBos || a.ad.localeCompare(b.ad, 'tr'));

    return sirala(
      Object.entries(map).map(([ad, d]) => ({
        ad, agg: d.agg,
        alt: sirala(
          Object.entries(d.alt).map(([ad2, td]) => ({
            ad: ad2, agg: td.agg,
            // En uzun süredir boş raflar üstte
            magazalar: td.magazalar.sort((a, b) =>
              b.enUzunBos - a.enUzunBos || b.bosSayisi - a.bosSayisi || a.ad.localeCompare(b.ad, 'tr')),
          })),
          !tipUstte),
      })),
      tipUstte);
  }, [filtered, tipUstte, skuIds]);

  const toggle = (key: string) => setExpanded(e => {
    const n = new Set(e);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const gruplamaInfo = GRUPLAMALAR.find(g => g.id === gruplama)!;

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading && !data) return <div className="p-8"><LoadingSkeleton rows={8} /></div>;

  if (error) return (
    <div className="p-8">
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
        <span className="text-xl">⚠️</span><div className="text-red-700 text-sm font-medium">{error}</div>
      </div>
    </div>
  );

  if (!magazalar.length) return (
    <div className="p-8 flex items-center justify-center h-64">
      <div className="text-center">
        <div className="text-4xl mb-3">📦</div>
        <div className="text-gray-500 font-medium">Bu tarihte mağaza stok verisi yok</div>
      </div>
    </div>
  );

  // Her grup satırı için SKU hücreleri (stok · boş mağaza · ort. boş gün)
  const grupSkuHucreleri = (a: Agg, kucuk: boolean) => skular.map(s => (
    <Fragment key={s.sku}>
      <td className={`${kucuk ? 'px-3 py-2' : 'px-3 py-2.5'} text-right font-mono text-gray-800`}>
        {formatNum(Math.round(a.stok[s.sku] || 0))}
      </td>
      <td className={`${kucuk ? 'px-3 py-2' : 'px-3 py-2.5'} text-right font-mono ${(a.bos[s.sku] || 0) > 0 ? 'text-red-600 font-bold' : 'text-gray-400'}`}>
        {a.bos[s.sku] || 0}
      </td>
      <td className={`${kucuk ? 'px-3 py-2' : 'px-3 py-2.5'} text-right font-mono text-gray-500`}>
        {ortBosGun(a, s.sku) > 0 ? `ort. ${ortBosGun(a, s.sku).toFixed(0)}` : '—'}
      </td>
    </Fragment>
  ));

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">

      {/* Filtreler */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={tarih} onChange={e => setTarih(e.target.value)}
          className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-gray-400">
          {dates.map(d => <option key={d} value={d}>{formatDateTR(d)}</option>)}
        </select>

        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {GRUPLAMALAR.map(g => (
            <button key={g.id}
              onClick={() => { setGruplama(g.id); setExpanded(new Set()); }}
              title={g.baslik}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all
                ${gruplama === g.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {g.label}
            </button>
          ))}
        </div>

        <button onClick={() => setSadeceBos(v => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all
            ${sadeceBos ? 'bg-ac text-white border-ac' : 'bg-white text-ac border-ac/40 hover:border-ac'}`}
          title="En az bir SKU'su rafta olmayan mağazalar">
          🚨 Sadece Raf Boş <span className="font-mono">{bosMagazaSayisi}</span>
        </button>

        <button onClick={() => setSadeceHedef(v => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all
            ${sadeceHedef ? 'bg-mb text-white border-mb' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
          Sadece hedef tipler
        </button>

        <input value={arama} onChange={e => setArama(e.target.value)} placeholder="Mağaza veya il ara..."
          className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-gray-400 w-52" />

        <div className="ml-auto text-xs text-gray-400">
          Yalnızca mağazalar — <b className="text-gray-600">dağıtım merkezleri hariç</b>
        </div>
      </div>

      {/* SKU kartları */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ borderTop: '3px solid #1A3A5C' }}>
          <div className="text-xs text-gray-500 font-medium mb-1">Mağaza</div>
          <div className="text-2xl font-black text-gray-800 leading-none">{formatNum(total.magaza)}</div>
          <div className="text-[11px] text-gray-400 mt-1">
            {total.tamBos > 0 && <span className="text-red-600 font-semibold">{total.tamBos} mağazada hiç ürün yok</span>}
          </div>
        </div>
        {skular.map(s => (
          <div key={s.sku} className="bg-white rounded-xl border border-gray-200 p-4" style={{ borderTop: `3px solid ${s.renk}` }}>
            <div className="text-xs font-bold mb-1" style={{ color: s.renk }}>{s.ad}</div>
            <div className="flex items-end gap-4">
              <div>
                <div className="text-2xl font-black text-gray-800 leading-none">
                  {formatNum(Math.round(total.stok[s.sku] || 0))}
                </div>
                <div className="text-[11px] text-gray-400 mt-1">adet stok</div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-2xl font-black leading-none text-red-600">{total.bos[s.sku] || 0}</div>
                <div className="text-[11px] text-gray-400 mt-1">
                  rafı boş
                  {ortBosGun(total, s.sku) > 0 && ` · ort. ${ortBosGun(total, s.sku).toFixed(0)} gün`}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Ağaç tablo */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="font-semibold text-gray-800">{gruplamaInfo.baslik}</div>
          <div className="text-xs text-gray-400">{formatDateTR(data?.tarih ?? null)} · satıra tıklayarak kır</div>
        </div>
        <table className="w-full text-xs" style={{ minWidth: 560 + skular.length * 210 }}>
          <thead>
            <tr className="bg-gray-50 text-gray-500">
              <th className="px-4 py-2 text-left font-semibold" rowSpan={2}>{gruplamaInfo.sutun}</th>
              <th className="px-3 py-2 text-right font-semibold" rowSpan={2}>Mağaza</th>
              {skular.map(s => (
                <th key={s.sku} colSpan={3} className="px-3 py-2 text-center font-bold border-l border-gray-200"
                    style={{ color: s.renk }}>
                  {s.ad}
                </th>
              ))}
            </tr>
            <tr className="bg-gray-50 text-gray-400 uppercase tracking-wide text-[10px]">
              {skular.map(s => (
                <Fragment key={s.sku}>
                  <th className="px-3 py-1.5 text-right font-semibold border-l border-gray-200">Stok</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Raf Boş</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Boş Gün</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {tree.map(b => {
              const bOpen = expanded.has(b.ad);
              return (
                <Fragment key={b.ad}>
                  <tr onClick={() => toggle(b.ad)}
                    className="border-t border-gray-100 bg-gray-50/60 hover:bg-gray-100 cursor-pointer font-semibold">
                    <td className="px-4 py-2.5 text-gray-800">
                      <span className={`inline-block w-3 text-gray-400 transition-transform ${bOpen ? 'rotate-90' : ''}`}>▸</span>
                      <span className="ml-1"><NodeLabel ad={b.ad} tip={tipUstte} /></span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-600">{b.agg.magaza}</td>
                    {grupSkuHucreleri(b.agg, false)}
                  </tr>

                  {bOpen && b.alt.map(t => {
                    const tKey = b.ad + '|' + t.ad;
                    const tOpen = expanded.has(tKey);
                    return (
                      <Fragment key={tKey}>
                        <tr onClick={() => toggle(tKey)}
                          className="border-t border-gray-50 hover:bg-gray-50 cursor-pointer">
                          <td className="px-4 py-2 pl-10 text-gray-700 font-medium">
                            <span className={`inline-block w-3 text-gray-400 transition-transform ${tOpen ? 'rotate-90' : ''}`}>▸</span>
                            <span className="ml-1"><NodeLabel ad={t.ad} tip={!tipUstte} /></span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-gray-600">{t.agg.magaza}</td>
                          {grupSkuHucreleri(t.agg, true)}
                        </tr>

                        {tOpen && t.magazalar.map(m => (
                          <tr key={tKey + '|' + m.id} className="border-t border-gray-50 hover:bg-blue-50/40">
                            <td className="px-4 py-2 pl-16 text-gray-600">
                              <div className="leading-tight">{m.ad}</div>
                              <div className="text-[10px] text-gray-400">{m.il || '—'} · #{m.id}</div>
                            </td>
                            <td className="px-3 py-2"></td>
                            {skular.map(s => {
                              const h = m.sku[s.sku];
                              const bos = !h || h.stok <= 0;
                              const gun = h?.bosGun ?? null;
                              return (
                                <Fragment key={s.sku}>
                                  <td className={`px-3 py-2 text-right font-mono border-l border-gray-100 ${bos ? 'text-red-600 font-bold' : 'text-gray-800'}`}>
                                    {h ? formatNum(Math.round(h.stok)) : '—'}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    {bos ? <span className="text-red-600 font-bold">●</span> : <span className="text-green-600">✓</span>}
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono font-bold" style={{ color: bosRenk(bos ? gun : 0) }}>
                                    {!h ? <span title="Bu mağazada bu SKU hiç listelenmemiş">hiç</span>
                                      : !bos ? '—'
                                      : gun === null ? `≥${h.kayitGun}`
                                      : gun}
                                  </td>
                                </Fragment>
                              );
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}

            <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
              <td className="px-4 py-2.5 text-gray-800">TOPLAM</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-900">{total.magaza}</td>
              {grupSkuHucreleri(total, false)}
            </tr>
          </tbody>
        </table>
        {!tree.length && (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">Filtreye uyan mağaza yok</div>
        )}
      </div>

      <div className="text-[11px] text-gray-400">
        <b>Boş Gün</b>: o SKU'nun ilgili mağazada rafta en son görüldüğü günden bu yana geçen gün.
        <b> ≥N</b> = elimizdeki stok geçmişi boyunca o mağazada o SKU hiç görülmedi, gerçek süre en az N gün.
      </div>
    </div>
  );
}

// ─── Alt bileşen ─────────────────────────────────────────────────────────────

function NodeLabel({ ad, tip }: { ad: string; tip: boolean }) {
  if (!tip) return <>🗺️ {ad}</>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: TYPE_COLORS[ad] || '#6b7280' }} />
      {ad}
    </span>
  );
}
