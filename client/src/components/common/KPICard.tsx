interface Props {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon?: string;
}
export default function KPICard({ label, value, sub, color = '#e94560', icon }: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 relative">
      <div className="absolute top-4 right-4 w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">{icon} {label}</div>
      <div className="text-2xl font-bold text-gray-900 leading-none">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}
