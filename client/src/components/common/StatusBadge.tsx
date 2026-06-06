import type { StockStatus } from '../../types';
const MAP: Record<StockStatus, { label: string; cls: string }> = {
  zero:     { label: 'Sıfır Stok', cls: 'bg-red-100 text-red-800 border border-red-200' },
  critical: { label: 'Kritik',     cls: 'bg-orange-100 text-orange-800 border border-orange-200' },
  warning:  { label: 'Uyarı',      cls: 'bg-blue-100 text-blue-800 border border-blue-200' },
  healthy:  { label: 'Sağlıklı',   cls: 'bg-green-100 text-green-800 border border-green-200' },
};
export default function StatusBadge({ status }: { status: StockStatus }) {
  const { label, cls } = MAP[status];
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>{label}</span>;
}
