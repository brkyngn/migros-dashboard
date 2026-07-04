import { useEffect, useState } from 'react';
import type { FinanceSettingsData, Product } from '../types/finance';
import { fetchSettings, updateSettings, fetchProducts, updateProduct } from '../api/finance';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import { parseTrNumber, toTrInput } from '../utils/money';

const SKU_COLORS: Record<string, string> = { '41075315': '#C0392B', '41075312': '#1A3A5C' };

export default function FinanceSettings() {
  const [settings, setSettings] = useState<FinanceSettingsData | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // Form durumu
  const [komisyonStr, setKomisyonStr] = useState('');
  const [kdvStr, setKdvStr] = useState('');
  const [satisKdvStr, setSatisKdvStr] = useState('');
  const [kdvDahil, setKdvDahil] = useState(false);

  useEffect(() => {
    Promise.all([fetchSettings(), fetchProducts()])
      .then(([s, p]) => {
        setSettings(s); setProducts(p);
        setKomisyonStr(String(s.komisyon_orani).replace('.', ','));
        setKdvStr(String(s.varsayilan_kdv).replace('.', ','));
        setSatisKdvStr(String(s.satis_kdv_orani).replace('.', ','));
        setKdvDahil(s.satis_kdv_dahil);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Ayarlar yüklenemedi'))
      .finally(() => setLoading(false));
  }, []);

  const saveSettings = async () => {
    setError(''); setSaved(false);
    const komisyon = parseTrNumber(komisyonStr);
    const kdv = parseTrNumber(kdvStr);
    const satisKdv = parseTrNumber(satisKdvStr);
    if (isNaN(komisyon) || komisyon < 0 || komisyon > 100) { setError('Komisyon oranı 0-100 arası olmalı.'); return; }
    if (isNaN(kdv) || isNaN(satisKdv)) { setError('KDV oranları geçersiz.'); return; }
    try {
      const s = await updateSettings({
        komisyon_orani: komisyon, varsayilan_kdv: kdv,
        satis_kdv_orani: satisKdv, satis_kdv_dahil: kdvDahil,
      });
      setSettings(s);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) { setError(e instanceof Error ? e.message : 'Kaydedilemedi'); }
  };

  const saveProduct = async (p: Product, patch: Partial<Product>) => {
    setError('');
    try {
      const updated = await updateProduct(p.id, { ...patch });
      setProducts(ps => ps.map(x => (x.id === p.id ? updated : x)));
    } catch (e) { setError(e instanceof Error ? e.message : 'Ürün güncellenemedi'); }
  };

  const inputCls = 'text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-gray-400 bg-white';
  const labelCls = 'block text-xs font-medium text-gray-500 mb-1';

  if (loading) return <div className="p-4 md:p-8"><LoadingSkeleton rows={5} /></div>;

  return (
    <div className="p-4 md:p-8 space-y-4 max-w-4xl">
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      {/* Genel oranlar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5 space-y-4">
        <div className="text-sm font-semibold text-gray-700">⚙️ Genel Oranlar</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className={labelCls}>Migros komisyon oranı (%)</label>
            <input value={komisyonStr} onChange={e => setKomisyonStr(e.target.value)} className={`${inputCls} w-full`} inputMode="decimal" />
          </div>
          <div>
            <label className={labelCls}>Varsayılan gider KDV (%)</label>
            <input value={kdvStr} onChange={e => setKdvStr(e.target.value)} className={`${inputCls} w-full`} inputMode="decimal" />
          </div>
          <div>
            <label className={labelCls}>Satış KDV oranı (%)</label>
            <input value={satisKdvStr} onChange={e => setSatisKdvStr(e.target.value)} className={`${inputCls} w-full`} inputMode="decimal" />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={kdvDahil} onChange={e => setKdvDahil(e.target.checked)} />
              Satış tutarı KDV dahil
            </label>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={saveSettings}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: '#1A3A5C' }}>
            Kaydet
          </button>
          {saved && <span className="text-sm text-green-700">✓ Kaydedildi</span>}
        </div>
        <div className="text-xs text-gray-400">
          Migros'tan gelen satış tutarı ({settings?.satis_kdv_dahil ? 'KDV dahil' : 'KDV hariç'}) kabul ediliyor.
          Komisyon oranı P&L'deki tüm hesaplamaları anında etkiler; ürün bazında aşağıdan ezebilirsiniz.
        </div>
      </div>

      {/* Ürün kartları */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5 space-y-4">
        <div className="text-sm font-semibold text-gray-700">📦 Ürün Kartları</div>
        {products.map(p => (
          <ProductCard key={p.id} product={p} color={SKU_COLORS[p.migros_urun_kodu] || '#888'} onSave={saveProduct} />
        ))}
      </div>
    </div>
  );
}

function ProductCard({ product: p, color, onSave }: {
  product: Product; color: string;
  onSave: (p: Product, patch: Partial<Product>) => Promise<void>;
}) {
  const [koliStr, setKoliStr] = useState(String(p.koli_ici_adet ?? 1));
  const [maliyetStr, setMaliyetStr] = useState(p.birim_maliyet !== null ? toTrInput(p.birim_maliyet) : '');
  const [komisyonStr, setKomisyonStr] = useState(p.komisyon_orani_override !== null ? String(p.komisyon_orani_override).replace('.', ',') : '');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  const save = async () => {
    setBusy(true); setOk(false);
    const maliyet = maliyetStr.trim() ? parseTrNumber(maliyetStr) : null;
    const komisyon = komisyonStr.trim() ? parseTrNumber(komisyonStr) : null;
    await onSave(p, {
      koli_ici_adet: parseInt(koliStr) || 1,
      birim_maliyet: maliyet !== null && !isNaN(maliyet) ? maliyet : null,
      komisyon_orani_override: komisyon !== null && !isNaN(komisyon) ? komisyon : null,
    });
    setBusy(false); setOk(true);
    setTimeout(() => setOk(false), 2500);
  };

  const inputCls = 'text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-gray-400 bg-white w-full';
  const labelCls = 'block text-xs font-medium text-gray-500 mb-1';

  return (
    <div className="border border-gray-100 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <span className="text-sm font-semibold">{p.ad}</span>
        <span className="text-xs text-gray-400">SKU {p.migros_urun_kodu}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className={labelCls}>Koli içi adet</label>
          <input value={koliStr} onChange={e => setKoliStr(e.target.value)} className={inputCls} inputMode="numeric" />
        </div>
        <div>
          <label className={labelCls}>Birim maliyet (₺, kutu başı)</label>
          <input value={maliyetStr} onChange={e => setMaliyetStr(e.target.value)} className={inputCls} placeholder="ör. 85,50" inputMode="decimal" />
        </div>
        <div>
          <label className={labelCls}>Komisyon override (%)</label>
          <input value={komisyonStr} onChange={e => setKomisyonStr(e.target.value)} className={inputCls} placeholder="boş = genel oran" inputMode="decimal" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: '#1A3A5C' }}>
            Kaydet
          </button>
          {ok && <span className="text-sm text-green-700">✓</span>}
        </div>
      </div>
    </div>
  );
}
