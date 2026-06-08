export interface DailySale {
  id?: number;
  DateTransaction: string;
  StoreType: string;
  StoreNumber: string;
  StoreName: string;
  SupplierItemNumber: string;
  SupplierItemName: string;
  QuantitySold: string;
  NetSalesValue: string;
  BarcodeNumber?: string;
}

export interface StockRecord {
  id?: number;
  STOK_MIKTARI: string;
  STOK_TUTARI: string;
  GUNLUK_SATIS_MIKTARI: string;
  GUNLUK_SATIS_TUTARI: string;
  GUNLUK_YUKLEME_MIKTARI: string;
  GUNLUK_YUKLEME_TUTARI: string;
  STOK_GUN: string;
  IL_ADI: string;
  TESLIM_NOKTASI_ACIKLAMA: string;
  URUN_SATICI_ADI: string;
  SATICI_URUN_KODU: string;
  veri_tarihi?: string;
}

export type StockStatus = 'zero' | 'critical' | 'warning' | 'healthy';

export interface ProductSummary {
  sku: string;
  name: string;
  color: string;
  quantity: number;
  revenue: number;
  stores: number;
  avgPrice: number;
  shareQty: number;
  shareRevenue: number;
}

export interface FetchLog {
  id: number;
  raport_adi: string;
  durum: string;
  satir_sayisi: number;
  mesaj: string;
  cekme_tarihi: string;
}

export type Page = 'dashboard' | 'sales' | 'stock-alerts' | 'turnover' | 'reports' | 'daily-report' | 'daily-stock' | 'stock-comparison';
