import { useEffect, useState } from 'react';
import type { CariAccount, CariDetail } from '../types/finance';
import { fetchCariAccounts, fetchCariDetail, createCari } from '../api/finance';
import KPICard from '../components/common/KPICard';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import { formatTLDec } from '../utils/formatters';

export default function Cari() {
  const [list, setList] = useState<CariAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<CariDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [yeniAd, setYeniAd] = useState('');

  const load = async () => {
    try { setList(await fetchCariAccounts()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Cari hesaplar alınamadı'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openDetail = async (c: CariAccount) => {
    setDetailLoading(true);
    setDetail(null);
    try { setDetail(await fetchCariDetail(c.id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Detay alınamadı'); }
    finally { setDetailLoading(false); }
  };

  const ekle = async () => {
    if (!yeniAd.trim()) return;
    try {
      await createCari({ ad: yeniAd.trim() });
      setYeniAd(''); setShowNew(false);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Eklenemedi'); }
  };

  const filtered = list.filter(c => !q || c.ad.toLowerCase().includes(q.toLowerCase()));
  const toplamBorc = list.reduce((s, c) => s + c.borc, 0);
  const toplamOdeme = list.reduce((s, c) => s + c.odeme, 0);
  const toplamBakiye = toplamBorc - toplamOdeme;
  const borcluSayisi = list.filter(c => c.bakiye > 0.01).length;

  const inputCls = 'text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-gray-400 bg-white';

  if (loading) return <div className="p-4 md:p-8"><LoadingSkeleton rows={6} /></div>;

  return (
    <div className="p-4 md:p-8 space-y-4">
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <KPICard label="Toplam Borç (Faturalar)" icon="🧾" value={formatTLDec(toplamBorc)} color="#C0392B" />
        <KPICard label="Toplam Ödeme (Banka)" icon="🏦" value={formatTLDec(toplamOdeme)} color="#27AE60" />
        <KPICard label="Net Bakiye (Borcumuz)" icon="⚖️" value={formatTLDec(toplamBakiye)} sub={`${borcluSayisi} cari borçlu`} color={toplamBakiye > 0 ? '#E67E22' : '#27AE60'} />
        <KPICard label="Cari Sayısı" icon="👥" value={String(list.length)} color="#1A3A5C" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Cari listesi */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-4 md:p-5 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <input value={q} onChange={e => setQ(e.target.value)} className={`${inputCls} w-56`} placeholder="Cari ara..." />
            <div className="flex-1" />
            {showNew ? (
              <div className="flex gap-1">
                <input value={yeniAd} onChange={e => setYeniAd(e.target.value)} className={inputCls} placeholder="Cari adı" autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') ekle(); }} />
                <button onClick={ekle} className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white" style={{ background: '#1A3A5C' }}>Ekle</button>
                <button onClick={() => setShowNew(false)} className="px-3 py-1.5 rounded-lg text-sm text-gray-500 border border-gray-200">İptal</button>
              </div>
            ) : (
              <button onClick={() => setShowNew(true)} className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">+ Yeni Cari</button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Cari</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Borç</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Ödeme</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Bakiye</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-8 text-gray-400">Cari hesap yok — fatura girince otomatik oluşur</td></tr>
                ) : filtered.map(c => (
                  <tr key={c.id} onClick={() => openDetail(c)}
                    className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${detail?.cari.id === c.id ? 'bg-blue-50/50' : ''}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{c.ad}</div>
                      <div className="text-xs text-gray-400">{c.fatura_sayisi} fatura · {c.odeme_sayisi} ödeme</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatTLDec(c.borc)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-700">{formatTLDec(c.odeme)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${c.bakiye > 0.01 ? 'text-red-600' : c.bakiye < -0.01 ? 'text-green-700' : 'text-gray-400'}`}>
                      {formatTLDec(c.bakiye)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detay paneli */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5">
          {detailLoading ? <LoadingSkeleton rows={4} /> : !detail ? (
            <div className="text-center text-gray-400 text-sm py-12">Detay için bir cari seçin</div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-base font-semibold">{detail.cari.ad}</div>
                {detail.cari.vkn && <div className="text-xs text-gray-400">VKN: {detail.cari.vkn}</div>}
                {detail.cari.iban && <div className="text-xs text-gray-400">{detail.cari.iban}</div>}
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase mb-1">🧾 Faturalar ({detail.giderler.length})</div>
                {detail.giderler.length === 0 ? <div className="text-xs text-gray-400">Fatura yok</div> : (
                  <div className="space-y-1">
                    {detail.giderler.map(e => (
                      <div key={e.id} className="flex justify-between text-sm">
                        <span className="text-gray-600">{e.tarih?.slice(0, 10)} <span className="text-gray-400">{e.kategori_ad}</span></span>
                        <span className="tabular-nums text-red-600">{formatTLDec(e.brut_tutar)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase mb-1">🏦 Banka Ödemeleri ({detail.odemeler.length})</div>
                {detail.odemeler.length === 0 ? <div className="text-xs text-gray-400">Eşleşmiş ödeme yok — Banka sayfasından eşleştirin</div> : (
                  <div className="space-y-1">
                    {detail.odemeler.map(o => (
                      <div key={o.id} className="flex justify-between text-sm">
                        <span className="text-gray-600">{o.islem_tarihi?.slice(0, 10)} <span className="text-gray-400">{o.banka_adi}</span></span>
                        <span className="tabular-nums text-green-700">{formatTLDec(-o.tutar)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-gray-200 pt-3 flex justify-between font-semibold">
                <span>Bakiye</span>
                <span className={`tabular-nums ${(detail.giderler.reduce((s, e) => s + e.brut_tutar, 0) + detail.odemeler.reduce((s, o) => s + o.tutar, 0)) > 0.01 ? 'text-red-600' : 'text-green-700'}`}>
                  {formatTLDec(detail.giderler.reduce((s, e) => s + e.brut_tutar, 0) + detail.odemeler.reduce((s, o) => s + o.tutar, 0))}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
