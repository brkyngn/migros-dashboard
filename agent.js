const https = require('https');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
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

// Tarihi Türkçe biçimlendir
function formatDateTR(d) {
  if (!d) return '';
  const months = ['','Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  const [y, m, day] = d.split('-');
  return `${parseInt(day)} ${months[parseInt(m)]} ${y}`;
}

function formatTL(n) {
  return '₺' + Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatNum(n) {
  return Number(n || 0).toLocaleString('tr-TR');
}

const SKU_AC = '41075315';
const SKU_MB = '41075312';
const SKU_NAMES = { [SKU_AC]: 'Active Carbon 5L', [SKU_MB]: 'Marseille Breeze 5L' };

const CONFIG = {
  USERNAME:  process.env.MIGROS_USERNAME,
  PASSWORD:  process.env.MIGROS_PASSWORD,
  SATICI_ID: process.env.SATICI_ID,
  NODE_ENV:  process.env.NODE_ENV || 'development',
  EMAIL_FROM: process.env.EMAIL_FROM,
  EMAIL_TO:   process.env.EMAIL_TO,
  EMAIL_PASS: process.env.EMAIL_PASS,
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

// Stok çek — null dönerse API hatası (retry gerekli)
async function fetchStok() {
  const r = await fetchData(
    `/report/get-stok/?pageno=1&saticiid=${CONFIG.SATICI_ID}&iade=H`,
    'Stok'
  );
  if (!r) throw new Error('API yanıt vermedi');
  const veriTarihi = trYesterday();
  const stamped = (r.data || []).map(row => ({ ...row, veri_tarihi: veriTarihi }));
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

async function buildEmailData(date) {
  // Satış verileri
  const satisRes = await pool.query(`
    SELECT
      "SupplierItemNumber" AS sku,
      SUM(CAST("QuantitySold" AS FLOAT))   AS total_qty,
      SUM(CAST("NetSalesValue" AS FLOAT))  AS total_rev,
      COUNT(DISTINCT "StoreNumber")        AS store_count
    FROM gunluk_satis
    WHERE "DateTransaction" = $1
    GROUP BY "SupplierItemNumber"
  `, [date]);

  const satisToplam = satisRes.rows.reduce((a, r) => ({
    qty: a.qty + parseFloat(r.total_qty || 0),
    rev: a.rev + parseFloat(r.total_rev || 0),
  }), { qty: 0, rev: 0 });

  const satisBySku = {};
  satisRes.rows.forEach(r => { satisBySku[r.sku] = r; });

  // Stok kolonlarını bul (SATICI_URUN_KODU veya URUN_SATICI_ADI'ndan SKU eşle)
  let stokBySku = {};
  let sifirMagazaCount = 0;
  try {
    const stokCols = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'stok'
    `);
    const cols = stokCols.rows.map(r => r.column_name);

    const skuCol   = cols.includes('SATICI_URUN_KODU') ? '"SATICI_URUN_KODU"'
                   : cols.includes('URUN_SATICI_ADI')  ? '"URUN_SATICI_ADI"'
                   : null;
    const qtyCol   = cols.includes('STOK_MIKTARI')    ? '"STOK_MIKTARI"'    : null;
    const storeCol = cols.includes('MAGAZA_NO')        ? '"MAGAZA_NO"'
                   : cols.includes('StoreNumber')      ? '"StoreNumber"'     : null;

    if (skuCol && qtyCol && storeCol) {
      const stokRes = await pool.query(`
        SELECT
          ${skuCol}                                             AS sku,
          SUM(CAST(${qtyCol} AS FLOAT))                        AS total_stok,
          COUNT(DISTINCT ${storeCol})                          AS magaza_count,
          COUNT(DISTINCT CASE WHEN CAST(${qtyCol} AS FLOAT) = 0 THEN ${storeCol} END) AS sifir_magaza
        FROM stok
        WHERE veri_tarihi = $1
          AND ${skuCol} IN ($2, $3)
        GROUP BY ${skuCol}
      `, [date, SKU_AC, SKU_MB]);
      stokRes.rows.forEach(r => { stokBySku[r.sku] = r; });

      // Hiç stok olmayan mağaza: tüm SKU'lar için stok = 0 olan mağazalar
      if (storeCol) {
        const sifirRes = await pool.query(`
          SELECT ${storeCol} AS magaza
          FROM stok
          WHERE veri_tarihi = $1
            AND ${skuCol} IN ($2, $3)
          GROUP BY ${storeCol}
          HAVING MAX(CAST(${qtyCol} AS FLOAT)) = 0
        `, [date, SKU_AC, SKU_MB]);
        sifirMagazaCount = sifirRes.rowCount;
      }
    }
  } catch(e) {
    console.error('⚠️ Stok verisi çekilemedi (email):', e.message);
  }

  return { date, satisBySku, satisToplam, stokBySku, sifirMagazaCount };
}

function buildEmailHTML(data) {
  const { date, satisBySku, satisToplam, stokBySku, sifirMagazaCount } = data;
  const dateTR = formatDateTR(date);

  const skuRows = [SKU_AC, SKU_MB].map(sku => {
    const s = satisBySku[sku] || {};
    const st = stokBySku[sku] || {};
    const qty   = parseFloat(s.total_qty  || 0);
    const rev   = parseFloat(s.total_rev  || 0);
    const stores = parseInt(s.store_count || 0);
    const stok  = parseFloat(st.total_stok || 0);
    const sifir = parseInt(st.sifir_magaza || 0);
    const totalMagaza = parseInt(st.magaza_count || 0);
    return `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;font-weight:600;color:#1a3a5c">${SKU_NAMES[sku]}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;text-align:right">${formatNum(Math.round(qty))}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;text-align:right">${formatTL(rev)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;text-align:right">${stores}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;text-align:right">${formatNum(Math.round(stok))}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;text-align:right;color:${sifir > 0 ? '#dc2626' : '#16a34a'}">${sifir} / ${totalMagaza}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#374151">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#1a3a5c 0%,#c0392b 100%);padding:28px 32px">
          <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:rgba(255,255,255,.7);text-transform:uppercase;margin-bottom:6px">Migros B2B · Günlük Rapor</div>
          <div style="font-size:26px;font-weight:800;color:#ffffff">${dateTR}</div>
          <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:4px">Satış ve Stok Özeti</div>
        </td></tr>

        <!-- KPI Kutuları -->
        <tr><td style="padding:24px 32px 8px">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="33%" style="text-align:center;padding:16px;background:#f9fafb;border-radius:8px">
                <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Toplam Satış</div>
                <div style="font-size:28px;font-weight:800;color:#c0392b">${formatNum(Math.round(satisToplam.qty))}</div>
                <div style="font-size:11px;color:#9ca3af;margin-top:2px">adet</div>
              </td>
              <td width="4%"></td>
              <td width="33%" style="text-align:center;padding:16px;background:#f9fafb;border-radius:8px">
                <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Net Ciro</div>
                <div style="font-size:28px;font-weight:800;color:#16a34a">${formatTL(satisToplam.rev)}</div>
                <div style="font-size:11px;color:#9ca3af;margin-top:2px">TL</div>
              </td>
              <td width="4%"></td>
              <td width="33%" style="text-align:center;padding:16px;background:#f9fafb;border-radius:8px">
                <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Stoksuz Mağaza</div>
                <div style="font-size:28px;font-weight:800;color:${sifirMagazaCount > 0 ? '#dc2626' : '#16a34a'}">${sifirMagazaCount}</div>
                <div style="font-size:11px;color:#9ca3af;margin-top:2px">mağaza</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Tablo Başlık -->
        <tr><td style="padding:24px 32px 8px">
          <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px">SKU Bazlı Detay</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="background:#f3f4f6">
                <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">Ürün</th>
                <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">Adet</th>
                <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">Ciro</th>
                <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">Mağaza</th>
                <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">Stok</th>
                <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">0 Stok/Top</th>
              </tr>
            </thead>
            <tbody>${skuRows}</tbody>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 32px 28px;border-top:1px solid #f0f0f0;margin-top:8px">
          <div style="font-size:11px;color:#9ca3af;text-align:center">
            Bu rapor Migros B2B agent tarafından otomatik oluşturulmuştur · ${new Date().toLocaleString('tr-TR')}
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendDailyReport() {
  if (!CONFIG.EMAIL_FROM || !CONFIG.EMAIL_TO || !CONFIG.EMAIL_PASS) {
    console.log('⚠️  Email env var eksik (EMAIL_FROM, EMAIL_TO, EMAIL_PASS), mail atlanıyor');
    return;
  }

  console.log('\n📧 Günlük rapor maili hazırlanıyor...');
  try {
    const date = trYesterday();
    const data = await buildEmailData(date);
    const html = buildEmailHTML(data);

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: CONFIG.EMAIL_FROM, pass: CONFIG.EMAIL_PASS },
    });

    await transporter.sendMail({
      from: `"Migros B2B Rapor" <${CONFIG.EMAIL_FROM}>`,
      to: CONFIG.EMAIL_TO,
      subject: `Migros Günlük Rapor · ${formatDateTR(date)}`,
      html,
    });

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
