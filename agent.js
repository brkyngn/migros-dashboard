const https = require('https');
const { Pool } = require('pg');
require('dotenv').config();

const CONFIG = {
  USERNAME:  process.env.MIGROS_USERNAME,
  PASSWORD:  process.env.MIGROS_PASSWORD,
  SATICI_ID: process.env.SATICI_ID,
  NODE_ENV:  process.env.NODE_ENV || 'development'
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let token = '';
let connectionCodeRaw = '';

// Tabloları oluştur
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gunluk_satis (
      id SERIAL PRIMARY KEY,
      "DateTransaction" TEXT, "SupplierCode" TEXT, "SupplierName" TEXT,
      "StoreType" TEXT, "StoreNumber" TEXT, "StoreName" TEXT,
      "SupplierStoreNumber" TEXT, "BarcodeNumber" TEXT, "ItemNumber" TEXT,
      "SupplierItemNumber" TEXT, "SupplierItemName" TEXT,
      "QuantitySold" TEXT, "TotalWeight" TEXT, "NetSalesValue" TEXT,
      "createdat" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stok (
      id SERIAL PRIMARY KEY,
      "createdat" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cekme_loglari (
      id SERIAL PRIMARY KEY,
      raport_adi TEXT, durum TEXT, satir_sayisi INTEGER, mesaj TEXT,
      cekme_tarihi TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ PostgreSQL tabloları hazır');
}

// SHA1
function sha1(str) {
  return require('crypto').createHash('sha1').update(str).digest('hex');
}

// Login
async function login() {
  return new Promise(resolve => {
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
        try {
          const r = JSON.parse(d);
          if (r.token) { token = r.token; connectionCodeRaw = r.connectionCode||''; console.log('✅ Login başarılı'); resolve(true); }
          else { console.error('❌ Login başarısız:', r.message); resolve(false); }
        } catch(e) { resolve(false); }
      });
    });
    req.on('error',   () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end(postData);
  });
}

// API'den veri çek
function fetchData(endpoint, reportName) {
  return new Promise(resolve => {
    if (!token) { resolve(null); return; }
    const cc = sha1(connectionCodeRaw + CONFIG.USERNAME);
    let sent = false;
    const req = https.request({
      hostname: 'api-prod.migros.com.tr', port: 443,
      path: '/rest/b2b/api/v1' + endpoint, method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': token, 'ConnectionCode': cc },
      timeout: 120000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (sent) return; sent = true;
        try {
          const r = JSON.parse(d);
          if (r.data) { console.log(`✅ ${reportName}: ${r.data.length} kayıt`); resolve(r); }
          else { console.error(`❌ ${reportName}:`, JSON.stringify(r).slice(0,200)); resolve(null); }
        } catch(e) { console.error(`❌ ${reportName}: Parse hatası`); resolve(null); }
      });
    });
    req.on('error',   () => { if (!sent) { sent=true; resolve(null); } });
    req.on('timeout', () => { if (!sent) { sent=true; req.destroy(); console.error(`❌ ${reportName}: Timeout`); resolve(null); } });
    req.end();
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

// DB'ye kaydet
async function saveToDatabase(tableName, data) {
  if (!data || !data.length) return 0;
  const keys = Object.keys(data[0]);
  await ensureColumns(tableName, keys);
  let count = 0;
  const cols = keys.map(k => '"' + k + '"').join(',');
  const placeholders = keys.map((_, i) => '$' + (i+1)).join(',');
  for (const row of data) {
    const values = keys.map(k => row[k] !== undefined ? row[k] : null);
    try {
      const r = await pool.query(`INSERT INTO ${tableName} (${cols}) VALUES (${placeholders})`, values);
      count += r.rowCount;
    } catch(e) { /* skip */ }
  }
  return count;
}

// Log ekle
async function logToDb(raporAdi, durum, satirSayisi, mesaj) {
  try {
    await pool.query(
      'INSERT INTO cekme_loglari (raport_adi, durum, satir_sayisi, mesaj) VALUES ($1,$2,$3,$4)',
      [raporAdi, durum, satirSayisi, mesaj]
    );
  } catch(e) {}
}

// Günlük Satış çek
async function fetchGunlukSatis() {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const r = await fetchData(
    `/report/get-gunluk-satis?pageno=1&raporBaslangic=${yesterday}&raporBitis=${yesterday}&saticild=${CONFIG.SATICI_ID}`,
    'Günlük Satış'
  );
  if (!r || !r.data) return 0;
  let flat = r.data;
  if (flat.length > 0 && flat[0].SalesList) flat = flat.flatMap(i => i.SalesList || []);
  return saveToDatabase('gunluk_satis', flat);
}

// Stok çek
async function fetchStok() {
  const r = await fetchData(
    `/report/get-stok/?pageno=1&saticiid=${CONFIG.SATICI_ID}&iade=H`,
    'Stok'
  );
  if (!r || !r.data) return 0;
  // Verinin temsil ettiği tarih = dün
  const veriTarihi = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const stamped = r.data.map(row => ({ ...row, veri_tarihi: veriTarihi }));
  return saveToDatabase('stok', stamped);
}

// Günlük Satış çalıştır
async function runGunlukSatis() {
  console.log('\n📊 Günlük Satış çekme başladı:', new Date().toLocaleString('tr-TR'));
  const ok = await login();
  if (!ok) { await logToDb('Günlük Satış', 'BAŞARISIZ', 0, 'Login başarısız'); return; }
  try {
    const count = await fetchGunlukSatis();
    console.log(`   → Günlük Satış: ${count} kayıt`);
    await logToDb('Günlük Satış', 'BAŞARILI', count, `Günlük Satış: ${count}`);
  } catch(e) {
    console.error('❌ Günlük Satış hatası:', e.message);
    await logToDb('Günlük Satış', 'HATA', 0, e.message);
  }
}

// Stok çalıştır
async function runStok() {
  console.log('\n📦 Stok çekme başladı:', new Date().toLocaleString('tr-TR'));
  const ok = await login();
  if (!ok) { await logToDb('Stok', 'BAŞARISIZ', 0, 'Login başarısız'); return; }
  try {
    const count = await fetchStok();
    console.log(`   → Stok: ${count} kayıt`);
    await logToDb('Stok', 'BAŞARILI', count, `Stok: ${count}`);
  } catch(e) {
    console.error('❌ Stok hatası:', e.message);
    await logToDb('Stok', 'HATA', 0, e.message);
  }
}

// Scheduler — Günlük Satış 06:00, Stok 06:15
function startScheduler() {
  console.log('\n⏰ Scheduler başladı. Günlük Satış: 06:00 | Stok: 06:15\n');
  setInterval(() => {
    const h = new Date().getHours();
    const m = new Date().getMinutes();
    if (h === 6 && m === 0)  runGunlukSatis();
    if (h === 6 && m === 15) runStok();
  }, 60000);
}

async function start() {
  console.log(`
============================================================
🚀 Migros B2B Otomatik Veri Çekme Agenti
============================================================
👤 Kullanıcı: ${CONFIG.USERNAME}
🏢 Satıcı ID: ${CONFIG.SATICI_ID}
⏰ Günlük Satış: 06:00 | Stok: 06:15
🌍 Environment: ${CONFIG.NODE_ENV}
============================================================
  `);
  try {
    await initDatabase();
    startScheduler();
  } catch(e) {
    console.error('❌ Agent başlama hatası:', e);
    process.exit(1);
  }
}

start();
