import { useEffect, useState, useMemo, Fragment } from 'react';
import { formatNum } from '../utils/formatters';
import { TYPE_ORDER, TYPE_COLORS } from '../utils/storeTypes';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

// ─── Tipler ──────────────────────────────────────────────────────────────────

interface Store {
  id: string;
  magaza_adi: string;
  il: string | null;
  bolge: string | null;
  tip: string;
  guncel_stok: number | string;
  guncel_tutar: number | string;
  guncel_kayit_var: boolean;
  son_stok_tarihi: string | null;
  ilk_kayit: string | null;
  stoklu_gun: number | string;
  kayit_gun: number | string;
  stoksuz_gun: number | string | null;
  toplam_qty: number | string;
  satis_gun: number | string;
  ilk_satis: string | null;
  son_satis: string | null;
  ort_gunluk_satis: number | string | null;
}

interface ApiResp {
  gecmis: { ilk: string | null; son: string | null; gun: number; satisSon: string | null };
  magazalar: Store[];
  error?: string;
}

interface SRow extends Store {
  stok: number;
  gun: number | null;   // kaç gündür stoksuz (null = geçmişte hiç stok görülmedi)
  kova: string;         // süre kovası anahtarı
  ortGunluk: number;    // geçmişten gelen ortalama günlük satış (adet)
  kayip: number;        // tahmini kayıp = ortGunluk × stoksuz gün
}

interface Agg { toplam: number; stokta: number; stoksuz: number; stok: number; gunTop: number; gunAdet: number; ortGunluk: number; kayip: number }

type Gruplama = 'bolge-tip' | 'tip-bolge' | 'sure-tip';

// ─── Sabitler ────────────────────────────────────────────────────────────────

// Kovalar stoksuzluk süresine göre; sıra ekranda ve PDF'te de bu sırayla çıkar.
const KOVALAR = [
  { id: 'stokta',  label: 'Stokta Var',        kisa: 'Stokta',   color: '#16a34a' },
  { id: 'hafta1',  label: '1 Haftadır Stoksuz', kisa: '1-7 gün',  color: '#eab308' },
  { id: 'hafta2',  label: '2 Haftadır Stoksuz', kisa: '8-14 gün', color: '#f97316' },
  { id: 'ay1',     label: '1 Aydır Stoksuz',    kisa: '15-30 gün', color: '#dc2626' },
  { id: 'ayustu',  label: '1 Aydan Uzun',       kisa: '30+ gün',  color: '#7f1d1d' },
  { id: 'hicyok',  label: 'Hiç Stok Görülmedi', kisa: 'kayıt yok', color: '#6b7280' },
];
const KOVA_INFO = Object.fromEntries(KOVALAR.map(k => [k.id, k]));

const GRUPLAMALAR: { id: Gruplama; label: string; baslik: string; sutun: string }[] = [
  { id: 'bolge-tip', label: '🗺️ Bölge → Tip', baslik: 'Coğrafi Bölge → Mağaza Tipi → Mağaza', sutun: 'Bölge / Tip / Mağaza' },
  { id: 'tip-bolge', label: '🏬 Tip → Bölge', baslik: 'Mağaza Tipi → Coğrafi Bölge → Mağaza', sutun: 'Tip / Bölge / Mağaza' },
  { id: 'sure-tip',  label: '⏱️ Süre → Tip',  baslik: 'Stoksuzluk Süresi → Mağaza Tipi → Mağaza', sutun: 'Süre / Tip / Mağaza' },
];

const num = (v: number | string | null | undefined) => Number(v || 0);

function kovaBul(gun: number | null, stok: number): string {
  if (gun === null) return 'hicyok';
  if (stok > 0 || gun === 0) return 'stokta';
  if (gun <= 7)  return 'hafta1';
  if (gun <= 14) return 'hafta2';
  if (gun <= 30) return 'ay1';
  return 'ayustu';
}

function emptyAgg(): Agg {
  return { toplam: 0, stokta: 0, stoksuz: 0, stok: 0, gunTop: 0, gunAdet: 0, ortGunluk: 0, kayip: 0 };
}
function addToAgg(a: Agg, s: SRow) {
  a.toplam++;
  if (s.kova === 'stokta') a.stokta++; else a.stoksuz++;
  a.stok += s.stok;
  a.ortGunluk += s.ortGunluk;
  a.kayip += s.kayip;
  if (s.gun !== null && s.gun > 0) { a.gunTop += s.gun; a.gunAdet++; }
}
const ortGun = (a: Agg) => a.gunAdet > 0 ? a.gunTop / a.gunAdet : 0;

