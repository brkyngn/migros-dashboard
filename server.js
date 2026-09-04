const express = require('express');
const https = require('https');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const { buildEmailData, buildEmailHTML, resendSend, formatDateTR } = require('./emailReport');
const { financeRoutes, initializeFinanceTables } = require('./financeRoutes');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// React app (built)
const clientDist = path.join(__dirname, 'client', 'dist');
app.use(express.static(clientDist));

// Eski HTML araçlar sayfası
app.get('/tools', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'tools.html')));
app.get('/karsilastirma', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'karsilastirma.html')));
app.get('/gunluk-stok', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'gunluk-stok.html')));
app.use('/frontend', express.static(path.join(__dirname, 'frontend')));

const CONFIG = {
  MIGROS_API: process.env.MIGROS_API || 'https://api-prod.migros.com.tr/rest/b2b/api/v1',
  USERNAME:   process.env.MIGROS_USERNAME,
  PASSWORD:   process.env.MIGROS_PASSWORD,
  SATICI_ID:  process.env.SATICI_ID,
  PORT:       process.env.PORT || 3000,
  NODE_ENV:   process.env.NODE_ENV || 'development'
};

// Türkiye saatine göre tarih (UTC+3)
function trToday() {
  const now = new Date();
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().split('T')[0];
}
function trYesterday() {
  const now = new Date();
  return new Date(now.getTime() + 3 * 60 * 60 * 1000 - 86400000).toISOString().split('T')[0];
}

// PostgreSQL bağlantısı
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Finans (P&L) modülü endpoint'leri — SPA fallback'ten önce kayıtlı olmalı
app.use('/api', financeRoutes(pool));

let token = '';
let connectionCodeRaw = '';
let tokenTimestamp = 0;
const TOKEN_MAX_AGE = 25 * 60 * 1000; // 25 dakika (Migros token 30 dk geçerli)

// Tabloları oluştur
async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gunluk_satis (
      id SERIAL PRIMARY KEY,
      "DateTransaction" TEXT,
      "SupplierCode" TEXT,
      "SupplierName" TEXT,
      "StoreType" TEXT,
      "StoreNumber" TEXT,
      "StoreName" TEXT,
      "SupplierStoreNumber" TEXT,
      "BarcodeNumber" TEXT,
      "ItemNumber" TEXT,
      "SupplierItemNumber" TEXT,
      "SupplierItemName" TEXT,
      "QuantitySold" TEXT,
      "TotalWeight" TEXT,
      "NetSalesValue" TEXT,
      "createdat" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Duplicate önleme için unique constraint (varsa atla)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS gunluk_satis_unique_idx
    ON gunluk_satis ("DateTransaction","StoreNumber","SupplierItemNumber","BarcodeNumber")
  `).catch(e => {
    // Sessizce yutmak, mükerrer korumasının hiç kurulmadığının anlaşılmasını
    // engelledi. Index zaten mükerrer varsa oluşmaz; log'da görünsün.
    console.error('⚠️ gunluk_satis unique index oluşturulamadı:', e.message);
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stok (
      id SERIAL PRIMARY KEY,
      "createdat" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cekme_loglari (
      id SERIAL PRIMARY KEY,
      raport_adi TEXT,
      durum TEXT,
      satir_sayisi INTEGER,
      mesaj TEXT,
      cekme_tarihi TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('✅ PostgreSQL tabloları hazır');
}

// SHA1
function sha1(str) {
  return require('crypto').createHash('sha1').update(str).digest('hex');
}

// Migros login
async function loginMigros() {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ username: CONFIG.USERNAME, password: CONFIG.PASSWORD });
    const req = https.request({
      hostname: 'api-prod.migros.com.tr', port: 443,
      path: '/rest/b2b/api/v1/auth/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: 15000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d);
          if (r.token) { token = r.token; connectionCodeRaw = r.connectionCode || ''; tokenTimestamp = Date.now(); console.log('✅ Migros Login başarılı'); resolve(true); }
          else { console.error('❌ Login başarısız:', r.message); resolve(false); }
        } catch(e) { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end(postData);
  });
}

// Tabloya eksik kolon ekle
async function ensureColumns(tableName, keys) {
  for (const col of keys) {
    try {
      await pool.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS "${col}" TEXT`);
    } catch(e) { /* zaten var */ }
  }
}

// Mükerrer koruması index'e GÜVENMEZ. Postgres unique index'inde NULL'lar
// birbirinden farklı sayılır; BarcodeNumber NULL olan satırlarda
// ON CONFLICT DO NOTHING hiç eşleşmiyor ve her çekimde satır yeniden
// yazılıyordu (3 Eylül'ün iki katına çıkması bu yüzden). IS NOT DISTINCT FROM
// NULL'ı NULL'a eşit sayar ve hiçbir index'e bağımlı değildir.
const DEDUP_KEYS = {
  gunluk_satis: ['DateTransaction', 'StoreNumber', 'SupplierItemNumber', 'BarcodeNumber'],
};

async function saveToDatabase(tableName, data) {
  if (!data || !data.length) return 0;
  const keys = Object.keys(data[0]);
  await ensureColumns(tableName, keys);
  const cols = keys.map(k => '"' + k + '"').join(',');

  const dedup = DEDUP_KEYS[tableName];
  let sql;
  if (dedup && dedup.every(k => keys.includes(k))) {
    const kosul = dedup.map(k => `"${k}" IS NOT DISTINCT FROM $${keys.indexOf(k) + 1}`).join(' AND ');
    const secim = keys.map((_, i) => `$${i + 1}::text`).join(',');
    sql = `INSERT INTO ${tableName} (${cols})
           SELECT ${secim}
           WHERE NOT EXISTS (SELECT 1 FROM ${tableName} WHERE ${kosul})`;
  } else {
    sql = `INSERT INTO ${tableName} (${cols}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')})`;
  }

  let count = 0, hata = 0, ilkHata = null;
  for (const row of data) {
    const values = keys.map(k => (row[k] !== undefined ? row[k] : null));
    try {
      const r = await pool.query(sql, values);
      count += r.rowCount;
    } catch (e) { hata++; if (!ilkHata) ilkHata = e.message; }
  }
  // Sessizce yutmak, mükerrer sorununun aylarca fark edilmemesine yol açtı
  if (hata) console.error(`⚠️ ${tableName}: ${hata} satır yazılamadı — ${ilkHata}`);
  return count;
}

// Log ekle
async function logToDb(raporAdi, durum, satirSayisi, mesaj) {
  try {
    await pool.query(
      'INSERT INTO cekme_loglari (raport_adi, durum, satir_sayisi, mesaj) VALUES ($1,$2,$3,$4)',
      [raporAdi, durum, satirSayisi, mesaj]
    );
  } catch(e) { console.error('Log hatası:', e.message); }
}

// ========== PROXY ==========

function proxyToMigros(reqPath, method, headers, body, res) {
  let sent = false;
  const req = https.request({
    hostname: 'api-prod.migros.com.tr', port: 443,
    path: `/rest/b2b/api/v1${reqPath}`, method,
    headers: { 'Content-Type': 'application/json', ...headers },
    timeout: 120000
  }, apiRes => {
    let d = '';
    apiRes.on('data', c => d += c);
    apiRes.on('end', () => {
      if (sent) return; sent = true;
      try { res.json(JSON.parse(d)); } catch(e) { res.status(500).json({ error: 'Parse hatası' }); }
    });
  });
  req.on('error',   (e) => { if (!sent) { sent=true; res.status(500).json({ error: e.message }); } });
  req.on('timeout', ()  => { if (!sent) { sent=true; req.destroy(); res.status(504).json({ error: 'Timeout' }); } });
  if (body) req.write(body);
  req.end();
}

app.post('/auth/login', (req, res) => {
  const body = JSON.stringify(req.body);
  proxyToMigros('/auth/login', 'POST', { 'Content-Length': Buffer.byteLength(body) }, body, res);
});

// Yerel dashboard girişi — Migros API'ye ihtiyaç duymaz
app.post('/api/local-login', (req, res) => {
  const { password } = req.body;
  const LOCAL_PASS = process.env.LOCAL_DASHBOARD_PASS || 'kittycady2024';
  if (password === LOCAL_PASS) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Hatalı şifre' });
  }
});


app.get('/report/*', (req, res) => {
  proxyToMigros(req.url, 'GET', {
    'Authorization': req.headers['authorization'] || '',
    'ConnectionCode': req.headers['connectioncode'] || ''
  }, null, res);
});

app.get('/isleticirapor/*', (req, res) => {
  proxyToMigros(req.url, 'GET', {
    'Authorization': req.headers['authorization'] || '',
    'ConnectionCode': req.headers['connectioncode'] || ''
  }, null, res);
});

