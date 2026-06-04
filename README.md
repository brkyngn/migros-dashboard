# 📊 Migros B2B Reporting System

Kittycady PET ürünleri tedarikçi şirketi için geliştirilmiş **profesyonel veri yönetimi ve analiz sistemi**.

**Canlı Sistem:** https://rapor.kittycady.com

---

## ✨ Özellikler

### 🎯 Dashboard'lar
- ✅ **15 Farklı Rapor** - İşletici, Stok, Teslim Noktaları, E-Ticaret, vb.
- ✅ **Günlük Satış Analizi** - Grafikler, tablolar, trend analizi
- ✅ **Mağaza Takibi** - Mağaza başı satış özeti
- ✅ **Ürün Analizi** - En çok satılan ürünler, performans

### 🤖 Otomasyonu
- ✅ **Otomatik Veri Çekme** - Günde 3 kez (08:00, 14:00, 20:00)
- ✅ **Anlık Güncelleme** - Database otomatik senkronizasyon
- ✅ **Hata Yönetimi** - Tüm işlemler loglaniyor

### 🔒 Güvenlik
- ✅ **Migros API Authentication** - SHA1 ConnectionCode
- ✅ **HTTPS/SSL** - Şifreli bağlantı
- ✅ **Environment Variables** - Credentials güvenli depolama

### 📈 Performans
- ✅ **Lightning Fast** - Statik HTML + Express API
- ✅ **Lightweight Database** - SQLite (MB cinsinden)
- ✅ **Scalable Architecture** - Docker deployment hazır

---

## 🏗️ Sistem Mimarisi

```
┌─────────────────────────────────────────┐
│   Frontend (HTML + Chart.js)            │
│   - 15 Rapor Dashboard                  │
│   - Günlük Satış Analiz                 │
│   - Real-time Grafikler                 │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│   Express.js Backend API                │
│   - /api/login                          │
│   - /api/gunluk-satis-analiz            │
│   - /api/isletici-satis-analiz          │
│   - /api/stok-analiz                    │
│   - /api/istatistikler                  │
└──────────────┬──────────────────────────┘
               │
┌──────────────┼──────────────────────────┐
│              │                          │
│    Migros    │         Agent            │
│    API       │  (Veri Çekme)            │
│    (HTTPS)   │                          │
│              │    ┌─────────────┐       │
│              └───►│  SQLite DB  │       │
│                   └─────────────┘       │
└──────────────────────────────────────────┘
```

---

## 🚀 Hızlı Başlangıç

### Requirement'ler
- Node.js 16+
- npm 8+

### Kurulum

```bash
# 1. Repository'yi indir
git clone https://github.com/kittycady/migros-b2b-system.git
cd migros-b2b-system

# 2. .env dosyası oluştur
cp .env.example .env
# Credentials'ı düzenle

# 3. Dependencies yükle
cd backend && npm install && cd ..
cd agent && npm install && cd ..

# 4. Backend başlat (Terminal 1)
cd backend && npm start

# 5. Agent başlat (Terminal 2)
cd agent && npm start

# 6. Dashboard'ı aç
# http://localhost:3000
```

**Detaylı kurulum için:** [KURULUM.md](./KURULUM.md)

---

## 📁 Proje Yapısı

```
migros-b2b-system/
├── frontend/
│   ├── dashboard.html           # 15 rapor (ana dashboard)
│   ├── gunluk-satis-analiz.html # Satış analiz dashboard'u
│   └── ...
├── backend/
│   ├── server.js                # Express API server
│   └── package.json
├── agent/
│   ├── agent.js                 # Otomatik veri çekme
│   └── package.json
├── data/
│   └── migros-data.db          # SQLite database
├── docs/
│   ├── KURULUM.md              # Türkçe kurulum rehberi
│   └── API.md
├── .env.example                 # Environment template
├── .gitignore
├── docker-compose.yml           # Docker deployment
├── Dockerfile.backend
├── Dockerfile.agent
└── README.md
```

---

## 📊 Veritabanı Şeması

### gunluk_satis
```sql
- DateTransaction (DATETIME)
- SupplierItemName (TEXT)
- QuantitySold (INTEGER)
- NetSalesValue (DECIMAL)
- StoreName (TEXT)
- StoreType (1=MMM, 2=MM, 3=M)
```

### isletici_satis
```sql
- FisNo (TEXT)
- FisTarihi (DATETIME)
- TeslimNoktasiAdi (TEXT)
- ToplamTutar (DECIMAL)
```

