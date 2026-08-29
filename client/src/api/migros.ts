import type { DailySale, StockRecord, FetchLog } from '../types';

const BASE = '';

export const fetchDailySales = async (startDate?: string, endDate?: string): Promise<DailySale[]> => {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  const res = await fetch(`${BASE}/api/db-gunluk?${params}`);
  if (!res.ok) throw new Error('Satış verisi alınamadı');
  return res.json();
};

export const fetchStockReport = async (tarih?: string): Promise<StockRecord[]> => {
  const url = tarih ? `${BASE}/api/db-stok-tarih?tarih=${tarih}` : `${BASE}/api/db-stok`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Stok verisi alınamadı');
  return res.json();
};

export const fetchStockDates = async (): Promise<string[]> => {
  const res = await fetch(`${BASE}/api/db-stok-gecmis`);
  if (!res.ok) return [];
  return res.json();
};

export const fetchOzet = async () => {
  const res = await fetch(`${BASE}/api/db-ozet`);
  if (!res.ok) throw new Error('Özet alınamadı');
  return res.json();
};

export const fetchLogs = async (): Promise<FetchLog[]> => {
  const res = await fetch(`${BASE}/api/cekme-loglari`);
  if (!res.ok) return [];
  return res.json();
};

export const triggerStokFetch = () => fetch(`${BASE}/api/agent-stok`, { method: 'POST' });
export const triggerGunlukFetch = () => fetch(`${BASE}/api/agent-gunluk`, { method: 'POST' });

// Sunucu tarafı satış toplamları. /api/db-gunluk LIMIT 20000'li olduğu için
// kümülatif rakamlar istemcide toplanınca eksik çıkıyordu — toplamlar ve
// zaman serisi buradan alınmalı, db-gunluk yalnızca satır detayı için.
export interface SatisOzet {
  urunler: { sku: string; urun_adi: string; qty: string; rev: string; magaza: string; ilk: string; son: string }[];
  gunluk:  { tarih: string; sku: string; qty: string; rev: string; magaza: string }[];
  magazalar: { id: string; sku: string; magaza_adi: string; il: string | null; bolge: string | null;
               tip: string; qty: string; rev: string; son_satis: string }[];
  genel: { magaza_sayisi: string; gun_sayisi: string; bozuk_tarih_satir: string;
           sayisal_olmayan_satir: string; toplam_satir: string };
}

export const fetchSatisOzet = async (): Promise<SatisOzet> => {
  const res = await fetch(`${BASE}/api/satis-ozet`);
  if (!res.ok) throw new Error('Satış özeti alınamadı');
  return res.json();
};
