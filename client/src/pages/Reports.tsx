import { useEffect, useState } from 'react';
import { fetchDailySales, fetchStockReport } from '../api/migros';
import type { DailySale, StockRecord } from '../types';
import { groupByProduct, calcStockStatus } from '../utils/calculations';
import { formatTL, formatNum } from '../utils/formatters';
import * as XLSX from 'xlsx';

export default function Reports() {
  const [sales, setSales] = useState<DailySale[]>([]);
  const [stock, setStock] = useState<StockRecord[]>([]);
  const [copied, setCopied] = useState(false);
  const [emailText, setEmailText] = useState('');

  useEffect(() => {
    Promise.all([fetchDailySales(), fetchStockReport()]).then(([s, st]) => {
      setSales(s); setStock(st);
      const prods = groupByProduct(s);
      const zeroCount = st.filter(r => calcStockStatus(parseFloat(r.STOK_GUN)||0, parseFloat(r.STOK_MIKTARI)||0) === 'zero').length;
      const dailyLoss = st.filter(r => calcStockStatus(parseFloat(r.STOK_GUN)||0, parseFloat(r.STOK_MIKTARI)||0) === 'zero')
        .reduce((acc, r) => acc + (parseFloat(r.GUNLUK_SATIS_TUTARI)||0), 0);
      setEmailText(`Sayın Migros B2B Ekibi,

KittyCady marka ürünlerimize ait ${new Date().toLocaleDateString('tr-TR')} tarihli satış ve stok raporunu bilgilerinize sunarız.

SATIŞ PERFORMANSI:
${prods.map(p => `• ${p.name}: ${formatNum(p.quantity)} adet — ${formatTL(p.revenue)}`).join('\n')}

STOK DURUMU:
• ${zeroCount} lokasyonda sıfır stok tespit edilmiştir.
• Günlük tahmini ciro kaybı: ${formatTL(dailyLoss)}
• Aylık tahmini ciro kaybı: ${formatTL(dailyLoss * 30)}

Acil stok müdahalesi talep etmekteyiz.

Saygılarımızla,
BT Pet Ürünleri Ltd. Şti. / KittyCady`);
    });
  }, []);

  const products = groupByProduct(sales);
  const zeroCount = stock.filter(r => calcStockStatus(parseFloat(r.STOK_GUN)||0, parseFloat(r.STOK_MIKTARI)||0) === 'zero').length;
  const critCount = stock.filter(r => calcStockStatus(parseFloat(r.STOK_GUN)||0, parseFloat(r.STOK_MIKTARI)||0) === 'critical').length;
  const totalRev = products.reduce((s, p) => s + p.revenue, 0);
  const dailyLoss = stock.filter(r => calcStockStatus(parseFloat(r.STOK_GUN)||0, parseFloat(r.STOK_MIKTARI)||0) === 'zero')
    .reduce((acc, r) => acc + (parseFloat(r.GUNLUK_SATIS_TUTARI)||0), 0);

  const downloadExcel = (type: 'sales' | 'stock' | 'alerts' | 'full') => {
    const wb = XLSX.utils.book_new();
    if (type === 'sales' || type === 'full') {
      const ws = XLSX.utils.json_to_sheet(sales.map(s => ({
        Tarih: s.DateTransaction?.slice(0,10), Mağaza: s.StoreName, SKU: s.SupplierItemNumber,
        Ürün: s.SupplierItemName, Adet: parseFloat(s.QuantitySold)||0, 'Net Tutar': parseFloat(s.NetSalesValue)||0,
      })));
      XLSX.utils.book_append_sheet(wb, ws, 'Günlük Satış');
    }
    if (type === 'stock' || type === 'full') {
      const ws = XLSX.utils.json_to_sheet(stock.map(r => ({
        Ürün: r.URUN_SATICI_ADI, Lokasyon: r.TESLIM_NOKTASI_ACIKLAMA, İl: r.IL_ADI,
        'Stok Miktarı': parseFloat(r.STOK_MIKTARI)||0, 'Stok Tutarı': parseFloat(r.STOK_TUTARI)||0,
        'G.Satış': parseFloat(r.GUNLUK_SATIS_MIKTARI)||0, 'Stok Gün': parseFloat(r.STOK_GUN)||0,
        Tarih: r.veri_tarihi,
      })));
      XLSX.utils.book_append_sheet(wb, ws, 'Stok');
    }
    if (type === 'alerts' || type === 'full') {
      const alerts = stock.filter(r => ['zero','critical'].includes(calcStockStatus(parseFloat(r.STOK_GUN)||0, parseFloat(r.STOK_MIKTARI)||0)));
      const ws = XLSX.utils.json_to_sheet(alerts.map(r => ({
        Durum: calcStockStatus(parseFloat(r.STOK_GUN)||0, parseFloat(r.STOK_MIKTARI)||0),
        Ürün: r.URUN_SATICI_ADI, Lokasyon: r.TESLIM_NOKTASI_ACIKLAMA, İl: r.IL_ADI,
        'Stok Miktarı': parseFloat(r.STOK_MIKTARI)||0, 'Stok Gün': parseFloat(r.STOK_GUN)||0,
        'G.Ciro Kaybı': parseFloat(r.GUNLUK_SATIS_TUTARI)||0,
      })));
      XLSX.utils.book_append_sheet(wb, ws, 'Stok Uyarıları');
    }
    XLSX.writeFile(wb, `kittycady_rapor_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const copyEmail = () => { navigator.clipboard.writeText(emailText); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div className="p-8 space-y-8">
      {/* Report Preview */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="bg-sidebar text-white px-6 py-4 flex justify-between items-center">
          <div>
            <div className="text-xs text-white/50 tracking-wide uppercase mb-1">BT Pet Ürünleri Ltd. Şti.</div>
            <div className="font-bold text-lg">KittyCady Migros Satış Raporu</div>
            <div className="text-white/50 text-sm">{new Date().toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
          </div>
          <button onClick={() => window.print()} className="bg-ac text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700">⬇ PDF İndir</button>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-gray-50 rounded-xl">
              <div className="text-xs text-gray-400 mb-1">Toplam Net Ciro</div>
              <div className="text-2xl font-bold text-gray-800">{formatTL(totalRev)}</div>
            </div>
            <div className="p-4 bg-red-50 rounded-xl border border-red-100">
              <div className="text-xs text-red-400 mb-1">Sıfır Stok Lokasyon</div>
              <div className="text-2xl font-bold text-red-700">{zeroCount}</div>
            </div>
            <div className="p-4 bg-orange-50 rounded-xl border border-orange-100">
              <div className="text-xs text-orange-400 mb-1">Günlük Ciro Kaybı</div>
              <div className="text-2xl font-bold text-orange-700">{formatTL(dailyLoss)}</div>
            </div>
          </div>
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-gray-50"><th className="px-4 py-2 text-left text-xs text-gray-500 uppercase">Ürün</th><th className="px-4 py-2 text-right text-xs text-gray-500 uppercase">Adet</th><th className="px-4 py-2 text-right text-xs text-gray-500 uppercase">Net Ciro</th><th className="px-4 py-2 text-right text-xs text-gray-500 uppercase">Ciro Payı</th></tr></thead>
            <tbody>
              {products.map(p => <tr key={p.sku} className="border-t border-gray-100"><td className="px-4 py-3 font-medium">{p.name}</td><td className="px-4 py-3 text-right">{formatNum(p.quantity)}</td><td className="px-4 py-3 text-right font-semibold">{formatTL(p.revenue)}</td><td className="px-4 py-3 text-right">%{p.shareRevenue.toFixed(1)}</td></tr>)}
            </tbody>
          </table>
          {(zeroCount + critCount) > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="font-semibold text-red-800 mb-1">⛔ Acil Stok Uyarısı</div>
              <div className="text-red-700 text-sm">{zeroCount} lokasyonda sıfır stok, {critCount} lokasyonda kritik stok (&lt;7 gün) tespit edilmiştir. Günlük tahmini ciro kaybı: <strong>{formatTL(dailyLoss)}</strong></div>
            </div>
          )}
        </div>
      </div>

      {/* Excel exports */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="font-semibold text-gray-800 mb-4">Excel Dışa Aktarma</div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { type: 'sales', label: '📊 Günlük Satış Excel\'i İndir', color: 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100' },
            { type: 'stock', label: '📦 Stok Raporu Excel\'i İndir', color: 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' },
            { type: 'alerts', label: '⚠️ Stok Uyarıları Excel\'i İndir', color: 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100' },
            { type: 'full', label: '📋 Tam Dashboard Excel\'i İndir', color: 'bg-sidebar text-white hover:opacity-90' },
          ].map(btn => (
            <button key={btn.type} onClick={() => downloadExcel(btn.type as 'sales'|'stock'|'alerts'|'full')}
              className={`border rounded-xl px-5 py-4 text-sm font-semibold text-left transition-all ${btn.color}`}>
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Email draft */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="font-semibold text-gray-800 mb-4">E-posta Taslağı</div>
        <div className="space-y-3 mb-4">
          <div className="flex gap-3">
            <label className="text-sm text-gray-500 w-20 flex-shrink-0 mt-2">Alıcı</label>
            <input defaultValue="tedarikci@migros.com.tr" className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400" />
          </div>
          <div className="flex gap-3">
            <label className="text-sm text-gray-500 w-20 flex-shrink-0 mt-2">Konu</label>
            <input defaultValue={`KittyCady Satış & Stok Raporu — ${new Date().toLocaleDateString('tr-TR')}`} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400" />
          </div>
        </div>
        <textarea value={emailText} onChange={e => setEmailText(e.target.value)} rows={12}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono outline-none focus:border-gray-400 resize-y" />
        <button onClick={copyEmail}
          className={`mt-3 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${copied ? 'bg-green-600 text-white' : 'bg-sidebar text-white hover:opacity-90'}`}>
          {copied ? '✓ Kopyalandı!' : '📋 Kopyala'}
        </button>
      </div>
    </div>
  );
}
