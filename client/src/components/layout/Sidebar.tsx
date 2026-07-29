import { useState } from 'react';
import type { Page } from '../../types';

interface NavItem { id: Page; icon: string; label: string; }
interface NavGroup { id: string; icon: string; label: string; items: NavItem[]; }

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'migros', icon: '🛒', label: 'Migros',
    items: [
      { id: 'dashboard',        icon: '🏠', label: 'Yönetim Özeti' },
      { id: 'daily-report',     icon: '📅', label: 'Günlük Satış' },
      { id: 'daily-stock',      icon: '📦', label: 'Günlük Stok' },
      { id: 'stock-comparison', icon: '📊', label: 'Stok Karşılaştırma' },
      { id: 'store-types',      icon: '🏬', label: 'Mağaza Tipi' },
      { id: 'availability',     icon: '🗺️', label: 'Bulunurluk' },
      { id: 'sales',            icon: '📈', label: 'Satış Performansı' },
      { id: 'stock-alerts',     icon: '⚠️', label: 'Stok Uyarıları' },
      { id: 'turnover',         icon: '🔄', label: 'Devir Hızı' },
      { id: 'reports',          icon: '📄', label: 'Raporlar' },
    ],
  },
  {
    id: 'finans', icon: '💰', label: 'Finans',
    items: [
      { id: 'expenses',         icon: '🧾', label: 'Giderler' },
      { id: 'banka',            icon: '🏦', label: 'Banka' },
      { id: 'cari',             icon: '👥', label: 'Cari Hesaplar' },
      { id: 'pnl',              icon: '📉', label: 'Kâr / Zarar' },
      { id: 'finance-settings', icon: '⚙️', label: 'Finans Ayarları' },
    ],
  },
];

const EXT_LINKS = [
  { href: '/tools', icon: '🛠️', label: 'Araçlar' },
];

const LS_KEY = 'sidebarGroups';

function loadOpenState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* yoksay */ }
  return { migros: true, finans: true };
}

interface Props { current: Page; onChange: (p: Page) => void; isOpen?: boolean; }

export default function Sidebar({ current, onChange, isOpen = false }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>(loadOpenState);

  // Aktif sayfayı içeren grup her zaman açık (kapatılamaz — kullanıcı başka gruba geçince kapanabilir)
  const isExpanded = (group: NavGroup) =>
    open[group.id] || group.items.some(i => i.id === current);

  const toggle = (id: string) => {
    setOpen(o => {
      const next = { ...o, [id]: !o[id] };
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* yoksay */ }
      return next;
    });
  };

  return (
    <aside
      className={`
        fixed md:static inset-y-0 left-0 z-50
        w-60 min-h-screen flex-shrink-0 flex flex-col
        transform transition-transform duration-200 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}
      style={{ background: '#1A1A2E' }}
    >
      <div className="px-6 py-6 border-b border-white/10">
        <div className="text-white font-bold text-lg leading-tight">KittyCady</div>
        <div className="text-white/40 text-xs mt-0.5">Migros B2B Dashboard</div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_GROUPS.map(group => (
          <div key={group.id}>
            <button
              onClick={() => toggle(group.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all text-white/70 hover:text-white hover:bg-white/8"
            >
              <span>{group.icon}</span>
              <span className="flex-1 text-left">{group.label}</span>
              <span className={`text-white/40 text-xs transition-transform duration-200 ${isExpanded(group) ? 'rotate-90' : ''}`}>▸</span>
            </button>
            {isExpanded(group) && (
              <div className="mt-0.5 space-y-0.5">
                {group.items.map(item => (
                  <button
                    key={item.id}
                    onClick={() => onChange(item.id)}
                    className={`w-full flex items-center gap-3 pl-6 pr-3 py-2 rounded-lg text-sm font-medium transition-all
                      ${current === item.id
                        ? 'bg-white/15 text-white'
                        : 'text-white/50 hover:text-white/80 hover:bg-white/8'}`}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
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
