const https = require('https');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Konfigürasyon
const CONFIG = {
  MIGROS_API: process.env.MIGROS_API || 'https://api-prod.migros.com.tr/rest/b2b/api/v1',
  USERNAME: process.env.MIGROS_USERNAME,
  PASSWORD: process.env.MIGROS_PASSWORD,
  SATICI_ID: process.env.SATICI_ID,
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '../data/migros-data.db'),
  CHECK_HOURS: [6],
  NODE_ENV: process.env.NODE_ENV || 'development'
};

let token = '';
let connectionCodeRaw = '';
let db = null;

// Database başlat
function initDatabase() {
  return new Promise((resolve, reject) => {
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

      console.log('✅ Database bağlantısı kuruldu:', CONFIG.DB_PATH);

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

// Login
async function login() {
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
      },
      timeout: 30000
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
            console.log('✅ Login başarılı');
            resolve(true);
          } else {
            console.error('❌ Login başarısız:', response.message);
            resolve(false);
          }
        } catch (err) {
          console.error('❌ Login parse hatası');
          resolve(false);
        }
      });
    }).on('error', (err) => {
      console.error('❌ Login bağlantı hatası:', err.message);
      resolve(false);
    }).on('timeout', () => {
      console.error('❌ Login timeout');
      resolve(false);
    }).end(postData);
  });
}

// API'den veri çek
async function fetchData(endpoint, reportName) {
  return new Promise(async (resolve) => {
    if (!token) {
      console.error(`❌ ${reportName}: Token yok`);
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
          if (response.data) {
            console.log(`✅ ${reportName}: ${response.data.length} kayıt çekildi`);
            resolve(response);
          } else {
            console.error(`❌ ${reportName}: ${response.message}`);
            resolve(null);
          }
        } catch (err) {
          console.error(`❌ ${reportName}: Parse hatası`);
          resolve(null);
        }
      });
    }).on('error', (err) => {
      console.error(`❌ ${reportName}: ${err.message}`);
      resolve(null);
    }).on('timeout', () => {
      console.error(`❌ ${reportName}: Timeout`);
      resolve(null);
    }).end();
  });
}

// Database'e kaydet
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

// Log kaydı
function logToDatabase(raporAdi, durum, satirSayisi, mesaj) {
  db.run(
    'INSERT INTO cekme_loglari (raport_adi, durum, satir_sayisi, mesaj) VALUES (?, ?, ?, ?)',
    [raporAdi, durum, satirSayisi, mesaj],
    (err) => {
      if (err) console.error('Log kaydı hatası:', err);
    }
  );
}

// Günlük Satış çek
async function fetchGunlukSatis() {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const raporBaslangic = yesterday.toISOString().split('T')[0];
  const raporBitis = raporBaslangic;

  const endpoint = `/report/get-gunluk-satis?pageno=1&raporBaslangic=${raporBaslangic}&raporBitis=${raporBitis}&saticild=${CONFIG.SATICI_ID}`;
  const response = await fetchData(endpoint, 'Günlük Satış');
  
  if (response && response.data) {
    let flatData = response.data;
    if (response.data.length > 0 && response.data[0].SalesList) {
      flatData = response.data.flatMap(item => item.SalesList || []);
    }
    const savedCount = await saveToDatabase('gunluk_satis', flatData);
    return savedCount;
  }
  return 0;
}

// İşletici Satış çek
async function fetchIsleticiSatis() {
  const today = new Date();
  const raporBaslangic = today.toISOString().split('T')[0].split('-').reverse().join('.');
  const raporBitis = raporBaslangic;

  const endpoint = `/isleticirapor/rapor?pageno=1&raporBaslangic=${raporBaslangic}&raporBitis=${raporBitis}&saticiid=${CONFIG.SATICI_ID}`;
  const response = await fetchData(endpoint, 'İşletici Satış');
  
  if (response && response.data) {
    let flatData = response.data;
    if (response.data.length > 0 && response.data[0].SalesList) {
      flatData = response.data.flatMap(item => item.SalesList || []);
    }
    const savedCount = await saveToDatabase('isletici_satis', flatData);
    return savedCount;
  }
  return 0;
}

// Stok çek
async function fetchStok() {
  const endpoint = `/report/get-stok/?pageno=1&saticiid=${CONFIG.SATICI_ID}&iade=H`;
  const response = await fetchData(endpoint, 'Stok');
  
  if (response && response.data) {
    const savedCount = await saveToDatabase('stok', response.data);
    return savedCount;
  }
  return 0;
}

// Günlük çekme
async function runDailyCollection() {
  console.log('\n📊 Günlük veri çekme başladı:', new Date().toLocaleString('tr-TR'));
  
  const loginSuccess = await login();
  if (!loginSuccess) {
    logToDatabase('Tüm Raporlar', 'BAŞARISIZ', 0, 'Login başarısız');
    console.log('❌ Login başarısız - çekme iptal edildi');
    return;
  }

  try {
    const gunlukCount = await fetchGunlukSatis();
    const isleticiCount = await fetchIsleticiSatis();
    const stokCount = await fetchStok();

    const totalCount = gunlukCount + isleticiCount + stokCount;
    console.log(`✅ Günlük çekme tamamlandı: ${totalCount} kayıt kaydedildi\n`);
    
    logToDatabase('Tüm Raporlar', 'BAŞARILI', totalCount, 
      `Günlük Satış: ${gunlukCount}, İşletici Satış: ${isleticiCount}, Stok: ${stokCount}`);
  } catch (err) {
    console.error('❌ Çekme hatası:', err.message);
    logToDatabase('Tüm Raporlar', 'HATA', 0, err.message);
  }
}

// Scheduler
function startScheduler() {
  console.log(`\n⏰ Scheduler başladı. Çekme saatleri: ${CONFIG.CHECK_HOURS.map(h => h + ':00').join(', ')}`);
  console.log('💡 İlk çekme hemen yapılacak...\n');

  // İlk çekmeyi hemen yap
  runDailyCollection();

  // Her dakika kontrol et
  setInterval(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const minutes = now.getMinutes();

    if (CONFIG.CHECK_HOURS.includes(currentHour) && minutes === 0) {
      runDailyCollection();
    }
  }, 60000);
}

// Ana başlangıç
async function start() {
  console.log(`
============================================================
🚀 Migros B2B Otomatik Veri Çekme Agenti
============================================================
📁 Database: ${CONFIG.DB_PATH}
👤 Kullanıcı: ${CONFIG.USERNAME}
🏢 Satıcı ID: ${CONFIG.SATICI_ID}
⏰ Çekme saatleri: ${CONFIG.CHECK_HOURS.map(h => h + ':00').join(', ')}
🌍 Environment: ${CONFIG.NODE_ENV}
============================================================
  `);

  try {
    await initDatabase();
    startScheduler();
  } catch (err) {
    console.error('❌ Agent başlama hatası:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Agent kapatılıyor...');
  if (db) {
    db.close((err) => {
      if (err) console.error(err);
      else console.log('✅ Database bağlantısı kapatıldı');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

start();
