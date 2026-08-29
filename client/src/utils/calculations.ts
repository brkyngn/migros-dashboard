import type { DailySale, StockStatus, ProductSummary } from '../types';

export const SKU_AC = '41075315';
export const SKU_MB = '41075312';
export const PRODUCTS = [
  { sku: SKU_AC, name: 'Active Carbon 5L', shortName: 'Active Carbon', color: '#C0392B' },
  { sku: SKU_MB, name: 'Marseille Breeze 5L', shortName: 'Marseille Breeze', color: '#1A3A5C' },
];

export const calcStockStatus = (stockDays: number, stockQty: number): StockStatus => {
  if (stockQty === 0) return 'zero';
  if (stockDays > 0 && stockDays < 7) return 'critical';
  if (stockDays >= 7 && stockDays < 15) return 'warning';
  return 'healthy';
};

export const calcTurnoverRate = (monthlySales: number, currentStock: number): number => {
  if (currentStock === 0) return 0;
  return monthlySales / currentStock;
};

export const calcDailyLoss = (dailySalesAmount: number): number => dailySalesAmount;

export const calcProjectedLoss = (dailyLoss: number, days: number): number => dailyLoss * days;

export const groupByProduct = (sales: DailySale[]): ProductSummary[] => {
  const map: Record<string, { qty: number; rev: number; stores: Set<string> }> = {};
  let totalQty = 0; let totalRev = 0;
  sales.forEach(s => {
    const sku = s.SupplierItemNumber;
    if (!map[sku]) map[sku] = { qty: 0, rev: 0, stores: new Set() };
    const q = parseFloat(s.QuantitySold) || 0;
    const r = parseFloat(s.NetSalesValue) || 0;
    map[sku].qty += q; map[sku].rev += r; map[sku].stores.add(s.StoreNumber);
    totalQty += q; totalRev += r;
  });
  return PRODUCTS.map(p => {
    const d = map[p.sku] || { qty: 0, rev: 0, stores: new Set() };
    return {
      sku: p.sku, name: p.name, color: p.color,
      quantity: Math.round(d.qty), revenue: Math.round(d.rev),
      stores: d.stores.size,
      avgPrice: d.qty > 0 ? d.rev / d.qty : 0,
      shareQty: totalQty > 0 ? d.qty / totalQty * 100 : 0,
      shareRevenue: totalRev > 0 ? d.rev / totalRev * 100 : 0,
    };
  });
};

export const groupByWeek = (sales: DailySale[]) => {
  const map: Record<string, Record<string, number>> = {};
  sales.forEach(s => {
    const d = new Date(s.DateTransaction.slice(0, 10) + 'T00:00:00Z');
    if (isNaN(d.getTime())) return;
    const week = `Hf ${getWeekNum(d)}`;
    if (!map[week]) map[week] = {};
    const sku = s.SupplierItemNumber;
    map[week][sku] = (map[week][sku] || 0) + (parseFloat(s.QuantitySold) || 0);
  });
  return Object.entries(map).map(([week, data]) => ({ week, ...data }));
};

const getWeekNum = (d: Date) => {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
};

export const groupByDayOfWeek = (sales: DailySale[]) => {
  const days = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  const map: Record<string, Record<string, number>> = {};
  days.forEach(d => { map[d] = {}; });
  sales.forEach(s => {
    const d2 = new Date(s.DateTransaction.slice(0, 10) + 'T00:00:00Z');
    if (isNaN(d2.getTime())) return;
    const day = days[(d2.getUTCDay() + 6) % 7];
    const sku = s.SupplierItemNumber;
    map[day][sku] = (map[day][sku] || 0) + (parseFloat(s.QuantitySold) || 0);
  });
  return days.map(d => ({ day: d, ...map[d] }));
};

export const groupByDay = (sales: DailySale[]) => {
  const map: Record<string, Record<string, number>> = {};
  sales.forEach(s => {
    const date = s.DateTransaction.slice(0, 10);
    if (!date || date.length < 10) return;
    if (!map[date]) map[date] = {};
    const sku = s.SupplierItemNumber;
    map[date][sku] = (map[date][sku] || 0) + (parseFloat(s.QuantitySold) || 0);
  });
  return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, data]) => {
      const total = (data[SKU_AC] || 0) + (data[SKU_MB] || 0);
      return { date: date.slice(5), ...data, toplam: total };
    });
};

// Sunucu tarafı satış özetinden ürün tablosu. groupByProduct'ın aksine
// LIMIT'e takılmaz — kümülatif rakamlar için bunu kullan.
export const productsFromOzet = (
  urunler: { sku: string; qty: string; rev: string; magaza: string }[]
): ProductSummary[] => {
  const map: Record<string, { qty: number; rev: number; stores: number }> = {};
  urunler.forEach(u => {
    map[u.sku] = { qty: Number(u.qty || 0), rev: Number(u.rev || 0), stores: Number(u.magaza || 0) };
  });
  const totalQty = PRODUCTS.reduce((s, p) => s + (map[p.sku]?.qty ?? 0), 0);
  const totalRev = PRODUCTS.reduce((s, p) => s + (map[p.sku]?.rev ?? 0), 0);
  return PRODUCTS.map(p => {
    const d = map[p.sku] || { qty: 0, rev: 0, stores: 0 };
    return {
      sku: p.sku, name: p.name, color: p.color,
      quantity: Math.round(d.qty), revenue: Math.round(d.rev),
      stores: d.stores,
      avgPrice: d.qty > 0 ? d.rev / d.qty : 0,
      shareQty: totalQty > 0 ? d.qty / totalQty * 100 : 0,
      shareRevenue: totalRev > 0 ? d.rev / totalRev * 100 : 0,
    };
  });
};

// ─── Sunucu özeti (satis-ozet) tabanlı gruplayıcılar ─────────────────────────
// groupByDay / groupByDayOfWeek satır bazlı çalışıyor ve /api/db-gunluk'un
// LIMIT 20000'ine takılıyor. Aşağıdakiler gün × SKU özetinden çalışır, kırpılmaz.

export interface OzetGun { tarih: string; sku: string; qty: string; rev: string; magaza: string }

export const gunlukSeriFromOzet = (rows: OzetGun[]) => {
  const map: Record<string, Record<string, number>> = {};
  rows.forEach(r => {
    if (!map[r.tarih]) map[r.tarih] = {};
    map[r.tarih][r.sku] = (map[r.tarih][r.sku] || 0) + Number(r.qty || 0);
  });
  return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, d]) => ({
      date: date.slice(5), tamTarih: date, ...d,
      toplam: (d[SKU_AC] || 0) + (d[SKU_MB] || 0),
    }));
};

export const haftaninGunuFromOzet = (rows: OzetGun[]) => {
  const days = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  const map: Record<string, Record<string, number>> = {};
  days.forEach(d => { map[d] = {}; });
  rows.forEach(r => {
    const d2 = new Date(r.tarih + 'T00:00:00Z');
    if (isNaN(d2.getTime())) return;
    const day = days[(d2.getUTCDay() + 6) % 7];
    map[day][r.sku] = (map[day][r.sku] || 0) + Number(r.qty || 0);
  });
  return days.map(d => ({ day: d, ...map[d] }));
};
