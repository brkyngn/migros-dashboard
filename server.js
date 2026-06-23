const express = require('express');
const https = require('https');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
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
  `).catch(() => {});

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
      const r = await pool.query(
        `INSERT INTO ${tableName} (${cols}) VALUES (${placeholders})`, values
      );
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

app.get('/api/db-stok', async (req, res) => {
  try {
    // En güncel veri_tarihi'nin kayıtlarını getir
    const latest = await pool.query(`SELECT MAX(veri_tarihi) as son FROM stok`);
    const sonTarih = latest.rows[0]?.son;
    if (!sonTarih) return res.json([]);
    const r = await pool.query('SELECT * FROM stok WHERE veri_tarihi = $1 ORDER BY id LIMIT 5000', [sonTarih]);
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
    const r = await pool.query('SELECT * FROM stok WHERE veri_tarihi = $1 ORDER BY id LIMIT 5000', [tarih]);
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
    const r = await pool.query(`SELECT * FROM gunluk_satis WHERE 1=1${where} ORDER BY "DateTransaction" DESC LIMIT 20000`, params);
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
      pool.query('SELECT * FROM stok WHERE veri_tarihi = $1', [t1]),
      pool.query('SELECT * FROM stok WHERE veri_tarihi = $1', [t2])
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
        const vals = Object.keys(safeRow).map((_, i) => '$' + (i + 1)).join(',');
        const values = Object.values(safeRow);
        const r = await pool.query(
          `INSERT INTO gunluk_satis (${cols}) VALUES (${vals})
           ON CONFLICT ("DateTransaction","StoreNumber","SupplierItemNumber","BarcodeNumber") DO NOTHING`, values
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

const SKU_AC = '41075315';
const SKU_MB = '41075312';
const SKU_NAMES = { [SKU_AC]: 'Active Carbon 5L', [SKU_MB]: 'Marseille Breeze 5L' };

function formatDateTR(d) {
  if (!d) return '';
  const months = ['','Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  const [y, m, day] = d.split('-');
  return `${parseInt(day)} ${months[parseInt(m)]} ${y}`;
}
function fmtTL(n) {
  return '₺' + Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n) {
  return Number(n || 0).toLocaleString('tr-TR');
}

async function buildEmailData(date) {
  const satisRes = await pool.query(`
    SELECT "SupplierItemNumber" AS sku,
           SUM(CAST("QuantitySold" AS FLOAT))  AS total_qty,
           SUM(CAST("NetSalesValue" AS FLOAT)) AS total_rev,
           COUNT(DISTINCT "StoreNumber")       AS store_count
    FROM gunluk_satis WHERE "DateTransaction" = $1
    GROUP BY "SupplierItemNumber"
  `, [date]);

  const satisToplam = satisRes.rows.reduce((a, r) => ({
    qty: a.qty + parseFloat(r.total_qty || 0),
    rev: a.rev + parseFloat(r.total_rev || 0),
  }), { qty: 0, rev: 0 });

  const satisBySku = {};
  satisRes.rows.forEach(r => { satisBySku[r.sku] = r; });

  let stokBySku = {};
  let sifirMagazaCount = 0;
  try {
    const stokCols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'stok'`);
    const cols = stokCols.rows.map(r => r.column_name);
    const skuCol   = cols.includes('SATICI_URUN_KODU') ? '"SATICI_URUN_KODU"' : cols.includes('URUN_SATICI_ADI') ? '"URUN_SATICI_ADI"' : null;
    const qtyCol   = cols.includes('STOK_MIKTARI')    ? '"STOK_MIKTARI"'    : null;
    const storeCol = cols.includes('MAGAZA_NO')        ? '"MAGAZA_NO"'       : cols.includes('StoreNumber') ? '"StoreNumber"' : null;
    if (skuCol && qtyCol && storeCol) {
      const stokRes = await pool.query(`
        SELECT ${skuCol} AS sku,
               SUM(CAST(${qtyCol} AS FLOAT)) AS total_stok,
               COUNT(DISTINCT ${storeCol})   AS magaza_count,
               COUNT(DISTINCT CASE WHEN CAST(${qtyCol} AS FLOAT) = 0 THEN ${storeCol} END) AS sifir_magaza
        FROM stok WHERE veri_tarihi = $1 AND ${skuCol} IN ($2,$3)
        GROUP BY ${skuCol}
      `, [date, SKU_AC, SKU_MB]);
      stokRes.rows.forEach(r => { stokBySku[r.sku] = r; });
      const sifirRes = await pool.query(`
        SELECT ${storeCol} FROM stok WHERE veri_tarihi = $1 AND ${skuCol} IN ($2,$3)
        GROUP BY ${storeCol} HAVING MAX(CAST(${qtyCol} AS FLOAT)) = 0
      `, [date, SKU_AC, SKU_MB]);
      sifirMagazaCount = sifirRes.rowCount;
    }
  } catch(e) { console.error('⚠️ Email stok verisi:', e.message); }

  return { date, satisBySku, satisToplam, stokBySku, sifirMagazaCount };
}

