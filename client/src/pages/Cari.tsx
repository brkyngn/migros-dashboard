import { useEffect, useMemo, useState } from 'react';
import type { CariAccount, CariDetail } from '../types/finance';
import { fetchCariAccounts, fetchCariDetail, createCari } from '../api/finance';
import KPICard from '../components/common/KPICard';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import { formatTLDec } from '../utils/formatters';

// Cari ekstre satırı — fatura (borç) veya banka ödemesi (alacak), yürüyen bakiye ile
interface LedgerRow {
  key: string;
  tarih: string;
  tur: 'Fatura' | 'Ödeme';
  aciklama: string;
  faturaNo: string;
  net: number | null;
  kdv: number | null;
  borc: number;
  alacak: number;
  bakiye: number;
}

// Faturaları fatura_no bazında birleştir (ürün satırlarını tek faturada topla),
// ödemelerle kronolojik ekstre + yürüyen bakiye üret. Borç = fatura toplamı (KDV dahil),
// Alacak = banka ödemesi. Bakiye pozitif ise firmaya borçluyuz.
function buildLedger(detail: CariDetail): LedgerRow[] {
  const groups = new Map<string, { tarih: string; faturaNo: string; net: number; kdv: number; brut: number; kalem: number; aciklama: string }>();
  for (const e of detail.giderler) {
    const key = e.fatura_no ? `F:${e.fatura_no}` : `E:${e.id}`;
    let g = groups.get(key);
    if (!g) {
      g = { tarih: e.tarih?.slice(0, 10) || '', faturaNo: e.fatura_no || '', net: 0, kdv: 0, brut: 0, kalem: 0, aciklama: e.kategori_ad || e.aciklama || 'Fatura' };
      groups.set(key, g);
    }
    g.net += e.net_tutar || 0;
    g.kdv += e.kdv_tutari || 0;
    g.brut += e.brut_tutar || 0;
    g.kalem++;
    const t = e.tarih?.slice(0, 10) || '';
    if (t && (!g.tarih || t < g.tarih)) g.tarih = t;
  }

  const items: Omit<LedgerRow, 'bakiye' | 'key'>[] = [];
  for (const g of groups.values()) {
    items.push({
      tarih: g.tarih, tur: 'Fatura',
      aciklama: g.kalem > 1 ? `Fatura (${g.kalem} kalem)` : g.aciklama,
      faturaNo: g.faturaNo,
      net: Math.round(g.net * 100) / 100, kdv: Math.round(g.kdv * 100) / 100,
      borc: Math.round(g.brut * 100) / 100, alacak: 0,
    });
  }
  for (const o of detail.odemeler) {
    items.push({
      tarih: o.islem_tarihi?.slice(0, 10) || '', tur: 'Ödeme',
      aciklama: (o.banka_adi ? `${o.banka_adi} — ` : '') + (o.aciklama || 'Ödeme'),
      faturaNo: o.fis_no || '',
      net: null, kdv: null,
      borc: 0, alacak: Math.round(-o.tutar * 100) / 100,
    });
  }

  items.sort((a, b) => (a.tarih < b.tarih ? -1 : a.tarih > b.tarih ? 1 : a.tur === 'Fatura' ? -1 : 1));

  let running = 0;
  return items.map((it, i) => {
    running = Math.round((running + it.borc - it.alacak) * 100) / 100;
    return { ...it, bakiye: running, key: String(i) };
  });
}

