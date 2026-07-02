const https = require('https');

const SKU_AC = '41075315';
const SKU_MB = '41075312';
const SKU_NAMES = { [SKU_AC]: 'Active Carbon 5L', [SKU_MB]: 'Marseille Breeze 5L' };
const SKU_COLORS = { [SKU_AC]: '#C0392B', [SKU_MB]: '#1A3A5C' };

function formatDateTR(d) {
  if (!d) return '';
  const months = ['','Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${parseInt(day)} ${months[parseInt(m)]} ${y}`;
}
function fmtTL(n) {
  return '₺' + Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n) {
  return Number(Math.round(n || 0)).toLocaleString('tr-TR');
}

// Türkiye saatine göre bugün / dün
function trDate(offsetDays = 0) {
  const now = new Date();
  return new Date(now.getTime() + 3 * 60 * 60 * 1000 - offsetDays * 86400000)
    .toISOString().split('T')[0];
}

async function buildEmailData(pool, date) {
  date = date || trDate(1); // dün

  // ── Dünün satışları ──────────────────────────────────────────────
  const satisRes = await pool.query(`
    SELECT "SupplierItemNumber" AS sku,
           SUM(CAST("QuantitySold"  AS FLOAT)) AS qty,
           SUM(CAST("NetSalesValue" AS FLOAT)) AS rev,
           COUNT(DISTINCT "StoreNumber")       AS stores
    FROM gunluk_satis WHERE "DateTransaction" = $1
    GROUP BY "SupplierItemNumber"
  `, [date]);

  const dun = {};
  satisRes.rows.forEach(r => { dun[r.sku] = r; });

  // ── Bu ayki satışlar ─────────────────────────────────────────────
  const monthStart = date.slice(0, 8) + '01'; // YYYY-MM-01
  const ayRes = await pool.query(`
    SELECT "SupplierItemNumber" AS sku,
           SUM(CAST("QuantitySold"  AS FLOAT)) AS qty,
           SUM(CAST("NetSalesValue" AS FLOAT)) AS rev
    FROM gunluk_satis
    WHERE "DateTransaction" >= $1 AND "DateTransaction" <= $2
    GROUP BY "SupplierItemNumber"
  `, [monthStart, date]);

  const ay = {};
  ayRes.rows.forEach(r => { ay[r.sku] = r; });

  // ── Kümülatif (tüm zamanlar) ─────────────────────────────────────
  const kumRes = await pool.query(`
    SELECT "SupplierItemNumber" AS sku,
           SUM(CAST("QuantitySold"  AS FLOAT)) AS qty,
           SUM(CAST("NetSalesValue" AS FLOAT)) AS rev
    FROM gunluk_satis
    GROUP BY "SupplierItemNumber"
  `);

  const kum = {};
  kumRes.rows.forEach(r => { kum[r.sku] = r; });

  // ── Stok (en güncel tarih) ───────────────────────────────────────
  let stok = {};
  let stokTarihi = null;
  let sifirMagazaCount = 0;

  try {
    const latestRes = await pool.query(`SELECT MAX(veri_tarihi) AS son FROM stok`);
    stokTarihi = latestRes.rows[0]?.son;

    if (stokTarihi) {
      const colRes = await pool.query(`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'stok'
      `);
      const cols = colRes.rows.map(r => r.column_name);
      const skuCol   = cols.includes('SATICI_URUN_KODU') ? '"SATICI_URUN_KODU"'
                     : cols.includes('URUN_SATICI_ADI')  ? '"URUN_SATICI_ADI"' : null;
      const qtyCol   = cols.includes('STOK_MIKTARI')     ? '"STOK_MIKTARI"'    : null;
      const storeCol = cols.includes('MAGAZA_NO')              ? '"MAGAZA_NO"'
                     : cols.includes('StoreNumber')            ? '"StoreNumber"'
                     : cols.includes('TESLIM_NOKTASI_ID')      ? '"TESLIM_NOKTASI_ID"'
                     : cols.includes('TESLIM_NOKTASI_ACIKLAMA') ? '"TESLIM_NOKTASI_ACIKLAMA"' : null;

      if (skuCol && qtyCol && storeCol) {
        const stokRes = await pool.query(`
          SELECT ${skuCol}  AS sku,
                 SUM(CAST(${qtyCol} AS FLOAT))   AS total_stok,
                 COUNT(DISTINCT ${storeCol})      AS magaza_count,
                 COUNT(DISTINCT CASE WHEN CAST(${qtyCol} AS FLOAT) > 0 THEN ${storeCol} END) AS stok_olan,
                 COUNT(DISTINCT CASE WHEN CAST(${qtyCol} AS FLOAT) = 0 THEN ${storeCol} END) AS sifir_magaza
          FROM stok
          WHERE veri_tarihi = $1 AND ${skuCol} IN ($2, $3)
          GROUP BY ${skuCol}
        `, [stokTarihi, SKU_AC, SKU_MB]);
        stokRes.rows.forEach(r => { stok[r.sku] = r; });

        const sifirRes = await pool.query(`
          SELECT ${storeCol}
          FROM stok WHERE veri_tarihi = $1 AND ${skuCol} IN ($2,$3)
          GROUP BY ${storeCol}
          HAVING MAX(CAST(${qtyCol} AS FLOAT)) = 0
        `, [stokTarihi, SKU_AC, SKU_MB]);
        sifirMagazaCount = sifirRes.rowCount;
      }
    }
  } catch(e) {
    console.error('⚠️ Email stok sorgusu:', e.message);
  }

  return { date, monthStart, stokTarihi, dun, ay, kum, stok, sifirMagazaCount };
}

function skuSection(dun, ay, kum, stok) {
  return [SKU_AC, SKU_MB].map(sku => {
    const d  = dun[sku]  || {};
    const a  = ay[sku]   || {};
    const k  = kum[sku]  || {};
    const st = stok[sku] || {};
    const color = SKU_COLORS[sku];
    const name  = SKU_NAMES[sku];

    const totalStok    = parseFloat(st.total_stok  || 0);
    const stokOlan     = parseInt(st.stok_olan     || 0);
    const sifirMagaza  = parseInt(st.sifir_magaza  || 0);

    return `
    <tr>
      <td style="padding:11px 14px;border-bottom:1px solid #f0f0f0;font-weight:700;color:${color}">${name}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #f0f0f0;text-align:right">${fmtNum(parseFloat(d.qty||0))}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #f0f0f0;text-align:right">${fmtTL(parseFloat(d.rev||0))}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #f0f0f0;text-align:right">${fmtNum(parseFloat(a.qty||0))}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #f0f0f0;text-align:right">${fmtTL(parseFloat(a.rev||0))}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #f0f0f0;text-align:right">${fmtNum(parseFloat(k.qty||0))}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #f0f0f0;text-align:right">${fmtTL(parseFloat(k.rev||0))}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;color:${totalStok > 0 ? '#16a34a' : '#dc2626'}">${fmtNum(totalStok)}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #f0f0f0;text-align:right">${stokOlan}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #f0f0f0;text-align:right;color:${sifirMagaza > 0 ? '#dc2626' : '#16a34a'}">${sifirMagaza}</td>
    </tr>`;
  }).join('');
}

function buildEmailHTML(data) {
  const { date, monthStart, stokTarihi, dun, ay, kum, stok, sifirMagazaCount } = data;

  const dunTopQty = [SKU_AC, SKU_MB].reduce((s, k) => s + parseFloat(dun[k]?.qty || 0), 0);
  const dunTopRev = [SKU_AC, SKU_MB].reduce((s, k) => s + parseFloat(dun[k]?.rev || 0), 0);
  const ayTopQty  = [SKU_AC, SKU_MB].reduce((s, k) => s + parseFloat(ay[k]?.qty  || 0), 0);
  const ayTopRev  = [SKU_AC, SKU_MB].reduce((s, k) => s + parseFloat(ay[k]?.rev  || 0), 0);
  const kumTopQty = [SKU_AC, SKU_MB].reduce((s, k) => s + parseFloat(kum[k]?.qty || 0), 0);
  const kumTopRev = [SKU_AC, SKU_MB].reduce((s, k) => s + parseFloat(kum[k]?.rev || 0), 0);

  const th = (txt) => `<th style="padding:9px 14px;text-align:right;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap">${txt}</th>`;
  const thL = (txt) => `<th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">${txt}</th>`;

  const totalRow = `
    <tr style="background:#f9fafb">
      <td style="padding:11px 14px;font-weight:700;color:#374151">TOPLAM</td>
      <td style="padding:11px 14px;text-align:right;font-weight:700">${fmtNum(dunTopQty)}</td>
      <td style="padding:11px 14px;text-align:right;font-weight:700">${fmtTL(dunTopRev)}</td>
      <td style="padding:11px 14px;text-align:right;font-weight:700">${fmtNum(ayTopQty)}</td>
      <td style="padding:11px 14px;text-align:right;font-weight:700">${fmtTL(ayTopRev)}</td>
      <td style="padding:11px 14px;text-align:right;font-weight:700">${fmtNum(kumTopQty)}</td>
      <td style="padding:11px 14px;text-align:right;font-weight:700">${fmtTL(kumTopRev)}</td>
      <td colspan="3" style="padding:11px 14px"></td>
    </tr>`;

  const monthName = formatDateTR(monthStart).replace(/^\d+ /, '');

  return `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;color:#374151">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:28px 0">
<tr><td align="center">
<table width="700" cellpadding="0" cellspacing="0" style="max-width:700px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#1a3a5c 0%,#c0392b 100%);padding:26px 32px">
    <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:rgba(255,255,255,.65);text-transform:uppercase;margin-bottom:5px">Migros B2B · Günlük Rapor</div>
    <div style="font-size:28px;font-weight:800;color:#fff">${formatDateTR(date)}</div>
    <div style="font-size:12px;color:rgba(255,255,255,.55);margin-top:3px">Satış · Stok · Kümülatif Özet</div>
  </td></tr>

  <!-- Dün KPI -->
  <tr><td style="padding:22px 32px 8px">
    <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">📅 Dünkü Performans</div>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="32%" style="text-align:center;padding:14px 8px;background:#fef2f2;border-radius:8px">
        <div style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px">Toplam Satış</div>
        <div style="font-size:26px;font-weight:800;color:#c0392b">${fmtNum(dunTopQty)}</div>
        <div style="font-size:10px;color:#9ca3af">adet</div>
      </td>
      <td width="4%"></td>
      <td width="32%" style="text-align:center;padding:14px 8px;background:#f0fdf4;border-radius:8px">
        <div style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px">Net Ciro</div>
        <div style="font-size:26px;font-weight:800;color:#16a34a">${fmtTL(dunTopRev)}</div>
        <div style="font-size:10px;color:#9ca3af">TL</div>
      </td>
      <td width="4%"></td>
      <td width="32%" style="text-align:center;padding:14px 8px;background:${sifirMagazaCount > 0 ? '#fef2f2' : '#f0fdf4'};border-radius:8px">
        <div style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px">Stoksuz Mağaza</div>
        <div style="font-size:26px;font-weight:800;color:${sifirMagazaCount > 0 ? '#dc2626' : '#16a34a'}">${sifirMagazaCount}</div>
        <div style="font-size:10px;color:#9ca3af">mağaza</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- Bu ay KPI -->
  <tr><td style="padding:16px 32px 8px">
    <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">📊 ${monthName} Ayı (${formatDateTR(monthStart)} – ${formatDateTR(date)})</div>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="48%" style="text-align:center;padding:14px 8px;background:#f8faff;border-radius:8px;border:1px solid #e0e7ff">
        <div style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px">Aylık Satış</div>
        <div style="font-size:26px;font-weight:800;color:#4f46e5">${fmtNum(ayTopQty)}</div>
        <div style="font-size:10px;color:#9ca3af">adet</div>
      </td>
      <td width="4%"></td>
      <td width="48%" style="text-align:center;padding:14px 8px;background:#f8faff;border-radius:8px;border:1px solid #e0e7ff">
        <div style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px">Aylık Ciro</div>
        <div style="font-size:26px;font-weight:800;color:#4f46e5">${fmtTL(ayTopRev)}</div>
        <div style="font-size:10px;color:#9ca3af">TL</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- Kümülatif KPI -->
  <tr><td style="padding:16px 32px 8px">
    <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">📈 Kümülatif Toplam (Tüm Zamanlar)</div>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="48%" style="text-align:center;padding:14px 8px;background:#fafaf5;border-radius:8px;border:1px solid #e5e7d5">
        <div style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px">Toplam Satış</div>
        <div style="font-size:26px;font-weight:800;color:#854d0e">${fmtNum(kumTopQty)}</div>
        <div style="font-size:10px;color:#9ca3af">adet</div>
      </td>
      <td width="4%"></td>
      <td width="48%" style="text-align:center;padding:14px 8px;background:#fafaf5;border-radius:8px;border:1px solid #e5e7d5">
        <div style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px">Toplam Ciro</div>
        <div style="font-size:26px;font-weight:800;color:#854d0e">${fmtTL(kumTopRev)}</div>
        <div style="font-size:10px;color:#9ca3af">TL</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- SKU Detay Tablosu -->
  <tr><td style="padding:16px 32px 20px">
    <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">🔍 SKU Bazlı Detay${stokTarihi ? ` · Stok: ${formatDateTR(stokTarihi)}` : ''}</div>
    <div style="overflow-x:auto">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;min-width:580px">
      <thead><tr style="background:#f3f4f6">
        ${thL('Ürün')}
        ${th('Dün Adet')}${th('Dün Ciro')}
        ${th('Ay Adet')}${th('Ay Ciro')}
        ${th('Küm. Adet')}${th('Küm. Ciro')}
        ${th('Kalan Stok')}${th('Stok Var')}${th('Stoksuz')}
      </tr></thead>
      <tbody>
        ${skuSection(dun, ay, kum, stok)}
        ${totalRow}
      </tbody>
    </table>
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:16px 32px 24px;border-top:1px solid #f0f0f0">
    <div style="font-size:11px;color:#9ca3af;text-align:center">
      Bu rapor Migros B2B agent tarafından otomatik oluşturulmuştur · ${new Date().toLocaleString('tr-TR')}
    </div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

function resendSend(apiKey, emailFrom, emailTo, subject, html) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from: `Migros B2B Rapor <${emailFrom}>`,
      to: emailTo.split(',').map(e => e.trim()).filter(Boolean),
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
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(r);
          else reject(new Error(r.message || JSON.stringify(r)));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Resend API timeout')); });
    req.write(body);
    req.end();
  });
}

module.exports = { buildEmailData, buildEmailHTML, resendSend, formatDateTR };
