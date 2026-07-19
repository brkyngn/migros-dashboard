import { useState } from 'react';
import type { Expense, ExpenseCategory, Product } from '../../types/finance';
import { TEVKIFAT_ORANLARI } from '../../types/finance';
import { parseTrNumber, toTrInput, netToBrut, brutToNet } from '../../utils/money';
import { formatTLDec } from '../../utils/formatters';

const KDV_ORANLARI = [0, 1, 10, 20];

// "2/10" → 0.2
function tevkifatOran(o: string): number {
  const m = o.match(/^(\d+)\s*\/\s*(\d+)$/);
  return m ? parseInt(m[1]) / parseInt(m[2]) : 0;
}

interface Props {
  categories: ExpenseCategory[];
  products: Product[];
  initial?: Partial<Expense>;      // düzenleme veya fatura AI ön-doldurma
  onSave: (body: Partial<Expense>) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}

export default function ExpenseForm({ categories, products, initial, onSave, onCancel, submitLabel = 'Kaydet' }: Props) {
  const [tarih, setTarih] = useState(initial?.tarih?.slice(0, 10) || new Date().toISOString().slice(0, 10));
  const [tedarikci, setTedarikci] = useState(initial?.tedarikci || '');
  const [kategoriId, setKategoriId] = useState<number | ''>(initial?.kategori_id || '');
  const [aciklama, setAciklama] = useState(initial?.aciklama || '');
  const [kdvOrani, setKdvOrani] = useState(initial?.kdv_orani ?? 20);
  const [netStr, setNetStr] = useState(initial?.net_tutar != null ? toTrInput(initial.net_tutar) : '');
  const [brutStr, setBrutStr] = useState(initial?.brut_tutar != null ? toTrInput(initial.brut_tutar) : '');
  const [urunId, setUrunId] = useState<number | ''>(initial?.urun_id || '');
  const [adetStr, setAdetStr] = useState(initial?.adet != null ? String(initial.adet) : '');
  const [faturaNo, setFaturaNo] = useState(initial?.fatura_no || '');
  const [tevkifatOraniStr, setTevkifatOraniStr] = useState(initial?.tevkifat_orani || '');
  const [lastEdited, setLastEdited] = useState<'net' | 'brut'>('net');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // KDV oranı değişince son değiştirilen alandan diğerini yeniden türet
  const onKdvChange = (oran: number) => {
    setKdvOrani(oran);
    if (lastEdited === 'net') {
      const net = parseTrNumber(netStr);
      setBrutStr(isNaN(net) ? '' : toTrInput(netToBrut(net, oran).brut));
    } else {
      const brut = parseTrNumber(brutStr);
      setNetStr(isNaN(brut) ? '' : toTrInput(brutToNet(brut, oran).net));
    }
  };

  const onNetChange = (v: string) => {
    setNetStr(v); setLastEdited('net');
    const net = parseTrNumber(v);
    setBrutStr(isNaN(net) ? '' : toTrInput(netToBrut(net, kdvOrani).brut));
  };

  const onBrutChange = (v: string) => {
    setBrutStr(v); setLastEdited('brut');
    const brut = parseTrNumber(v);
    setNetStr(isNaN(brut) ? '' : toTrInput(brutToNet(brut, kdvOrani).net));
  };

  const net = parseTrNumber(netStr);
  const kdvTutari = isNaN(net) ? 0 : netToBrut(net, kdvOrani).kdv;
  const brutTutar = isNaN(net) ? 0 : net + kdvTutari;
  const tevkifatTutari = tevkifatOraniStr ? Math.round(kdvTutari * tevkifatOran(tevkifatOraniStr) * 100) / 100 : 0;
  const odenecekTutar = Math.round((brutTutar - tevkifatTutari) * 100) / 100;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!tarih || !kategoriId || isNaN(net)) { setError('Tarih, kategori ve tutar zorunlu.'); return; }
    setSaving(true);
    try {
      await onSave({
        tarih,
        tedarikci: tedarikci || null,
        kategori_id: kategoriId as number,
        aciklama: aciklama || null,
        net_tutar: net,
        kdv_orani: kdvOrani,
        urun_id: urunId ? (urunId as number) : null,
        adet: adetStr ? parseTrNumber(adetStr) : null,
        fatura_no: faturaNo || null,
        tevkifat_orani: tevkifatOraniStr || null,
        kaynak: initial?.kaynak === 'fatura_ai' ? 'fatura_ai' : 'manuel',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-gray-400 bg-white';
  const labelCls = 'block text-xs font-medium text-gray-500 mb-1';

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={labelCls}>Tarih *</label>
          <input type="date" value={tarih} onChange={e => setTarih(e.target.value)} className={inputCls} required />
        </div>
        <div>
          <label className={labelCls}>Tedarikçi</label>
          <input value={tedarikci} onChange={e => setTedarikci(e.target.value)} className={inputCls} placeholder="Firma adı" />
        </div>
        <div>
          <label className={labelCls}>Kategori *</label>
          <select value={kategoriId} onChange={e => setKategoriId(e.target.value ? Number(e.target.value) : '')} className={inputCls} required>
            <option value="">Seçin...</option>
            {categories.filter(c => c.aktif).map(c => (
              <option key={c.id} value={c.id}>{c.ad}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Fatura No</label>
          <input value={faturaNo} onChange={e => setFaturaNo(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={labelCls}>Net Tutar (₺) *</label>
          <input value={netStr} onChange={e => onNetChange(e.target.value)} className={inputCls} placeholder="1.000,00" inputMode="decimal" />
        </div>
        <div>
          <label className={labelCls}>KDV Oranı</label>
          <select value={kdvOrani} onChange={e => onKdvChange(Number(e.target.value))} className={inputCls}>
            {KDV_ORANLARI.map(o => <option key={o} value={o}>%{o}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>KDV Tutarı</label>
          <input value={toTrInput(kdvTutari)} readOnly className={`${inputCls} bg-gray-50 text-gray-500`} tabIndex={-1} />
        </div>
        <div>
          <label className={labelCls}>Brüt Tutar (₺)</label>
          <input value={brutStr} onChange={e => onBrutChange(e.target.value)} className={inputCls} placeholder="1.200,00" inputMode="decimal" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={labelCls}>İlgili Ürün (SMM için)</label>
          <select value={urunId} onChange={e => setUrunId(e.target.value ? Number(e.target.value) : '')} className={inputCls}>
            <option value="">—</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.ad}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Adet (birim maliyet için)</label>
          <input value={adetStr} onChange={e => setAdetStr(e.target.value)} className={inputCls} placeholder="0" inputMode="numeric" />
        </div>
        <div className="col-span-2">
          <label className={labelCls}>Açıklama</label>
          <input value={aciklama} onChange={e => setAciklama(e.target.value)} className={inputCls} placeholder="Opsiyonel not" />
        </div>
      </div>

      {/* KDV Tevkifatı */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className={labelCls}>KDV Tevkifatı</label>
          <select value={tevkifatOraniStr} onChange={e => setTevkifatOraniStr(e.target.value)} className={inputCls}>
            <option value="">Yok</option>
            {TEVKIFAT_ORANLARI.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        {tevkifatOraniStr && (
          <>
            <div>
              <label className={labelCls}>Tevkifat Tutarı (devlete)</label>
              <input value={toTrInput(tevkifatTutari)} readOnly className={`${inputCls} bg-gray-50 text-gray-500`} tabIndex={-1} />
            </div>
            <div>
              <label className={labelCls}>Satıcıya Ödenecek</label>
              <input value={toTrInput(odenecekTutar)} readOnly className={`${inputCls} bg-amber-50 text-amber-800 font-medium`} tabIndex={-1} />
            </div>
            <div className="text-xs text-gray-400 pb-2">
              Brüt {formatTLDec(brutTutar)} − Tevkifat {formatTLDec(tevkifatTutari)}. Cari borç ödenecek tutar üzerinden takip edilir.
            </div>
          </>
        )}
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: '#1A3A5C' }}>
          {saving ? 'Kaydediliyor...' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">
            Vazgeç
          </button>
        )}
      </div>
    </form>
  );
}
