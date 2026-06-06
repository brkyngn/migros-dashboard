import { useState, useMemo } from 'react';

interface Column<T> {
  key: keyof T | string;
  label: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
}

interface Props<T> {
  data: T[];
  columns: Column<T>[];
  searchKeys?: (keyof T)[];
  maxRows?: number;
}

export default function DataTable<T extends Record<string, unknown>>({ data, columns, searchKeys, maxRows = 100 }: Props<T>) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filtered = useMemo(() => {
    let d = data;
    if (search && searchKeys) {
      const q = search.toLowerCase();
      d = d.filter(row => searchKeys.some(k => String(row[k] ?? '').toLowerCase().includes(q)));
    }
    if (sortKey) {
      d = [...d].sort((a, b) => {
        const av = parseFloat(String(a[sortKey])) || String(a[sortKey] ?? '');
        const bv = parseFloat(String(b[sortKey])) || String(b[sortKey] ?? '');
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return d.slice(0, maxRows);
  }, [data, search, sortKey, sortDir, searchKeys, maxRows]);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  return (
    <div>
      {searchKeys && (
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Ara..."
          className="mb-3 w-64 text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-gray-400"
        />
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {columns.map(col => (
                <th
                  key={String(col.key)}
                  onClick={() => col.sortable !== false && handleSort(String(col.key))}
                  className={`px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap ${col.sortable !== false ? 'cursor-pointer hover:text-gray-800 select-none' : ''} ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}
                >
                  {col.label}
                  {sortKey === String(col.key) && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={columns.length} className="text-center py-8 text-gray-400 text-sm">Veri bulunamadı</td></tr>
            ) : filtered.map((row, i) => (
              <tr key={i} className={`border-b border-gray-100 hover:bg-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                {columns.map(col => (
                  <td key={String(col.key)} className={`px-3 py-2 ${col.align === 'right' ? 'text-right tabular-nums' : col.align === 'center' ? 'text-center' : ''}`}>
                    {col.render ? col.render(row) : String(row[col.key as keyof T] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {data.length > maxRows && (
          <div className="text-center text-xs text-gray-400 py-2">
            İlk {maxRows} kayıt gösteriliyor · Toplam {data.length}
          </div>
        )}
      </div>
    </div>
  );
}
