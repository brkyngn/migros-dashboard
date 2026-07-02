const https = require('https');
const { Pool } = require('pg');
const { buildEmailData, buildEmailHTML, resendSend, formatDateTR } = require('./emailReport');
require('dotenv').config();

// Türkiye saatine göre tarih hesapla (UTC+3)
function trToday() {
  const now = new Date();
  const tr = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return tr.toISOString().split('T')[0];
}
function trYesterday() {
  const now = new Date();
  const tr = new Date(now.getTime() + 3 * 60 * 60 * 1000 - 86400000);
  return tr.toISOString().split('T')[0];
}

// Tarih string'ini YYYY-MM-DD formatına normalize et
function normalizeDateStr(val) {
  if (!val) return val;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
  const dmy = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  return s.slice(0, 10);
}


const CONFIG = {
  USERNAME:  process.env.MIGROS_USERNAME,
  PASSWORD:  process.env.MIGROS_PASSWORD,
  SATICI_ID: process.env.SATICI_ID,
  NODE_ENV:  process.env.NODE_ENV || 'development',
  EMAIL_FROM:     process.env.EMAIL_FROM || 'rapor@kittycady.com',
  EMAIL_TO:       process.env.EMAIL_TO,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
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
      timeout: 300000
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
const CONFLICT_CLAUSES = {
  gunluk_satis: 'ON CONFLICT ("DateTransaction","StoreNumber","SupplierItemNumber","BarcodeNumber") DO NOTHING',
};

async function saveToDatabase(tableName, data) {
  if (!data || !data.length) return 0;
  const keys = Object.keys(data[0]);
  await ensureColumns(tableName, keys);
  let count = 0;
  const cols = keys.map(k => '"' + k + '"').join(',');
  const placeholders = keys.map((_, i) => '$' + (i+1)).join(',');
  const conflict = CONFLICT_CLAUSES[tableName] || '';
  for (const row of data) {
    const values = keys.map(k => row[k] !== undefined ? row[k] : null);
    try {
      const r = await pool.query(`INSERT INTO ${tableName} (${cols}) VALUES (${placeholders}) ${conflict}`, values);
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

// Günlük Satış çek — null dönerse API hatası (retry gerekli)
async function fetchGunlukSatis() {
  const yesterday = trYesterday();
  const r = await fetchData(
    `/report/get-gunluk-satis?pageno=1&raporBaslangic=${yesterday}&raporBitis=${yesterday}&saticiIds=${CONFIG.SATICI_ID}`,
    'Günlük Satış'
  );
  if (!r) throw new Error('API yanıt vermedi');
  let flat = r.data || [];
  if (flat.length > 0 && flat[0].SalesList) flat = flat.flatMap(i => i.SalesList || []);
  flat = flat.map(row => ({
    ...row,
    DateTransaction: row.DateTransaction ? normalizeDateStr(row.DateTransaction) : row.DateTransaction
  }));
  return saveToDatabase('gunluk_satis', flat);
}

// next_url'den sadece path'i çıkar
function extractPath(nextUrl) {
  if (!nextUrl) return null;
  const marker = '/rest/b2b/api/v1';
  const idx = nextUrl.indexOf(marker);
  return idx !== -1 ? nextUrl.slice(idx + marker.length) : nextUrl;
}

// Stok çek — tüm sayfaları çeker (pagination)
async function fetchStok() {
  const allData = [];
  let endpoint = `/report/get-stok/?pageno=1&saticiid=${CONFIG.SATICI_ID}&iade=H`;
  let page = 1;

  while (endpoint) {
    const r = await fetchData(endpoint, `Stok sayfa ${page}`);
    if (!r) throw new Error('API yanıt vermedi');
    allData.push(...(r.data || []));
    endpoint = extractPath(r.next_url || r.nextUrl || r.NextUrl || null);
    page++;
    if (page > 20) break; // güvenlik limiti
  }

  console.log(`   → Stok toplam: ${allData.length} kayıt (${page - 1} sayfa)`);
  const veriTarihi = trYesterday();
  const stamped = allData.map(row => ({ ...row, veri_tarihi: veriTarihi }));
  return saveToDatabase('stok', stamped);
}

// Günlük Satış çalıştır — true: başarılı, false: hata (retry)
async function runGunlukSatis() {
  console.log('\n📊 Günlük Satış çekme başladı:', new Date().toLocaleString('tr-TR'));
  const ok = await login();
  if (!ok) {
    await logToDb('Günlük Satış', 'BAŞARISIZ', 0, 'Login başarısız');
    return false;
  }
  try {
    const count = await fetchGunlukSatis();
    console.log(`   → Günlük Satış: ${count} yeni kayıt`);
    await logToDb('Günlük Satış', 'BAŞARILI', count, `Günlük Satış: ${count} kayıt`);
    return true;
  } catch(e) {
    console.error('❌ Günlük Satış hatası:', e.message);
    await logToDb('Günlük Satış', 'HATA', 0, e.message);
    return false;
  }
}

// Stok çalıştır — true: başarılı, false: hata (retry)
async function runStok() {
  console.log('\n📦 Stok çekme başladı:', new Date().toLocaleString('tr-TR'));
  const ok = await login();
  if (!ok) {
    await logToDb('Stok', 'BAŞARISIZ', 0, 'Login başarısız');
    return false;
  }
  try {
    const count = await fetchStok();
    console.log(`   → Stok: ${count} yeni kayıt`);
    await logToDb('Stok', 'BAŞARILI', count, `Stok: ${count} kayıt`);
    return true;
  } catch(e) {
    console.error('❌ Stok hatası:', e.message);
    await logToDb('Stok', 'HATA', 0, e.message);
    return false;
  }
}

// ─── EMAIL ───────────────────────────────────────────────────────────────────

async function sendDailyReport() {
  if (!CONFIG.RESEND_API_KEY || !CONFIG.EMAIL_TO) {
    console.log('⚠️  Email env var eksik (RESEND_API_KEY, EMAIL_TO), mail atlanıyor');
    return;
  }
  console.log('\n📧 Günlük rapor maili hazırlanıyor...');
  try {
    const date = trYesterday();
    const data = await buildEmailData(pool, date);
    const html = buildEmailHTML(data);
    await resendSend(CONFIG.RESEND_API_KEY, CONFIG.EMAIL_FROM, CONFIG.EMAIL_TO,
      `Migros Günlük Rapor · ${formatDateTR(date)}`, html);
    console.log(`✅ Günlük rapor maili gönderildi → ${CONFIG.EMAIL_TO}`);
    await logToDb('Email', 'BAŞARILI', 0, `Günlük rapor gönderildi: ${date}`);
  } catch(e) {
    console.error('❌ Mail gönderme hatası:', e.message);
    await logToDb('Email', 'HATA', 0, e.message);
  }
}

// ─── SCHEDULER ───────────────────────────────────────────────────────────────
// Günlük Satış: 06:00'dan itibaren her 30 dakikada bir, başarılı olana kadar
// Stok:        06:15'ten itibaren her 30 dakikada bir, başarılı olana kadar
// Her ikisi başarılı → günlük rapor maili gönderilir
// Her gece 00:00'da bayraklar sıfırlanır
function startScheduler() {
  let satisBasarili = false;
  let stokBasarili  = false;
  let satisCalisiyor = false;
  let stokCalisiyor  = false;
  let emailGonderildi = false;

  console.log('\n⏰ Scheduler başladı.');
  console.log('   Günlük Satış: 06:00 TR | Stok: 06:15 TR');
  console.log('   Başarısız olursa her 30 dakikada bir yeniden dener');
  console.log('   Her ikisi başarılı → günlük rapor maili gönderilir\n');

  setInterval(() => {
    const now = new Date();
    const trTime = new Date(now.getTime() + 3 * 60 * 60 * 1000); // UTC+3
    const h = trTime.getUTCHours();
    const m = trTime.getUTCMinutes();
    const totalMin = h * 60 + m;

    // Gece yarısı sıfırla
    if (h === 0 && m === 0) {
      satisBasarili  = false;
      stokBasarili   = false;
      emailGonderildi = false;
      console.log('🔄 Günlük bayraklar sıfırlandı');
    }

    // Günlük Satış: 06:00 (360dk), 06:30, 07:00... her 30 dakika
    if (!satisBasarili && !satisCalisiyor && totalMin >= 360 && (totalMin - 360) % 30 === 0) {
      satisCalisiyor = true;
      runGunlukSatis().then(ok => {
        satisCalisiyor = false;
        if (ok) {
          satisBasarili = true;
          console.log('✅ Günlük Satış bugün için tamamlandı');
        } else {
          console.log('⚠️  Günlük Satış başarısız, 30 dakika sonra tekrar denenecek');
        }
        // Her ikisi de başarılıysa mail at
        if (satisBasarili && stokBasarili && !emailGonderildi) {
          emailGonderildi = true;
          sendDailyReport();
        }
      });
    }

    // Stok: 06:15 (375dk), 06:45, 07:15... her 30 dakika
    if (!stokBasarili && !stokCalisiyor && totalMin >= 375 && (totalMin - 375) % 30 === 0) {
      stokCalisiyor = true;
      runStok().then(ok => {
        stokCalisiyor = false;
        if (ok) {
          stokBasarili = true;
          console.log('✅ Stok bugün için tamamlandı');
        } else {
          console.log('⚠️  Stok başarısız, 30 dakika sonra tekrar denenecek');
        }
        // Her ikisi de başarılıysa mail at
        if (satisBasarili && stokBasarili && !emailGonderildi) {
          emailGonderildi = true;
          sendDailyReport();
        }
      });
    }
  }, 60000);
}

async function start() {
  console.log(`
============================================================
🚀 Migros B2B Otomatik Veri Çekme Agenti
============================================================
👤 Kullanıcı: ${CONFIG.USERNAME}
🏢 Satıcı ID: ${CONFIG.SATICI_ID}
⏰ Günlük Satış: 06:00 TR | Stok: 06:15 TR
🔄 Başarısız olursa 30dk'da bir yeniden dener
📧 Mail: ${CONFIG.EMAIL_TO || '(tanımlı değil)'}
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
