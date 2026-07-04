import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { PnlWaterfall, PnlTrendRow, UnitEconomics as UE } from '../types/finance';
import { fetchPnl, fetchPnlTrend, fetchUnitEconomics, fetchStokSermayesi } from '../api/finance';
import KPICard from '../components/common/KPICard';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import UnitEconomics from '../components/finance/UnitEconomics';
import { formatTL, formatTLDec, formatPct, formatNum } from '../utils/formatters';

const PIE_COLORS = ['#C0392B', '#1A3A5C', '#E67E22', '#27AE60', '#8E44AD', '#16A085', '#F39C12', '#7F8C8D', '#2C3E50', '#D35400'];

type Preset = 'bu-ay' | 'gecen-ay' | 'ceyrek' | 'yil' | 'ozel';

function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (p) {
    case 'bu-ay': return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) };
    case 'gecen-ay': return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
    case 'ceyrek': {
      const q = Math.floor(m / 3) * 3;
      return { from: iso(new Date(Date.UTC(y, q, 1))), to: iso(new Date(Date.UTC(y, q + 3, 0))) };
    }
    case 'yil': return { from: `${y}-01-01`, to: `${y}-12-31` };
    default: return { from: `${y}-01-01`, to: iso(now) };
  }
}

interface WfRow { label: string; value: number; sub?: boolean; bold?: boolean; marj?: number; negative?: boolean }

function waterfallRows(p: PnlWaterfall): WfRow[] {
  return [
    { label: 'Brüt Satış (raf)', value: p.brutSatis, bold: true },
    ...(p.satisKdv > 0 ? [{ label: '(−) KDV', value: -p.satisKdv, sub: true, negative: true }] : []),
    { label: 'Net Satış (KDV hariç)', value: p.netSatis, bold: true },
    { label: '(−) Migros Komisyonu', value: -p.komisyon, sub: true, negative: true },
    { label: 'NET GELİR (bizim pay)', value: p.netGelir, bold: true },
    { label: '(−) İade & Fire', value: -p.iadeFire, sub: true, negative: true },
    { label: 'Düzeltilmiş Net Gelir', value: p.duzeltilmisNetGelir },
    { label: '(−) SMM (ürün + ambalaj + lojistik)', value: -p.smm, sub: true, negative: true },
    { label: 'BRÜT KÂR', value: p.brutKar, bold: true, marj: p.brutMarj },
    { label: '(−) Perakende / Kanal', value: -p.kanal, sub: true, negative: true },
    { label: '(−) Pazarlama', value: -p.pazarlama, sub: true, negative: true },
    { label: '(−) Operasyonel / Genel', value: -p.operasyonel, sub: true, negative: true },
    { label: '(−) Personel', value: -p.personel, sub: true, negative: true },
    { label: '(−) Diğer', value: -p.diger, sub: true, negative: true },
    { label: 'FAVÖK / Faaliyet Kârı', value: p.favok, bold: true, marj: p.favokMarj },
    { label: '(−) Finansman', value: -p.finansman, sub: true, negative: true },
    { label: 'NET KÂR', value: p.netKar, bold: true, marj: p.netMarj },
  ];
}