### stok
```sql
- MalNo (TEXT)
- MalAdi (TEXT)
- StokMiktari (INTEGER)
```

### cekme_loglari
```sql
- raport_adi (TEXT)
- durum (BAŞARILI/BAŞARISIZ/HATA)
- satir_sayisi (INTEGER)
- cekme_tarihi (DATETIME)
```

---

## 🔌 API Endpoints

### Health Check
```
GET /api/health
Response: { status: "ok", timestamp: "...", env: "production" }
```

### Günlük Satış Analiz
```
GET /api/gunluk-satis-analiz?startDate=2024-01-01&endDate=2024-01-31&storeType=1

Response:
{
  "totalSales": 125000.50,
  "totalItems": 8500,
  "transactionCount": 2300,
  "avgOrder": 54.35,
  "dailySales": { "2024-01-01": 5000, ... },
  "storeTypes": { "MMM": 1200, "MM": 800, "M": 300 },
  "topProducts": [...],
  "topStores": [...]
}
```

### İşletici Satış Analiz
```
GET /api/isletici-satis-analiz?startDate=2024-01-01&endDate=2024-01-31

Response:
{
  "total": 150,
  "byDate": { "2024-01-01": 5, ... },
  "topStores": [...]
}
```

### Stok Analiz
```
GET /api/stok-analiz

Response:
{
  "total": 850,
  "topItems": [...]
}
```

---

## 🐳 Docker Deployment

```bash
# Build
docker-compose build

# Çalıştır
docker-compose up -d

# Logları görüntüle
docker-compose logs -f backend

# Durdur
docker-compose down
```

---

## 🔄 Otomatik Veri Çekme (Agent)

Agent günde **3 kez** otomatik olarak çalışır:
- **08:00** - Sabah çekme
- **14:00** - Öğleden sonra çekme
- **20:00** - Akşam çekme

Çekilen veriler:
1. Günlük Satış (son 24 saat)
2. İşletici Satış (güncel)
3. Stok Bilgileri

Tüm işlemler `cekme_loglari` tablosunda kaydedilir.

---

## 🌐 Production Deployment

### DigitalOcean/AWS/VPS Üzerine

1. **SSH ile bağlan**
2. **Node.js 18 yükle**
3. **Repository klonla**
4. **.env dosyasını yapılandır**
5. **npm install çalıştır**
6. **PM2 ile çalıştır:**

```bash
pm2 start backend/server.js --name "migros-backend"
pm2 start agent/agent.js --name "migros-agent"
pm2 startup && pm2 save
```

7. **Nginx Reverse Proxy**
8. **Let's Encrypt SSL**

**Detaylı:** [KURULUM.md](./KURULUM.md#-production-deployment-hostingde)

---

## 📈 Teknik Stack

| Component | Technology |
|-----------|------------|
| Frontend | HTML5, CSS3, Chart.js |
| Backend | Node.js, Express.js |
| Database | SQLite3 |
| API | RESTful |
| Authentication | Migros B2B API (SHA1) |
| Deployment | Docker, PM2 |
| Monitoring | PM2 Plus (optional) |

---

## 🔐 Güvenlik

✅ **Best Practices:**
- Environment variables ile credentials depolama
- HTTPS/SSL enforced
- SHA1 ConnectionCode authentication
- Input validation
- Rate limiting (isteğe bağlı)

⚠️ **Yapılması Gerekenler:**
- Database'i düzenli backup al
- Firewall konfigürasyonu kontrol et
- Regular security updates

---

## 📊 Monitoring

### Logları Görüntüle
```bash
pm2 logs migros-backend
pm2 logs migros-agent
```

### Status Kontrol Et
```bash
pm2 status
```

### Database Boyutu
```bash
du -h data/migros-data.db
```

---

## 🤝 Katkıda Bulun

Bug buldum → Issues açın
İyileştirme fikrim var → Pull request gönderin

---

## 📄 License

MIT License - Açık kaynak

---

## 📞 İletişim

**Şirket:** Kittycady (BT PET ÜRÜNLERİ LİMİTED ŞİRKETİ)  
**Satıcı ID:** 39286  
**Email:** support@kittycady.com

---

## 🙏 Teşekkürler

Migros B2B API'sine ve tüm katkıda bulunanlara teşekkürler! 🎉

---

**Made with ❤️ by Kittycady | 2024**
