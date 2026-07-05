// bankParser.js — Türk banka hesap hareketleri Excel'ini (.xls/.xlsx) ayrıştırır.
// Yapı: üstte hesap bilgileri (etiket A sütununda, değer C'de), sonra sütun
// başlığı satırı, ardından hareketler. Bakiye yürüyen bakiye olduğu için
// satır içeriği + IBAN benzersiz bir mükerrer-önleme anahtarı verir.
const XLSX = require('xlsx');
const crypto = require('crypto');

// Türk IBAN banka kodları (ilk 5 hane) → banka adı (yaygın olanlar)
const BANK_CODES = {
  '00010': 'Ziraat Bankası', '00012': 'Halkbank', '00015': 'VakıfBank',
  '00032': 'TEB', '00046': 'Akbank', '00059': 'Şekerbank', '00062': 'Garanti BBVA',
  '00064': 'İş Bankası', '00067': 'Yapı Kredi', '00099': 'ING', '00103': 'Fibabanka',
  '00111': 'QNB', '00123': 'HSBC', '00134': 'Denizbank', '00143': 'Odeabank',
  '00203': 'Albaraka', '00205': 'Kuveyt Türk', '00206': 'Türkiye Finans',
  '00209': 'Ziraat Katılım', '00210': 'Vakıf Katılım', '00211': 'Emlak Katılım',
};

function bankFromIban(iban) {
  const clean = (iban || '').replace(/\s/g, '').toUpperCase();
  if (!clean.startsWith('TR') || clean.length < 9) return null;
  const code = clean.slice(4, 9);
  return BANK_CODES[code] || `Banka (${code})`;
}

// "08/05/2026" → "2026-05-08". Zaten YYYY-MM-DD ise dokunma.
function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

// "1.234,56" / "-36000" / 36000 → sayı
function parseAmount(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\s/g, '');
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return parseFloat(s);
}

const norm = (v) => String(v == null ? '' : v).trim();

// Türkçe diakritikleri sıyırıp ASCII anahtara çevir (İ/ş/ı/ç... güvenli karşılaştırma)
const asciiKey = (v) => norm(v).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[çÇ]/g, 'c').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
  .replace(/[ıİ]/g, 'i').replace(/[öÖ]/g, 'o').replace(/[üÜ]/g, 'u')
  .toLowerCase().replace(/[\s:]/g, '');

// Açıklamadan karşı tarafı (cari eşleştirme önerisi için) çıkarmaya çalış
function extractKarsiTaraf(aciklama, fisAciklama) {
  const text = `${aciklama || ''} ${fisAciklama || ''}`;
  const patterns = [
    /ALICI\s*ÜNVANI\s*:\s*([^|]+?)(?:\s*ALICI\s*IBAN|\s*\||$)/i,
    /HAVALEYİ\s*ALAN\s*(?:MUSTERİ\s*)?UNVANI\s*:\s*([^|]+?)(?:\s*\||$)/i,
    /Alıcı\s*:?\s*([^-|]+?)(?:\s*-|\s*Sorgu|\s*\||$)/i,
    /GÖNDEREN\s*:?\s*([^|]+?)(?:\s*\||\s*HESAP|\s*SORGU|$)/i,
    /Gönderen\s*:?\s*([^-|]+?)(?:\s*Sorgu|\s*-|\s*\||$)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) {
      const cand = m[1].trim();
      if (cand.length > 2 && !/^BT PET/i.test(cand)) return cand.slice(0, 120);
    }
  }
  return null;
}

/**
 * @returns {{ account: {iban, unvan, vkn, hesap_adi, sube, banka_adi, devreden_bakiye}, transactions: [...] }}
 */
function parseBankStatement(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('Excel sayfası okunamadı.');
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // --- Hesap bilgileri (etiket A sütununda, değer C sütununda) ---
  const account = { iban: null, unvan: null, vkn: null, hesap_adi: null, sube: null, banka_adi: null, devreden_bakiye: null };
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const label = asciiKey(rows[i][0]);
    const val = norm(rows[i][2]);
    if (label === 'unvan') account.unvan = val;
    else if (label === 'vkn') account.vkn = val;
    else if (label === 'iban') account.iban = val.replace(/\s/g, '');
    else if (label === 'hesapadi') account.hesap_adi = val;
    else if (label === 'sube') account.sube = val;
    if (asciiKey(rows[i][0]) === 'islemtarihi') { headerIdx = i; break; }
  }
  if (!account.iban) throw new Error('Ekstrede IBAN bulunamadı — desteklenmeyen dosya formatı olabilir.');
  if (headerIdx === -1) throw new Error('Hareket başlık satırı bulunamadı ("İşlem Tarihi").');
  account.banka_adi = bankFromIban(account.iban);

  // --- Hareketler ---
  const transactions = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const aciklama = norm(r[4]);
    // Devreden bakiye satırı: tarihsiz, sadece bakiye
    if (/DEVREDEN BAK/i.test(aciklama)) {
      account.devreden_bakiye = parseAmount(r[6]);
      continue;
    }
    const islemTarihi = parseDate(r[0]);
    if (!islemTarihi) continue; // boş satır / dipnot / footer
    const tutar = parseAmount(r[5]);
    if (tutar === null || isNaN(tutar)) continue;

    const bakiye = parseAmount(r[6]);
    const yon = norm(r[3]).toUpperCase() || (tutar < 0 ? 'B' : 'A');
    const fisNo = norm(r[7]);
    const fisAciklama = norm(r[8]);
    const kanal = norm(r[2]);

    const hash = crypto.createHash('sha1')
      .update(`${account.iban}|${islemTarihi}|${tutar}|${bakiye}|${fisNo}|${aciklama}`)
      .digest('hex');

    transactions.push({
      islem_tarihi: islemTarihi,
      valor_tarihi: parseDate(r[1]),
      kanal,
      yon,
      aciklama,
      tutar,
      bakiye,
      fis_no: fisNo || null,
      fis_aciklama: fisAciklama || null,
      karsi_taraf: extractKarsiTaraf(aciklama, fisAciklama),
      satir_hash: hash,
    });
  }

  if (!transactions.length) throw new Error('Dosyada işlenebilir hareket bulunamadı.');
  return { account, transactions };
}

module.exports = { parseBankStatement, bankFromIban };