function exportPnlCsv(p: PnlWaterfall) {
  const rows = waterfallRows(p).map(r => `${r.label};${String(r.value).replace('.', ',')}${r.marj !== undefined ? `;%${String(r.marj).replace('.', ',')}` : ''}`);
  const blob = new Blob(['﻿' + [`P&L;${p.from} - ${p.to}`, ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `pnl-${p.from}-${p.to}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export default function ProfitLoss() {
  const [preset, setPreset] = useState<Preset>('bu-ay');
  const [{ from, to }, setRange] = useState(presetRange('bu-ay'));
  const [pnl, setPnl] = useState<PnlWaterfall | null>(null);
  const [trend, setTrend] = useState<PnlTrendRow[]>([]);
  const [ue, setUe] = useState<UE | null>(null);
  const [stokSermaye, setStokSermaye] = useState<{ toplam: number; tarih: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Karşılaştırma
  const [compare, setCompare] = useState(false);
  const [cmpRange, setCmpRange] = useState(presetRange('gecen-ay'));
  const [cmpPnl, setCmpPnl] = useState<PnlWaterfall | null>(null);

  const selectPreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'ozel') setRange(presetRange(p));
  };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [p, t, u, s] = await Promise.all([
        fetchPnl(from, to),
        fetchPnlTrend(12),
        fetchUnitEconomics(from, to),
        fetchStokSermayesi().catch(() => null),
      ]);
      setPnl(p); setTrend(t); setUe(u);
      if (s) setStokSermaye({ toplam: s.toplam, tarih: s.tarih });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'P&L yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!compare) { setCmpPnl(null); return; }
    fetchPnl(cmpRange.from, cmpRange.to).then(setCmpPnl).catch(() => setCmpPnl(null));
  }, [compare, cmpRange]);

  const rows = useMemo(() => (pnl ? waterfallRows(pnl) : []), [pnl]);
  const cmpRows = useMemo(() => (cmpPnl ? waterfallRows(cmpPnl) : []), [cmpPnl]);

  const inputCls = 'text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-gray-400 bg-white';
  const btnCls = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${active
      ? 'text-white border-transparent' : 'text-gray-600 border-gray-200 hover:bg-gray-50'}`;

  return (
    <div className="p-4 md:p-8 space-y-4 print:p-2">
      {/* Dönem seçici */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-2 items-center print:hidden">
        {([['bu-ay', 'Bu Ay'], ['gecen-ay', 'Geçen Ay'], ['ceyrek', 'Bu Çeyrek'], ['yil', 'Bu Yıl'], ['ozel', 'Özel']] as [Preset, string][]).map(([p, label]) => (
          <button key={p} onClick={() => selectPreset(p)} className={btnCls(preset === p)}
            style={preset === p ? { background: '#1A3A5C' } : undefined}>
            {label}
          </button>
        ))}
        {preset === 'ozel' && (
          <>
            <input type="date" value={from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className={inputCls} />
            <span className="text-gray-400 text-sm">—</span>
            <input type="date" value={to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className={inputCls} />
          </>
        )}
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} />
          Karşılaştır
        </label>
        {compare && (
          <>
            <input type="date" value={cmpRange.from} onChange={e => setCmpRange(r => ({ ...r, from: e.target.value }))} className={inputCls} />
            <span className="text-gray-400 text-sm">—</span>
            <input type="date" value={cmpRange.to} onChange={e => setCmpRange(r => ({ ...r, to: e.target.value }))} className={inputCls} />
          </>
        )}
        {pnl && (
          <>
            <button onClick={() => exportPnlCsv(pnl)} className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">⬇ CSV</button>
            <button onClick={() => window.print()} className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">🖨 Yazdır</button>
          </>
        )}
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      {loading ? <LoadingSkeleton rows={8} /> : pnl && (
        <>
          {/* KPI kartları */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <KPICard label="Net Gelir" icon="💵" value={formatTL(pnl.netGelir)} sub={`${formatNum(pnl.toplamAdet)} kutu satış`} color="#1A3A5C" />
            <KPICard label="Brüt Kâr" icon="📊" value={formatTL(pnl.brutKar)} sub={`Marj ${formatPct(pnl.brutMarj)}`} color="#27AE60" />
            <KPICard label="FAVÖK" icon="⚙️" value={formatTL(pnl.favok)} sub={`Marj ${formatPct(pnl.favokMarj)}`} color="#E67E22" />
            <KPICard label="Net Kâr" icon="🏁" value={formatTL(pnl.netKar)} sub={`Marj ${formatPct(pnl.netMarj)}`} color={pnl.netKar >= 0 ? '#27AE60' : '#C0392B'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Şelale tablosu */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-4 md:p-5">
              <div className="text-sm font-semibold text-gray-700 mb-3">
                Kâr / Zarar Tablosu <span className="text-gray-400 font-normal">({from} → {to})</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  {compare && cmpPnl && (
                    <tr className="text-xs text-gray-400 border-b border-gray-100">
                      <th className="text-left font-medium py-1">Kalem</th>
                      <th className="text-right font-medium py-1">Dönem</th>
                      <th className="text-right font-medium py-1">Karşılaştırma</th>
                      <th className="text-right font-medium py-1">Δ%</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const cmp = cmpRows[i];
                    const delta = cmp && Math.abs(cmp.value) > 0.005
                      ? ((r.value - cmp.value) / Math.abs(cmp.value)) * 100
                      : null;
                    return (
                      <tr key={r.label} className={`${r.bold ? 'border-t border-gray-200 font-semibold' : ''}`}>
                        <td className={`py-1.5 ${r.sub ? 'pl-6 text-gray-500' : ''}`}>
                          {r.label}
                          {r.marj !== undefined && <span className="ml-2 text-xs text-gray-400 font-normal">marj {formatPct(r.marj)}</span>}
                        </td>
                        <td className={`py-1.5 text-right tabular-nums ${r.negative && r.value !== 0 ? 'text-red-600' : r.bold && r.value < 0 ? 'text-red-600' : ''}`}>
                          {formatTLDec(r.value)}
                        </td>
                        {compare && cmpPnl && (
                          <>
                            <td className="py-1.5 text-right tabular-nums text-gray-400">{cmp ? formatTLDec(cmp.value) : '—'}</td>
                            <td className={`py-1.5 text-right tabular-nums text-xs ${delta === null ? 'text-gray-300' : delta >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                              {delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}%`}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Sağ kolon: KDV pozisyonu + gider dağılımı */}
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5">
                <div className="text-sm font-semibold text-gray-700 mb-3">🧮 KDV Pozisyonu</div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Hesaplanan KDV (satış)</span><span className="tabular-nums">{formatTLDec(pnl.kdvPozisyonu.hesaplanan)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">İndirilecek KDV (gider)</span><span className="tabular-nums">{formatTLDec(pnl.kdvPozisyonu.indirilecek)}</span></div>
                  <div className="flex justify-between border-t border-gray-200 pt-1.5 font-semibold">
                    <span>{pnl.kdvPozisyonu.fark >= 0 ? 'Ödenecek KDV' : 'Devreden KDV'}</span>
                    <span className={`tabular-nums ${pnl.kdvPozisyonu.fark >= 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {formatTLDec(Math.abs(pnl.kdvPozisyonu.fark))}
                    </span>
                  </div>
                </div>
              </div>

              {stokSermaye && stokSermaye.tarih && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5">
                  <div className="text-sm font-semibold text-gray-700 mb-2">🏦 Stoğa Bağlı Sermaye</div>
                  <div className="text-2xl font-bold">{formatTL(stokSermaye.toplam)}</div>
                  <div className="text-xs text-gray-400 mt-1">Migros stok verisi: {stokSermaye.tarih}</div>
                </div>
              )}

              {pnl.giderKategoriDagilimi.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5">
                  <div className="text-sm font-semibold text-gray-700 mb-2">Gider Dağılımı</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={pnl.giderKategoriDagilimi} dataKey="tutar" nameKey="kategori"
                        cx="50%" cy="50%" outerRadius={75} label={false}>
                        {pnl.giderKategoriDagilimi.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => formatTLDec(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* 12 aylık trend */}
          {trend.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5">
              <div className="text-sm font-semibold text-gray-700 mb-3">📈 Aylık Trend (son 12 ay)</div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="ay" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatTL(Number(v))} width={90} />
                  <Tooltip formatter={(v) => formatTLDec(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="netGelir" name="Net Gelir" stroke="#1A3A5C" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="brutKar" name="Brüt Kâr" stroke="#27AE60" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="netKar" name="Net Kâr" stroke="#C0392B" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Birim ekonomisi */}
          {ue && ue.rows.length > 0 && <UnitEconomics data={ue} />}
        </>
      )}
    </div>
  );
}