function formatDateTR(d: string | null) {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  const months = ['','Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  return `${parseInt(day)} ${months[parseInt(m)]} ${y}`;
}

// ─── Bileşen ─────────────────────────────────────────────────────────────────

export default function StockAvailability() {
  const [data, setData]       = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [gruplama, setGruplama] = useState<Gruplama>('sure-tip');
  const [kovaFiltre, setKovaFiltre] = useState<string>('hepsi');
  const [sadeceHedef, setSadeceHedef] = useState(true);
  const [arama, setArama] = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    fetch('/api/stok-bulunurluk')
      .then(r => r.json())
      .then((d: ApiResp) => { if (d.error) setError(d.error); else setData(d); })
      .catch(e => setError(e instanceof Error ? e.message : 'Bilinmeyen hata'))
      .finally(() => setLoading(false));
  }, []);

  const stores = useMemo<SRow[]>(() => {
    if (!data) return [];
    return data.magazalar.map(s => {
      const stok = num(s.guncel_stok);
      const gun = s.stoksuz_gun === null || s.stoksuz_gun === undefined ? null : num(s.stoksuz_gun);
      const ortGunluk = num(s.ort_gunluk_satis);
      const kova = kovaBul(gun, stok);
      // Kayıp yalnızca fiilen stoksuz geçen günler için anlamlı
      const kayip = kova === 'stokta' || gun === null ? 0 : ortGunluk * gun;
      return { ...s, stok, gun, kova, ortGunluk, kayip };
    });
  }, [data]);

  const HEDEF = useMemo(() => new Set(['MM', 'MMM', '5M', 'Macrocenter']), []);

  const filtered = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase('tr');
    return stores.filter(s => {
      if (sadeceHedef && !HEDEF.has(s.tip)) return false;
      if (kovaFiltre === 'stoksuz') { if (s.kova === 'stokta') return false; }
      else if (kovaFiltre !== 'hepsi' && s.kova !== kovaFiltre) return false;
      if (q && !(s.magaza_adi || '').toLocaleLowerCase('tr').includes(q)
            && !(s.il || '').toLocaleLowerCase('tr').includes(q)) return false;
      return true;
    });
  }, [stores, kovaFiltre, arama, sadeceHedef, HEDEF]);

  const total = useMemo(() => {
    const a = emptyAgg();
    filtered.forEach(s => addToAgg(a, s));
    return a;
  }, [filtered]);

  // Kova dağılımı (filtre çubuğundaki rozetler — kova filtresinden bağımsız)
  const kovaSayilari = useMemo(() => {
    const c: Record<string, number> = {};
    stores.forEach(s => {
      if (sadeceHedef && !HEDEF.has(s.tip)) return;
      c[s.kova] = (c[s.kova] || 0) + 1;
    });
    return c;
  }, [stores, sadeceHedef, HEDEF]);

  const tumSayi = useMemo(
    () => Object.values(kovaSayilari).reduce((a, b) => a + b, 0), [kovaSayilari]);
  const stoksuzSayi = useMemo(
    () => Object.entries(kovaSayilari).reduce((a, [k, v]) => k === 'stokta' ? a : a + v, 0), [kovaSayilari]);

  const tipUstte = gruplama === 'tip-bolge';
  const sureUstte = gruplama === 'sure-tip';

  const tree = useMemo(() => {
    // sure-tip: kova→tip · tip-bolge: tip→bölge · bolge-tip: bölge→tip
    const key1 = (s: SRow) => sureUstte ? s.kova : tipUstte ? s.tip : (s.bolge || 'Bilinmiyor');
    const key2 = (s: SRow) => tipUstte ? (s.bolge || 'Bilinmiyor') : s.tip;

    const map: Record<string, { agg: Agg; alt: Record<string, { agg: Agg; magazalar: SRow[] }> }> = {};
    filtered.forEach(s => {
      const k1 = key1(s), k2 = key2(s);
      if (!map[k1]) map[k1] = { agg: emptyAgg(), alt: {} };
      if (!map[k1].alt[k2]) map[k1].alt[k2] = { agg: emptyAgg(), magazalar: [] };
      addToAgg(map[k1].agg, s);
      addToAgg(map[k1].alt[k2].agg, s);
      map[k1].alt[k2].magazalar.push(s);
    });

    // Süre kovaları sabit sırada, tipler TYPE_ORDER'da, bölgeler stoksuz sayısına göre
    const sirala = <T extends { ad: string; agg: Agg }>(nodes: T[], tur: 'kova' | 'tip' | 'bolge') =>
      nodes.sort((a, b) =>
        tur === 'kova' ? KOVALAR.findIndex(k => k.id === a.ad) - KOVALAR.findIndex(k => k.id === b.ad)
        : tur === 'tip' ? TYPE_ORDER.indexOf(a.ad) - TYPE_ORDER.indexOf(b.ad)
        : b.agg.stoksuz - a.agg.stoksuz || a.ad.localeCompare(b.ad, 'tr'));

    const tur1 = sureUstte ? 'kova' : tipUstte ? 'tip' : 'bolge';
    const tur2 = sureUstte ? 'tip'  : tipUstte ? 'bolge' : 'tip';

    return sirala(
      Object.entries(map).map(([ad, d]) => ({
        ad, agg: d.agg,
        alt: sirala(
          Object.entries(d.alt).map(([ad2, td]) => ({
            ad: ad2, agg: td.agg,
            // En uzun süredir stoksuz olan en üstte — aksiyon listesi bu sırayla okunur
            magazalar: td.magazalar.sort((a, b) =>
              b.kayip - a.kayip
              || (b.gun ?? 99999) - (a.gun ?? 99999)
              || a.magaza_adi.localeCompare(b.magaza_adi, 'tr')),
          })),
          tur2 as 'kova' | 'tip' | 'bolge'),
      })),
      tur1 as 'kova' | 'tip' | 'bolge');
  }, [filtered, tipUstte, sureUstte]);

  const toggle = (key: string) => setExpanded(e => {
    const n = new Set(e);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const gruplamaInfo = GRUPLAMALAR.find(g => g.id === gruplama)!;
  const kapsam = data?.gecmis.gun ?? 0;

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
        <div className="text-4xl mb-3">📦</div>
        <div className="text-gray-500 font-medium">Stok geçmişi yok</div>
        <div className="text-gray-400 text-sm mt-1">Önce stok verisi çekilmeli.</div>
      </div>
    </div>
  );

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">

      {/* Filtreler */}
      <div className="flex items-center gap-3 flex-wrap no-print">
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

        <button onClick={() => setSadeceHedef(v => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all
            ${sadeceHedef ? 'bg-mb text-white border-mb' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
          title="MM · MMM · 5M · Macrocenter dışındaki formatları gizle">
          Sadece hedef tipler
        </button>

        <input value={arama} onChange={e => setArama(e.target.value)} placeholder="Mağaza veya il ara..."
          className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-gray-400 w-52" />

        <button onClick={() => window.print()}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-ac text-white hover:opacity-90">
          🖨️ PDF / Yazdır
        </button>

        <div className="ml-auto text-xs text-gray-400">
          Stok: <b className="text-gray-600">{formatDateTR(data?.gecmis.son ?? null)}</b>
          {' · '}Geçmiş: <b className="text-gray-600">{kapsam} gün</b> ({formatDateTR(data?.gecmis.ilk ?? null)}'den beri)
        </div>
      </div>

      {/* Kova rozetleri = hızlı filtre */}
      <div className="flex gap-2 flex-wrap no-print">
        <button onClick={() => setKovaFiltre('hepsi')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all
            ${kovaFiltre === 'hepsi' ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-600 border-gray-200'}`}>
          Tümü <span className="font-mono">{tumSayi}</span>
        </button>
        <button onClick={() => setKovaFiltre(kovaFiltre === 'stoksuz' ? 'hepsi' : 'stoksuz')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all
            ${kovaFiltre === 'stoksuz' ? 'bg-ac text-white border-ac' : 'bg-white text-ac border-ac/40 hover:border-ac'}`}
          title="Stokta olmayan bütün mağazalar — süre farketmeksizin">
          🚨 Tüm Stoksuzlar <span className="font-mono">{stoksuzSayi}</span>
        </button>
        <span className="w-px bg-gray-200 mx-1" />
        {KOVALAR.map(k => {
          const adet = kovaSayilari[k.id] || 0;
          const aktif = kovaFiltre === k.id;
          return (
            <button key={k.id} onClick={() => setKovaFiltre(aktif ? 'hepsi' : k.id)} disabled={!adet}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all disabled:opacity-40
                ${aktif ? 'text-white' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
              style={aktif ? { background: k.color, borderColor: k.color } : undefined}>
              {k.label} <span className="font-mono">{adet}</span>
            </button>
          );
        })}
      </div>

      {/* KPI kartları */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 no-print">
        <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ borderTop: '3px solid #1A3A5C' }}>
          <div className="text-xs text-gray-500 font-medium mb-1">Takip Edilen Mağaza</div>
          <div className="text-2xl font-black text-gray-800 leading-none">{formatNum(total.toplam)}</div>
          <div className="text-[11px] text-gray-400 mt-1">{sadeceHedef ? 'MM · MMM · 5M · Macro' : 'tüm formatlar'}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ borderTop: '3px solid #16a34a' }}>
          <div className="text-xs text-gray-500 font-medium mb-1">Stokta Var</div>
          <div className="text-2xl font-black leading-none" style={{ color: '#16a34a' }}>{formatNum(total.stokta)}</div>
          <div className="text-[11px] text-gray-400 mt-1">
            %{total.toplam > 0 ? (total.stokta / total.toplam * 100).toFixed(1) : '0'}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ borderTop: '3px solid #C0392B' }}>
          <div className="text-xs text-gray-500 font-medium mb-1">Stoksuz Mağaza</div>
          <div className="text-2xl font-black leading-none" style={{ color: '#C0392B' }}>{formatNum(total.stoksuz)}</div>
          <div className="text-[11px] text-gray-400 mt-1">ort. {ortGun(total).toFixed(0)} gündür</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ borderTop: '3px solid #F5A623' }}>
          <div className="text-xs text-gray-500 font-medium mb-1">Raftaki Toplam Stok</div>
          <div className="text-2xl font-black text-gray-800 leading-none">{formatNum(Math.round(total.stok))}</div>
          <div className="text-[11px] text-gray-400 mt-1">adet</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ borderTop: '3px solid #7f1d1d' }}>
          <div className="text-xs text-gray-500 font-medium mb-1">Tahmini Kayıp Satış</div>
          <div className="text-2xl font-black leading-none" style={{ color: '#7f1d1d' }}>
            {formatNum(Math.round(total.kayip))}
          </div>
          <div className="text-[11px] text-gray-400 mt-1">adet · ort. günlük × stoksuz gün</div>
        </div>
      </div>

      {/* Yazdırma bloğu — ekranda gizli, PDF'te tüm dallar açık.
          Ayrı render ediliyor ki baskı, ekrandaki aç/kapa durumundan etkilenmesin. */}
      <div id="print-area" className="print-only">
        <div className="print-header">
          <h1>KittyCady · Stok Bulunurluk Raporu</h1>
          <div className="print-meta">
            {gruplamaInfo.baslik}
            {' — '}Stok tarihi: {formatDateTR(data?.gecmis.son ?? null)}
            {' · '}Kapsam: {kapsam} gün ({formatDateTR(data?.gecmis.ilk ?? null)} – {formatDateTR(data?.gecmis.son ?? null)})
            <br />
            {sadeceHedef ? 'MM · MMM · 5M · Macrocenter' : 'Tüm formatlar'}
            {kovaFiltre !== 'hepsi' && ` · Filtre: ${KOVA_INFO[kovaFiltre]?.label}`}
            {' · '}<b>{total.toplam} mağaza · {total.stoksuz} stoksuz · ort. {ortGun(total).toFixed(0)} gün
            {total.kayip > 0 && ` · tahmini kayıp ${formatNum(Math.round(total.kayip))} adet`}</b>
          </div>
        </div>
        <table className="print-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>{gruplamaInfo.sutun}</th>
              <th>İl</th>
              <th>Güncel Stok</th>
              <th>Stoksuz Gün</th>
              <th>Ort. Günlük</th>
              <th>Tah. Kayıp</th>
              <th>Son Stok Tarihi</th>
            </tr>
          </thead>
          <tbody>
            {tree.map(b => (
              <Fragment key={'p' + b.ad}>
                <tr className="print-l1">
                  <td>{b.ad === 'Bilinmiyor' ? b.ad : (KOVA_INFO[b.ad]?.label ?? b.ad)}</td>
                  <td colSpan={6}>
                    {b.agg.toplam} mağaza · {b.agg.stoksuz} stoksuz
                    {b.agg.gunAdet > 0 && ` · ort. ${ortGun(b.agg).toFixed(0)} gün`}
                    {b.agg.kayip > 0 && ` · tahmini kayıp ${formatNum(Math.round(b.agg.kayip))} adet`}
                  </td>
                </tr>
                {b.alt.map(t => (
                  <Fragment key={'p' + b.ad + t.ad}>
                    <tr className="print-l2">
                      <td>{t.ad}</td>
                      <td colSpan={6}>
                        {t.agg.toplam} mağaza · {t.agg.stoksuz} stoksuz
                        {t.agg.kayip > 0 && ` · tahmini kayıp ${formatNum(Math.round(t.agg.kayip))} adet`}
                      </td>
                    </tr>
                    {t.magazalar.map(s => (
                      <tr key={'p' + b.ad + t.ad + s.id}>
                        <td className="print-store">{s.magaza_adi} <span className="print-id">#{s.id}</span></td>
                        <td>{s.il || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{formatNum(Math.round(s.stok))}</td>
                        <td style={{ textAlign: 'right' }}>
                          {s.gun === null ? `≥${s.kayit_gun}` : s.gun > 0 ? s.gun : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>{s.ortGunluk > 0 ? s.ortGunluk.toFixed(2) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{s.kayip > 0 ? formatNum(Math.round(s.kayip)) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{s.son_stok_tarihi ? formatDateTR(s.son_stok_tarihi) : 'hiç'}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Ağaç tablo — ekran */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto no-print">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="font-semibold text-gray-800">{gruplamaInfo.baslik}</div>
            <div className="print-only text-xs text-gray-500 mt-1">
              KittyCady · Stok Bulunurluk Raporu · Stok tarihi: {formatDateTR(data?.gecmis.son ?? null)}
              {' · '}{sadeceHedef ? 'MM/MMM/5M/Macrocenter' : 'tüm formatlar'}
              {kovaFiltre !== 'hepsi' && ` · ${KOVA_INFO[kovaFiltre]?.label}`}
              {' · '}{total.toplam} mağaza, {total.stoksuz} stoksuz
            </div>
          </div>
          <div className="text-xs text-gray-400 no-print">Satıra tıklayarak kır</div>
        </div>
        <table className="w-full text-xs min-w-[940px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-2.5 text-left font-semibold">{gruplamaInfo.sutun}</th>
              <th className="px-3 py-2.5 text-right font-semibold">Mağaza</th>
              <th className="px-3 py-2.5 text-right font-semibold">Stokta</th>
              <th className="px-3 py-2.5 text-right font-semibold">Stoksuz</th>
              <th className="px-3 py-2.5 text-right font-semibold">Güncel Stok</th>
              <th className="px-3 py-2.5 text-right font-semibold">Stoksuz Gün</th>
              <th className="px-3 py-2.5 text-right font-semibold">Ort. Günlük Satış</th>
              <th className="px-3 py-2.5 text-right font-semibold">Tahmini Kayıp</th>
              <th className="px-3 py-2.5 text-right font-semibold">Son Stok Tarihi</th>
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
                      <span className={`inline-block w-3 text-gray-400 transition-transform no-print ${bOpen ? 'rotate-90' : ''}`}>▸</span>
                      <span className="ml-1"><NodeLabel ad={b.ad} tur={sureUstte ? 'kova' : tipUstte ? 'tip' : 'bolge'} /></span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-600">{b.agg.toplam}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-green-700">{b.agg.stokta}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-red-600 font-bold">{b.agg.stoksuz}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-800">{formatNum(Math.round(b.agg.stok))}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-500">
                      {b.agg.gunAdet > 0 ? `ort. ${ortGun(b.agg).toFixed(0)}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-700">{b.agg.ortGunluk.toFixed(1)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-red-600">
                      {b.agg.kayip > 0 ? formatNum(Math.round(b.agg.kayip)) : '—'}
                    </td>
                    <td className="px-3 py-2.5"></td>
                  </tr>

                  {bOpen && b.alt.map(t => {
                    const tKey = b.ad + '|' + t.ad;
                    const tOpen = expanded.has(tKey);
                    return (
                      <Fragment key={tKey}>
                        <tr onClick={() => toggle(tKey)}
                          className="border-t border-gray-50 hover:bg-gray-50 cursor-pointer">
                          <td className="px-4 py-2 pl-10 text-gray-700 font-medium">
                            <span className={`inline-block w-3 text-gray-400 transition-transform no-print ${tOpen ? 'rotate-90' : ''}`}>▸</span>
                            <span className="ml-1"><NodeLabel ad={t.ad} tur={sureUstte ? 'tip' : tipUstte ? 'bolge' : 'tip'} /></span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-gray-600">{t.agg.toplam}</td>
                          <td className="px-3 py-2 text-right font-mono text-green-700">{t.agg.stokta}</td>
                          <td className="px-3 py-2 text-right font-mono text-red-600 font-bold">{t.agg.stoksuz}</td>
                          <td className="px-3 py-2 text-right font-mono text-gray-800">{formatNum(Math.round(t.agg.stok))}</td>
                          <td className="px-3 py-2 text-right font-mono text-gray-500">
                            {t.agg.gunAdet > 0 ? `ort. ${ortGun(t.agg).toFixed(0)}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-gray-700">{t.agg.ortGunluk.toFixed(1)}</td>
                          <td className="px-3 py-2 text-right font-mono text-red-600">
                            {t.agg.kayip > 0 ? formatNum(Math.round(t.agg.kayip)) : '—'}
                          </td>
                          <td className="px-3 py-2"></td>
                        </tr>

                        {tOpen && t.magazalar.map(s => {
                          const k = KOVA_INFO[s.kova];
                          return (
                            <tr key={tKey + '|' + s.id} className="border-t border-gray-50 hover:bg-blue-50/40">
                              <td className="px-4 py-2 pl-16 text-gray-600">
                                <div className="leading-tight">{s.magaza_adi}</div>
                                <div className="text-[10px] text-gray-400">{s.il || '—'} · #{s.id}</div>
                              </td>
                              <td className="px-3 py-2"></td>
                              <td className="px-3 py-2"></td>
                              <td className="px-3 py-2 text-right">
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                                  style={{ color: k?.color, background: (k?.color || '#666') + '18' }}>
                                  {k?.kisa}
                                </span>
                              </td>
                              <td className={`px-3 py-2 text-right font-mono ${s.stok > 0 ? 'text-gray-800' : 'text-red-600 font-bold'}`}>
                                {formatNum(Math.round(s.stok))}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-bold"
                                  style={{ color: s.gun === null ? '#6b7280' : s.gun > 0 ? '#C0392B' : '#16a34a' }}>
                                {s.gun === null ? `≥${s.kayit_gun}` : s.gun > 0 ? s.gun : '—'}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-gray-700">
                                {s.ortGunluk > 0 ? s.ortGunluk.toFixed(2) : '—'}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-red-600">
                                {s.kayip > 0 ? formatNum(Math.round(s.kayip)) : '—'}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-500">
                                {s.son_stok_tarihi ? formatDateTR(s.son_stok_tarihi) : 'hiç'}
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

            <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
              <td className="px-4 py-2.5 text-gray-800">TOPLAM</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-900">{total.toplam}</td>
              <td className="px-3 py-2.5 text-right font-mono text-green-700">{total.stokta}</td>
              <td className="px-3 py-2.5 text-right font-mono text-red-600">{total.stoksuz}</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-900">{formatNum(Math.round(total.stok))}</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-500">
                {total.gunAdet > 0 ? `ort. ${ortGun(total).toFixed(0)}` : '—'}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-900">{total.ortGunluk.toFixed(1)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-red-600">{formatNum(Math.round(total.kayip))}</td>
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

function NodeLabel({ ad, tur }: { ad: string; tur: 'kova' | 'tip' | 'bolge' }) {
  if (tur === 'bolge') return <>🗺️ {ad}</>;
  const color = tur === 'kova' ? KOVA_INFO[ad]?.color : TYPE_COLORS[ad];
  const label = tur === 'kova' ? (KOVA_INFO[ad]?.label ?? ad) : ad;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color || '#6b7280' }} />
      {label}
    </span>
  );
}
