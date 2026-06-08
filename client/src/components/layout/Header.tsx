const TITLES: Record<string, string> = {
  dashboard: 'Yönetim Özeti',
  'daily-report': 'Günlük Satış',
  'daily-stock': 'Günlük Stok',
  'stock-comparison': 'Stok Karşılaştırma',
  sales: 'Satış Performansı',
  'stock-alerts': 'Stok Uyarıları',
  turnover: 'Devir Hızı',
  reports: 'Raporlar',
};

interface Props { page: string; lastUpdate?: string; onMenuClick?: () => void; }

export default function Header({ page, lastUpdate, onMenuClick }: Props) {
  return (
    <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-3 md:py-4 flex justify-between items-center sticky top-0 z-30">
      <div className="flex items-center gap-3">
        {/* Hamburger — sadece mobilde */}
        <button
          onClick={onMenuClick}
          className="md:hidden p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          aria-label="Menüyü aç"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <h1 className="text-base md:text-xl font-bold text-gray-900">{TITLES[page] || page}</h1>
      </div>
      {lastUpdate && <div className="hidden sm:block text-xs text-gray-400">{lastUpdate}</div>}
    </div>
  );
}
