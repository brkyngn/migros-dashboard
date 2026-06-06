export const formatTL = (n: number) =>
  '₺' + n.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const formatTLDec = (n: number) =>
  '₺' + n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatNum = (n: number) => n.toLocaleString('tr-TR');

export const formatDate = (d: string) => {
  if (!d) return '—';
  return d.slice(0, 10);
};

export const formatPct = (n: number) =>
  '%' + n.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
