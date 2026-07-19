import { useRef, useState } from 'react';
import type { ExpenseCategory, ParsedInvoice, Product } from '../../types/finance';
import { TEVKIFAT_ORANLARI } from '../../types/finance';
import { analyzeInvoice, checkDuplicate, createExpense } from '../../api/finance';
import { formatTLDec } from '../../utils/formatters';
import { toTrInput, parseTrNumber } from '../../utils/money';

const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

interface Props {
  categories: ExpenseCategory[];
  products: Product[];
  onSaved: () => void;
}

interface EditableLine {
  aciklama: string;
  adetStr: string;
  netStr: string;
  kdv_orani: number;
  kategori_id: number | '';
  urun_id: number | '';
}

export default function InvoiceUpload({ categories, products, onSaved }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [invoice, setInvoice] = useState<ParsedInvoice | null>(null);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [satici, setSatici] = useState('');
  const [faturaNo, setFaturaNo] = useState('');
  const [faturaTarihi, setFaturaTarihi] = useState('');
  const [tevkifatOrani, setTevkifatOrani] = useState('');
  const [duplicate, setDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    setError('');
    if (!ACCEPTED.includes(file.type)) {
      setError('Desteklenmeyen dosya türü. PDF, JPG, PNG veya WebP yükleyin.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('Dosya çok büyük (en fazla 15 MB).');
      return;
    }
    setAnalyzing(true);
    setInvoice(null);
    try {
      const parsed = await analyzeInvoice(file);
      setInvoice(parsed);
      setSatici(parsed.satici || '');
      setFaturaNo(parsed.fatura_no || '');
      setFaturaTarihi(parsed.fatura_tarihi || new Date().toISOString().slice(0, 10));
      setTevkifatOrani(parsed.tevkifat_var && parsed.tevkifat_orani ? parsed.tevkifat_orani : '');
      setLines(parsed.kalemler.map(k => ({
        aciklama: k.aciklama,
        adetStr: k.adet ? String(k.adet) : '',
        netStr: toTrInput(k.net_tutar),
        kdv_orani: k.kdv_orani ?? 20,
        kategori_id: '',
        urun_id: '',
      })));
      // Mükerrer kontrolü
      if (parsed.fatura_no && parsed.satici) {
        const dup = await checkDuplicate(parsed.fatura_no, parsed.satici);
        setDuplicate(dup.exists);
      } else {
        setDuplicate(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fatura analiz edilemedi');
    } finally {
      setAnalyzing(false);
    }
  };

  const updateLine = (i: number, patch: Partial<EditableLine>) => {
    setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };

  const removeLine = (i: number) => setLines(ls => ls.filter((_, j) => j !== i));

  const save = async () => {
    setError('');
    const eksik = lines.some(l => !l.kategori_id || isNaN(parseTrNumber(l.netStr)));
    if (!lines.length || eksik) {
      setError('Her kalem için kategori seçin ve tutarları kontrol edin.');
      return;
    }
    setSaving(true);
    try {
      for (const l of lines) {
        await createExpense({
          tarih: faturaTarihi,
          tedarikci: satici || null,
          kategori_id: l.kategori_id as number,
          aciklama: l.aciklama || null,
          net_tutar: parseTrNumber(l.netStr),
          kdv_orani: l.kdv_orani,
          urun_id: l.urun_id ? (l.urun_id as number) : null,
          adet: l.adetStr ? parseTrNumber(l.adetStr) : null,
          fatura_no: faturaNo || null,
          tevkifat_orani: tevkifatOrani || null,
          kaynak: 'fatura_ai',
        });
      }
      setInvoice(null);
      setLines([]);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-gray-400 bg-white';
  const labelCls = 'block text-xs font-medium text-gray-500 mb-1';

  return (
    <div className="space-y-4">
      {!invoice && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault(); setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
            ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'}`}
        >
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          {analyzing ? (
            <div className="text-gray-500">
              <div className="text-2xl mb-2 animate-pulse">🤖</div>
              <div className="text-sm font-medium">Fatura analiz ediliyor... (10-30 sn sürebilir)</div>
            </div>
          ) : (
            <div className="text-gray-500">
              <div className="text-2xl mb-2">📄</div>
              <div className="text-sm font-medium">Fatura yüklemek için tıklayın veya sürükleyin</div>
              <div className="text-xs text-gray-400 mt-1">PDF, JPG, PNG, WebP · en fazla 15 MB · dosya sunucuda saklanmaz</div>
            </div>
          )}
        </div>
      )}

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      {invoice && (
        <div className="space-y-4">
          {duplicate && (
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              ⚠️ Bu fatura numarası ve tedarikçi ile daha önce kayıt yapılmış görünüyor. Yine de kaydedebilirsiniz.
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className={labelCls}>Satıcı / Tedarikçi</label>
              <input value={satici} onChange={e => setSatici(e.target.value)} className={`${inputCls} w-full`} />
            </div>
            <div>
              <label className={labelCls}>Fatura No</label>
              <input value={faturaNo} onChange={e => setFaturaNo(e.target.value)} className={`${inputCls} w-full`} />
            </div>
            <div>
              <label className={labelCls}>Fatura Tarihi</label>
              <input type="date" value={faturaTarihi} onChange={e => setFaturaTarihi(e.target.value)} className={`${inputCls} w-full`} />
            </div>
            <div className="flex items-end text-xs text-gray-500 pb-2">
              AI toplamları: Net {formatTLDec(invoice.toplam_net)} · KDV {formatTLDec(invoice.toplam_kdv)} · Brüt {formatTLDec(invoice.toplam_brut)}
            </div>
          </div>

          {/* KDV Tevkifatı */}
          <div className={`rounded-lg p-3 ${tevkifatOrani ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'}`}>
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className={labelCls}>KDV Tevkifatı {invoice.tevkifat_var && <span className="text-amber-600">(faturada tespit edildi)</span>}</label>
                <select value={tevkifatOrani} onChange={e => setTevkifatOrani(e.target.value)} className={`${inputCls} w-32`}>
                  <option value="">Yok</option>
                  {TEVKIFAT_ORANLARI.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              {tevkifatOrani && (
                <div className="text-sm text-amber-800 pt-4">
                  {invoice.tevkifat_sebebi && <span className="mr-3">📋 {invoice.tevkifat_sebebi}</span>}
                  {invoice.tevkifat_tutari != null && <span className="mr-3">Tevkifat (devlete): <b>{formatTLDec(invoice.tevkifat_tutari)}</b></span>}
                  {invoice.odenecek_tutar != null && <span>Satıcıya ödenecek: <b>{formatTLDec(invoice.odenecek_tutar)}</b></span>}
                </div>
              )}
            </div>
            {tevkifatOrani && (
              <div className="text-xs text-gray-500 mt-1">
                Tevkifat oranı tüm kalemlere uygulanır. Cari borç, satıcıya ödenecek (tevkifat düşülmüş) tutar üzerinden takip edilir.
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-2 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Açıklama</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Adet</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Net Tutar</th>
                  <th className="px-2 py-2 text-center text-xs font-semibold text-gray-500 uppercase">KDV</th>
                  <th className="px-2 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Kategori *</th>
                  <th className="px-2 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Ürün</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-2 py-1.5">
                      <input value={l.aciklama} onChange={e => updateLine(i, { aciklama: e.target.value })}
                        className={`${inputCls} w-full min-w-40`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={l.adetStr} onChange={e => updateLine(i, { adetStr: e.target.value })}
                        className={`${inputCls} w-16 text-right`} inputMode="decimal" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={l.netStr} onChange={e => updateLine(i, { netStr: e.target.value })}
                        className={`${inputCls} w-28 text-right`} inputMode="decimal" />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <select value={l.kdv_orani} onChange={e => updateLine(i, { kdv_orani: Number(e.target.value) })} className={inputCls}>
                        {[0, 1, 10, 20].map(o => <option key={o} value={o}>%{o}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select value={l.kategori_id} onChange={e => updateLine(i, { kategori_id: e.target.value ? Number(e.target.value) : '' })}
                        className={`${inputCls} ${!l.kategori_id ? 'border-amber-300' : ''}`}>
                        <option value="">Seçin...</option>
                        {categories.filter(c => c.aktif).map(c => <option key={c.id} value={c.id}>{c.ad}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select value={l.urun_id} onChange={e => updateLine(i, { urun_id: e.target.value ? Number(e.target.value) : '' })} className={inputCls}>
                        <option value="">—</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.ad}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button onClick={() => removeLine(i)} className="text-xs text-red-600 hover:underline">Kaldır</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: '#1A3A5C' }}>
              {saving ? 'Kaydediliyor...' : `${lines.length} kalemi gider olarak kaydet`}
            </button>
            <button onClick={() => { setInvoice(null); setLines([]); setError(''); }}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">
              İptal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