function exportLedgerCsv(cariAd: string, rows: LedgerRow[]) {
  const header = ['Tarih', 'Tür', 'Açıklama', 'Fatura No', 'Net', 'KDV', 'Borç', 'Alacak', 'Bakiye'];
  const lines = rows.map(r => [
    r.tarih, r.tur, (r.aciklama || '').replace(/;/g, ','), r.faturaNo,
    r.net != null ? String(r.net).replace('.', ',') : '',
    r.kdv != null ? String(r.kdv).replace('.', ',') : '',
    r.borc ? String(r.borc).replace('.', ',') : '',
    r.alacak ? String(r.alacak).replace('.', ',') : '',
    String(r.bakiye).replace('.', ','),
  ].join(';'));
  const blob = new Blob(['﻿' + [`Cari Ekstresi;${cariAd}`, header.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `cari-ekstre-${cariAd.replace(/[^\w]+/g, '_')}.csv`; a.click();
  URL.revokeObjectURL(url);
}

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

  const ledger = useMemo(() => (detail ? buildLedger(detail) : []), [detail]);
  const sonBakiye = ledger.length ? ledger[ledger.length - 1].bakiye : 0;
  const toplamBorc = ledger.reduce((s, r) => s + r.borc, 0);
  const toplamAlacak = ledger.reduce((s, r) => s + r.alacak, 0);

  const filtered = list.filter(c => !q || c.ad.toLowerCase().includes(q.toLowerCase()));
  const gToplamBorc = list.reduce((s, c) => s + c.borc, 0);
  const gToplamOdeme = list.reduce((s, c) => s + c.odeme, 0);
  const gBakiye = gToplamBorc - gToplamOdeme;
  const borcluSayisi = list.filter(c => c.bakiye > 0.01).length;

  const inputCls = 'text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-gray-400 bg-white';

  if (loading) return <div className="p-4 md:p-8"><LoadingSkeleton rows={6} /></div>;

  // --- Cari ekstre görünümü (bir cari seçiliyken) ---
  if (detail || detailLoading) {
    return (
      <div className="p-4 md:p-8 space-y-4">
        <button onClick={() => setDetail(null)} className="text-sm text-gray-600 hover:text-gray-900">← Cari listesine dön</button>
        {detailLoading || !detail ? <LoadingSkeleton rows={6} /> : (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5 flex flex-wrap items-center gap-4">
              <div>
                <div className="text-lg font-bold">{detail.cari.ad}</div>
                <div className="text-xs text-gray-400">
                  {detail.cari.vkn && <>VKN: {detail.cari.vkn} · </>}
                  {detail.giderler.length} fatura kalemi · {detail.odemeler.length} ödeme
                </div>
              </div>
              <div className="flex-1" />
              <div className="text-right">
                <div className="text-xs text-gray-400 uppercase">Güncel Bakiye</div>
                <div className={`text-2xl font-bold ${sonBakiye > 0.01 ? 'text-red-600' : sonBakiye < -0.01 ? 'text-green-700' : 'text-gray-500'}`}>
                  {formatTLDec(sonBakiye)}
                </div>
                <div className="text-xs text-gray-400">{sonBakiye > 0.01 ? 'Firmaya borçluyuz' : sonBakiye < -0.01 ? 'Fazla ödeme' : 'Kapalı'}</div>
              </div>
              <button onClick={() => exportLedgerCsv(detail.cari.ad, ledger)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">⬇ CSV</button>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5">
              <div className="text-sm font-semibold text-gray-700 mb-3">Hesap Ekstresi</div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Tarih</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Açıklama</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Fatura No</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Tutar (Net)</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">KDV</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Borç</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Alacak</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Bakiye</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-8 text-gray-400">Hareket yok</td></tr>
                    ) : ledger.map(r => (
                      <tr key={r.key} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2 whitespace-nowrap">{r.tarih}</td>
                        <td className="px-3 py-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded mr-2 ${r.tur === 'Fatura' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>{r.tur}</span>
                          <span className="text-gray-600">{r.aciklama}</span>
                        </td>
                        <td className="px-3 py-2 text-gray-500">{r.faturaNo || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.net != null ? formatTLDec(r.net) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.kdv != null ? formatTLDec(r.kdv) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-600">{r.borc ? formatTLDec(r.borc) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-green-700">{r.alacak ? formatTLDec(r.alacak) : '—'}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-medium ${r.bakiye > 0.01 ? 'text-red-600' : r.bakiye < -0.01 ? 'text-green-700' : 'text-gray-400'}`}>
                          {formatTLDec(r.bakiye)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {ledger.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 font-semibold bg-gray-50">
                        <td className="px-3 py-2" colSpan={5}>Toplam</td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-600">{formatTLDec(toplamBorc)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-green-700">{formatTLDec(toplamAlacak)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${sonBakiye > 0.01 ? 'text-red-600' : 'text-green-700'}`}>{formatTLDec(sonBakiye)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              <div className="text-xs text-gray-400 mt-2">
                Borç = fatura toplamı (KDV dahil) · Alacak = bankadan yapılan ödeme · Bakiye pozitifse firmaya borçluyuz.
                Faturalar fatura numarasına göre birleştirilir.
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // --- Cari listesi görünümü ---
  return (
    <div className="p-4 md:p-8 space-y-4">
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <KPICard label="Toplam Borç (Faturalar)" icon="🧾" value={formatTLDec(gToplamBorc)} color="#C0392B" />
        <KPICard label="Toplam Ödeme (Banka)" icon="🏦" value={formatTLDec(gToplamOdeme)} color="#27AE60" />
        <KPICard label="Net Bakiye (Borcumuz)" icon="⚖️" value={formatTLDec(gBakiye)} sub={`${borcluSayisi} cari borçlu`} color={gBakiye > 0 ? '#E67E22' : '#27AE60'} />
        <KPICard label="Cari Sayısı" icon="👥" value={String(list.length)} color="#1A3A5C" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5 space-y-3">
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
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-8 text-gray-400">Cari hesap yok — fatura girince otomatik oluşur</td></tr>
              ) : filtered.map(c => (
                <tr key={c.id} onClick={() => openDetail(c)} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <td className="px-3 py-2">
                    <div className="font-medium">{c.ad}</div>
                    <div className="text-xs text-gray-400">{c.fatura_sayisi} fatura · {c.odeme_sayisi} ödeme</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatTLDec(c.borc)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-green-700">{formatTLDec(c.odeme)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${c.bakiye > 0.01 ? 'text-red-600' : c.bakiye < -0.01 ? 'text-green-700' : 'text-gray-400'}`}>
                    {formatTLDec(c.bakiye)}
                  </td>
                  <td className="px-3 py-2 text-right"><span className="text-xs text-blue-600">Ekstre →</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
