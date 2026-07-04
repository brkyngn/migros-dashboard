export type PnlBlok = 'SMM' | 'KANAL' | 'IADE_FIRE' | 'PAZARLAMA' | 'OPERASYONEL' | 'PERSONEL' | 'FINANSMAN' | 'DIGER';

export const PNL_BLOK_ADLARI: Record<PnlBlok, string> = {
  SMM: 'SMM / Ürün Maliyeti',
  KANAL: 'Perakende / Kanal',
  IADE_FIRE: 'İade & Fire',
  PAZARLAMA: 'Pazarlama',
  OPERASYONEL: 'Operasyonel / Genel',
  PERSONEL: 'Personel',
  FINANSMAN: 'Finansman',
  DIGER: 'Diğer',
};

export interface ExpenseCategory {
  id: number;
  ad: string;
  pnl_blok: PnlBlok;
  sira: number;
  aktif: boolean;
}

export interface Expense {
  id: number;
  tarih: string;
  tedarikci: string | null;
  alici: string | null;
  kategori_id: number;
  kategori_ad?: string;
  pnl_blok?: PnlBlok;
  aciklama: string | null;
  net_tutar: number;
  kdv_orani: number;
  kdv_tutari: number;
  brut_tutar: number;
  urun_id: number | null;
  urun_ad?: string | null;
  adet: number | null;
  kaynak: 'manuel' | 'fatura_ai' | 'tekrar';
  fatura_no: string | null;
  tekrarlayan_id: number | null;
  donem: string | null;
}

export interface RecurringExpense {
  id: number;
  baslik: string;
  kategori_id: number;
  kategori_ad?: string;
  tedarikci: string | null;
  aciklama: string | null;
  net_tutar: number;
  kdv_orani: number;
  gun: number;
  baslangic: string;
  bitis: string | null;
  aktif: boolean;
}

export interface Product {
  id: number;
  migros_urun_kodu: string;
  ad: string;
  barkod: string | null;
  koli_ici_adet: number;
  kdv_orani: number;
  komisyon_orani_override: number | null;
  birim_maliyet: number | null;
  aktif: boolean;
}

export interface FinanceSettingsData {
  komisyon_orani: number;
  varsayilan_kdv: number;
  satis_kdv_orani: number;
  satis_kdv_dahil: boolean;
}

export interface PnlWaterfall {
  brutSatis: number;
  satisKdv: number;
  netSatis: number;
  komisyon: number;
  netGelir: number;
  iadeFire: number;
  duzeltilmisNetGelir: number;
  smm: number;
  brutKar: number;
  brutMarj: number;
  kanal: number;
  pazarlama: number;
  operasyonel: number;
  personel: number;
  favok: number;
  favokMarj: number;
  finansman: number;
  diger: number;
  netKar: number;
  netMarj: number;
  toplamAdet: number;
  kdvPozisyonu: { hesaplanan: number; indirilecek: number; fark: number };
  giderKategoriDagilimi: { kategori: string; pnl_blok: PnlBlok; tutar: number }[];
  skuBazinda: { sku: string; ad: string; adet: number; brut: number; komisyonOrani: number }[];
}

export interface PnlTrendRow {
  ay: string;
  netGelir: number;
  brutKar: number;
  netKar: number;
}

export interface UnitEconomicsRow {
  sku: string;
  ad: string;
  adet: number;
  rafFiyati: number;
  netFiyat: number;
  komisyonSonrasi: number;
  birimMaliyet: number | null;
  dagitilanGider: number;
  kutuBasiNetKar: number;
}

export interface UnitEconomics {
  rows: UnitEconomicsRow[];
  toplamAdet: number;
  sabitGiderler: number;
  breakevenAdet: number | null;
}

export interface InvoiceLineItem {
  aciklama: string;
  adet: number;
  birim_fiyat: number;
  net_tutar: number;
  kdv_orani: number;
}

export interface ParsedInvoice {
  satici: string;
  satici_vkn: string | null;
  alici: string;
  fatura_no: string;
  fatura_tarihi: string;
  para_birimi: string;
  kalemler: InvoiceLineItem[];
  kdv_ozeti: { oran: number; matrah: number; kdv: number }[];
  toplam_net: number;
  toplam_kdv: number;
  toplam_brut: number;
}
