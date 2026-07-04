import type { UnitEconomics as UE } from '../../types/finance';
import { formatTLDec, formatNum } from '../../utils/formatters';

const SKU_COLORS: Record<string, string> = { '41075315': '#C0392B', '41075312': '#1A3A5C' };

export default function UnitEconomics({ data }: { data: UE }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5 space-y-4">
      <div className="text-sm font-semibold text-gray-700">📦 Birim Ekonomisi (Kutu Başı)</div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.rows.map(r => (
          <div key={r.sku} className="border border-gray-100 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: SKU_COLORS[r.sku] || '#888' }} />
              <span className="text-sm font-semibold">{r.ad}</span>
              <span className="text-xs text-gray-400 ml-auto">{formatNum(r.adet)} kutu</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                <Row label="Raf fiyatı (ort.)" value={r.rafFiyati} />
                <Row label="Net fiyat (KDV hariç)" value={r.netFiyat} />
                <Row label="Komisyon sonrası gelir" value={r.komisyonSonrasi} />
                <Row label="Birim maliyet (COGS)" value={r.birimMaliyet} negative note={r.birimMaliyet === null ? 'Ayarlardan girin' : undefined} />
                <Row label="Dağıtılan sabit gider" value={r.dagitilanGider} negative />
                <tr className="border-t border-gray-200">
                  <td className="py-1.5 font-semibold">Kutu başı net kâr</td>
                  <td className={`py-1.5 text-right tabular-nums font-bold ${r.kutuBasiNetKar >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {formatTLDec(r.kutuBasiNetKar)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-6 text-sm bg-gray-50 rounded-lg px-4 py-3">
        <div><span className="text-gray-500">Dönem satışı:</span> <b>{formatNum(data.toplamAdet)} kutu</b></div>
        <div><span className="text-gray-500">Sabit giderler:</span> <b>{formatTLDec(data.sabitGiderler)}</b></div>
        <div>
          <span className="text-gray-500">Başabaş noktası:</span>{' '}
          <b>{data.breakevenAdet !== null ? `${formatNum(data.breakevenAdet)} kutu` : '—'}</b>
          {data.breakevenAdet === null && <span className="text-xs text-gray-400 ml-1">(birim maliyet girilmeli)</span>}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, negative, note }: { label: string; value: number | null; negative?: boolean; note?: string }) {
  return (
    <tr>
      <td className="py-1 text-gray-600">{negative ? '(−) ' : ''}{label}</td>
      <td className="py-1 text-right tabular-nums">
        {value === null
          ? <span className="text-xs text-amber-600">{note || '—'}</span>
          : formatTLDec(value)}
      </td>
    </tr>
  );
}
