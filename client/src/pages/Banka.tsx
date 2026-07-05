import { useCallback, useEffect, useRef, useState } from 'react';
import type { BankAccount, BankTransaction, BankUploadResult, CariAccount } from '../types/finance';
import {
  uploadBankStatement, fetchBankAccounts, fetchBankTransactions,
  assignTransactionCari, deleteBankAccount, fetchCariAccounts, createCari,
} from '../api/finance';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import { formatTLDec } from '../utils/formatters';

export default function Banka() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [cariList, setCariList] = useState<CariAccount[]>([]);
  const [selected, setSelected] = useState<number | 'all'>('all');
  const [txns, setTxns] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BankUploadResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Filtreler
  const [yon, setYon] = useState('');
  const [q, setQ] = useState('');
  const [sadeceEslesmemis, setSadeceEslesmemis] = useState(false);

  const loadAccounts = useCallback(async () => {
    const [accs, cari] = await Promise.all([fetchBankAccounts(), fetchCariAccounts()]);
    setAccounts(accs); setCariList(cari);
  }, []);

  const loadTxns = useCallback(async () => {
    setTxLoading(true);
    try {
      const data = await fetchBankTransactions({
        bank_account_id: selected === 'all' ? undefined : selected,
        yon: yon || undefined, q: q || undefined, eslesmemis: sadeceEslesmemis,
      });
      setTxns(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hareketler alınamadı');
    } finally {
      setTxLoading(false);
    }
  }, [selected, yon, q, sadeceEslesmemis]);

  useEffect(() => {
    loadAccounts().catch(e => setError(e instanceof Error ? e.message : 'Yüklenemedi')).finally(() => setLoading(false));
  }, [loadAccounts]);

  useEffect(() => { if (!loading) loadTxns(); }, [loadTxns, loading]);

  const handleFile = async (file: File) => {
    setError(''); setResult(null);
    if (!/\.(xls|xlsx)$/i.test(file.name)) { setError('Sadece .xls veya .xlsx dosyası yükleyin.'); return; }
    setUploading(true);
    try {
      const r = await uploadBankStatement(file);
      setResult(r);
      await loadAccounts();
      await loadTxns();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ekstre yüklenemedi');
    } finally {
      setUploading(false);
    }
  };

  // value: '' (temizle) | 'masraf' (banka masrafı) | cari id (sayı)
  const onSelect = async (tx: BankTransaction, value: string) => {
    const masraf = value === 'masraf';
    const cariId = masraf || value === '' ? null : Number(value);
    await assignTransactionCari(tx.id, { cariId, masraf });
    setTxns(ts => ts.map(t => (t.id === tx.id
      ? { ...t, cari_id: cariId, banka_masrafi: masraf, cari_ad: cariId ? cariList.find(c => c.id === cariId)?.ad : null }
      : t)));
    loadAccounts();
  };

  // Yeni cari oluştur (hareketin karşı tarafından) ve ata
  const createAndAssign = async (tx: BankTransaction) => {
    if (!tx.karsi_taraf) return;
    try {
      const c = await createCari({ ad: tx.karsi_taraf });
      setCariList(list => [...list, c]);
      await onSelect(tx, String(c.id));
    } catch {
      // İsim zaten varsa: mevcut cariyi bul ve ata
      const existing = cariList.find(c => c.ad.toLowerCase() === tx.karsi_taraf!.toLowerCase());
      if (existing) await onSelect(tx, String(existing.id));
    }
  };

  const delAccount = async (a: BankAccount) => {
    if (!confirm(`${a.banka_adi} (${a.iban}) hesabı ve ${a.hareket_sayisi} hareketi silinsin mi?`)) return;
    await deleteBankAccount(a.id);
    if (selected === a.id) setSelected('all');
    await loadAccounts();
    await loadTxns();
  };

  const inputCls = 'text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-gray-400 bg-white';

  if (loading) return <div className="p-4 md:p-8"><LoadingSkeleton rows={6} /></div>;

  return (
    <div className="p-4 md:p-8 space-y-4">
      {/* Yükleme alanı */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5">
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors
            ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'}`}
        >
          <input ref={fileRef} type="file" accept=".xls,.xlsx" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          {uploading ? (
            <div className="text-gray-500 text-sm animate-pulse">🏦 Ekstre işleniyor...</div>
          ) : (
            <div className="text-gray-500">
              <div className="text-xl mb-1">🏦</div>
              <div className="text-sm font-medium">Banka ekstresi yüklemek için tıklayın veya sürükleyin (.xls / .xlsx)</div>
              <div className="text-xs text-gray-400 mt-1">Aynı hesabın mükerrer hareketleri otomatik atlanır · birden fazla banka desteklenir</div>
            </div>
          )}
        </div>

        {result && (
          <div className="mt-3 text-sm bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-green-800">
            ✓ <b>{result.hesap.banka_adi}</b> — {result.eklenen} yeni hareket eklendi
            {result.mukerrer > 0 && <>, {result.mukerrer} mükerrer atlandı</>} (toplam {result.toplam})
          </div>
        )}
        {error && <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
      </div>

      {/* Hesap kartları */}
      {accounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setSelected('all')}
            className={`px-4 py-2 rounded-lg text-sm border ${selected === 'all' ? 'text-white border-transparent' : 'text-gray-600 border-gray-200 bg-white hover:bg-gray-50'}`}
            style={selected === 'all' ? { background: '#1A3A5C' } : undefined}>
            Tüm Hesaplar
          </button>
          {accounts.map(a => (
            <div key={a.id}
              onClick={() => setSelected(a.id)}
              className={`px-4 py-2 rounded-lg text-sm border cursor-pointer group ${selected === a.id ? 'text-white border-transparent' : 'text-gray-700 border-gray-200 bg-white hover:bg-gray-50'}`}
              style={selected === a.id ? { background: '#1A3A5C' } : undefined}>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{a.banka_adi}</span>
                <span className={selected === a.id ? 'text-white/70' : 'text-gray-400'}>
                  {a.son_bakiye !== null ? formatTLDec(a.son_bakiye) : '—'}
                </span>
                <button onClick={e => { e.stopPropagation(); delAccount(a); }}
                  className={`opacity-0 group-hover:opacity-100 text-xs ${selected === a.id ? 'text-white/70 hover:text-white' : 'text-red-500'}`}>✕</button>
              </div>
              <div className={`text-xs ${selected === a.id ? 'text-white/60' : 'text-gray-400'}`}>
                {a.hesap_adi} · {a.hareket_sayisi} hareket
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Hareketler */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <select value={yon} onChange={e => setYon(e.target.value)} className={inputCls}>
            <option value="">Tümü (giriş/çıkış)</option>
            <option value="A">Sadece Girişler (Alacak)</option>
            <option value="B">Sadece Çıkışlar (Borç)</option>
          </select>
          <input value={q} onChange={e => setQ(e.target.value)} className={`${inputCls} w-56`} placeholder="Ara (açıklama, karşı taraf, fiş no)" />
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={sadeceEslesmemis} onChange={e => setSadeceEslesmemis(e.target.checked)} />
            Sadece cariye bağlanmamış çıkışlar
          </label>
          <div className="flex-1" />
          <div className="text-xs text-gray-500">{txns.length} hareket</div>
        </div>

        {txLoading ? <LoadingSkeleton rows={4} /> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Tarih</th>
                  {selected === 'all' && <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Banka</th>}
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Karşı Taraf / Açıklama</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Tutar</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Bakiye</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Cari (Ödeme)</th>
                </tr>
              </thead>
              <tbody>
                {txns.length === 0 ? (
                  <tr><td colSpan={selected === 'all' ? 6 : 5} className="text-center py-8 text-gray-400">Hareket yok — ekstre yükleyin</td></tr>
                ) : txns.slice(0, 1000).map(t => (
                  <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">{t.islem_tarihi?.slice(0, 10)}</td>
                    {selected === 'all' && <td className="px-3 py-2 text-gray-500">{t.banka_adi}</td>}
                    <td className="px-3 py-2 max-w-md">
                      <div className="font-medium">{t.karsi_taraf || '—'}</div>
                      <div className="text-xs text-gray-400 truncate" title={t.aciklama || ''}>{t.aciklama}</div>
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${t.tutar < 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {formatTLDec(t.tutar)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{t.bakiye !== null ? formatTLDec(t.bakiye) : '—'}</td>
                    <td className="px-3 py-2">
                      {t.yon === 'B' ? (
                        <div className="flex items-center gap-1">
                          <select
                            value={t.banka_masrafi ? 'masraf' : (t.cari_id ?? '')}
                            onChange={e => onSelect(t, e.target.value)}
                            className={`text-xs border rounded-lg px-2 py-1 bg-white max-w-40 ${t.banka_masrafi ? 'border-amber-300 text-amber-700' : 'border-gray-200'}`}>
                            <option value="">— Eşleştir —</option>
                            <option value="masraf">🏦 Banka Masrafı</option>
                            {cariList.length > 0 && <option disabled>──────────</option>}
                            {cariList.map(c => <option key={c.id} value={c.id}>{c.ad}</option>)}
                          </select>
                          {!t.cari_id && !t.banka_masrafi && t.karsi_taraf && (
                            <button onClick={() => createAndAssign(t)} title="Karşı taraftan cari oluştur ve ata"
                              className="text-xs text-blue-600 hover:underline whitespace-nowrap">+ oluştur</button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">giriş</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
