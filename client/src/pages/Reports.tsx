import { useEffect, useState, useMemo } from 'react';
import { fetchDailySales, fetchStockReport } from '../api/migros';
import type { DailySale, StockRecord } from '../types';
import { SKU_AC, SKU_MB, PRODUCTS } from '../utils/calculations';
import { formatTL, formatNum } from '../utils/formatters';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// Tarih yardımcıları
function toISO(d: Date) { return d.toISOString().split('T')[0]; }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function formatDateTR(d: Date) {
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}
function formatDateShortTR(d: Date) {
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
}

const AC_COLOR = '#C0392B';
const MB_COLOR = '#1A3A5C';

export default function Reports() {
  const today = new Date();
  const endDay   = addDays(today, -1);  // dün (D-1)
  const startDay = addDays(endDay, -6); // 7 gün geriye

  const startDate = toISO(startDay);
  const endDate   = toISO(endDay);

  const [sales, setSales] = useState<DailySale[]>([]);
  const [stock, setStock] = useState<StockRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchDailySales(startDate, endDate),
      fetchStockReport(),
    ]).then(([s, st]) => {
      setSales(s);
      setStock(st);
      setLoading(false);
    });
  }, []);

  const stats = useMemo(() => {
    // --- Satış istatistikleri ---
    const salesBySku: Record<string, { qty: number; rev: number }> = {};
    let totalQty = 0, totalRev = 0;

    sales.forEach(s => {
      const sku = s.SupplierItemNumber;
      const qty = parseFloat(s.QuantitySold) || 0;
      const rev = parseFloat(s.NetSalesValue) || 0;
      if (!salesBySku[sku]) salesBySku[sku] = { qty: 0, rev: 0 };
      salesBySku[sku].qty += qty;
      salesBySku[sku].rev += rev;
      totalQty += qty;
      totalRev += rev;
    });

    const avgDailyRev = totalRev / 7;
    const avgDailyQty = totalQty / 7;

    // --- Stok istatistikleri ---
    // SKU eşleştirme: SATICI_URUN_KODU veya URUN_SATICI_ADI ile
    const matchSku = (r: StockRecord, sku: string) => {
      if (r.SATICI_URUN_KODU === sku) return true;
      if (sku === SKU_AC && r.URUN_SATICI_ADI?.toLowerCase().includes('active')) return true;
      if (sku === SKU_MB && r.URUN_SATICI_ADI?.toLowerCase().includes('marseille')) return true;
      return false;
    };

    // Toplam stok miktarı per SKU
    const stockQtyBySku: Record<string, number> = {};
    [SKU_AC, SKU_MB].forEach(sku => {
      stockQtyBySku[sku] = stock
        .filter(r => matchSku(r, sku))
        .reduce((acc, r) => acc + (parseFloat(r.STOK_MIKTARI) || 0), 0);
    });

    // Stoksuz mağaza per SKU (STOK_MIKTARI = 0 olan satır = o mağazada o SKU yok)
    const zeroStoresBySku: Record<string, number> = {};
    [SKU_AC, SKU_MB].forEach(sku => {
      zeroStoresBySku[sku] = stock
        .filter(r => matchSku(r, sku) && (parseFloat(r.STOK_MIKTARI) || 0) === 0)
        .length;
    });

    // Hiç stoku olmayan mağazalar: mağaza bazında tüm satırların stoku 0
    const storeHasStock: Record<string, boolean> = {};
    stock.forEach(r => {
      const store = r.TESLIM_NOKTASI_ACIKLAMA || r.IL_ADI || '';
      if (!(store in storeHasStock)) storeHasStock[store] = false;
      if ((parseFloat(r.STOK_MIKTARI) || 0) > 0) storeHasStock[store] = true;
    });
    const totalNoStockStores = Object.values(storeHasStock).filter(v => !v).length;
    const totalStores = Object.keys(storeHasStock).length;

    // Haftalık kaçırılan ciro (stoku sıfır olan satırların günlük satış tahmini × 7)
    const zeroRows = stock.filter(r => (parseFloat(r.STOK_MIKTARI) || 0) === 0);
    const dailyMissedRev = zeroRows.reduce((acc, r) => acc + (parseFloat(r.GUNLUK_SATIS_TUTARI) || 0), 0);
    const weeklyMissedRev = dailyMissedRev * 7;

    const weeklyMissedBySku: Record<string, number> = {};
    [SKU_AC, SKU_MB].forEach(sku => {
      const skuZeroRows = zeroRows.filter(r => matchSku(r, sku));
      weeklyMissedBySku[sku] = skuZeroRows.reduce((acc, r) => acc + (parseFloat(r.GUNLUK_SATIS_TUTARI) || 0), 0) * 7;
    });

    return {
      totalQty: Math.round(totalQty),
      totalRev: Math.round(totalRev),
      avgDailyRev,
      avgDailyQty,
      salesBySku,
      stockQtyBySku,
      zeroStoresBySku,
      totalNoStockStores,
      totalStores,
      weeklyMissedRev,
      weeklyMissedBySku,
      dailyMissedRev,
    };
  }, [sales, stock]);

  const [pdfLoading, setPdfLoading] = useState(false);

  const downloadPDF = async () => {
    const element = document.getElementById('migros-rapor');
    if (!element) return;
    setPdfLoading(true);
    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#f9fafb',
      });

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const contentW = pdfW - margin * 2;
      const contentH = pdfH - margin * 2;

      // mm per pixel
      const mmPerPx = contentW / canvas.width;
      const totalHeightMM = canvas.height * mmPerPx;
      const pageHeightPx = contentH / mmPerPx;

      let yOffset = 0;
      let pageIndex = 0;

      while (yOffset < canvas.height) {
        if (pageIndex > 0) pdf.addPage();

        // Slice the canvas for this page
        const sliceH = Math.min(pageHeightPx, canvas.height - yOffset);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceH;
        const ctx = sliceCanvas.getContext('2d')!;
        ctx.drawImage(canvas, 0, yOffset, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

        const imgData = sliceCanvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', margin, margin, contentW, sliceH * mmPerPx);

        yOffset += pageHeightPx;
        pageIndex++;
      }

      pdf.save(`migros-rapor-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setPdfLoading(false);
    }
  };

  if (loading) return <div className="p-8"><LoadingSkeleton rows={10} /></div>;

  return (
    <>

      <div className="p-4 md:p-8">
        <div id="migros-rapor" className="max-w-4xl mx-auto space-y-6">

          {/* Başlık */}
          <div className="bg-sidebar text-white rounded-2xl overflow-hidden">
            <div className="px-8 py-6 flex items-start justify-between">
              <div>
                <div className="text-white/50 text-xs uppercase tracking-widest mb-1">BT Pet Ürünleri Ltd. Şti.</div>
                <div className="text-2xl font-bold mb-1">Migros Rapor</div>
                <div className="text-white/70 text-sm">
                  {formatDateShortTR(startDay)} – {formatDateTR(endDay)} · 7 günlük dönem
                </div>
              </div>
              <button
                onClick={downloadPDF}
                disabled={pdfLoading}
                className="bg-white/10 hover:bg-white/20 text-white border border-white/20 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 disabled:opacity-60"
              >
                {pdfLoading ? '⏳ Hazırlanıyor...' : '⬇ PDF İndir'}
              </button>
            </div>
            {/* Tarih bandı */}
            <div className="bg-white/10 px-8 py-3 text-xs text-white/60 flex gap-6">
              <span>Rapor tarihi: {formatDateTR(today)}</span>
              <span>·</span>
              <span>Dönem: {formatDateShortTR(startDay)} – {formatDateShortTR(endDay)}</span>
            </div>
          </div>

          {/* BÖLÜM 1: Satış */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
              <div className="w-1 h-6 rounded-full bg-sidebar" />
              <div className="font-bold text-gray-800">Satış Performansı — 7 Günlük</div>
              <div className="text-xs text-gray-400 ml-auto">{formatDateShortTR(startDay)} – {formatDateShortTR(endDay)}</div>
            </div>
            <div className="p-6">
              {/* Toplam KPI'lar */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {[
                  { label: 'Toplam Satış Adedi', value: formatNum(stats.totalQty), sub: `Ort. ${formatNum(Math.round(stats.avgDailyQty))}/gün` },
                  { label: 'Toplam Net Ciro', value: formatTL(stats.totalRev), sub: `Ort. ${formatTL(Math.round(stats.avgDailyRev))}/gün` },
                  { label: 'Active Carbon Adedi', value: formatNum(Math.round(stats.salesBySku[SKU_AC]?.qty || 0)), sub: formatTL(Math.round(stats.salesBySku[SKU_AC]?.rev || 0)) },
                  { label: 'Marseille Breeze Adedi', value: formatNum(Math.round(stats.salesBySku[SKU_MB]?.qty || 0)), sub: formatTL(Math.round(stats.salesBySku[SKU_MB]?.rev || 0)) },
                ].map(k => (
                  <div key={k.label} className="bg-gray-50 rounded-xl p-4">
                    <div className="text-xs text-gray-400 mb-1 leading-tight">{k.label}</div>
                    <div className="text-xl font-bold text-gray-800">{k.value}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{k.sub}</div>
                  </div>
                ))}
              </div>
              {/* SKU detay tablosu */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-2.5 text-left">Ürün</th>
                    <th className="px-4 py-2.5 text-right">SKU</th>
                    <th className="px-4 py-2.5 text-right">7 Günlük Adet</th>
                    <th className="px-4 py-2.5 text-right">7 Günlük Ciro</th>
                    <th className="px-4 py-2.5 text-right">Ort. Günlük Adet</th>
                    <th className="px-4 py-2.5 text-right">Ort. Günlük Ciro</th>
                  </tr>
                </thead>
                <tbody>
                  {PRODUCTS.map(p => {
                    const d = stats.salesBySku[p.sku] || { qty: 0, rev: 0 };
                    return (
                      <tr key={p.sku} className="border-t border-gray-100">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                            <span className="font-medium text-gray-800">{p.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-400 font-mono text-xs">{p.sku}</td>
                        <td className="px-4 py-3 text-right font-bold text-gray-800">{formatNum(Math.round(d.qty))}</td>
                        <td className="px-4 py-3 text-right font-semibold" style={{ color: p.color }}>{formatTL(Math.round(d.rev))}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{formatNum(Math.round(d.qty / 7))}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{formatTL(Math.round(d.rev / 7))}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                    <td className="px-4 py-3 text-gray-700" colSpan={2}>Toplam</td>
                    <td className="px-4 py-3 text-right text-gray-800">{formatNum(stats.totalQty)}</td>
                    <td className="px-4 py-3 text-right text-gray-800">{formatTL(stats.totalRev)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{formatNum(Math.round(stats.avgDailyQty))}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{formatTL(Math.round(stats.avgDailyRev))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* BÖLÜM 2: Stok */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
              <div className="w-1 h-6 rounded-full bg-amber-500" />
              <div className="font-bold text-gray-800">Stok Durumu</div>
              <div className="text-xs text-gray-400 ml-auto">En son stok verisi</div>
            </div>
            <div className="p-6 space-y-6">
              {/* Özet sayılar */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="text-xs text-gray-400 mb-1">Toplam Mağaza Sayısı</div>
                  <div className="text-2xl font-bold text-gray-800">{formatNum(stats.totalStores)}</div>
                </div>
                <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                  <div className="text-xs text-red-400 mb-1">Hiç Stok Olmayan Mağaza</div>
                  <div className="text-2xl font-bold text-red-700">{formatNum(stats.totalNoStockStores)}</div>
                  <div className="text-xs text-red-400 mt-0.5">Tüm SKU'lar sıfır</div>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                  <div className="text-xs text-amber-600 mb-1">Stoksuz Mağaza Oranı</div>
                  <div className="text-2xl font-bold text-amber-700">
                    %{stats.totalStores > 0 ? ((stats.totalNoStockStores / stats.totalStores) * 100).toFixed(1) : '0'}
                  </div>
                </div>
              </div>

              {/* SKU bazlı stok tablosu */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-2.5 text-left">Ürün</th>
                    <th className="px-4 py-2.5 text-right">Depodaki Stok (Adet)</th>
                    <th className="px-4 py-2.5 text-right">Stoksuz Mağaza</th>
                    <th className="px-4 py-2.5 text-right">Stoksuz Oran</th>
                  </tr>
                </thead>
                <tbody>
                  {PRODUCTS.map(p => {
                    const stockQty = Math.round(stats.stockQtyBySku[p.sku] || 0);
                    const zeroStores = stats.zeroStoresBySku[p.sku] || 0;
                    const skuTotal = stock.filter(r =>
                      r.SATICI_URUN_KODU === p.sku ||
                      (p.sku === SKU_AC && r.URUN_SATICI_ADI?.toLowerCase().includes('active')) ||
                      (p.sku === SKU_MB && r.URUN_SATICI_ADI?.toLowerCase().includes('marseille'))
                    ).length;
                    const zeroRate = skuTotal > 0 ? (zeroStores / skuTotal * 100).toFixed(1) : '0';
                    return (
                      <tr key={p.sku} className="border-t border-gray-100">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                            <span className="font-medium text-gray-800">{p.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-gray-800">{formatNum(stockQty)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-bold ${zeroStores > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {formatNum(zeroStores)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-sm font-semibold ${parseFloat(zeroRate) > 20 ? 'text-red-600' : parseFloat(zeroRate) > 10 ? 'text-amber-600' : 'text-green-600'}`}>
                            %{zeroRate}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* BÖLÜM 3: Kaçırılan Ciro */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
              <div className="w-1 h-6 rounded-full bg-red-500" />
              <div className="font-bold text-gray-800">Kaçırılan Ciro Tahmini</div>
              <div className="text-xs text-gray-400 ml-auto">Stoksuz mağazaların ortalama satışına göre</div>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-red-50 border border-red-200 rounded-xl p-5">
                  <div className="text-xs text-red-400 mb-1">Günlük Kaçırılan Ciro</div>
                  <div className="text-2xl font-black text-red-700">{formatTL(Math.round(stats.dailyMissedRev))}</div>
                  <div className="text-xs text-red-400 mt-1">Stoksuz mağazaların beklenen satışı</div>
                </div>
                <div className="bg-red-100 border border-red-300 rounded-xl p-5">
                  <div className="text-xs text-red-500 mb-1">Haftalık Kaçırılan Ciro</div>
                  <div className="text-2xl font-black text-red-800">{formatTL(Math.round(stats.weeklyMissedRev))}</div>
                  <div className="text-xs text-red-500 mt-1">Günlük × 7</div>
                </div>
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-5">
                  <div className="text-xs text-orange-400 mb-1">Aylık Kaçırılan Ciro</div>
                  <div className="text-2xl font-black text-orange-700">{formatTL(Math.round(stats.dailyMissedRev * 30))}</div>
                  <div className="text-xs text-orange-400 mt-1">Günlük × 30</div>
                </div>
              </div>

              {/* SKU bazlı kaçırılan ciro */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-2.5 text-left">Ürün</th>
                    <th className="px-4 py-2.5 text-right">Stoksuz Mağaza</th>
                    <th className="px-4 py-2.5 text-right">Haftalık Kaçırılan Ciro</th>
                    <th className="px-4 py-2.5 text-right">Aylık Kaçırılan Ciro</th>
                  </tr>
                </thead>
                <tbody>
                  {PRODUCTS.map(p => (
                    <tr key={p.sku} className="border-t border-gray-100">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                          <span className="font-medium text-gray-800">{p.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-red-600">
                        {formatNum(stats.zeroStoresBySku[p.sku] || 0)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-red-700">
                        {formatTL(Math.round(stats.weeklyMissedBySku[p.sku] || 0))}
                      </td>
                      <td className="px-4 py-3 text-right text-orange-700 font-semibold">
                        {formatTL(Math.round((stats.weeklyMissedBySku[p.sku] || 0) / 7 * 30))}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                    <td className="px-4 py-3 text-gray-700">Toplam</td>
                    <td className="px-4 py-3 text-right text-red-600">{formatNum(stats.totalNoStockStores)}</td>
                    <td className="px-4 py-3 text-right text-red-700">{formatTL(Math.round(stats.weeklyMissedRev))}</td>
                    <td className="px-4 py-3 text-right text-orange-700">{formatTL(Math.round(stats.dailyMissedRev * 30))}</td>
                  </tr>
                </tbody>
              </table>

              {stats.weeklyMissedRev > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
                  <div className="text-red-500 text-lg mt-0.5">⚠️</div>
                  <div>
                    <div className="font-semibold text-red-800 text-sm mb-0.5">Acil Stok Müdahalesi Gerekiyor</div>
                    <div className="text-red-700 text-sm">
                      {formatNum(stats.totalNoStockStores)} mağazada stok bulunmamaktadır.
                      Bu durum haftalık <strong>{formatTL(Math.round(stats.weeklyMissedRev))}</strong> kaçırılan ciroya yol açmaktadır.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="text-center text-xs text-gray-400 pt-4 border-t border-gray-200">
            BT Pet Ürünleri Ltd. Şti. · KittyCady · Migros Rapor · {formatDateTR(today)}
          </div>

        </div>
      </div>
    </>
  );
}
