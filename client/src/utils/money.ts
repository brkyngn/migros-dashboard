// Türkçe sayı formatı yardımcıları — giriş alanları için.
// Gösterim için utils/formatters.ts (formatTL, formatTLDec, formatPct) kullanılır.

/** '1.234,56' → 1234.56 ; '1234.56' → 1234.56 ; boş/geçersiz → NaN */
export function parseTrNumber(s: string): number {
  if (!s) return NaN;
  const t = s.trim().replace(/\s/g, '').replace(/₺/g, '');
  // Hem nokta hem virgül varsa: nokta binlik, virgül ondalık
  if (t.includes(',')) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  return parseFloat(t);
}

/** 1234.56 → '1.234,56' (input değeri olarak göstermek için) */
export function toTrInput(n: number): string {
  if (n === null || n === undefined || isNaN(n)) return '';
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function netToBrut(net: number, kdvOrani: number): { kdv: number; brut: number } {
  const kdv = Math.round(net * kdvOrani) / 100;
  return { kdv, brut: net + kdv };
}

export function brutToNet(brut: number, kdvOrani: number): { net: number; kdv: number } {
  const net = Math.round((brut / (1 + kdvOrani / 100)) * 100) / 100;
  return { net, kdv: brut - net };
}
