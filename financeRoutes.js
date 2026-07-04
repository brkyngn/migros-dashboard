// financeRoutes.js — P&L (Kâr/Zarar) modülü: şema, seed ve API endpoint'leri
// server.js tarafından mount edilir: app.use('/api', financeRoutes(pool))
const express = require('express');
const multer = require('multer');
const { parseInvoice, InvoiceAIError } = require('./invoiceAI');

// Fatura upload: bellek depolama (dosya diske hiç yazılmaz), 15MB sınır, tip whitelist'i
const ALLOWED_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('UNSUPPORTED_TYPE'));
  },
});

// ========== ŞEMA + SEED ==========

async function initializeFinanceTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      migros_urun_kodu TEXT UNIQUE NOT NULL,
      ad TEXT NOT NULL,
      barkod TEXT,
      koli_ici_adet INTEGER DEFAULT 1,
      kdv_orani NUMERIC DEFAULT 20,
      komisyon_orani_override NUMERIC,
      birim_maliyet NUMERIC,
      aktif BOOLEAN DEFAULT TRUE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS expense_categories (
      id SERIAL PRIMARY KEY,
      ad TEXT NOT NULL,
      pnl_blok TEXT NOT NULL,
      sira INTEGER DEFAULT 0,
      aktif BOOLEAN DEFAULT TRUE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS recurring_expenses (
      id SERIAL PRIMARY KEY,
      baslik TEXT NOT NULL,
      kategori_id INTEGER REFERENCES expense_categories(id),
      tedarikci TEXT,
      aciklama TEXT,
      net_tutar NUMERIC NOT NULL,
      kdv_orani NUMERIC DEFAULT 20,
      gun INTEGER DEFAULT 1,
      baslangic DATE NOT NULL,
      bitis DATE,
      aktif BOOLEAN DEFAULT TRUE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      tarih DATE NOT NULL,
      tedarikci TEXT,
      alici TEXT,
      kategori_id INTEGER REFERENCES expense_categories(id),
      aciklama TEXT,
      net_tutar NUMERIC NOT NULL,
      kdv_orani NUMERIC DEFAULT 20,
      kdv_tutari NUMERIC DEFAULT 0,
      brut_tutar NUMERIC NOT NULL,
      urun_id INTEGER REFERENCES products(id),
      adet NUMERIC,
      kaynak TEXT DEFAULT 'manuel',
      fatura_no TEXT,
      tekrarlayan_id INTEGER REFERENCES recurring_expenses(id),
      donem TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tekrarlayan gider materyalizasyonunda çift kayıt önleme
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS expenses_recurring_uniq
    ON expenses (tekrarlayan_id, donem) WHERE tekrarlayan_id IS NOT NULL
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // --- Seed (idempotent) ---
  await pool.query(`
    INSERT INTO settings (key, value) VALUES
      ('komisyon_orani', '50'),
      ('varsayilan_kdv', '20'),
      ('satis_kdv_orani', '20'),
      ('satis_kdv_dahil', 'false')
    ON CONFLICT (key) DO NOTHING
  `);

  await pool.query(`
    INSERT INTO products (migros_urun_kodu, ad, kdv_orani) VALUES
      ('41075315', 'KittyCady Active Carbon 5L', 20),
      ('41075312', 'KittyCady Marseille Breeze 5L', 20)
    ON CONFLICT (migros_urun_kodu) DO NOTHING
  `);

  // Kategoriler: tablo boşsa standart seti doldur
  const catCount = await pool.query(`SELECT COUNT(*)::int AS n FROM expense_categories`);
  if (catCount.rows[0].n === 0) {
    await pool.query(`
      INSERT INTO expense_categories (ad, pnl_blok, sira) VALUES
        ('Ürün Alımı (Fason Üretim)', 'SMM', 1),
        ('Ambalaj / Koli', 'SMM', 2),
        ('Etiket', 'SMM', 3),
        ('Lojistik / Nakliye', 'SMM', 4),
        ('Raf Bedeli', 'KANAL', 5),
        ('Listeleme / Aktivasyon', 'KANAL', 6),
        ('Insert / Katalog', 'KANAL', 7),
        ('Promosyon / İndirim', 'KANAL', 8),
        ('İade & Fire', 'IADE_FIRE', 9),
        ('Reklam (Meta / Google)', 'PAZARLAMA', 10),
        ('Ajans / İçerik', 'PAZARLAMA', 11),
        ('Numune', 'PAZARLAMA', 12),
        ('Muhasebe', 'OPERASYONEL', 13),
        ('Banka Masrafları', 'OPERASYONEL', 14),
        ('Yazılım Abonelikleri', 'OPERASYONEL', 15),
        ('Ofis / Araç', 'OPERASYONEL', 16),
        ('Personel', 'PERSONEL', 17),
        ('Kredi Faizi', 'FINANSMAN', 18),
        ('Kur Farkı', 'FINANSMAN', 19),
        ('Diğer', 'DIGER', 20)
    `);
  }

  console.log('✅ Finans tabloları hazır');
}

// ========== YARDIMCILAR ==========

const PNL_BLOKLARI = ['SMM', 'KANAL', 'IADE_FIRE', 'PAZARLAMA', 'OPERASYONEL', 'PERSONEL', 'FINANSMAN', 'DIGER'];

// pg NUMERIC değerlerini string döndürür — sayıya çevir
function num(v) { return v === null || v === undefined ? null : parseFloat(v); }

function mapExpense(r) {
  return {
    ...r,
    net_tutar: num(r.net_tutar),
    kdv_orani: num(r.kdv_orani),
    kdv_tutari: num(r.kdv_tutari),
    brut_tutar: num(r.brut_tutar),
    adet: num(r.adet),
  };
}

function mapProduct(r) {
  return {
    ...r,
    koli_ici_adet: r.koli_ici_adet === null ? null : parseInt(r.koli_ici_adet),
    kdv_orani: num(r.kdv_orani),
    komisyon_orani_override: num(r.komisyon_orani_override),
    birim_maliyet: num(r.birim_maliyet),
  };
}

function mapRecurring(r) {
  return { ...r, net_tutar: num(r.net_tutar), kdv_orani: num(r.kdv_orani), gun: parseInt(r.gun) };
}

async function getSettings(pool) {
  const r = await pool.query(`SELECT key, value FROM settings`);
  const s = {};
  for (const row of r.rows) s[row.key] = row.value;
  return {
    komisyon_orani: parseFloat(s.komisyon_orani ?? '50'),
    varsayilan_kdv: parseFloat(s.varsayilan_kdv ?? '20'),
    satis_kdv_orani: parseFloat(s.satis_kdv_orani ?? '20'),
    satis_kdv_dahil: s.satis_kdv_dahil === 'true',
  };
}

// Tekrarlayan giderleri gerçek gider satırlarına dönüştür (okurken materyalize).
// Her aktif şablon için baslangic..min(bitis, bugün) aralığındaki her aya bir satır;
// unique index (tekrarlayan_id, donem) çift üretimi engeller — her çağrıda idempotent.
async function materializeRecurring(pool) {
  const templates = await pool.query(`SELECT * FROM recurring_expenses WHERE aktif = TRUE`);
  if (!templates.rows.length) return;

  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  for (const t of templates.rows) {
    const start = new Date(t.baslangic);
    const endYm = t.bitis
      ? `${new Date(t.bitis).getFullYear()}-${String(new Date(t.bitis).getMonth() + 1).padStart(2, '0')}`
      : currentYm;
    const stopYm = endYm < currentYm ? endYm : currentYm;

    let y = start.getFullYear(), m = start.getMonth() + 1;
    let ym = `${y}-${String(m).padStart(2, '0')}`;
    while (ym <= stopYm) {
      const gun = Math.min(parseInt(t.gun) || 1, 28); // her ayda geçerli olsun
      const tarih = `${ym}-${String(gun).padStart(2, '0')}`;
      const kdvOrani = parseFloat(t.kdv_orani) || 0;
      const netTutar = parseFloat(t.net_tutar);
      const kdvTutari = Math.round(netTutar * kdvOrani) / 100;
      await pool.query(`
        INSERT INTO expenses (tarih, tedarikci, kategori_id, aciklama, net_tutar, kdv_orani, kdv_tutari, brut_tutar, kaynak, tekrarlayan_id, donem)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'tekrar', $9, $10)
        ON CONFLICT (tekrarlayan_id, donem) WHERE tekrarlayan_id IS NOT NULL DO NOTHING
      `, [tarih, t.tedarikci, t.kategori_id, t.aciklama || t.baslik, netTutar, kdvOrani, kdvTutari, netTutar + kdvTutari, t.id, ym]).catch(() => {});
      m++;
      if (m > 12) { m = 1; y++; }
      ym = `${y}-${String(m).padStart(2, '0')}`;
    }
  }
}

// ========== ROUTER ==========

function financeRoutes(pool) {
  const router = express.Router();

  // --- Kategoriler ---
  router.get('/expense-categories', async (req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM expense_categories ORDER BY sira, id`);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/expense-categories', async (req, res) => {
    try {
      const { ad, pnl_blok, sira } = req.body;
      if (!ad || !PNL_BLOKLARI.includes(pnl_blok)) return res.status(400).json({ error: 'ad ve geçerli pnl_blok zorunlu' });
      const r = await pool.query(
        `INSERT INTO expense_categories (ad, pnl_blok, sira) VALUES ($1, $2, $3) RETURNING *`,
        [ad, pnl_blok, sira ?? 0]
      );
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/expense-categories/:id', async (req, res) => {
    try {
      const { ad, pnl_blok, sira, aktif } = req.body;
      if (pnl_blok && !PNL_BLOKLARI.includes(pnl_blok)) return res.status(400).json({ error: 'geçersiz pnl_blok' });
      const r = await pool.query(
        `UPDATE expense_categories SET
           ad = COALESCE($1, ad), pnl_blok = COALESCE($2, pnl_blok),
           sira = COALESCE($3, sira), aktif = COALESCE($4, aktif)
         WHERE id = $5 RETURNING *`,
        [ad, pnl_blok, sira, aktif, req.params.id]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'kategori bulunamadı' });
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- Giderler ---
  // Not: '/expenses/duplicate-check' rotası '/expenses/:id'den ÖNCE tanımlanmalı
  router.get('/expenses/duplicate-check', async (req, res) => {
    try {
      const { fatura_no, tedarikci } = req.query;
      if (!fatura_no || !tedarikci) return res.json({ exists: false });
      const r = await pool.query(
        `SELECT id FROM expenses WHERE fatura_no = $1 AND LOWER(tedarikci) = LOWER($2) LIMIT 1`,
        [fatura_no, tedarikci]
      );
      res.json(r.rows.length ? { exists: true, id: r.rows[0].id } : { exists: false });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/expenses', async (req, res) => {
    try {
      await materializeRecurring(pool);
      const { from, to, kategori_id, q } = req.query;
      const params = [];
      let where = 'WHERE 1=1';
      if (from) { params.push(from); where += ` AND e.tarih >= $${params.length}`; }
      if (to) { params.push(to); where += ` AND e.tarih <= $${params.length}`; }
      if (kategori_id) { params.push(kategori_id); where += ` AND e.kategori_id = $${params.length}`; }
      if (q) { params.push(`%${q}%`); where += ` AND (e.tedarikci ILIKE $${params.length} OR e.aciklama ILIKE $${params.length} OR e.fatura_no ILIKE $${params.length})`; }
      const r = await pool.query(`
        SELECT e.*, c.ad AS kategori_ad, c.pnl_blok, p.ad AS urun_ad
        FROM expenses e
        LEFT JOIN expense_categories c ON c.id = e.kategori_id
        LEFT JOIN products p ON p.id = e.urun_id
        ${where}
        ORDER BY e.tarih DESC, e.id DESC
        LIMIT 5000
      `, params);
      res.json(r.rows.map(mapExpense));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/expenses', async (req, res) => {
    try {
      const b = req.body;
      const net = parseFloat(b.net_tutar);
      if (!b.tarih || !b.kategori_id || isNaN(net)) {
        return res.status(400).json({ error: 'tarih, kategori_id ve net_tutar zorunlu' });
      }
      // Sunucu tarafında yeniden hesapla — istemciden gelen tutarlara körü körüne güvenme
      const kdvOrani = parseFloat(b.kdv_orani) || 0;
      const kdvTutari = Math.round(net * kdvOrani) / 100;
      const brut = net + kdvTutari;
      const r = await pool.query(`
        INSERT INTO expenses (tarih, tedarikci, alici, kategori_id, aciklama, net_tutar, kdv_orani, kdv_tutari, brut_tutar, urun_id, adet, kaynak, fatura_no)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
      `, [b.tarih, b.tedarikci || null, b.alici || null, b.kategori_id, b.aciklama || null,
          net, kdvOrani, kdvTutari, brut, b.urun_id || null, b.adet || null,
          b.kaynak === 'fatura_ai' ? 'fatura_ai' : 'manuel', b.fatura_no || null]);
      res.json(mapExpense(r.rows[0]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/expenses/:id', async (req, res) => {
    try {
      const b = req.body;
      const net = parseFloat(b.net_tutar);
      if (isNaN(net)) return res.status(400).json({ error: 'net_tutar zorunlu' });
      const kdvOrani = parseFloat(b.kdv_orani) || 0;
      const kdvTutari = Math.round(net * kdvOrani) / 100;
      const brut = net + kdvTutari;
      const r = await pool.query(`
        UPDATE expenses SET
          tarih = COALESCE($1, tarih), tedarikci = $2, alici = $3,
          kategori_id = COALESCE($4, kategori_id), aciklama = $5,
          net_tutar = $6, kdv_orani = $7, kdv_tutari = $8, brut_tutar = $9,
          urun_id = $10, adet = $11, fatura_no = $12
        WHERE id = $13 RETURNING *
      `, [b.tarih, b.tedarikci || null, b.alici || null, b.kategori_id, b.aciklama || null,
          net, kdvOrani, kdvTutari, brut, b.urun_id || null, b.adet || null, b.fatura_no || null, req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'gider bulunamadı' });
      res.json(mapExpense(r.rows[0]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/expenses/:id', async (req, res) => {
    try {
      const r = await pool.query(`DELETE FROM expenses WHERE id = $1 RETURNING id`, [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'gider bulunamadı' });
      res.json({ ok: true, id: r.rows[0].id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- Tekrarlayan giderler ---
  router.get('/recurring-expenses', async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT t.*, c.ad AS kategori_ad
        FROM recurring_expenses t LEFT JOIN expense_categories c ON c.id = t.kategori_id
        ORDER BY t.id DESC
      `);
      res.json(r.rows.map(mapRecurring));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/recurring-expenses', async (req, res) => {
    try {
      const b = req.body;
      const net = parseFloat(b.net_tutar);
      if (!b.baslik || !b.kategori_id || isNaN(net) || !b.baslangic) {
        return res.status(400).json({ error: 'baslik, kategori_id, net_tutar ve baslangic zorunlu' });
      }
      const r = await pool.query(`
        INSERT INTO recurring_expenses (baslik, kategori_id, tedarikci, aciklama, net_tutar, kdv_orani, gun, baslangic, bitis)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
      `, [b.baslik, b.kategori_id, b.tedarikci || null, b.aciklama || null,
          net, parseFloat(b.kdv_orani) || 0, parseInt(b.gun) || 1, b.baslangic, b.bitis || null]);
      res.json(mapRecurring(r.rows[0]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/recurring-expenses/:id', async (req, res) => {
    try {
      const b = req.body;
      const r = await pool.query(`
        UPDATE recurring_expenses SET
          baslik = COALESCE($1, baslik), kategori_id = COALESCE($2, kategori_id),
          tedarikci = $3, aciklama = $4,
          net_tutar = COALESCE($5, net_tutar), kdv_orani = COALESCE($6, kdv_orani),
          gun = COALESCE($7, gun), baslangic = COALESCE($8, baslangic), bitis = $9,
          aktif = COALESCE($10, aktif)
        WHERE id = $11 RETURNING *
      `, [b.baslik, b.kategori_id, b.tedarikci || null, b.aciklama || null,
          b.net_tutar, b.kdv_orani, b.gun, b.baslangic, b.bitis || null, b.aktif, req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'şablon bulunamadı' });
      res.json(mapRecurring(r.rows[0]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/recurring-expenses/:id', async (req, res) => {
    try {
      // Şablonu silme — materyalize edilmiş geçmiş satırlar FK ile bağlı; pasife çek
      const r = await pool.query(
        `UPDATE recurring_expenses SET aktif = FALSE WHERE id = $1 RETURNING id`, [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'şablon bulunamadı' });
      res.json({ ok: true, id: r.rows[0].id, note: 'şablon pasife alındı' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- Ayarlar ---
  router.get('/settings', async (req, res) => {
    try { res.json(await getSettings(pool)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/settings', async (req, res) => {
    try {
      const allowed = ['komisyon_orani', 'varsayilan_kdv', 'satis_kdv_orani', 'satis_kdv_dahil'];
      for (const [key, value] of Object.entries(req.body)) {
        if (!allowed.includes(key)) continue;
        await pool.query(`
          INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
          ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP
        `, [key, String(value)]);
      }
      res.json(await getSettings(pool));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- Ürünler ---
  router.get('/products', async (req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM products ORDER BY id`);
      res.json(r.rows.map(mapProduct));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/products', async (req, res) => {
    try {
      const b = req.body;
      if (!b.migros_urun_kodu || !b.ad) return res.status(400).json({ error: 'migros_urun_kodu ve ad zorunlu' });
      const r = await pool.query(`
        INSERT INTO products (migros_urun_kodu, ad, barkod, koli_ici_adet, kdv_orani, komisyon_orani_override, birim_maliyet)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
      `, [b.migros_urun_kodu, b.ad, b.barkod || null, b.koli_ici_adet || 1,
          b.kdv_orani ?? 20, b.komisyon_orani_override ?? null, b.birim_maliyet ?? null]);
      res.json(mapProduct(r.rows[0]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/products/:id', async (req, res) => {
    try {
      const b = req.body;
      const r = await pool.query(`
        UPDATE products SET
          ad = COALESCE($1, ad), barkod = $2,
          koli_ici_adet = COALESCE($3, koli_ici_adet), kdv_orani = COALESCE($4, kdv_orani),
          komisyon_orani_override = $5, birim_maliyet = $6,
          aktif = COALESCE($7, aktif)
        WHERE id = $8 RETURNING *
      `, [b.ad, b.barkod || null, b.koli_ici_adet, b.kdv_orani,
          b.komisyon_orani_override ?? null, b.birim_maliyet ?? null, b.aktif, req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'ürün bulunamadı' });
      res.json(mapProduct(r.rows[0]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== P&L ==========

  // Belirli dönem için satış + gider agregasyonundan P&L şelalesi
  async function computePnl(from, to) {
    await materializeRecurring(pool);
    const settings = await getSettings(pool);
    const productsRes = await pool.query(`SELECT * FROM products`);
    const products = productsRes.rows;

    // Satış agregasyonu (SKU bazında) — DateTransaction TEXT olduğu için regex guard + CAST
    const satisRes = await pool.query(`
      SELECT "SupplierItemNumber" AS sku,
             MAX("SupplierItemName") AS ad,
             SUM(CAST("QuantitySold"  AS NUMERIC)) AS adet,
             SUM(CAST("NetSalesValue" AS NUMERIC)) AS brut
      FROM gunluk_satis
      WHERE "DateTransaction" ~ '^\\d{4}-\\d{2}-\\d{2}'
        AND "DateTransaction"::date BETWEEN $1::date AND $2::date
      GROUP BY "SupplierItemNumber"
    `, [from, to]);

    // Gider agregasyonu (kategori + blok bazında)
    const giderRes = await pool.query(`
      SELECT c.pnl_blok, c.ad AS kategori,
             SUM(e.net_tutar) AS net, SUM(e.kdv_tutari) AS kdv
      FROM expenses e
      JOIN expense_categories c ON c.id = e.kategori_id
      WHERE e.tarih BETWEEN $1::date AND $2::date
      GROUP BY c.pnl_blok, c.ad
    `, [from, to]);

    // --- Satış tarafı ---
    const kdvOran = settings.satis_kdv_orani;
    let brutSatis = 0, satisKdv = 0, netSatis = 0, komisyon = 0, toplamAdet = 0;
    const skuBazinda = [];
    for (const row of satisRes.rows) {
      const brut = num(row.brut) || 0;
      const adet = num(row.adet) || 0;
      brutSatis += brut;
      toplamAdet += adet;
      // KDV ayrıştırma: satış tutarı KDV dahilse ayrıştır, değilse (varsayılan) tutar zaten net
      const kdv = settings.satis_kdv_dahil ? brut * kdvOran / (100 + kdvOran) : 0;
      satisKdv += kdv;
      const net = brut - kdv;
      netSatis += net;
      const prod = products.find(p => p.migros_urun_kodu === row.sku);
      const oran = prod && prod.komisyon_orani_override !== null
        ? num(prod.komisyon_orani_override)
        : settings.komisyon_orani;
      komisyon += net * oran / 100;
      skuBazinda.push({ sku: row.sku, ad: (prod && prod.ad) || row.ad || row.sku, adet, brut, komisyonOrani: oran });
    }
    const netGelir = netSatis - komisyon;

    // --- Gider tarafı (blok toplamları) ---
    const blok = {};
    let indirilecekKdv = 0;
    const giderKategoriDagilimi = [];
    for (const g of giderRes.rows) {
      const net = num(g.net) || 0;
      blok[g.pnl_blok] = (blok[g.pnl_blok] || 0) + net;
      indirilecekKdv += num(g.kdv) || 0;
      giderKategoriDagilimi.push({ kategori: g.kategori, pnl_blok: g.pnl_blok, tutar: net });
    }
    giderKategoriDagilimi.sort((a, b) => b.tutar - a.tutar);

    const iadeFire = blok.IADE_FIRE || 0;
    const smm = blok.SMM || 0;
    const kanal = blok.KANAL || 0;
    const pazarlama = blok.PAZARLAMA || 0;
    const operasyonel = blok.OPERASYONEL || 0;
    const personel = blok.PERSONEL || 0;
    const finansman = blok.FINANSMAN || 0;
    const diger = blok.DIGER || 0;

    const duzeltilmisNetGelir = netGelir - iadeFire;
    const brutKar = duzeltilmisNetGelir - smm;
    const favok = brutKar - kanal - pazarlama - operasyonel - personel - diger;
    const netKar = favok - finansman;

    // KDV pozisyonu: satış KDV dahil değilse hesaplanan KDV = netSatis × oran
    const hesaplananKdv = settings.satis_kdv_dahil ? satisKdv : netSatis * kdvOran / 100;

    const marj = (x) => netSatis > 0 ? Math.round(x / netSatis * 1000) / 10 : 0;
    const r2 = (x) => Math.round(x * 100) / 100;

    return {
      from, to,
      brutSatis: r2(brutSatis), satisKdv: r2(satisKdv), netSatis: r2(netSatis),
      komisyon: r2(komisyon), netGelir: r2(netGelir),
      iadeFire: r2(iadeFire), duzeltilmisNetGelir: r2(duzeltilmisNetGelir),
      smm: r2(smm), brutKar: r2(brutKar), brutMarj: marj(brutKar),
      kanal: r2(kanal), pazarlama: r2(pazarlama), operasyonel: r2(operasyonel), personel: r2(personel),
      favok: r2(favok), favokMarj: marj(favok),
      finansman: r2(finansman), diger: r2(diger),
      netKar: r2(netKar), netMarj: marj(netKar),
      toplamAdet,
      kdvPozisyonu: { hesaplanan: r2(hesaplananKdv), indirilecek: r2(indirilecekKdv), fark: r2(hesaplananKdv - indirilecekKdv) },
      giderKategoriDagilimi: giderKategoriDagilimi.map(g => ({ ...g, tutar: r2(g.tutar) })),
      skuBazinda: skuBazinda.map(s => ({ ...s, brut: r2(s.brut) })),
    };
  }

  router.get('/pnl', async (req, res) => {
    try {
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ error: 'from ve to zorunlu (YYYY-MM-DD)' });
      res.json(await computePnl(from, to));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Son N ayın aylık trendi
  router.get('/pnl/trend', async (req, res) => {
    try {
      const months = Math.min(parseInt(req.query.months) || 12, 36);
      await materializeRecurring(pool);
      const settings = await getSettings(pool);
      const productsRes = await pool.query(`SELECT * FROM products`);
      const products = productsRes.rows;
      const kdvOran = settings.satis_kdv_orani;

      const satisRes = await pool.query(`
        SELECT SUBSTRING("DateTransaction", 1, 7) AS ay,
               "SupplierItemNumber" AS sku,
               SUM(CAST("NetSalesValue" AS NUMERIC)) AS brut
        FROM gunluk_satis
        WHERE "DateTransaction" ~ '^\\d{4}-\\d{2}-\\d{2}'
        GROUP BY 1, 2 ORDER BY 1
      `);
      const giderRes = await pool.query(`
        SELECT TO_CHAR(e.tarih, 'YYYY-MM') AS ay, c.pnl_blok, SUM(e.net_tutar) AS net
        FROM expenses e JOIN expense_categories c ON c.id = e.kategori_id
        GROUP BY 1, 2
      `);

      const aylar = {};
      for (const row of satisRes.rows) {
        const a = aylar[row.ay] = aylar[row.ay] || { netSatis: 0, komisyon: 0, gider: {} };
        const brut = num(row.brut) || 0;
        const net = settings.satis_kdv_dahil ? brut * 100 / (100 + kdvOran) : brut;
        const prod = products.find(p => p.migros_urun_kodu === row.sku);
        const oran = prod && prod.komisyon_orani_override !== null ? num(prod.komisyon_orani_override) : settings.komisyon_orani;
        a.netSatis += net;
        a.komisyon += net * oran / 100;
      }
      for (const row of giderRes.rows) {
        const a = aylar[row.ay] = aylar[row.ay] || { netSatis: 0, komisyon: 0, gider: {} };
        a.gider[row.pnl_blok] = (a.gider[row.pnl_blok] || 0) + (num(row.net) || 0);
      }

      const r2 = (x) => Math.round(x * 100) / 100;
      const keys = Object.keys(aylar).sort().slice(-months);
      res.json(keys.map(ay => {
        const a = aylar[ay];
        const g = a.gider;
        const netGelir = a.netSatis - a.komisyon;
        const brutKar = netGelir - (g.IADE_FIRE || 0) - (g.SMM || 0);
        const favok = brutKar - (g.KANAL || 0) - (g.PAZARLAMA || 0) - (g.OPERASYONEL || 0) - (g.PERSONEL || 0) - (g.DIGER || 0);
        const netKar = favok - (g.FINANSMAN || 0);
        return { ay, netGelir: r2(netGelir), brutKar: r2(brutKar), netKar: r2(netKar) };
      }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Birim (kutu başı) ekonomisi + başabaş analizi
  router.get('/pnl/unit-economics', async (req, res) => {
    try {
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ error: 'from ve to zorunlu (YYYY-MM-DD)' });
      const pnl = await computePnl(from, to);
      const settings = await getSettings(pool);
      const productsRes = await pool.query(`SELECT * FROM products`);
      const products = productsRes.rows;
      const kdvOran = settings.satis_kdv_orani;

      // SKU-bağsız sabit giderler: SMM dışındaki tüm bloklar (finansman dahil)
      const sabitGiderler = pnl.kanal + pnl.pazarlama + pnl.operasyonel + pnl.personel + pnl.diger + pnl.finansman + pnl.iadeFire;
      const toplamAdet = pnl.toplamAdet;
      const r2 = (x) => Math.round(x * 100) / 100;

      const rows = pnl.skuBazinda.map(s => {
        const prod = products.find(p => p.migros_urun_kodu === s.sku);
        const rafFiyati = s.adet > 0 ? s.brut / s.adet : 0;
        const netFiyat = settings.satis_kdv_dahil ? rafFiyati * 100 / (100 + kdvOran) : rafFiyati;
        const komisyonSonrasi = netFiyat * (1 - s.komisyonOrani / 100);
        const birimMaliyet = prod && prod.birim_maliyet !== null ? num(prod.birim_maliyet) : null;
        const dagitilanGider = toplamAdet > 0 ? sabitGiderler / toplamAdet : 0;
        const kutuBasiNetKar = komisyonSonrasi - (birimMaliyet || 0) - dagitilanGider;
        return {
          sku: s.sku, ad: s.ad, adet: s.adet,
          rafFiyati: r2(rafFiyati), netFiyat: r2(netFiyat), komisyonSonrasi: r2(komisyonSonrasi),
          birimMaliyet, dagitilanGider: r2(dagitilanGider), kutuBasiNetKar: r2(kutuBasiNetKar),
        };
      });

      // Başabaş: ağırlıklı ortalama katkı payı (komisyon sonrası − birim maliyet)
      let katkiToplam = 0, katkiAdet = 0;
      for (const r of rows) {
        if (r.birimMaliyet !== null) { katkiToplam += (r.komisyonSonrasi - r.birimMaliyet) * r.adet; katkiAdet += r.adet; }
      }
      const ortKatki = katkiAdet > 0 ? katkiToplam / katkiAdet : null;
      const breakevenAdet = ortKatki && ortKatki > 0 ? Math.ceil(sabitGiderler / ortKatki) : null;

      res.json({ rows, toplamAdet, sabitGiderler: r2(sabitGiderler), breakevenAdet });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== FATURA AI ==========
  // Dosya analiz edilir ve ayrıştırılmış JSON döner — KAYDETMEZ.
  // Kayıt her zaman kullanıcı onayından sonra POST /api/expenses ile yapılır.
  router.post('/fatura-analiz', (req, res) => {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        if (err.message === 'UNSUPPORTED_TYPE') {
          return res.status(415).json({ error: 'Desteklenmeyen dosya türü — PDF, JPG, PNG veya WebP yükleyin.' });
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'Dosya çok büyük — en fazla 15 MB.' });
        }
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) return res.status(400).json({ error: 'Dosya yüklenmedi.' });
      try {
        const parsed = await parseInvoice(req.file.buffer, req.file.mimetype);
        res.json(parsed);
      } catch (e) {
        if (e instanceof InvoiceAIError) return res.status(e.status).json({ error: e.message });
        res.status(500).json({ error: e.message });
      }
    });
  });

  // Stok sermayesi: son stok × birim maliyet
  router.get('/stok-sermayesi', async (req, res) => {
    try {
      const latest = await pool.query(`SELECT MAX(veri_tarihi) AS son FROM stok`);
      const sonTarih = latest.rows[0] && latest.rows[0].son;
      if (!sonTarih) return res.json({ toplam: 0, tarih: null, detay: [] });
      const stokRes = await pool.query(`
        SELECT "SATICI_URUN_KODU" AS sku, SUM(CAST("STOK_MIKTARI" AS NUMERIC)) AS miktar
        FROM stok WHERE veri_tarihi = $1 GROUP BY 1
      `, [sonTarih]);
      const productsRes = await pool.query(`SELECT * FROM products`);
      const r2 = (x) => Math.round(x * 100) / 100;
      let toplam = 0;
      const detay = stokRes.rows.map(row => {
        const prod = productsRes.rows.find(p => p.migros_urun_kodu === row.sku);
        const miktar = num(row.miktar) || 0;
        const bm = prod && prod.birim_maliyet !== null ? num(prod.birim_maliyet) : null;
        const tutar = bm !== null ? r2(miktar * bm) : null;
        if (tutar) toplam += tutar;
        return { sku: row.sku, ad: (prod && prod.ad) || row.sku, miktar, birimMaliyet: bm, tutar };
      });
      res.json({ toplam: r2(toplam), tarih: sonTarih, detay });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

module.exports = { financeRoutes, initializeFinanceTables, getSettings, materializeRecurring };
