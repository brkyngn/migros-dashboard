const express = require('express');
const https = require('https');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// Ana sayfa
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Konfigürasyon
const CONFIG = {
  MIGROS_API: process.env.MIGROS_API || 'https://api-prod.migros.com.tr/rest/b2b/api/v1',
  USERNAME: process.env.MIGROS_USERNAME,
  PASSWORD: process.env.MIGROS_PASSWORD,
  SATICI_ID: process.env.SATICI_ID,
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '../data/migros-data.db'),
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development'
};

let token = '';
let connectionCodeRaw = '';
let db = null;

// Database başlat
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    // Data klasörü oluştur
    const dataDir = path.dirname(CONFIG.DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    db = new sqlite3.Database(CONFIG.DB_PATH, (err) => {
      if (err) {
        console.error('❌ Database bağlantı hatası:', err.message);
        reject(err);
        return;
      }

      console.log('✅ Database bağlantısı kuruldu');

      // Tabloları oluştur
      db.serialize(() => {
        db.run(`
          CREATE TABLE IF NOT EXISTS gunluk_satis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            DateTransaction TEXT,
            SupplierCode TEXT,
            SupplierName TEXT,
            StoreType TEXT,
            StoreNumber TEXT,
            StoreName TEXT,
            SupplierStoreNumber TEXT,
            BarcodeNumber TEXT,
            ItemNumber TEXT,
            SupplierItemNumber TEXT,
            SupplierItemName TEXT,
            QuantitySold TEXT,
            TotalWeight TEXT,
            NetSalesValue TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(DateTransaction, SupplierCode, ItemNumber, StoreNumber)
          )
        `);

        db.run(`
          CREATE TABLE IF NOT EXISTS isletici_satis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            FisNo TEXT,
            FisTarihi TEXT,
            TeslimNoktasiKodu TEXT,
            TeslimNoktasiAdi TEXT,
            SaticiKodu TEXT,
            SaticiAdi TEXT,
            ToplamTutar TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(FisNo, TeslimNoktasiKodu)
          )
        `);

        db.run(`
          CREATE TABLE IF NOT EXISTS stok (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            SaticiId TEXT,
            MalNo TEXT,
            MalAdi TEXT,
            StokMiktari TEXT,
            Birim TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(SaticiId, MalNo)
          )
        `);

        db.run(`
          CREATE TABLE IF NOT EXISTS cekme_loglari (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raport_adi TEXT,
            durum TEXT,
            satir_sayisi INTEGER,
            mesaj TEXT,
            cekme_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
      });

      resolve();
    });
  });
}

// SHA1 hash
async function sha1(str) {
  const crypto = require('crypto');
  return crypto.createHash('sha1').update(str).digest('hex');
}

// Login - Migros API'ye
async function loginMigros() {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      username: CONFIG.USERNAME,
      password: CONFIG.PASSWORD
    });

    const options = {
      hostname: 'api-prod.migros.com.tr',
      port: 443,
      path: '/rest/b2b/api/v1/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.token) {
            token = response.token;
            connectionCodeRaw = response.connectionCode || '';
            console.log('✅ Migros Login başarılı');
            resolve(true);
          } else {
            console.error('❌ Login başarısız:', response.message);
            resolve(false);
          }
        } catch (err) {
          console.error('❌ Login parse hatası:', err);
          resolve(false);
        }
      });
    }).on('error', (err) => {
      console.error('❌ Login bağlantı hatası:', err);
      resolve(false);
    }).end(postData);
  });
}

// Migros API'den veri çek
async function fetchFromMigros(endpoint) {
  return new Promise(async (resolve) => {
    if (!token) {
      resolve(null);
      return;
    }

    const hashedConnectionCode = await sha1(connectionCodeRaw + CONFIG.USERNAME);

    const options = {
      hostname: 'api-prod.migros.com.tr',
      port: 443,
      path: endpoint,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token,
        'ConnectionCode': hashedConnectionCode
      },
      timeout: 120000
    };

    https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response);
        } catch (err) {
          console.error('Parse hatası:', err);
          resolve(null);
        }
      });
    }).on('error', (err) => {
      console.error('Bağlantı hatası:', err);
      resolve(null);
    }).end();
  });
}

// Database'e veri kaydet
function saveToDatabase(tableName, data) {
  return new Promise((resolve) => {
    if (!data || data.length === 0) {
      resolve(0);
      return;
    }

    let insertedCount = 0;
    const keys = Object.keys(data[0]);
    const placeholders = keys.map(() => '?').join(',');
    const columns = keys.join(',');

    const stmt = db.prepare(
      `INSERT OR IGNORE INTO ${tableName} (${columns}) VALUES (${placeholders})`
    );

    data.forEach(row => {
      const values = keys.map(key => row[key]);
      stmt.run(values, function(err) {
        if (!err && this.changes > 0) {
          insertedCount++;
        }
      });
    });

    stmt.finalize(() => {
      resolve(insertedCount);
    });
  });
}

// ========== MİGROS API PROXY ==========

// Migros API'ye istek ilet (frontend'den gelen token ile)
function proxyToMigros(reqPath, method, headers, body, res) {
  let sent = false;

  const options = {
    hostname: 'api-prod.migros.com.tr',
    port: 443,
    path: `/rest/b2b/api/v1${reqPath}`,
    method: method,
    headers: { 'Content-Type': 'application/json', ...headers },
    timeout: 120000
  };

  const req = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      if (sent) return;
      sent = true;
      try {
        res.json(JSON.parse(data));
      } catch (e) {
        res.status(500).json({ error: 'Parse hatası' });
      }
    });
  });

  req.on('error', (err) => {
    if (sent) return;
    sent = true;
    res.status(500).json({ error: err.message });
  });

  req.on('timeout', () => {
    if (sent) return;
    sent = true;
    req.destroy();
    res.status(504).json({ error: 'Timeout' });
  });

  if (body) req.write(body);
  req.end();
}

// Login proxy
app.post('/auth/login', (req, res) => {
  const body = JSON.stringify(req.body);
  proxyToMigros('/auth/login', 'POST', { 'Content-Length': Buffer.byteLength(body) }, body, res);
});

// Rapor proxy (GET)
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

// ========== API ENDPOINTS ==========

// ========== MANUEL AGENT TETİKLEME ==========
app.post('/api/agent-calistir', async (req, res) => {
  console.log('🔧 Manuel agent tetiklendi');
  res.json({ status: 'started', message: 'Veri çekme başladı, logları /api/cekme-loglari adresinden takip edin.' });

  // Arka planda çalıştır
  (async () => {
    const crypto = require('crypto');
    const sha1 = str => crypto.createHash('sha1').update(str).digest('hex');

    // Login
    let agentToken = '', agentCC = '';
    await new Promise(resolve => {
      const postData = JSON.stringify({ username: CONFIG.USERNAME, password: CONFIG.PASSWORD });
      const req2 = https.request({
        hostname: 'api-prod.migros.com.tr', port: 443,
        path: '/rest/b2b/api/v1/auth/login', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
        timeout: 30000
      }, res2 => {
        let d = '';
        res2.on('data', c => d += c);
        res2.on('end', () => {
          try {
            const r = JSON.parse(d);
            if (r.token) { agentToken = r.token; agentCC = r.connectionCode || ''; console.log('✅ Agent login başarılı'); }
            else console.error('❌ Agent login başarısız:', r.message);
          } catch(e) { console.error('❌ Agent login parse hatası'); }
          resolve();
        });
      });
      req2.on('error', e => { console.error('❌ Agent login bağlantı hatası:', e.message); resolve(); });
      req2.on('timeout', () => { console.error('❌ Agent login timeout'); req2.destroy(); resolve(); });
      req2.end(postData);
    });

    if (!agentToken) {
      db.run('INSERT INTO cekme_loglari (raport_adi, durum, satir_sayisi, mesaj) VALUES (?,?,?,?)',
        ['Manuel Çekme', 'BAŞARISIZ', 0, 'Login başarısız']);
      return;
    }

    const fetchAgent = (endpoint, name) => new Promise(async resolve => {
      const cc = sha1(agentCC + CONFIG.USERNAME);
      let sent2 = false;
      const req3 = https.request({
        hostname: 'api-prod.migros.com.tr', port: 443,
        path: `/rest/b2b/api/v1${endpoint}`, method: 'GET',
        headers: { 'Content-Type': 'application/json', 'Authorization': agentToken, 'ConnectionCode': cc },
        timeout: 120000
      }, res3 => {
        let d = '';
        res3.on('data', c => d += c);
        res3.on('end', () => {
          if (sent2) return; sent2 = true;
          try {
            const r = JSON.parse(d);
            if (r.data) { console.log(`✅ ${name}: ${r.data.length} kayıt`); resolve(r); }
            else { console.error(`❌ ${name}:`, JSON.stringify(r).slice(0,150)); resolve(null); }
          } catch(e) { console.error(`❌ ${name} parse hatası`); resolve(null); }
        });
      });
      req3.on('error', e => { if (!sent2) { sent2=true; console.error(`❌ ${name}:`, e.message); resolve(null); } });
      req3.on('timeout', () => { if (!sent2) { sent2=true; req3.destroy(); console.error(`❌ ${name}: Timeout`); resolve(null); } });
      req3.end();
    });

    let gunlukCount=0, isleticiCount=0, stokCount=0;

    // Stok
    console.log('📥 Stok çekiliyor...');
    const stokRes = await fetchAgent(`/report/get-stok/?pageno=1&saticiid=${CONFIG.SATICI_ID}&iade=H`, 'Stok');
    if (stokRes && stokRes.data) stokCount = await saveToDatabase('stok', stokRes.data);

    // İşletici Satış
    console.log('📥 İşletici Satış çekiliyor...');
    const today = new Date().toISOString().split('T')[0].split('-').reverse().join('.');
    const isleticiRes = await fetchAgent(`/isleticirapor/rapor?pageno=1&raporBaslangic=${today}&raporBitis=${today}&saticiid=${CONFIG.SATICI_ID}`, 'İşletici Satış');
    if (isleticiRes && isleticiRes.data) {
      let flat = isleticiRes.data;
      if (flat.length > 0 && flat[0].SalesList) flat = flat.flatMap(i => i.SalesList || []);
      isleticiCount = await saveToDatabase('isletici_satis', flat);
    }

    // Günlük Satış
    console.log('📥 Günlük Satış çekiliyor...');
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const gunlukRes = await fetchAgent(`/report/get-gunluk-satis?pageno=1&raporBaslangic=${yesterday}&raporBitis=${yesterday}&saticild=${CONFIG.SATICI_ID}`, 'Günlük Satış');
    if (gunlukRes && gunlukRes.data) {
      let flat = gunlukRes.data;
      if (flat.length > 0 && flat[0].SalesList) flat = flat.flatMap(i => i.SalesList || []);
      gunlukCount = await saveToDatabase('gunluk_satis', flat);
    }

    const total = gunlukCount + isleticiCount + stokCount;
    const mesaj = `Günlük Satış: ${gunlukCount}, İşletici Satış: ${isleticiCount}, Stok: ${stokCount}`;
    console.log(`✅ Manuel çekme tamamlandı: ${total} kayıt — ${mesaj}`);
    db.run('INSERT INTO cekme_loglari (raport_adi, durum, satir_sayisi, mesaj) VALUES (?,?,?,?)',
      ['Manuel Çekme', 'BAŞARILI', total, mesaj]);
  })();
});

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: CONFIG.NODE_ENV
  });
});

// Login
app.post('/api/login', async (req, res) => {
  const success = await loginMigros();
  res.json({
    success,
    message: success ? 'Login başarılı' : 'Login başarısız'
  });
});

// Günlük Satış Analiz
app.get('/api/gunluk-satis-analiz', (req, res) => {
  const { startDate, endDate, storeType } = req.query;

  const conditions = ['1=1'];
  const params = [];

  if (startDate) { conditions.push("DATE(DateTransaction) >= DATE(?)"); params.push(startDate); }
  if (endDate)   { conditions.push("DATE(DateTransaction) <= DATE(?)"); params.push(endDate); }
  if (storeType) { conditions.push("StoreType = ?"); params.push(storeType); }

  const query = `SELECT * FROM gunluk_satis WHERE ${conditions.join(' AND ')} LIMIT 10000`;

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }

    // Verileri işle
    const analysis = analyzeGunlukSatis(rows);
    res.json(analysis);
  });
});

// İşletici Satış Analiz
app.get('/api/isletici-satis-analiz', (req, res) => {
  const { startDate, endDate } = req.query;

  const conditions = ['1=1'];
  const params = [];

  if (startDate) { conditions.push("DATE(FisTarihi) >= DATE(?)"); params.push(startDate); }
  if (endDate)   { conditions.push("DATE(FisTarihi) <= DATE(?)"); params.push(endDate); }

  const query = `SELECT * FROM isletici_satis WHERE ${conditions.join(' AND ')} LIMIT 5000`;

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const analysis = analyzeIsleticiSatis(rows);
    res.json(analysis);
  });
});

// Stok Analiz
app.get('/api/stok-analiz', (req, res) => {
  const query = `
    SELECT * FROM stok 
    WHERE StokMiktari > 0
    ORDER BY StokMiktari DESC
    LIMIT 1000
  `;

  db.all(query, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const analysis = analyzeStok(rows);
    res.json(analysis);
  });
});

// Çekme Logları
app.get('/api/cekme-loglari', (req, res) => {
  const query = `
    SELECT * FROM cekme_loglari 
    ORDER BY cekme_tarihi DESC 
    LIMIT 100
  `;

  db.all(query, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Database İstatistikleri
app.get('/api/istatistikler', (req, res) => {
  const stats = {};

  db.get('SELECT COUNT(*) as count FROM gunluk_satis', (err, row) => {
    stats.gunlukSatis = row?.count || 0;

    db.get('SELECT COUNT(*) as count FROM isletici_satis', (err, row) => {
      stats.isleticiSatis = row?.count || 0;

      db.get('SELECT COUNT(*) as count FROM stok', (err, row) => {
        stats.stok = row?.count || 0;

        db.get('SELECT COUNT(*) as count FROM cekme_loglari WHERE durum = "BAŞARILI"', (err, row) => {
          stats.basariliCekme = row?.count || 0;

          res.json(stats);
        });
      });
    });
  });
});

// ========== ANALIZ FONKSİYONLARI ==========

function analyzeGunlukSatis(data) {
  if (!data || data.length === 0) {
    return {
      totalSales: 0,
      totalItems: 0,
      transactionCount: 0,
      avgOrder: 0,
      dailySales: {},
      storeTypes: {},
      topProducts: [],
      topStores: []
    };
  }

  const totalSales = data.reduce((sum, item) => sum + parseFloat(item.NetSalesValue || 0), 0);
  const totalItems = data.reduce((sum, item) => sum + parseInt(item.QuantitySold || 0), 0);
  const transactionCount = data.length;

  const dailySales = {};
  data.forEach(item => {
    const date = item.DateTransaction.split(' ')[0];
    dailySales[date] = (dailySales[date] || 0) + parseFloat(item.NetSalesValue || 0);
  });

  const storeTypes = {};
  data.forEach(item => {
    const type = item.StoreType === '1' ? 'MMM' : item.StoreType === '2' ? 'MM' : 'M';
    storeTypes[type] = (storeTypes[type] || 0) + 1;
  });

  const products = {};
  data.forEach(item => {
    const key = item.SupplierItemName;
    if (!products[key]) {
      products[key] = {
        name: item.SupplierItemName,
        quantity: 0,
        sales: 0
      };
    }
    products[key].quantity += parseInt(item.QuantitySold || 0);
    products[key].sales += parseFloat(item.NetSalesValue || 0);
  });

  const topProducts = Object.values(products)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 20);

  const stores = {};
  data.forEach(item => {
    const key = item.StoreName;
    if (!stores[key]) {
      stores[key] = {
        name: item.StoreName,
        storeNumber: item.StoreNumber,
        sales: 0,
        count: 0
      };
    }
    stores[key].sales += parseFloat(item.NetSalesValue || 0);
    stores[key].count++;
  });

  const topStores = Object.values(stores)
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 20);

  return {
    totalSales: Math.round(totalSales * 100) / 100,
    totalItems,
    transactionCount,
    avgOrder: Math.round((totalSales / transactionCount) * 100) / 100,
    dailySales,
    storeTypes,
    topProducts,
    topStores
  };
}

function analyzeIsleticiSatis(data) {
  if (!data || data.length === 0) {
    return { total: 0, byDate: {}, topStores: [] };
  }

  const byDate = {};
  const topStores = {};

  data.forEach(item => {
    const date = item.FisTarihi.split(' ')[0];
    byDate[date] = (byDate[date] || 0) + 1;

    const store = item.TeslimNoktasiAdi;
    if (!topStores[store]) {
      topStores[store] = 0;
    }
    topStores[store]++;
  });

  return {
    total: data.length,
    byDate,
    topStores: Object.entries(topStores)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  };
}

function analyzeStok(data) {
  if (!data || data.length === 0) {
    return { total: 0, topItems: [] };
  }

  return {
    total: data.length,
    topItems: data.slice(0, 20)
  };
}

// ========== SERVER BAŞLAT ==========

async function startServer() {
  try {
    // Database'i başlat
    await initializeDatabase();

    // Migros'a login yap
    await loginMigros();

    // Server'ı başlat
    app.listen(CONFIG.PORT, () => {
      console.log(`
============================================================
🚀 Migros B2B Backend Server Çalışıyor
============================================================
📍 URL: http://localhost:${CONFIG.PORT}
📊 Database: ${CONFIG.DB_PATH}
🏢 Satıcı ID: ${CONFIG.SATICI_ID}
🌍 Environment: ${CONFIG.NODE_ENV}
============================================================
      `);
    });
  } catch (err) {
    console.error('❌ Server başlama hatası:', err);
    process.exit(1);
  }
}

startServer();

module.exports = app;
