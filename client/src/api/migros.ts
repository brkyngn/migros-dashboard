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