function buildEmailHTML(data) {
  const { date, satisBySku, satisToplam, stokBySku, sifirMagazaCount } = data;
  const skuRows = [SKU_AC, SKU_MB].map(sku => {
    const s = satisBySku[sku] || {};
    const st = stokBySku[sku] || {};
    const qty = parseFloat(s.total_qty || 0), rev = parseFloat(s.total_rev || 0);
    const stores = parseInt(s.store_count || 0), stok = parseFloat(st.total_stok || 0);
    const sifir = parseInt(st.sifir_magaza || 0), totalM = parseInt(st.magaza_count || 0);
    return `<tr>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;font-weight:600;color:#1a3a5c">${SKU_NAMES[sku]}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;text-align:right">${fmtNum(Math.round(qty))}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;text-align:right">${fmtTL(rev)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;text-align:right">${stores}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;text-align:right">${fmtNum(Math.round(stok))}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;text-align:right;color:${sifir > 0 ? '#dc2626' : '#16a34a'}">${sifir} / ${totalM}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;color:#374151">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0"><tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
  <tr><td style="background:linear-gradient(135deg,#1a3a5c 0%,#c0392b 100%);padding:28px 32px">
    <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:rgba(255,255,255,.7);text-transform:uppercase;margin-bottom:6px">Migros B2B · Günlük Rapor</div>
    <div style="font-size:26px;font-weight:800;color:#fff">${formatDateTR(date)}</div>
    <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:4px">Satış ve Stok Özeti</div>
  </td></tr>
  <tr><td style="padding:24px 32px 8px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="33%" style="text-align:center;padding:16px;background:#f9fafb;border-radius:8px">
        <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Toplam Satış</div>
        <div style="font-size:28px;font-weight:800;color:#c0392b">${fmtNum(Math.round(satisToplam.qty))}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:2px">adet</div>
      </td>
      <td width="4%"></td>
      <td width="33%" style="text-align:center;padding:16px;background:#f9fafb;border-radius:8px">
        <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Net Ciro</div>
        <div style="font-size:28px;font-weight:800;color:#16a34a">${fmtTL(satisToplam.rev)}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:2px">TL</div>
      </td>
      <td width="4%"></td>
      <td width="33%" style="text-align:center;padding:16px;background:#f9fafb;border-radius:8px">
        <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Stoksuz Mağaza</div>
        <div style="font-size:28px;font-weight:800;color:${sifirMagazaCount > 0 ? '#dc2626' : '#16a34a'}">${sifirMagazaCount}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:2px">mağaza</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:16px 32px 8px">
    <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px">SKU Bazlı Detay</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#f3f4f6">
        <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase">Ürün</th>
        <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase">Adet</th>
        <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase">Ciro</th>
        <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase">Mağaza</th>
        <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase">Stok</th>
        <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase">0 Stok/Top</th>
      </tr></thead>
      <tbody>${skuRows}</tbody>
    </table>
  </td></tr>
  <tr><td style="padding:20px 32px 28px;border-top:1px solid #f0f0f0;margin-top:8px">
    <div style="font-size:11px;color:#9ca3af;text-align:center">Bu rapor Migros B2B agent tarafından otomatik oluşturulmuştur · ${new Date().toLocaleString('tr-TR')}</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function resendSend(apiKey, to, subject, html) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from: `Migros B2B Rapor <${process.env.EMAIL_FROM || 'rapor@kittycady.com'}>`,
      to: to.split(',').map(e => e.trim()).filter(Boolean),
      subject,
      html,
    });
    const req = https.request({
      hostname: 'api.resend.com', port: 443,
      path: '/emails', method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          if (r.statusCode >= 200 && r.statusCode < 300) resolve(parsed);
          else reject(new Error(parsed.message || JSON.stringify(parsed)));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Resend API timeout')); });
    req.write(body);
    req.end();
  });
}

app.post('/api/trigger-email', async (req, res) => {
  const apiKey  = process.env.RESEND_API_KEY;
  const emailTo = process.env.EMAIL_TO;

  if (!apiKey || !emailTo) {
    return res.status(400).json({ success: false, message: 'RESEND_API_KEY veya EMAIL_TO env var eksik' });
  }

  try {
    const date = trYesterday();
    const data = await buildEmailData(date);
    const html = buildEmailHTML(data);
    await resendSend(apiKey, emailTo, `Migros Günlük Rapor · ${formatDateTR(date)}`, html);
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
