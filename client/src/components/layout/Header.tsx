const TITLES: Record<string, string> = {
  dashboard: 'Yönetim Özeti',
  sales: 'Ürün Satış Performansı',
  'stock-alerts': 'Stok Uyarıları',
  turnover: 'Stok Devir Hızı & Verimlilik',
  reports: 'Rapor & Dışa Aktarma',
};

export default function Header({ page, lastUpdate }: { page: string; lastUpdate?: string }) {
  return (
    <div className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center">
      <h1 className="text-xl font-bold text-gray-900">{TITLES[page] || page}</h1>
      {lastUpdate && <div className="text-xs text-gray-400">Son güncelleme: {lastUpdate}</div>}
    </div>
  );
}
