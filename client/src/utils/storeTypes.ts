// Mağaza tipi sabitleri — tek kaynak. Sunucudaki normMagazaTip() ile aynı etiketleri
// üretir; oraya yeni bir tip eklendiğinde TYPE_ORDER'a da eklenmeli, yoksa sayfalar
// TYPE_ORDER.filter(...) yaptığı için o tipi sessizce gizler.
//
// DİKKAT: Excel'in F kolonundaki kod müşteriye görünen markayla aynı değil:
//   kod 'HİPER' -> gerçek 5M hipermarketler ('5M ANKARA')
//   kod '5M'    -> HEMEN / darkstore noktaları ('HEMEN İSTİNYE MİGROS')

export const TYPE_ORDER = [
  // Satış hedefimiz olan formatlar
  'MMM', 'MM', '5M', 'Macrocenter',
  // Stok görülebilen diğer Migros formatları
  'M', 'MJet', 'MION', 'Macrokiosk', 'Minigros', 'Gross', 'Hemen', 'Toptan', 'Depo',
  // magazalar tablosunda eşleşmeyen teslim noktaları
  'Diğer',
];

export const TYPE_COLORS: Record<string, string> = {
  'MMM': '#C0392B', 'MM': '#1A3A5C', '5M': '#F5A623', 'Macrocenter': '#6D28D9',
  'M': '#0891B2', 'MJet': '#DB2777', 'MION': '#059669', 'Macrokiosk': '#7C3AED',
  'Minigros': '#65A30D', 'Gross': '#B45309', 'Hemen': '#0EA5E9', 'Toptan': '#475569',
  'Depo': '#92400E', 'Diğer': '#6b7280',
};

// Yalnızca magazalar tablosunda eşleşme yoksa kullanılır — isimden kaba tahmin.
// DİKKAT: \b KULLANMA — 'MİGROS' içindeki İ, JS'te kelime karakteri sayılmadığından
// /\bM\b/ baştaki M'yi eşleştirir ve mağazayı yanlışlıkla M tipi yapar.
// Bunun yerine isim kelimelere bölünüp tam eşleşme aranıyor.
export function getStoreType(name: string): string {
  const tokens = (name || '').toUpperCase().split(/[\s.,/()\-]+/).filter(Boolean);
  if (tokens.some(t => t.startsWith('MACRO'))) return 'Macrocenter';
  if (tokens.includes('5M'))  return '5M';
  if (tokens.includes('MMM')) return 'MMM';
  if (tokens.includes('MM'))  return 'MM';
  if (tokens.includes('M'))   return 'M';
  return 'Diğer';
}
