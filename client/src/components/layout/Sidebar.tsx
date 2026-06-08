import type { Page } from '../../types';

const NAV = [
  { id: 'dashboard' as Page,      icon: '🏠', label: 'Yönetim Özeti' },
  { id: 'daily-report' as Page,   icon: '📅', label: 'Günlük Satış' },
  { id: 'sales' as Page,          icon: '📈', label: 'Satış Performansı' },
  { id: 'stock-alerts' as Page,   icon: '⚠️', label: 'Stok Uyarıları' },
  { id: 'turnover' as Page,       icon: '🔄', label: 'Devir Hızı' },
  { id: 'reports' as Page,        icon: '📄', label: 'Raporlar' },
];

const EXT_LINKS = [
  { href: '/karsilastirma', icon: '📊', label: 'Stok Karşılaştırma' },
  { href: '/tools',         icon: '🛠️', label: 'Araçlar' },
];

interface Props { current: Page; onChange: (p: Page) => void; }

export default function Sidebar({ current, onChange }: Props) {
  return (
    <aside className="w-60 min-h-screen flex-shrink-0 flex flex-col" style={{ background: '#1A1A2E' }}>
      <div className="px-6 py-6 border-b border-white/10">
        <div className="text-white font-bold text-lg leading-tight">KittyCady</div>
        <div className="text-white/40 text-xs mt-0.5">Migros B2B Dashboard</div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(item => (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
              ${current === item.id
                ? 'bg-white/15 text-white'
                : 'text-white/50 hover:text-white/80 hover:bg-white/8'}`}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
        <a
          href="/gunluk-stok"
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-white/50 hover:text-white/80 hover:bg-white/8 no-underline"
        >
          <span>📦</span>
          <span>Günlük Stok</span>
        </a>
      </nav>
      <div className="px-3 py-2 border-t border-white/10">
        <div className="text-white/30 text-[10px] uppercase tracking-wider px-3 py-2">Harici Sayfalar</div>
        {EXT_LINKS.map(link => (
          <a
            key={link.href}
            href={link.href}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-white/50 hover:text-white/80 hover:bg-white/8 no-underline"
          >
            <span>{link.icon}</span>
            <span>{link.label}</span>
          </a>
        ))}
      </div>
      <div className="px-6 py-4 border-t border-white/10">
        <div className="text-white/30 text-xs">BT Pet Ürünleri Ltd. Şti.</div>
      </div>
    </aside>
  );
}
