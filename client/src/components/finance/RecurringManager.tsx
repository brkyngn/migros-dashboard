import { useState } from 'react';
import type { ExpenseCategory, RecurringExpense } from '../../types/finance';
import { createRecurring, updateRecurring, deactivateRecurring } from '../../api/finance';
import { parseTrNumber, toTrInput } from '../../utils/money';
import { formatTLDec } from '../../utils/formatters';

const KDV_ORANLARI = [0, 1, 10, 20];

interface Props {
  recurring: RecurringExpense[];
  categories: ExpenseCategory[];
  onChanged: () => void;
}

export default function RecurringManager({ recurring, categories, onChanged }: Props) {
  const [baslik, setBaslik] = useState('');
  const [kategoriId, setKategoriId] = useState<number | ''>('');
  const [tedarikci, setTedarikci] = useState('');
  const [netStr, setNetStr] = useState('');
  const [kdvOrani, setKdvOrani] = useState(20);
  const [gun, setGun] = useState(1);
  const [baslangic, setBaslangic] = useState(new Date().toISOString().slice(0, 7) + '-01');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ekle = async () => {
    const net = parseTrNumber(netStr);
    if (!baslik.trim() || !kategoriId || isNaN(net)) { setError('Başlık, kategori ve tutar zorunlu.'); return; }
    setBusy(true); setError('');
    try {
      await createRecurring({
        baslik: baslik.trim(), kategori_id: kategoriId as number,
        tedarikci: tedarikci || null, net_tutar: net, kdv_orani: kdvOrani,
        gun, baslangic,
      });
      setBaslik(''); setNetStr(''); setTedarikci('');
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Eklenemedi'); }
    finally { setBusy(false); }
  };

  const durdur = async (t: RecurringExpense) => {
    if (!confirm(`"${t.baslik}" şablonu durdurulsun mu? (Geçmiş kayıtlar silinmez)`)) return;
    try { await deactivateRecurring(t.id); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Durdurulamadı'); }
  };

  const yenidenBaslat = async (t: RecurringExpense) => {
    try { await updateRecurring(t.id, { aktif: true }); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Başlatılamadı'); }
  };

  const inputCls = 'text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-gray-400 bg-white';
  const labelCls = 'block text-xs font-medium text-gray-500 mb-1';

  return (
    <div className="space-y-4">
      <div className="bg-gray-50 rounded-lg p-4 space-y-3">
        <div className="text-sm font-semibold text-gray-700">Yeni tekrarlayan gider (her ay otomatik eklenir)</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className={labelCls}>Başlık *</label>
            <input value={baslik} onChange={e => setBaslik(e.target.value)} className={`${inputCls} w-full`} placeholder="Kira, muhasebe..." />
          </div>
          <div>
            <label className={labelCls}>Kategori *</label>
            <select value={kategoriId} onChange={e => setKategoriId(e.target.value ? Number(e.target.value) : '')} className={`${inputCls} w-full`}>
              <option value="">Seçin...</option>
              {categories.filter(c => c.aktif).map(c => <option key={c.id} value={c.id}>{c.ad}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Tedarikçi</label>
            <input value={tedarikci} onChange={e => setTedarikci(e.target.value)} className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className={labelCls}>Net Tutar (₺) *</label>
            <input value={netStr} onChange={e => setNetStr(e.target.value)} className={`${inputCls} w-full`} placeholder="10.000,00" inputMode="decimal" />
          </div>
          <div>
            <label className={labelCls}>KDV Oranı</label>
            <select value={kdvOrani} onChange={e => setKdvOrani(Number(e.target.value))} className={`${inputCls} w-full`}>
              {KDV_ORANLARI.map(o => <option key={o} value={o}>%{o}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Ayın günü</label>
            <input type="number" min={1} max={28} value={gun} onChange={e => setGun(Number(e.target.value))} className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className={labelCls}>Başlangıç</label>
            <input type="date" value={baslangic} onChange={e => setBaslangic(e.target.value)} className={`${inputCls} w-full`} />
          </div>
          <div className="flex items-end">
            <button onClick={ekle} disabled={busy}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 w-full"
              style={{ background: '#1A3A5C' }}>
              Ekle
            </button>
          </div>
        </div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Başlık</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Kategori</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Net Tutar</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase">Gün</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Başlangıç</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase">Durum</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {recurring.length === 0 ? (
            <tr><td colSpan={7} className="text-center py-8 text-gray-400">Tekrarlayan gider yok</td></tr>
          ) : recurring.map(t => (
            <tr key={t.id} className={`border-b border-gray-100 ${t.aktif ? '' : 'opacity-40'}`}>
              <td className="px-3 py-2 font-medium">{t.baslik}</td>
              <td className="px-3 py-2">{t.kategori_ad || '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatTLDec(t.net_tutar)} <span className="text-gray-400">+%{toTrInput(t.kdv_orani).replace(',00', '')} KDV</span></td>
              <td className="px-3 py-2 text-center">{t.gun}</td>
              <td className="px-3 py-2">{t.baslangic?.slice(0, 10)}</td>
              <td className="px-3 py-2 text-center">
                <span className={`text-xs px-2 py-0.5 rounded-full ${t.aktif ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {t.aktif ? 'Aktif' : 'Durduruldu'}
                </span>
              </td>
              <td className="px-3 py-2 text-right">
                {t.aktif
                  ? <button onClick={() => durdur(t)} className="text-xs text-red-600 hover:underline">Durdur</button>
                  : <button onClick={() => yenidenBaslat(t)} className="text-xs text-green-700 hover:underline">Başlat</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
