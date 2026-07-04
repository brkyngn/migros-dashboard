import { useState } from 'react';
import type { ExpenseCategory, PnlBlok } from '../../types/finance';
import { PNL_BLOK_ADLARI } from '../../types/finance';
import { createCategory, updateCategory } from '../../api/finance';

interface Props {
  categories: ExpenseCategory[];
  onChanged: () => void;
}

export default function CategoryManager({ categories, onChanged }: Props) {
  const [yeniAd, setYeniAd] = useState('');
  const [yeniBlok, setYeniBlok] = useState<PnlBlok>('OPERASYONEL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ekle = async () => {
    if (!yeniAd.trim()) return;
    setBusy(true); setError('');
    try {
      await createCategory({ ad: yeniAd.trim(), pnl_blok: yeniBlok, sira: categories.length + 1 });
      setYeniAd('');
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Eklenemedi'); }
    finally { setBusy(false); }
  };

  const blokDegistir = async (cat: ExpenseCategory, blok: PnlBlok) => {
    try { await updateCategory(cat.id, { pnl_blok: blok }); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Güncellenemedi'); }
  };

  const aktifDegistir = async (cat: ExpenseCategory) => {
    try { await updateCategory(cat.id, { aktif: !cat.aktif }); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Güncellenemedi'); }
  };

  const inputCls = 'text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-gray-400 bg-white';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Yeni kategori</label>
          <input value={yeniAd} onChange={e => setYeniAd(e.target.value)} className={`${inputCls} w-56`} placeholder="Kategori adı" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">P&L bloğu</label>
          <select value={yeniBlok} onChange={e => setYeniBlok(e.target.value as PnlBlok)} className={inputCls}>
            {Object.entries(PNL_BLOK_ADLARI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <button onClick={ekle} disabled={busy || !yeniAd.trim()}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: '#1A3A5C' }}>
          Ekle
        </button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Kategori</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">P&L Bloğu</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase">Aktif</th>
          </tr>
        </thead>
        <tbody>
          {categories.map(cat => (
            <tr key={cat.id} className={`border-b border-gray-100 ${cat.aktif ? '' : 'opacity-40'}`}>
              <td className="px-3 py-2">{cat.ad}</td>
              <td className="px-3 py-2">
                <select value={cat.pnl_blok} onChange={e => blokDegistir(cat, e.target.value as PnlBlok)}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white">
                  {Object.entries(PNL_BLOK_ADLARI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
              <td className="px-3 py-2 text-center">
                <input type="checkbox" checked={cat.aktif} onChange={() => aktifDegistir(cat)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
