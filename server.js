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
app.use('/frontend', express.static(path.join(__dirname, 'frontend')));

const CONFIG = {
  MIGROS_API: process.env.MIGROS_API || 'https://api-prod.migros.com.tr/rest/b2b/api/v1',
  USERNAME:   process.env.MIGROS_USERNAME,
  PASSWORD:   process.env.MIGROS_PASSWORD,
  SATICI_ID:  process.env.SATICI_ID,
  PORT:       process.env.PORT || 3000,
  NODE_ENV:   process.env.NODE_ENV || 'development'
};

// PostgreSQL bağlantısı
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let token = '';
let connectionCodeRaw = '';

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
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d);
          if (r.token) { token = r.token; connectionCodeRaw = r.connectionCode || ''; console.log('✅ Migros Login başarılı'); resolve(true); }
          else { console.error('❌ Login başarısız:', r.message); resolve(false); }
        } catch(e) { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
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

// ========== KAYDET ==========

app.post('/api/kaydet-stok', async (req, res) => {
  const data = req.body.data;
  if (!data || !data.length) return res.json({ success: false, message: 'Veri yok' });
  try {
    const veriTarihi = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const stamped = data.map(row => ({ ...row, veri_tarihi: veriTarihi }));
    const count = await saveToDatabase('stok', stamped);
    res.json({ success: true, message: count + ' kayıt eklendi (' + veriTarihi + ')' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// Excel'den geçmiş satış içe aktarma
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
    for (const row of data) {
      const cols = Object.keys(row).map(k => '"' + k + '"').join(',');
      const vals = Object.keys(row).map((_, i) => '$' + (i + 1)).join(',');
      const values = Object.values(row).map(v => v === '' ? null : v);
      try {
        const r = await pool.query(
          `INSERT INTO gunluk_satis (${cols}) VALUES (${vals})`, values
        );
        inserted += r.rowCount;
      } catch(e) { /* satır zaten var veya format hatası, atla */ }
    }
    res.json({ success: true, inserted });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/kaydet-gunluk', async (req, res) => {
  let data = req.body.data;
  if (!data || !data.length) return res.json({ success: false, message: 'Veri yok' });
  try {
    if (data[0] && data[0].SalesList) data = data.flatMap(i => i.SalesList || []);
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
      timeout: 120000
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
      const veriTarihi = new Date(Date.now() - 86400000).toISOString().split('T')[0];
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
    const yesterday = new Date(Date.now()-86400000).toISOString().split('T')[0];
    const r = await agentFetch(`/report/get-gunluk-satis?pageno=1&raporBaslangic=${yesterday}&raporBitis=${yesterday}&saticild=${CONFIG.SATICI_ID}`, 'Günlük Satış');
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

    const yesterday = new Date(Date.now()-86400000).toISOString().split('T')[0];
    const gr = await agentFetch(`/report/get-gunluk-satis?pageno=1&raporBaslangic=${yesterday}&raporBitis=${yesterday}&saticild=${CONFIG.SATICI_ID}`, 'Günlük Satış');
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

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString(), env: CONFIG.NODE_ENV }));

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
    await loginMigros();
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