// ========== DB OKUMA ==========

// Stok satırlarını magazalar tablosundan gelen resmî tiple zenginleştirir.
// İsimden tahmin ETME: 'HİPER' kodlu gerçek 5M'ler isimlerinde 5M geçmeyebiliyor.
// Eşleşme yoksa magaza_tipi null döner, istemci isimden tahmine düşer.
function stokSelectSQL(limit) {
  return `
    SELECT s.*,
           CASE WHEN m.tip IS NOT NULL THEN ${normMagazaTip('m.tip')} ELSE NULL END AS magaza_tipi,
           m.il AS magaza_il, m.bolge AS magaza_bolge
    FROM stok s
    LEFT JOIN magazalar m ON m.teslim_noktasi_id = s."TESLIM_NOKTASI_ID"
    WHERE s.veri_tarihi = $1
    ORDER BY s.id${limit ? ` LIMIT ${limit}` : ''}`;
}

app.get('/api/db-stok', async (req, res) => {
  try {
    // En güncel veri_tarihi'nin kayıtlarını getir
    const latest = await pool.query(`SELECT MAX(veri_tarihi) as son FROM stok`);
    const sonTarih = latest.rows[0]?.son;
    if (!sonTarih) return res.json([]);
    const r = await pool.query(stokSelectSQL(5000), [sonTarih]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Stok geçmişi — tüm tarihler
app.get('/api/db-stok-gecmis', async (req, res) => {
  try {
    const r = await pool.query(`SELECT DISTINCT veri_tarihi FROM stok WHERE veri_tarihi IS NOT NULL ORDER BY veri_tarihi DESC`);
    res.json(r.rows.map(row => row.veri_tarihi));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Belirli tarihli stok
app.get('/api/db-stok-tarih', async (req, res) => {
  try {
    const { tarih } = req.query;
    if (!tarih) return res.status(400).json({ error: 'tarih parametresi gerekli' });
    const r = await pool.query(stokSelectSQL(5000), [tarih]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/db-gunluk', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const params = [];
    let where = '';
    if (startDate) { params.push(startDate); where += ` AND "DateTransaction"::date >= $${params.length}::date`; }
    if (endDate)   { params.push(endDate);   where += ` AND "DateTransaction"::date <= $${params.length}::date`; }
    // magazalar ile zenginleştir: gerçek il/bölge ve kesin mağaza tipi
    const r = await pool.query(`
      SELECT g.*, m.il AS il, m.bolge AS bolge,
             CASE WHEN m.tip IS NOT NULL THEN ${normMagazaTip('m.tip')} ELSE NULL END AS magaza_tipi
      FROM gunluk_satis g
      LEFT JOIN magazalar m ON m.teslim_noktasi_id = g."StoreNumber"
      WHERE 1=1${where.replace(/"DateTransaction"/g, 'g."DateTransaction"')}
      ORDER BY g."DateTransaction" DESC LIMIT 20000`, params);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/db-satis-tarihler', async (req, res) => {
  try {
    const r = await pool.query(`SELECT DISTINCT "DateTransaction"::text as tarih FROM gunluk_satis WHERE "DateTransaction" IS NOT NULL ORDER BY tarih DESC`);
    res.json(r.rows.map(row => row.tarih.slice(0, 10)));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/db-ozet', async (req, res) => {
  try {
    const stok    = await pool.query('SELECT COUNT(*) as cnt, MAX(createdat) as son FROM stok');
    const satis   = await pool.query(`SELECT COUNT(*) as cnt, SUM(CAST("NetSalesValue" AS NUMERIC)) as tutar, MAX("DateTransaction") as son FROM gunluk_satis`);
    const cekme   = await pool.query(`SELECT COUNT(*) as cnt FROM cekme_loglari WHERE durum='BAŞARILI'`);
    res.json({
      stok:  stok.rows[0],
      satis: satis.rows[0],
      basariliCekme: parseInt(cekme.rows[0].cnt) || 0
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Mağaza tipini (MM/MMM/5M/Macrocenter) isim kolonundan çıkaran SQL CASE.
// Sıra önemli: MACROCENTER, M'den; MMM, MM'den önce (Postgres \y = kelime sınırı).
function tipCase(col) {
  // Kelime sınırı için \y KULLANMA: 'MİGROS' içindeki İ birçok locale'de harf
  // sayılmadığından \yM\y baştaki M'yi eşleştirip mağazayı yanlışlıkla M tipi yapar.
  // Bunun yerine açık boşluk/başlangıç-bitiş sınırı kullanılıyor.
  const w = (kelime) => `${col} ~* '(^| )${kelime}( |$)'`;
  // Sıra önemli: MACROKIOSK, MACRO'dan ÖNCE gelmeli — yoksa 114 kiosk
  // 'MACRO' alt dizesine takılıp hedef formatımız Macrocenter'ı şişiriyor.
  return `CASE
    WHEN ${col} ~* 'MACROKIOSK'   THEN 'Macrokiosk'
    WHEN ${col} ~* 'MACRO'        THEN 'Macrocenter'
    WHEN ${col} ~* 'MJET'         THEN 'MJet'
    WHEN ${col} ~* 'MION'         THEN 'MION'
    WHEN ${col} ~* 'M[İI]N[İI]GROS' THEN 'Minigros'
    WHEN ${col} ~* 'GROSS'        THEN 'Gross'
    WHEN ${col} ~* 'HEMEN'        THEN 'Hemen'
    WHEN ${col} ~* 'TOPTAN'       THEN 'Toptan'
    WHEN ${col} ~* 'DA[ĞG]ITIM MERKEZ' THEN 'Depo'
    WHEN ${w('5M')}  THEN '5M'
    WHEN ${w('MMM')} THEN 'MMM'
    WHEN ${w('MM')}  THEN 'MM'
    WHEN ${w('M')}   THEN 'M'
    ELSE 'Diğer' END`;
}

// magazalar.tip (Excel F ham kod) → gösterim tipine normalize et
// DİKKAT: Excel F kolonundaki kod ile müşteriye görünen marka aynı değil.
//   kod 'HİPER' -> mağaza adları '5M ...' yani gerçek 5M hipermarketler
//   kod '5M'    -> 'HEMEN ...' / darkstore / operasyon noktaları (hipermarket değil)
function normMagazaTip(expr) {
  return `CASE UPPER(${expr})
    WHEN 'MACRO' THEN 'Macrocenter'
    WHEN 'MACROCENTER' THEN 'Macrocenter'
    WHEN 'MMM'   THEN 'MMM'
    WHEN 'MM'    THEN 'MM'
    WHEN 'HİPER' THEN '5M'
    WHEN 'HIPER' THEN '5M'
    WHEN '5M'    THEN 'Hemen'
    WHEN 'M'     THEN 'M'
    WHEN 'MJET'       THEN 'MJet'
    WHEN 'MION'       THEN 'MION'
    WHEN 'MACROKIOSK' THEN 'Macrokiosk'
    WHEN 'MINIGROS'   THEN 'Minigros'
    WHEN 'GROSS'      THEN 'Gross'
    WHEN 'CC'         THEN 'Toptan'
    WHEN 'DEPO'       THEN 'Depo'
    ELSE 'Diğer' END`;
}

// Önce magazalar tablosundaki kesin tipi kullan; eşleşme yoksa isim regex'ine düş.
// mExpr = magazalar.tip alanı, nameCol = isim kolonu (fallback).
function tipCoalesce(mExpr, nameCol) {
  return `CASE WHEN ${mExpr} IS NOT NULL THEN ${normMagazaTip(mExpr)} ELSE ${tipCase(nameCol)} END`;
}

// Mağaza tipine göre birleşik özet: toplam satış + günlük satış + stok + raf boş
app.get('/api/magaza-tipi', async (req, res) => {
  try {
    const stokTarihiRes = await pool.query(`SELECT MAX(veri_tarihi) AS son FROM stok`);
    const stokTarihi = stokTarihiRes.rows[0]?.son || null;
    const satisTarihiRes = await pool.query(`SELECT MAX("DateTransaction") AS son FROM gunluk_satis WHERE "DateTransaction" ~ '^\\d{4}-\\d{2}-\\d{2}'`);
    const satisTarihi = satisTarihiRes.rows[0]?.son || null;

    const satisTip = tipCoalesce('m.tip', 'g."StoreName"');
    const stokTip  = tipCoalesce('m.tip', 's."TESLIM_NOKTASI_ACIKLAMA"');

    // Toplam satış (tüm zamanlar)
    const satisToplam = await pool.query(`
      SELECT ${satisTip} AS tip,
             SUM(CAST(g."QuantitySold"  AS FLOAT)) AS qty,
             SUM(CAST(g."NetSalesValue" AS FLOAT)) AS rev,
             COUNT(DISTINCT g."StoreNumber")       AS magaza
      FROM gunluk_satis g
      LEFT JOIN magazalar m ON m.teslim_noktasi_id = g."StoreNumber"
      WHERE g."QuantitySold" ~ '^-?[0-9.]+$' AND g."NetSalesValue" ~ '^-?[0-9.]+$'
      GROUP BY 1
    `);

    // Günlük satış (en son tarih)
    const satisGunluk = satisTarihi ? await pool.query(`
      SELECT ${satisTip} AS tip,
             SUM(CAST(g."QuantitySold"  AS FLOAT)) AS qty,
             SUM(CAST(g."NetSalesValue" AS FLOAT)) AS rev,
             COUNT(DISTINCT g."StoreNumber")       AS magaza
      FROM gunluk_satis g
      LEFT JOIN magazalar m ON m.teslim_noktasi_id = g."StoreNumber"
      WHERE g."DateTransaction" = $1
        AND g."QuantitySold" ~ '^-?[0-9.]+$' AND g."NetSalesValue" ~ '^-?[0-9.]+$'
      GROUP BY 1
    `, [satisTarihi]) : { rows: [] };

    // Stok (en son tarih, yalnızca mağazalar DEPO_TUR='MA')
    const stok = stokTarihi ? await pool.query(`
      SELECT ${stokTip} AS tip,
             SUM(CAST(s."STOK_MIKTARI" AS FLOAT)) AS stok,
             SUM(CAST(s."STOK_TUTARI"  AS FLOAT)) AS tutar,
             COUNT(DISTINCT s."TESLIM_NOKTASI_ID") AS magaza,
             COUNT(DISTINCT CASE WHEN CAST(s."STOK_MIKTARI" AS FLOAT) = 0 THEN s."TESLIM_NOKTASI_ID" END) AS raf_bos
      FROM stok s
      LEFT JOIN magazalar m ON m.teslim_noktasi_id = s."TESLIM_NOKTASI_ID"
      WHERE s.veri_tarihi = $1 AND s."DEPO_TUR" = 'MA'
        AND s."STOK_MIKTARI" ~ '^-?[0-9.]+$'
      GROUP BY 1
    `, [stokTarihi]) : { rows: [] };

    res.json({
      satisTarihi, stokTarihi,
      satisToplam: satisToplam.rows,
      satisGunluk: satisGunluk.rows,
      stok: stok.rows,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── MÜKERRER SATIŞ TEŞHİSİ ───────────────────────────────────────────────────
// gunluk_satis'te mükerrer engelleyici unique index var ama Postgres'te NULL'lar
// birbirinden farklı sayılır: dört anahtar kolondan biri (özellikle
// BarcodeNumber) NULL ise ON CONFLICT DO NOTHING hiç eşleşmez ve aynı satır
// her yeniden çekimde tekrar yazılır. Bu uç, önce ne olduğunu gösterir.
app.get('/api/satis-mukerrer', async (req, res) => {
  try {
    const tarih = req.query.tarih || null;
    const p = tarih ? [tarih] : [];
    const nerede = tarih ? `WHERE "DateTransaction" = $1` : '';

    const [ozet, gunler, indeks] = await Promise.all([
      pool.query(`
        WITH gruplar AS (
          SELECT "DateTransaction" AS tarih, "StoreNumber" AS magaza,
                 "SupplierItemNumber" AS sku, "BarcodeNumber" AS barkod,
                 COUNT(*) AS adet,
                 SUM(CASE WHEN "QuantitySold" ~ '^-?[0-9.]+$'
                          THEN CAST("QuantitySold" AS FLOAT) ELSE 0 END) AS qty,
                 SUM(CASE WHEN "NetSalesValue" ~ '^-?[0-9.]+$'
                          THEN CAST("NetSalesValue" AS FLOAT) ELSE 0 END) AS rev
          FROM gunluk_satis ${nerede}
          GROUP BY 1,2,3,4 HAVING COUNT(*) > 1
        )
        SELECT COUNT(*) AS mukerrer_grup,
               COALESCE(SUM(adet - 1), 0) AS fazla_satir,
               -- fazlalık payı: her gruptaki fazla kopyaların taşıdığı miktar
               COALESCE(SUM(qty * (adet - 1) / adet), 0) AS fazla_qty,
               COALESCE(SUM(rev * (adet - 1) / adet), 0) AS fazla_rev,
               COUNT(*) FILTER (WHERE barkod IS NULL) AS barkod_null_grup
        FROM gruplar`, p),
      // Hangi günler etkilenmiş + o günün toplamı ne kadar şişmiş
      pool.query(`
        WITH gruplar AS (
          SELECT "DateTransaction" AS tarih, "StoreNumber" AS magaza,
                 "SupplierItemNumber" AS sku, "BarcodeNumber" AS barkod,
                 COUNT(*) AS adet,
                 SUM(CASE WHEN "QuantitySold" ~ '^-?[0-9.]+$'
                          THEN CAST("QuantitySold" AS FLOAT) ELSE 0 END) AS qty
          FROM gunluk_satis
          GROUP BY 1,2,3,4 HAVING COUNT(*) > 1
        )
        SELECT tarih, COUNT(*) AS grup, SUM(adet - 1) AS fazla_satir,
               ROUND(SUM(qty * (adet - 1) / adet)::numeric, 2) AS fazla_qty
        FROM gruplar GROUP BY tarih ORDER BY tarih DESC LIMIT 30`),
      // Unique index gerçekten var mı? (oluşturma hatası sessizce yutuluyordu)
      pool.query(`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'gunluk_satis'`),
    ]);

    // Tarih verildiyse o günün detayı: anahtar mükerrer yoksa şişme başka
    // yerden geliyordur — aynı mağaza+SKU'nun farklı barkodlarla tekrarlaması
    // ya da aynı günün farklı tarih formatlarında iki kez durması gibi.
    let detay = null;
    if (tarih) {
      const [y, m, d] = tarih.split('-');
      const varyant = [tarih, `${m}/${d}/${y}%`, `${tarih}%`, `${d}.${m}.${y}%`];
      const [gun, ayniMagazaSku, tarihVaryant] = await Promise.all([
        pool.query(`
          SELECT "SupplierItemNumber" AS sku, COUNT(*) AS satir,
                 COUNT(DISTINCT "StoreNumber") AS magaza,
                 SUM(CASE WHEN "QuantitySold" ~ '^-?[0-9.]+$'
                          THEN CAST("QuantitySold" AS FLOAT) ELSE 0 END) AS qty,
                 SUM(CASE WHEN "NetSalesValue" ~ '^-?[0-9.]+$'
                          THEN CAST("NetSalesValue" AS FLOAT) ELSE 0 END) AS rev
          FROM gunluk_satis WHERE "DateTransaction" = $1
          GROUP BY 1`, [tarih]),
        // Aynı mağaza+SKU birden çok satırda: barkodlar farklıysa anahtar
        // mükerreri yakalamaz ama satış iki kez sayılıyor olabilir.
        pool.query(`
          SELECT "StoreNumber" AS magaza, "SupplierItemNumber" AS sku,
                 COUNT(*) AS satir,
                 ARRAY_AGG(DISTINCT "BarcodeNumber") AS barkodlar,
                 SUM(CASE WHEN "QuantitySold" ~ '^-?[0-9.]+$'
                          THEN CAST("QuantitySold" AS FLOAT) ELSE 0 END) AS qty
          FROM gunluk_satis WHERE "DateTransaction" = $1
          GROUP BY 1,2 HAVING COUNT(*) > 1
          ORDER BY 3 DESC LIMIT 50`, [tarih]),
        // Aynı gün farklı formatlarda duruyor mu (2026-09-03 vs 09/03/2026)
        pool.query(`
          SELECT "DateTransaction" AS tarih_degeri, COUNT(*) AS satir,
                 SUM(CASE WHEN "QuantitySold" ~ '^-?[0-9.]+$'
                          THEN CAST("QuantitySold" AS FLOAT) ELSE 0 END) AS qty
          FROM gunluk_satis
          WHERE "DateTransaction" = $1 OR "DateTransaction" LIKE $2
             OR "DateTransaction" LIKE $3 OR "DateTransaction" LIKE $4
          GROUP BY 1 ORDER BY 1`, varyant),
      ]);
      detay = {
        skuBazinda: gun.rows,
        ayniMagazaSkuCoklu: ayniMagazaSku.rows,
        tarihVaryantlari: tarihVaryant.rows,
      };
    }

    res.json({
      tarih: tarih || 'tüm zamanlar',
      ozet: ozet.rows[0],
      detay,
      etkilenenGunler: gunler.rows,
      indeksler: indeks.rows,
    });
  } catch(e) {
    console.error('satis-mukerrer hata:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Mükerrer satırları siler; her gruptan EN DÜŞÜK id kalır.
// Geri alınamaz — bu yüzden gövdede {onay:"SIL"} ve tarih zorunlu.
app.post('/api/satis-mukerrer-temizle', async (req, res) => {
  const { onay, tarih, anahtar } = req.body || {};
  // anahtar='tam'        → DateTransaction+StoreNumber+SupplierItemNumber+BarcodeNumber
  // anahtar='magaza-sku' → BarcodeNumber HARİÇ. Aynı gün/mağaza/SKU birden çok
  //   satırdaysa satış çift sayılıyor demektir; barkod farklı geldiği için
  //   dört kolonluk anahtar bunu mükerrer saymaz. Önce /api/satis-mukerrer
  //   çıktısındaki ayniMagazaSkuCoklu listesine bakıp öyle kullanın.
  const ANAHTARLAR = {
    tam: '"DateTransaction", "StoreNumber", "SupplierItemNumber", "BarcodeNumber"',
    'magaza-sku': '"DateTransaction", "StoreNumber", "SupplierItemNumber"',
  };
  const bolum = ANAHTARLAR[anahtar || 'tam'];
  if (!bolum) {
    return res.status(400).json({ error: 'anahtar "tam" veya "magaza-sku" olmalı.' });
  }
  if (onay !== 'SIL' && onay !== 'DENEME') {
    return res.status(400).json({
      error: 'onay "DENEME" (hiçbir şey silmez, sayıyı verir) veya "SIL" olmalı.',
      ornek: { onay: 'DENEME', tarih: 'YYYY-MM-DD', anahtar: 'magaza-sku' },
    });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih || '')) {
    return res.status(400).json({ error: 'Geçerli bir tarih gerekli (YYYY-MM-DD). Tüm tabloyu tek seferde temizlemiyoruz.' });
  }
  try {
    const fazlalar = `
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY ${bolum}
            ORDER BY id
          ) AS sira
          FROM gunluk_satis WHERE "DateTransaction" = $1
        ) t WHERE sira > 1`;

    // Deneme modu: hiçbir şey silmez, ne kadar temizleneceğini gösterir
    if (onay === 'DENEME') {
      const d = await pool.query(`
        SELECT COUNT(*) AS silinecek,
               SUM(CASE WHEN "QuantitySold" ~ '^-?[0-9.]+$'
                        THEN CAST("QuantitySold" AS FLOAT) ELSE 0 END) AS dusecek_qty,
               SUM(CASE WHEN "NetSalesValue" ~ '^-?[0-9.]+$'
                        THEN CAST("NetSalesValue" AS FLOAT) ELSE 0 END) AS dusecek_rev
        FROM gunluk_satis WHERE id IN (${fazlalar})`, [tarih]);
      const kalan = await pool.query(`
        SELECT SUM(CASE WHEN "QuantitySold" ~ '^-?[0-9.]+$'
                        THEN CAST("QuantitySold" AS FLOAT) ELSE 0 END) AS mevcut_qty
        FROM gunluk_satis WHERE "DateTransaction" = $1`, [tarih]);
      return res.json({
        deneme: true, tarih, anahtar: anahtar || 'tam',
        ...d.rows[0], mevcut_qty: kalan.rows[0].mevcut_qty,
      });
    }

    const r = await pool.query(`
      DELETE FROM gunluk_satis WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY ${bolum}
            ORDER BY id
          ) AS sira
          FROM gunluk_satis WHERE "DateTransaction" = $1
        ) t WHERE sira > 1
      )`, [tarih]);
    console.log(`🧹 Mükerrer temizlik ${tarih} (anahtar=${anahtar || 'tam'}): ${r.rowCount} satır silindi`);
    res.json({ tarih, anahtar: anahtar || 'tam', silinen: r.rowCount });
  } catch(e) {
    console.error('mukerrer-temizle hata:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── SATIŞ ÖZETİ (sunucu tarafı toplamlar) ────────────────────────────────────
// /api/db-gunluk satır bazlı ve LIMIT 20000'li; istemcide toplanınca kümülatif
// ciro sessizce eksik çıkıyordu. Buradaki toplamlar SQL'de, limitsiz hesaplanır
// ve e-posta raporuyla aynı evreni kullanır (tüm satırlar, tarih filtresi yok).
// Üç küme de küçük olduğu için grafikler de bunlardan beslenebilir.
app.get('/api/satis-ozet', async (req, res) => {
  const hatalar = [];
  const guvenli = (sql, params) => pool.query(sql, params).catch(e => {
    console.error('satis-ozet alt sorgu hatası:', e.message);
    hatalar.push(e.message);
    return { rows: [] };
  });
  const NUM = `"NetSalesValue" ~ '^-?[0-9.]+$' AND "QuantitySold" ~ '^-?[0-9.]+$'`;
  const QTY = `SUM(CASE WHEN ${NUM} THEN CAST("QuantitySold"  AS FLOAT) ELSE 0 END)`;
  const REV = `SUM(CASE WHEN ${NUM} THEN CAST("NetSalesValue" AS FLOAT) ELSE 0 END)`;

  // İsteğe bağlı dönem filtresi. DateTransaction TEXT ve ISO formatta olduğu
  // için metin karşılaştırması doğru sıralar; bozuk tarihli satırlar filtre
  // verildiğinde regex koşuluyla zaten dışarıda kalır.
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const from = ISO.test(req.query.from || '') ? req.query.from : null;
  const to   = ISO.test(req.query.to   || '') ? req.query.to   : null;
  const params = [];
  let donem = '';
  if (from || to) {
    donem += ` AND "DateTransaction" ~ '^\\d{4}-\\d{2}-\\d{2}'`;
    if (from) { params.push(from); donem += ` AND "DateTransaction" >= $${params.length}`; }
    if (to)   { params.push(to);   donem += ` AND "DateTransaction" <= $${params.length}`; }
  }
  try {
    // Sorgular birbirinden bağımsız: biri hata verirse yalnızca o küme boş
    // döner, yanıtın tamamı çökmez (Dashboard KPI'ları urunler+genel'e bakıyor).
    const [urun, gun, magaza, genel] = await Promise.all([
      guvenli(`
        SELECT "SupplierItemNumber" AS sku,
               MAX("SupplierItemName")             AS urun_adi,
               ${QTY} AS qty, ${REV} AS rev,
               COUNT(DISTINCT "StoreNumber")       AS magaza,
               MIN("DateTransaction")              AS ilk,
               MAX("DateTransaction")              AS son
        FROM gunluk_satis WHERE 1=1${donem} GROUP BY 1`, params),
      guvenli(`
        SELECT "DateTransaction" AS tarih, "SupplierItemNumber" AS sku,
               ${QTY} AS qty, ${REV} AS rev,
               COUNT(DISTINCT "StoreNumber") AS magaza
        FROM gunluk_satis
        WHERE "DateTransaction" ~ '^\\d{4}-\\d{2}-\\d{2}'
        GROUP BY 1, 2 ORDER BY 1`), // dönemden bağımsız: daima tüm geçmiş
      guvenli(`
        SELECT g."StoreNumber" AS id, "SupplierItemNumber" AS sku,
               MAX(g."StoreName") AS magaza_adi, m.il, m.bolge,
               ${tipCoalesce('m.tip', 'MAX(g."StoreName")')} AS tip,
               ${QTY} AS qty, ${REV} AS rev,
               MAX(g."DateTransaction") AS son_satis
        FROM gunluk_satis g
        LEFT JOIN magazalar m ON m.teslim_noktasi_id = g."StoreNumber"
        WHERE 1=1${donem}
        GROUP BY g."StoreNumber", "SupplierItemNumber", m.il, m.bolge, m.tip`, params),
      // Bu blok DAİMA tüm veriyi sayar (dönem filtresi uygulanmaz): bozuk
      // tarihli satır sayacı, ISO filtresi eklenirse tanımı gereği hep 0 çıkar.
      // Toplamın kaçı bozuk tarihli satırlardan geliyor — iki rapor ayrışırsa
      // farkın buradan gelip gelmediği tek bakışta görülsün diye ayrı veriliyor.
      guvenli(`
        SELECT COUNT(DISTINCT "StoreNumber") AS magaza_sayisi,
               COUNT(DISTINCT "DateTransaction") FILTER
                 (WHERE "DateTransaction" ~ '^\\d{4}-\\d{2}-\\d{2}') AS gun_sayisi,
               COUNT(*) FILTER (WHERE "DateTransaction" !~ '^\\d{4}-\\d{2}-\\d{2}'
                                   OR "DateTransaction" IS NULL) AS bozuk_tarih_satir,
               COUNT(*) FILTER (WHERE NOT (${NUM}))               AS sayisal_olmayan_satir,
               COUNT(*) AS toplam_satir
        FROM gunluk_satis`),
    ]);

    res.json({
      urunler: urun.rows,
      gunluk:  gun.rows,
      magazalar: magaza.rows,
      genel: genel.rows[0] || {},
      hatalar,
    });
  } catch(e) {
    console.error('satis-ozet hata:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GÜNLÜK STOK DURUMU (SKU kırılımlı) ───────────────────────────────────────
// Seçilen güne kadarki stok geçmişinden, mağaza × SKU bazında:
//   miktar   — o gündeki stok
//   bos_gun  — o SKU'nun rafta en son >0 görüldüğü günden bu yana geçen gün
// Dağıtım merkezi / iade / bloke depoları HİÇ girmez (yalnızca DEPO_TUR='MA').
app.get('/api/gunluk-stok-durum', async (req, res) => {
  try {
    const t = await pool.query(`
      SELECT MAX(veri_tarihi) AS son FROM stok
      WHERE veri_tarihi ~ '^\\d{4}-\\d{2}-\\d{2}'
        AND ($1::text IS NULL OR veri_tarihi <= $1)
    `, [req.query.tarih || null]);
    const tarih = t.rows[0]?.son || null;
    if (!tarih) return res.json({ tarih: null, satirlar: [] });

    const rows = await pool.query(`
      WITH ma AS (
        SELECT "TESLIM_NOKTASI_ID" AS id,
               "SATICI_URUN_KODU"  AS sku,
               veri_tarihi,
               SUM(CAST("STOK_MIKTARI" AS FLOAT))              AS miktar,
               MAX("URUN_SATICI_ADI")                          AS urun_adi,
               MAX("TESLIM_NOKTASI_ACIKLAMA")                  AS ad
        FROM stok
        WHERE "DEPO_TUR" = 'MA'
          AND veri_tarihi ~ '^\\d{4}-\\d{2}-\\d{2}'
          AND veri_tarihi <= $1
          AND "STOK_MIKTARI" ~ '^-?[0-9.]+$'
        GROUP BY 1, 2, 3
      ),
      ozet AS (
        SELECT id, sku,
               MAX(urun_adi)                              AS urun_adi,
               MAX(ad)                                    AS ad,
               MAX(veri_tarihi) FILTER (WHERE miktar > 0) AS son_stok_tarihi,
               COUNT(*)                                   AS kayit_gun
        FROM ma GROUP BY id, sku
      ),
      guncel AS (
        SELECT id, sku, miktar FROM ma WHERE veri_tarihi = $1
      )
      SELECT o.id, o.sku, o.urun_adi,
             COALESCE(m.magaza_adi, o.ad)  AS magaza_adi,
             m.il, m.bolge,
             ${tipCoalesce('m.tip', 'o.ad')} AS tip,
             COALESCE(g.miktar, 0)         AS miktar,
             (g.id IS NOT NULL)            AS kayit_var,
             o.son_stok_tarihi, o.kayit_gun,
             CASE WHEN o.son_stok_tarihi IS NULL THEN NULL
                  ELSE ($1::date - o.son_stok_tarihi::date) END AS bos_gun
      FROM ozet o
      LEFT JOIN magazalar m ON m.teslim_noktasi_id = o.id
      LEFT JOIN guncel g    ON g.id = o.id AND g.sku = o.sku
    `, [tarih]);

    res.json({ tarih, satirlar: rows.rows });
  } catch(e) {
    console.error('gunluk-stok-durum hata:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── STOK BULUNURLUĞU ─────────────────────────────────────────────────────────
// Tamamen stok geçmişinden hesaplanır (satış verisi kullanılmaz).
// Her mağaza teslim noktası (DEPO_TUR='MA') için:
//   guncel_stok    — son snapshot'taki miktar
//   son_stok_tarihi— stoğun > 0 görüldüğü EN SON gün (hiç görülmediyse NULL)
//   stoksuz_gun    — son snapshot ile son_stok_tarihi arasındaki gün farkı
// stoksuz_gun yalnızca elimizdeki snapshot aralığı kadar geriye gidebilir;
// bu yüzden yanıt 'gecmis' bloğunda kapsama penceresini de döndürür ve
// hiç stok görülmemiş mağazalar için istemci "≥ N gün" gösterir.
app.get('/api/stok-bulunurluk', async (req, res) => {
  try {
    const g = await pool.query(`
      SELECT MIN(veri_tarihi) AS ilk, MAX(veri_tarihi) AS son,
             COUNT(DISTINCT veri_tarihi) AS gun
      FROM stok WHERE veri_tarihi ~ '^\\d{4}-\\d{2}-\\d{2}'
    `);
    const gecmis = g.rows[0] || {};
    if (!gecmis.son) return res.json({ gecmis: { ilk: null, son: null, gun: 0 }, satirlar: [] });

    // Ortalama günlük satışın paydası için satış verisinin son günü
    const sRes = await pool.query(`
      SELECT MAX("DateTransaction") AS son FROM gunluk_satis
      WHERE "DateTransaction" ~ '^\\d{4}-\\d{2}-\\d{2}'
    `);
    const satisSon = sRes.rows[0]?.son || null;

    // Satırlar mağaza × SKU bazında döner; "her iki üründe de yok" birleşimini
    // istemci hesaplar (SUM>0 mantığı = SKU'ların son stok tarihlerinin MAX'ı).
    const rows = await pool.query(`
      WITH ma AS (
        SELECT "TESLIM_NOKTASI_ID" AS id,
               "SATICI_URUN_KODU"  AS sku,
               veri_tarihi,
               SUM(CAST("STOK_MIKTARI" AS FLOAT)) AS miktar,
               SUM(CASE WHEN "STOK_TUTARI" ~ '^-?[0-9.]+$'
                        THEN CAST("STOK_TUTARI" AS FLOAT) ELSE 0 END) AS tutar,
               MAX("URUN_SATICI_ADI")        AS urun_adi,
               MAX("TESLIM_NOKTASI_ACIKLAMA") AS ad
        FROM stok
        WHERE "DEPO_TUR" = 'MA'
          AND veri_tarihi ~ '^\\d{4}-\\d{2}-\\d{2}'
          AND "STOK_MIKTARI" ~ '^-?[0-9.]+$'
        GROUP BY 1, 2, 3
      ),
      -- Mağaza seviyesi: SKU'lardan bağımsız kimlik ve geçmiş derinliği
      nokta AS (
        SELECT id, MAX(ad) AS ad, MIN(veri_tarihi) AS ilk_kayit,
               COUNT(DISTINCT veri_tarihi) AS kayit_gun
        FROM ma GROUP BY id
      ),
      sku_liste AS (
        SELECT sku, MAX(urun_adi) AS urun_adi FROM ma GROUP BY sku
      ),
      ozet AS (
        SELECT id, sku,
               MAX(veri_tarihi) FILTER (WHERE miktar > 0) AS son_stok_tarihi,
               COUNT(*) FILTER (WHERE miktar > 0)         AS stoklu_gun
        FROM ma GROUP BY id, sku
      ),
      guncel AS (
        SELECT id, sku, miktar AS guncel_stok, tutar AS guncel_tutar
        FROM ma WHERE veri_tarihi = $1
      ),
      -- Geçmiş satış ortalaması: payda, mağazanın İLK satışından satış
      -- verisinin son gününe kadarki takvim günü. Böylece sonradan açılan
      -- mağazalar, hiç listelenmedikleri günlerle cezalandırılmıyor.
      sat AS (
        SELECT "StoreNumber" AS id,
               "SupplierItemNumber" AS sku,
               SUM(CAST("QuantitySold" AS FLOAT)) AS toplam_qty,
               MIN("DateTransaction")             AS ilk_satis,
               MAX("DateTransaction")             AS son_satis,
               COUNT(DISTINCT "DateTransaction")  AS satis_gun
        FROM gunluk_satis
        WHERE "DateTransaction" ~ '^\\d{4}-\\d{2}-\\d{2}'
          AND "QuantitySold" ~ '^-?[0-9.]+$'
        GROUP BY 1, 2
      )
      SELECT n.id, sl.sku, sl.urun_adi,
             COALESCE(m.magaza_adi, n.ad)                     AS magaza_adi,
             m.il, m.bolge,
             ${tipCoalesce('m.tip', 'n.ad')}                  AS tip,
             COALESCE(gc.guncel_stok, 0)                      AS guncel_stok,
             COALESCE(gc.guncel_tutar, 0)                     AS guncel_tutar,
             (o.id IS NOT NULL)                               AS sku_kaydi_var,
             o.son_stok_tarihi, n.ilk_kayit,
             COALESCE(o.stoklu_gun, 0)                        AS stoklu_gun,
             n.kayit_gun,
             CASE WHEN o.son_stok_tarihi IS NULL THEN NULL
                  ELSE ($1::date - o.son_stok_tarihi::date) END AS stoksuz_gun,
             COALESCE(sa.toplam_qty, 0) AS toplam_qty,
             COALESCE(sa.satis_gun, 0)  AS satis_gun,
             sa.ilk_satis, sa.son_satis,
             CASE WHEN sa.toplam_qty IS NULL OR sa.ilk_satis IS NULL THEN NULL
                  ELSE sa.toplam_qty
                       / GREATEST(($2::date - sa.ilk_satis::date) + 1, 1) END AS ort_gunluk_satis
      FROM nokta n
      CROSS JOIN sku_liste sl
      LEFT JOIN magazalar m ON m.teslim_noktasi_id = n.id
      LEFT JOIN ozet o      ON o.id = n.id AND o.sku = sl.sku
      LEFT JOIN guncel gc   ON gc.id = n.id AND gc.sku = sl.sku
      LEFT JOIN sat sa      ON sa.id = n.id AND sa.sku = sl.sku
    `, [gecmis.son, satisSon || gecmis.son]);

    res.json({
      gecmis: { ilk: gecmis.ilk, son: gecmis.son, gun: Number(gecmis.gun), satisSon },
      satirlar: rows.rows,
    });
  } catch(e) {
    console.error('stok-bulunurluk hata:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── BULUNURLUK RAPORU ────────────────────────────────────────────────────────
// Hedef evren: magazalar tablosundaki MM / MMM / 5M / MACRO mağazaları.
// Her mağaza için: seçili dönem satışı, tüm zaman satışı, güncel stok.
// Durum: bulunuyor (dönemde satış veya stok>0) / daha_once (eskiden satış) / hic
const BULUNURLUK_TIPLER = ['MM', 'MMM', 'MACRO', 'MACROCENTER', 'HİPER', 'HIPER'];
const PERIYOT_GUN = { gun: 0, '7gun': 6, ay: 29 };

app.get('/api/bulunurluk', async (req, res) => {
  try {
    const periyot = PERIYOT_GUN[req.query.periyot] !== undefined ? req.query.periyot : 'gun';
    const geriGun = PERIYOT_GUN[periyot];

    const satisSonRes = await pool.query(`
      SELECT MAX("DateTransaction") AS son FROM gunluk_satis
      WHERE "DateTransaction" ~ '^\\d{4}-\\d{2}-\\d{2}'
    `);
    const satisSon = satisSonRes.rows[0]?.son || null;
    const stokSonRes = await pool.query(`SELECT MAX(veri_tarihi) AS son FROM stok`);
    const stokTarihi = stokSonRes.rows[0]?.son || null;

    if (!satisSon) {
      return res.json({ periyot, baslangic: null, bitis: null, stokTarihi, magazalar: [] });
    }
    // Dönem başlangıcı = son satış tarihi - geriGun
    const basRes = await pool.query(`SELECT ($1::date - $2::int)::text AS bas`, [satisSon, geriGun]);
    const baslangic = basRes.rows[0].bas;

    const rows = await pool.query(`
      WITH hedef AS (
        SELECT teslim_noktasi_id AS id, magaza_adi, il, bolge,
               UPPER(tip) AS tip_ham,
               ${normMagazaTip('tip')} AS tip
        FROM magazalar
        WHERE UPPER(tip) = ANY($3)
      ),
      s_donem AS (
        SELECT "StoreNumber" AS id,
               SUM(CAST("QuantitySold"  AS FLOAT)) AS qty,
               SUM(CAST("NetSalesValue" AS FLOAT)) AS rev,
               COUNT(DISTINCT "DateTransaction")   AS gun_sayisi
        FROM gunluk_satis
        WHERE "DateTransaction" >= $1 AND "DateTransaction" <= $2
          AND "QuantitySold" ~ '^-?[0-9.]+$' AND "NetSalesValue" ~ '^-?[0-9.]+$'
        GROUP BY 1
      ),
      s_tum AS (
        SELECT "StoreNumber" AS id,
               SUM(CAST("QuantitySold"  AS FLOAT)) AS qty,
               SUM(CAST("NetSalesValue" AS FLOAT)) AS rev,
               MAX("DateTransaction")              AS son_satis
        FROM gunluk_satis
        WHERE "DateTransaction" ~ '^\\d{4}-\\d{2}-\\d{2}'
          AND "QuantitySold" ~ '^-?[0-9.]+$' AND "NetSalesValue" ~ '^-?[0-9.]+$'
        GROUP BY 1
      ),
      st AS (
        SELECT "TESLIM_NOKTASI_ID" AS id,
               SUM(CAST("STOK_MIKTARI" AS FLOAT)) AS stok,
               SUM(CAST("STOK_TUTARI"  AS FLOAT)) AS tutar
        FROM stok
        WHERE veri_tarihi = $4 AND "STOK_MIKTARI" ~ '^-?[0-9.]+$'
        GROUP BY 1
      )
      SELECT h.id, h.magaza_adi, h.il, h.bolge, h.tip,
             COALESCE(d.qty, 0)  AS donem_qty,
             COALESCE(d.rev, 0)  AS donem_rev,
             COALESCE(d.gun_sayisi, 0) AS satis_gun,
             COALESCE(t.qty, 0)  AS tum_qty,
             COALESCE(t.rev, 0)  AS tum_rev,
             t.son_satis,
             st.stok, st.tutar AS stok_tutar,
             (st.id IS NOT NULL) AS stok_kaydi_var
      FROM hedef h
      LEFT JOIN s_donem d ON d.id = h.id
      LEFT JOIN s_tum   t ON t.id = h.id
      LEFT JOIN st        ON st.id = h.id
    `, [baslangic, satisSon, BULUNURLUK_TIPLER, stokTarihi]);

    res.json({
      periyot, baslangic, bitis: satisSon, stokTarihi,
      magazalar: rows.rows,
    });
  } catch(e) {
    console.error('bulunurluk hata:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Stok karşılaştırma — iki tarih arasındaki farklar
app.get('/api/stok-karsilastirma', async (req, res) => {
  try {
    const { tarih1, tarih2 } = req.query;
    // Tarih verilmezse son 2 tarihi al
    let t1 = tarih1, t2 = tarih2;
    if (!t1 || !t2) {
      const dates = await pool.query(`SELECT DISTINCT veri_tarihi FROM stok WHERE veri_tarihi IS NOT NULL ORDER BY veri_tarihi DESC LIMIT 2`);
      if (dates.rows.length < 2) return res.json({ error: 'Karşılaştırma için en az 2 gün veri gerekli', dates: dates.rows.map(r => r.veri_tarihi) });
      t2 = dates.rows[0].veri_tarihi; // yeni
      t1 = dates.rows[1].veri_tarihi; // eski
    }
    const [r1, r2] = await Promise.all([
      pool.query(stokSelectSQL(), [t1]),
      pool.query(stokSelectSQL(), [t2])
    ]);
    res.json({ tarih1: t1, tarih2: t2, eski: r1.rows, yeni: r2.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ========== KAYDET ==========

app.post('/api/kaydet-stok', async (req, res) => {
  const data = req.body.data;
  if (!data || !data.length) return res.json({ success: false, message: 'Veri yok' });
  try {
    const veriTarihi = trYesterday();
    const stamped = data.map(row => ({ ...row, veri_tarihi: veriTarihi }));
    const count = await saveToDatabase('stok', stamped);
    res.json({ success: true, message: count + ' kayıt eklendi (' + veriTarihi + ')' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// Excel'den geçmiş satış içe aktarma
// Tarih string'ini YYYY-MM-DD formatına normalize et
function normalizeDateStr(val) {
  if (!val) return val;
  const s = String(val).trim();
  // Zaten YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // MM/DD/YYYY veya MM/DD/YYYY HH:MM:SS
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
  // DD.MM.YYYY
  const dmy = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  return s.slice(0, 10);
}

app.post('/api/import-excel-satis', async (req, res) => {
  const data = req.body.data;
  if (!data || !data.length) return res.json({ inserted: 0 });
  try {
    // gunluk_satis tablosunda gerekli kolonları güvenceye al
    const keyCols = ['DateTransaction','SupplierName','SupplierItemNumber','ItemNumber',
      'SupplierItemName','BarcodeNumber','StoreName','StoreNumber',
      'QuantitySold','TotalWeight','NetSalesValue','Metrics'];
    await ensureColumns('gunluk_satis', keyCols);

    let inserted = 0;
    let skipped = 0;
    for (const row of data) {
      try {
        // DateTransaction formatını normalize et
        if (row.DateTransaction) row.DateTransaction = normalizeDateStr(row.DateTransaction);
        // Sadece string/number değerleri al, diğerlerini null yap
        const safeRow = {};
        for (const [k, v] of Object.entries(row)) {
          safeRow[k] = (v === '' || v === undefined || v === null) ? null
            : (typeof v === 'object') ? String(v) : v;
        }
        const cols = Object.keys(safeRow).map(k => '"' + k + '"').join(',');
        const values = Object.values(safeRow);
        // ON CONFLICT yerine NULL-güvenli kontrol — bkz. saveToDatabase notu
        const anahtar = DEDUP_KEYS.gunluk_satis;
        const alanlar = Object.keys(safeRow);
        const kosul = anahtar
          .map(k => alanlar.includes(k)
            ? `"${k}" IS NOT DISTINCT FROM $${alanlar.indexOf(k) + 1}`
            : `"${k}" IS NULL`)
          .join(' AND ');
        const secim = alanlar.map((_, i) => `$${i + 1}::text`).join(',');
        const r = await pool.query(
          `INSERT INTO gunluk_satis (${cols})
           SELECT ${secim}
           WHERE NOT EXISTS (SELECT 1 FROM gunluk_satis WHERE ${kosul})`, values
        );
        inserted += r.rowCount;
      } catch(e) { skipped++; }
    }
    res.json({ success: true, inserted, skipped });
  } catch(e) {
    console.error('import-excel-satis hata:', e.message);
    res.status(500).json({ success: false, message: e.message, inserted: 0 });
  }
});

// ── Mağaza referans listesi (Excel: MagazaListe) ─────────────────────────────
async function ensureMagazalarTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS magazalar (
      teslim_noktasi_id TEXT PRIMARY KEY,
      tip         TEXT,   -- Excel F (ACIKLAMA): M, MM, MMM, MACRO, 5M, MJET, DEPO...
      tip_kodu    TEXT,   -- Excel E (TIP) sayısal kod
      tur         TEXT,   -- Excel H (ACIKLAMA1): MIGROS
      magaza_adi  TEXT,
      il          TEXT,
      bolge       TEXT,
      adres       TEXT,
      tel         TEXT,
      posta_kodu  TEXT,
      enlem       TEXT,
      boylam      TEXT,
      harita_link TEXT,
      updatedat   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

app.post('/api/import-magaza-liste', async (req, res) => {
  const data = req.body.data;
  if (!data || !data.length) return res.json({ success: true, inserted: 0, updated: 0 });
  try {
    await ensureMagazalarTable();
    let count = 0;
    for (const r of data) {
      const id = String(r.teslim_noktasi_id || '').trim();
      if (!id) continue;
      const q = await pool.query(`
        INSERT INTO magazalar
          (teslim_noktasi_id, tip, tip_kodu, tur, magaza_adi, il, bolge, adres, tel, posta_kodu, enlem, boylam, harita_link, updatedat)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CURRENT_TIMESTAMP)
        ON CONFLICT (teslim_noktasi_id) DO UPDATE SET
          tip=$2, tip_kodu=$3, tur=$4, magaza_adi=$5, il=$6, bolge=$7, adres=$8,
          tel=$9, posta_kodu=$10, enlem=$11, boylam=$12, harita_link=$13, updatedat=CURRENT_TIMESTAMP
      `, [id, r.tip||null, r.tip_kodu||null, r.tur||null, r.magaza_adi||null, r.il||null,
          r.bolge||null, r.adres||null, r.tel||null, r.posta_kodu||null, r.enlem||null,
          r.boylam||null, r.harita_link||null]);
      count += q.rowCount;
    }
    res.json({ success: true, saved: count });
  } catch(e) {
    console.error('import-magaza-liste hata:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// Mağaza listesi özeti (import doğrulaması için)
app.get('/api/magaza-liste-ozet', async (req, res) => {
  try {
    await ensureMagazalarTable();
    const toplam = await pool.query(`SELECT COUNT(*) AS cnt FROM magazalar`);
    const tipler = await pool.query(`SELECT tip, COUNT(*) AS cnt FROM magazalar GROUP BY tip ORDER BY cnt DESC`);
    // stok/satış eşleşme oranı
    const stokMatch = await pool.query(`
      SELECT COUNT(DISTINCT s."TESLIM_NOKTASI_ID") AS eslesen
      FROM stok s JOIN magazalar m ON m.teslim_noktasi_id = s."TESLIM_NOKTASI_ID"
      WHERE s.veri_tarihi = (SELECT MAX(veri_tarihi) FROM stok)
    `);
    const satisMatch = await pool.query(`
      SELECT COUNT(DISTINCT g."StoreNumber") AS eslesen
      FROM gunluk_satis g JOIN magazalar m ON m.teslim_noktasi_id = g."StoreNumber"
    `);
    res.json({
      toplam: parseInt(toplam.rows[0].cnt) || 0,
      tipler: tipler.rows,
      stokEslesen: parseInt(stokMatch.rows[0]?.eslesen) || 0,
      satisEslesen: parseInt(satisMatch.rows[0]?.eslesen) || 0,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/kaydet-gunluk', async (req, res) => {
  let data = req.body.data;
  if (!data || !data.length) return res.json({ success: false, message: 'Veri yok' });
  try {
    if (data[0] && data[0].SalesList) data = data.flatMap(i => i.SalesList || []);
    // DateTransaction formatını normalize et
    data = data.map(row => row.DateTransaction
      ? { ...row, DateTransaction: normalizeDateStr(row.DateTransaction) }
      : row
    );
    const count = await saveToDatabase('gunluk_satis', data);
    res.json({ success: true, message: count + ' kayıt eklendi' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ========== AGENT ==========

async function agentFetch(endpoint, name) {
  let agentToken = '', agentCC = '';
  await new Promise(resolve => {
    const postData = JSON.stringify({ username: CONFIG.USERNAME, password: CONFIG.PASSWORD });
    const req = https.request({
      hostname: 'api-prod.migros.com.tr', port: 443,
      path: '/rest/b2b/api/v1/auth/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: 30000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { const r = JSON.parse(d); if (r.token) { agentToken = r.token; agentCC = r.connectionCode||''; console.log('✅ Agent login başarılı'); } } catch(e) {}
        resolve();
      });
    });
    req.on('error', () => resolve());
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.end(postData);
  });
  if (!agentToken) return null;

  return new Promise(resolve => {
    const cc = sha1(agentCC + CONFIG.USERNAME);
    let sent = false;
    const req = https.request({
      hostname: 'api-prod.migros.com.tr', port: 443,
      path: '/rest/b2b/api/v1' + endpoint, method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': agentToken, 'ConnectionCode': cc },
      timeout: 300000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (sent) return; sent = true;
        try {
          const r = JSON.parse(d);
          if (r.data) { console.log(`✅ ${name}: ${r.data.length} kayıt`); resolve(r); }
          else { console.error(`❌ ${name}:`, JSON.stringify(r).slice(0,200)); resolve(null); }
        } catch(e) { resolve(null); }
      });
    });
    req.on('error',   () => { if (!sent) { sent=true; resolve(null); } });
    req.on('timeout', () => { if (!sent) { sent=true; req.destroy(); console.error(`❌ ${name}: Timeout`); resolve(null); } });
    req.end();
  });
}

app.post('/api/agent-stok', async (req, res) => {
  console.log('🔧 Manuel Stok çekme tetiklendi');
  res.json({ status: 'started', message: 'Stok çekme başladı.' });
  (async () => {
    const r = await agentFetch(`/report/get-stok/?pageno=1&saticiid=${CONFIG.SATICI_ID}&iade=H`, 'Stok');
    let count = 0;
    if (r && r.data) {
      const veriTarihi = trYesterday();
      const stamped = r.data.map(row => ({ ...row, veri_tarihi: veriTarihi }));
      count = await saveToDatabase('stok', stamped);
    }
    console.log(`✅ Stok: ${count} kayıt`);
    await logToDb('Manuel Stok', count > 0 ? 'BAŞARILI' : 'BAŞARISIZ', count, `Stok: ${count}`);
  })();
});

app.post('/api/agent-gunluk', async (req, res) => {
  console.log('🔧 Manuel Günlük Satış çekme tetiklendi');
  res.json({ status: 'started', message: 'Günlük Satış çekme başladı.' });
  (async () => {
    const yesterday = trYesterday();
    const r = await agentFetch(`/report/get-gunluk-satis?pageno=1&raporBaslangic=${yesterday}&raporBitis=${yesterday}&saticiIds=${CONFIG.SATICI_ID}`, 'Günlük Satış');
    let count = 0;
    if (r && r.data) {
      let flat = r.data;
      if (flat.length > 0 && flat[0].SalesList) flat = flat.flatMap(i => i.SalesList || []);
      count = await saveToDatabase('gunluk_satis', flat);
    }
    console.log(`✅ Günlük Satış: ${count} kayıt`);
    await logToDb('Manuel Günlük Satış', count > 0 ? 'BAŞARILI' : 'BAŞARISIZ', count, `Günlük Satış: ${count}`);
  })();
});

app.post('/api/agent-calistir', async (req, res) => {
  res.json({ status: 'started', message: 'Stok ve Günlük Satış çekme başladı.' });
  (async () => {
    const sr = await agentFetch(`/report/get-stok/?pageno=1&saticiid=${CONFIG.SATICI_ID}&iade=H`, 'Stok');
    let sc = 0;
    if (sr && sr.data) sc = await saveToDatabase('stok', sr.data);

    const yesterday = trYesterday();
    const gr = await agentFetch(`/report/get-gunluk-satis?pageno=1&raporBaslangic=${yesterday}&raporBitis=${yesterday}&saticiIds=${CONFIG.SATICI_ID}`, 'Günlük Satış');
    let gc = 0;
    if (gr && gr.data) {
      let flat = gr.data;
      if (flat.length > 0 && flat[0].SalesList) flat = flat.flatMap(i => i.SalesList || []);
      gc = await saveToDatabase('gunluk_satis', flat);
    }
    await logToDb('Manuel Çekme', 'BAŞARILI', sc+gc, `Stok: ${sc}, Günlük Satış: ${gc}`);
  })();
});

// ========== API ==========

// Bozuk tarihli satış kayıtlarını temizle
app.delete('/api/temizle-bozuk-tarih', async (req, res) => {
  try {
    const r = await pool.query(`
      DELETE FROM gunluk_satis
      WHERE "DateTransaction" IS NULL
         OR "DateTransaction" = ''
         OR "DateTransaction" NOT SIMILAR TO '[0-9]{4}-[0-9]{2}-[0-9]{2}%'
    `);
    res.json({ success: true, deleted: r.rowCount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/gunluk-satis-temizle', async (req, res) => {
  try {
    await pool.query('TRUNCATE TABLE gunluk_satis RESTART IDENTITY');
    res.json({ success: true, message: 'gunluk_satis tablosu temizlendi' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Stok veri_tarihi düzelt: createdat'a göre TR günü ata
app.post('/api/fix-stok-tarih', async (req, res) => {
  try {
    const r = await pool.query(`
      UPDATE stok
      SET veri_tarihi = (createdat AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul')::DATE::TEXT
      WHERE createdat IS NOT NULL
    `);
    res.json({ success: true, updated: r.rowCount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/fix-date-format', async (req, res) => {
  try {
    const r = await pool.query(`
      UPDATE gunluk_satis
      SET "DateTransaction" = TO_CHAR(TO_DATE("DateTransaction", 'MM/DD/YYYY'), 'YYYY-MM-DD')
      WHERE "DateTransaction" LIKE '%/%'
    `);
    res.json({ success: true, updated: r.rowCount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString(), env: CONFIG.NODE_ENV }));

// ========== EMAIL ==========

app.post('/api/trigger-email', async (req, res) => {
  const apiKey   = process.env.RESEND_API_KEY;
  const emailTo  = process.env.EMAIL_TO;
  const emailFrom = process.env.EMAIL_FROM || 'rapor@kittycady.com';

  if (!apiKey || !emailTo) {
    return res.status(400).json({ success: false, message: 'RESEND_API_KEY veya EMAIL_TO env var eksik' });
  }

  try {
    const date = trYesterday();
    const data = await buildEmailData(pool, date);
    const html = buildEmailHTML(data);
    await resendSend(apiKey, emailFrom, emailTo, `Migros Günlük Rapor · ${formatDateTR(date)}`, html);
    console.log(`✅ Manuel email gönderildi → ${emailTo}`);
    await logToDb('Manuel Email', 'BAŞARILI', 0, `Günlük rapor gönderildi: ${date}`);
    res.json({ success: true, message: `Rapor gönderildi: ${emailTo}`, date });
  } catch(e) {
    console.error('❌ Email hatası:', e.message);
    await logToDb('Manuel Email', 'HATA', 0, e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  const success = await loginMigros();
  res.json({ success, message: success ? 'Login başarılı' : 'Login başarısız' });
});

app.get('/api/cekme-loglari', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM cekme_loglari ORDER BY cekme_tarihi DESC LIMIT 100');
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/istatistikler', async (req, res) => {
  try {
    const gs = await pool.query('SELECT COUNT(*) as count FROM gunluk_satis');
    const st = await pool.query('SELECT COUNT(*) as count FROM stok');
    const cl = await pool.query(`SELECT COUNT(*) as count FROM cekme_loglari WHERE durum='BAŞARILI'`);
    res.json({
      gunlukSatis:    parseInt(gs.rows[0].count),
      isleticiSatis:  0,
      stok:           parseInt(st.rows[0].count),
      basariliCekme:  parseInt(cl.rows[0].count)
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/gunluk-satis-analiz', async (req, res) => {
  try {
    const { startDate, endDate, storeType } = req.query;
    const params = [];
    let where = '';
    if (startDate) { params.push(startDate); where += ` AND "DateTransaction"::date >= $${params.length}::date`; }
    if (endDate)   { params.push(endDate);   where += ` AND "DateTransaction"::date <= $${params.length}::date`; }
    if (storeType) { params.push(storeType); where += ` AND "StoreType" = $${params.length}`; }
    const r = await pool.query(`SELECT * FROM gunluk_satis WHERE 1=1${where} LIMIT 10000`, params);
    res.json(analyzeGunlukSatis(r.rows));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stok-analiz', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM stok ORDER BY id DESC LIMIT 1000');
    res.json({ total: r.rows.length, topItems: r.rows.slice(0,20) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ========== ANALİZ ==========

function analyzeGunlukSatis(data) {
  if (!data || !data.length) return { totalSales:0, totalItems:0, transactionCount:0, avgOrder:0, dailySales:{}, storeTypes:{}, topProducts:[], topStores:[] };
  const totalSales = data.reduce((s,i) => s + parseFloat(i.NetSalesValue||0), 0);
  const totalItems = data.reduce((s,i) => s + parseInt(i.QuantitySold||0), 0);
  const dailySales = {}, storeTypes = {}, products = {}, stores = {};
  data.forEach(item => {
    const date = (item.DateTransaction||'').split(' ')[0];
    dailySales[date] = (dailySales[date]||0) + parseFloat(item.NetSalesValue||0);
    const type = item.StoreType==='1'?'MMM':item.StoreType==='2'?'MM':'M';
    storeTypes[type] = (storeTypes[type]||0) + 1;
    const pk = item.SupplierItemName;
    if (!products[pk]) products[pk] = { name:pk, quantity:0, sales:0 };
    products[pk].quantity += parseInt(item.QuantitySold||0);
    products[pk].sales    += parseFloat(item.NetSalesValue||0);
    const sk = item.StoreName;
    if (!stores[sk]) stores[sk] = { name:sk, storeNumber:item.StoreNumber, sales:0, count:0 };
    stores[sk].sales += parseFloat(item.NetSalesValue||0);
    stores[sk].count++;
  });
  return {
    totalSales: Math.round(totalSales*100)/100, totalItems,
    transactionCount: data.length,
    avgOrder: Math.round((totalSales/data.length)*100)/100,
    dailySales, storeTypes,
    topProducts: Object.values(products).sort((a,b)=>b.quantity-a.quantity).slice(0,20),
    topStores:   Object.values(stores).sort((a,b)=>b.sales-a.sales).slice(0,20)
  };
}

// ========== START ==========

async function startServer() {
  try {
    await initializeDatabase();
    await initializeFinanceTables(pool);
    await ensureMagazalarTable();   // /api/db-gunluk join'i için tablo hazır olmalı
    // Login'i arka planda yap — başlamayı bloklama
    loginMigros().then(ok => {
      if (ok) console.log('✅ Migros login başarılı');
      else console.warn('⚠️ Migros login başarısız, sonraki istekte yeniden denenecek');
    }).catch(() => {});
    app.listen(CONFIG.PORT, () => {
      console.log(`\n🚀 Server: http://localhost:${CONFIG.PORT} | DB: PostgreSQL | Satıcı: ${CONFIG.SATICI_ID}\n`);
    });
  } catch(err) {
    console.error('❌ Server başlama hatası:', err);
    process.exit(1);
  }
}

// SPA fallback — tüm bilinmeyen route'ları React'a yönlendir
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/report') || req.path === '/tools') return;
  res.sendFile(path.join(clientDist, 'index.html'));
});

startServer();
module.exports = app;
