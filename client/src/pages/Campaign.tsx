import { useEffect, useState, Fragment } from 'react';
import { formatNum, formatTL } from '../utils/formatters';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

// ─── Tipler ──────────────────────────────────────────────────────────────────

interface Satir {
  sku: string;
  referans: { adet: number; tutar: number; gun: number; birimFiyat: number | null };
  donem: { adet: number; tutar: number; gun: number; birimFiyat: number | null };
  fiyatOrani: number | null;
  sekil: string;
  bedavaAdet: number | null;
  birimFiyat: number | null;
  komisyonOrani: number;
  anlasilanPay: number | null;
  migrosPayi: number | null;
  otomatikPay: number | null;
  fark: number | null;
}

interface GunlukSatir {
  tarih: string; sku: string; adet: number; tutar: number;
  bedavaAdet: number | null; anlasilanPay: number | null; otomatikPay: number | null;
}

interface Analiz {
  kampanya: {
    id: number; ad: string; tip: string; baslangic: string; bitis: string;
    bedava_maliyet_orani: number; fiyat_bazi: string;
  };
  referansDonem: { baslangic: string; bitis: string; gun: number };
  veriDurumu: { sonSatisGunu: string | null; tamamlandi: boolean };
  satirlar: Satir[];
  gunluk: GunlukSatir[];
  toplam: {
    donemAdet: number; donemTutar: number; bedavaAdet: number;
    anlasilanPay: number; migrosPayi: number; otomatikPay: number; fark: number;
  };
  eksik: string[];
  yorum: string;
  error?: string;
}

const URUN_ADI: Record<string, string> = {
  '41075315': 'Active Carbon 5L',
  '41075312': 'Marseille Breeze 5L',
};
const urunAdi = (sku: string) => URUN_ADI[sku] || sku;

