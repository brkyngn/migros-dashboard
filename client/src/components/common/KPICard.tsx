interface Props {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon?: string;
}
export default function KPICard({ label, value, sub, color = '#e94560', icon }: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 md:p-5 relative">
      <div className="absolute top-3 right-3 md:top-4 md:right-4 w-2 h-2 md:w-2.5 md:h-2.5 rounded-full" style={{ background: color }} />
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1 leading-tight">{icon} {label}</div>
      <div className="text-xl md:text-2xl font-bold text-gray-900 leading-none">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}