function formatDateTR(d: string | null) {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  const months = ['','Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  return `${parseInt(day)} ${months[parseInt(m)]} ${y}`;
}

// ─── Bileşen ─────────────────────────────────────────────────────────────────

export default function Campaign() {
  const [data, setData] = useState<Analiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/kampanya-analiz')
      .then(r => r.json())
      .then((d: Analiz) => { if (d.error) setError(d.error); else setData(d); })
      .catch(e => setError(e instanceof Error ? e.message : 'Bilinmeyen hata'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8"><LoadingSkeleton rows={6} /></div>;

  if (error) return (
    <div className="p-8">
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
        <span className="text-xl">⚠️</span>
        <div className="text-red-700 text-sm font-medium">
          {error}
          <div className="text-red-600 font-normal mt-1">
            Kampanya kaydı yoksa önce Araçlar'dan oluşturulmalı.
          </div>
        </div>
      </div>
    </div>
  );

  if (!data) return null;

  const k = data.kampanya;
  const t = data.toplam;
  const bitti = data.veriDurumu.tamamlandi;
  const lehimize = t.fark > 0;

  // Günlük satırları tarihe göre grupla (SKU'lar yan yana)
  const gunler = [...new Set(data.gunluk.map(g => g.tarih))].sort();
  const skular = [...new Set(data.gunluk.map(g => g.sku))].sort();
  const hucre = (tarih: string, sku: string) => data.gunluk.find(g => g.tarih === tarih && g.sku === sku);

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">

      {/* Durum uyarısı — ekranda, PDF'te değil */}
      {!bitti && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 text-sm no-print">
          <b>⏳ Kampanya devam ediyor.</b> {formatDateTR(k.bitis)} tarihinde bitiyor; son satış
          verisi <b>{formatDateTR(data.veriDurumu.sonSatisGunu)}</b>. Aşağıdaki rakamlar
          şu ana kadarki kısmi dönemi kapsar. <b>Migros'a nihai raporu kampanya bittikten
          sonra gönderin</b> — 4 Ekim verisi 5 Ekim sabahı düşecek.
        </div>
      )}

      {data.eksik.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-800 text-sm no-print">
          <b>Dikkat:</b> {data.eksik.join(', ')} için raporlama şekli tespit edilemedi;
          bu ürünler toplamlara <b>dahil değil</b>.
        </div>
      )}

      {/* KPI kartları — ekran */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 no-print">
        <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ borderTop: '3px solid #1A3A5C' }}>
          <div className="text-xs text-gray-500 font-medium mb-1">Bedava Verilen</div>
          <div className="text-2xl font-black text-gray-800 leading-none">{formatNum(Math.round(t.bedavaAdet))}</div>
          <div className="text-[11px] text-gray-400 mt-1">adet</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ borderTop: '3px solid #16a34a' }}>
          <div className="text-xs text-gray-500 font-medium mb-1">Anlaşmaya Göre Payımız</div>
          <div className="text-2xl font-black text-gray-800 leading-none">{formatTL(t.anlasilanPay)}</div>
          <div className="text-[11px] text-gray-400 mt-1">%{k.bedava_maliyet_orani}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ borderTop: '3px solid #C0392B' }}>
          <div className="text-xs text-gray-500 font-medium mb-1">Fiilen Üstlenilen</div>
          <div className="text-2xl font-black leading-none" style={{ color: '#C0392B' }}>{formatTL(t.otomatikPay)}</div>
          <div className="text-[11px] text-gray-400 mt-1">ciro paylaşımı üzerinden</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"
             style={{ borderTop: `3px solid ${lehimize ? '#16a34a' : '#6b7280'}` }}>
          <div className="text-xs text-gray-500 font-medium mb-1">{lehimize ? 'Migros\'tan Alacak' : 'Fark'}</div>
          <div className="text-2xl font-black leading-none" style={{ color: lehimize ? '#16a34a' : '#6b7280' }}>
            {formatTL(Math.abs(t.fark))}
          </div>
          <div className="text-[11px] text-gray-400 mt-1">{lehimize ? 'fazla üstlenilmiş' : 'lehimize'}</div>
        </div>
      </div>

      <div className="flex gap-2 no-print">
        <button onClick={() => window.print()}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-ac text-white hover:opacity-90">
          🖨️ Migros Raporu (PDF)
        </button>
        {!bitti && (
          <div className="text-xs text-gray-400 self-center">
            Kampanya bitmeden gönderilmemeli — çıktıda da bu uyarı yer alır.
          </div>
        )}
      </div>

      {/* ── Migros'a gidecek rapor ── */}
      <div id="print-area" className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">

        <div className="border-b border-gray-200 pb-4">
          <div className="text-xs text-gray-500">BT Pet Ürünleri · KittyCady</div>
          <h1 className="text-xl font-black text-gray-900 mt-1">Kampanya Mutabakat Raporu</h1>
          <div className="text-sm text-gray-600 mt-1">{k.ad}</div>
          <div className="text-xs text-gray-500 mt-2">
            Kampanya dönemi: <b>{formatDateTR(k.baslangic)} – {formatDateTR(k.bitis)}</b>
            {' · '}Rapor kapsamı: <b>{formatDateTR(k.baslangic)} – {formatDateTR(data.veriDurumu.sonSatisGunu)}</b>
            {!bitti && <span className="text-amber-700 font-bold"> · ARA RAPOR (kampanya devam ediyor)</span>}
          </div>
        </div>

        {/* Yöntem — Migros'un doğrulayabilmesi için */}
        <div className="text-[11px] text-gray-600 leading-relaxed bg-gray-50 rounded-lg p-3">
          <b>Hesaplama yöntemi.</b> Birim fiyat, kampanya öncesi{' '}
            <b>{formatDateTR(data.referansDonem.baslangic)} – {formatDateTR(data.referansDonem.bitis)}</b>{' '}
            ({data.referansDonem.gun} gün) referans döneminin ortalama KDV hariç birim fiyatıdır
            (NetSalesValue ÷ QuantitySold). Kampanya dönemi birim fiyatı bu referansın{' '}
            <b>%{data.satirlar[0] ? Math.round((data.satirlar[0].fiyatOrani ?? 0) * 100) : '—'}</b>'i
            olduğundan, günlük satış raporunda bedava verilen adetler de raporlanmakta ve
            bedava adet = raporlanan adet ÷ 2 kabul edilmiştir.
            Bedava ürünün bedeli, ciro paylaşımı gereği hakedişe hiç yansımadığından,
            tedarikçi payı (%{100 - (data.satirlar[0]?.komisyonOrani ?? 50)}) kadarı fiilen
            tedarikçi tarafından üstlenilmektedir. Sözleşmede mutabık kalınan tedarikçi payı
            ise %{k.bedava_maliyet_orani}'tir.
        </div>

        {/* Ürün bazında */}
        <div>
          <div className="font-semibold text-gray-800 text-sm mb-2">Ürün Bazında Özet</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide text-[10px]">
                <th className="px-3 py-2 text-left font-semibold">Ürün</th>
                <th className="px-3 py-2 text-right font-semibold">Raporlanan Adet</th>
                <th className="px-3 py-2 text-right font-semibold">Bedava Adet</th>
                <th className="px-3 py-2 text-right font-semibold">Birim Fiyat</th>
                <th className="px-3 py-2 text-right font-semibold">Anlaşma (%{k.bedava_maliyet_orani})</th>
                <th className="px-3 py-2 text-right font-semibold">Fiilen Üstlenilen</th>
                <th className="px-3 py-2 text-right font-semibold">Fark</th>
              </tr>
            </thead>
            <tbody>
              {data.satirlar.map(s => (
                <tr key={s.sku} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-800">{urunAdi(s.sku)}</div>
                    <div className="text-[10px] text-gray-400">SKU {s.sku}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{formatNum(Math.round(s.donem.adet))}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">
                    {s.bedavaAdet === null ? '—' : formatNum(Math.round(s.bedavaAdet))}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {s.birimFiyat === null ? '—' : formatTL(s.birimFiyat)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{formatTL(s.anlasilanPay ?? 0)}</td>
                  <td className="px-3 py-2 text-right font-mono text-red-700">{formatTL(s.otomatikPay ?? 0)}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-green-700">{formatTL(s.fark ?? 0)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                <td className="px-3 py-2">TOPLAM</td>
                <td className="px-3 py-2 text-right font-mono">{formatNum(Math.round(t.donemAdet))}</td>
                <td className="px-3 py-2 text-right font-mono">{formatNum(Math.round(t.bedavaAdet))}</td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-right font-mono">{formatTL(t.anlasilanPay)}</td>
                <td className="px-3 py-2 text-right font-mono text-red-700">{formatTL(t.otomatikPay)}</td>
                <td className="px-3 py-2 text-right font-mono text-green-700">{formatTL(t.fark)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Sonuç */}
        <div className="rounded-lg p-4" style={{ background: lehimize ? '#f0fdf4' : '#f9fafb',
                                                  border: `1px solid ${lehimize ? '#bbf7d0' : '#e5e7eb'}` }}>
          <div className="text-sm text-gray-800">
            <b>Sonuç.</b> Rapor kapsamındaki dönemde{' '}
            <b>{formatNum(Math.round(t.bedavaAdet))} adet</b> ürün bedelsiz verilmiştir.
            Sözleşmeye göre tedarikçiye düşen pay <b>{formatTL(t.anlasilanPay)}</b> iken,
            hakediş mahsubu yoluyla fiilen üstlenilen tutar <b>{formatTL(t.otomatikPay)}</b>'dir.
            {lehimize && (
              <> Aradaki <b style={{ color: '#16a34a' }}>{formatTL(t.fark)}</b> tutarındaki farkın
              tedarikçi lehine mahsup edilmesini talep ederiz.</>
            )}
          </div>
        </div>

        {/* Günlük dayanak */}
        <div>
          <div className="font-semibold text-gray-800 text-sm mb-2">Günlük Dayanak</div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide text-[9px]">
                <th className="px-2 py-1.5 text-left font-semibold">Tarih</th>
                {skular.map(sku => (
                  <th key={sku} colSpan={2} className="px-2 py-1.5 text-center font-semibold border-l border-gray-200">
                    {urunAdi(sku)}
                  </th>
                ))}
              </tr>
              <tr className="bg-gray-50 text-gray-400 text-[9px]">
                <th></th>
                {skular.map(sku => (
                  <Fragment key={sku}>
                    <th className="px-2 py-1 text-right border-l border-gray-200">Adet</th>
                    <th className="px-2 py-1 text-right">Bedava</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {gunler.map(g => (
                <tr key={g} className="border-t border-gray-100">
                  <td className="px-2 py-1.5 text-gray-700">{formatDateTR(g)}</td>
                  {skular.map(sku => {
                    const h = hucre(g, sku);
                    return (
                      <Fragment key={sku}>
                        <td className="px-2 py-1.5 text-right font-mono border-l border-gray-100">
                          {h ? formatNum(Math.round(h.adet)) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono font-semibold">
                          {h?.bedavaAdet == null ? '—' : formatNum(Math.round(h.bedavaAdet))}
                        </td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-[10px] text-gray-400 border-t border-gray-100 pt-3">
          Rapor tarihi: {formatDateTR(new Date().toISOString().slice(0, 10))} ·
          Kaynak: Migros B2B günlük satış raporu (NetSalesValue, QuantitySold) ·
          Tutarlar KDV hariçtir.
        </div>
      </div>
    </div>
  );
}
