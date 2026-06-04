# 📁 Migros B2B System - Proje Yapısı

```
migros-b2b-system/
│
├── 📄 README.md                    # Ana dokumentasyon (GitHub)
├── 📄 KURULUM.md                   # Detaylı kurulum rehberi (Türkçe)
├── 📄 package.json                 # Root package (parent scripts)
├── 📄 .env.example                 # Environment template
├── 📄 .gitignore                   # Git ignore dosyası
│
├── 🐳 docker-compose.yml           # Docker deployment
├── 🐳 Dockerfile.backend           # Backend container
├── 🐳 Dockerfile.agent             # Agent container
│
├── 📁 frontend/
│   ├── 📊 dashboard.html           # 15 Rapor (Ana Dashboard)
│   ├── 📈 gunluk-satis-analiz.html # Günlük Satış Analiz
│   └── ... (diğer dashboard'lar)
│
├── 📁 backend/
│   ├── 🔧 server.js                # Express API Server
│   ├── 📄 package.json             # Backend dependencies
│   └── 📋 Migros API Endpoints:
│       ├── GET /api/health
│       ├── POST /api/login
│       ├── GET /api/gunluk-satis-analiz
│       ├── GET /api/isletici-satis-analiz
│       ├── GET /api/stok-analiz
│       ├── GET /api/cekme-loglari
│       └── GET /api/istatistikler
│
├── 📁 agent/
│   ├── 🤖 agent.js                 # Otomatik Veri Çekme Servisi
│   ├── 📄 package.json             # Agent dependencies
│   └── ⏰ Schedule: 08:00, 14:00, 20:00
│
├── 📁 data/ (oluşturulacak)
│   └── 💾 migros-data.db           # SQLite Database
│
├── 📁 docs/
│   ├── API.md                      # API Dokumentasyonu
│   ├── DATABASE.md                 # Database Şeması
│   └── DEPLOYMENT.md               # Deployment Rehberi
│
└── 📁 scripts/ (opsiyonel)
    ├── backup.sh                   # Database Backup
    └── deploy.sh                   # Deployment Otomasyonu
```

---

## 📊 Dosya Açıklamaları

### 🌐 Frontend Dosyaları

| Dosya | İçerik |
|-------|--------|
| `dashboard.html` | 15 farklı Migros raporu (İşletici, Stok, Teslim, vb.) |
| `gunluk-satis-analiz.html` | Günlük satış verilerinin işlenmesi ve grafikleri |

### 🔧 Backend Dosyaları

| Dosya | Açıklama |
|-------|----------|
| `server.js` | Express.js server, API endpoints, database işlemleri |
| `package.json` | Dependencies: express, cors, sqlite3, dotenv |

### 🤖 Agent Dosyaları

| Dosya | Açıklama |
|-------|----------|
| `agent.js` | Otomatik veri çekme, scheduler, database kayıt |
| `package.json` | Dependencies: sqlite3, dotenv |

### 📁 Data (Auto-created)

| Dosya | Açıklama |
|-------|----------|
| `migros-data.db` | SQLite database (otomatik oluşturulur) |

---

## 🗄️ Database Tabloları

### 1. gunluk_satis
```sql
- id (INTEGER)
- DateTransaction (TEXT)
- SupplierCode (TEXT)
- SupplierName (TEXT)
- StoreType (TEXT)
- StoreName (TEXT)
- SupplierItemName (TEXT)
- QuantitySold (TEXT)
- NetSalesValue (TEXT)
- createdAt (DATETIME)
```

### 2. isletici_satis
```sql
- id (INTEGER)
- FisNo (TEXT)
- FisTarihi (TEXT)
- TeslimNoktasiAdi (TEXT)
- SaticiAdi (TEXT)
- ToplamTutar (TEXT)
- createdAt (DATETIME)
```

### 3. stok
```sql
- id (INTEGER)
- SaticiId (TEXT)
- MalNo (TEXT)
- MalAdi (TEXT)
- StokMiktari (TEXT)
- createdAt (DATETIME)
```

### 4. cekme_loglari
```sql
- id (INTEGER)
- raport_adi (TEXT)
- durum (TEXT) [BAŞARILI/BAŞARISIZ/HATA]
- satir_sayisi (INTEGER)
- mesaj (TEXT)
- cekme_tarihi (DATETIME)
```

---

## 🔄 İş Akışı

### 1. Başlangıç
```
┌─────────────┐
│ npm install │ (Tüm dependencies yüklenir)
└──────┬──────┘
       │
       ▼
┌────────────────────┐
│ Backend başlat     │
│ (Express server)   │
└──────┬─────────────┘
       │
       ▼
┌────────────────────┐
│ Agent başlat       │
│ (Scheduler)        │
└──────┬─────────────┘
       │
       ▼
┌────────────────────┐
│ Dashboard açıl     │
│ (http://3000)      │
└────────────────────┘
```

### 2. Otomatik Veri Çekme (Agent)
```
⏰ 08:00, 14:00, 20:00
   │
   ▼
┌──────────────────────┐
│ Migros API'ye login  │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Veri çek:            │
│ - Günlük Satış       │
│ - İşletici Satış     │
│ - Stok               │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ SQLite'e kaydet      │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Log kaydı            │
│ (Başarılı/Hata)      │
└──────────────────────┘
```

### 3. Dashboard İsteği
```
Dashboard
   │
   ▼
┌─────────────────────────┐
│ Browser (http://3000)   │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Express API             │
│ GET /api/gunluk-satis-analiz
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ SQLite Query            │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Analiz (sum, count)     │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ JSON Response           │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Chart.js Grafikleri     │
│ + Tablolar              │
└─────────────────────────┘
```

---

## 🚀 Deployment Seçenekleri

### ✅ Lokal Geliştirme
```bash
npm install-all
npm run dev
# Terminal 1: Backend çalışıyor
# Terminal 2: Agent çalışıyor
```

### ✅ Production (Linux VPS)
```bash
npm install-all
pm2 start backend/server.js
pm2 start agent/agent.js
# Server'da 24/7 çalışıyor
```

### ✅ Docker (Containerized)
```bash
docker-compose up -d
# Hem backend hem agent çalışıyor
```

---

## 📝 Konfigürasyon (.env)

```env
# Migros Credentials
MIGROS_USERNAME=30368
MIGROS_PASSWORD=Bjkbjk1903!
SATICI_ID=39286

# Server
PORT=3000
NODE_ENV=production

# Database
DB_PATH=./data/migros-data.db

# Agent Schedule
# CRON: 0 8,14,20 * * * (Varsayılan)
```

---

## 🔍 Monitoring

### PM2 ile
```bash
pm2 status                    # Process durumu
pm2 logs migros-backend      # Backend logs
pm2 logs migros-agent        # Agent logs
pm2 monit                    # Canlı monitoring
```

### Health Check
```bash
curl http://localhost:3000/api/health
# {"status":"ok","timestamp":"...","env":"production"}
```

---

## ✅ Pre-Deployment Checklist

- [ ] Node.js 16+ kurulu
- [ ] .env dosyası yapılandırıldı
- [ ] npm install-all çalıştırıldı
- [ ] Backend başlıyor (npm run backend)
- [ ] Agent başlıyor (npm run agent)
- [ ] Dashboard açılıyor (http://localhost:3000)
- [ ] Database oluşturuluyor (data/migros-data.db)
- [ ] API endpoints'ler yanıt veriyor
- [ ] Loglar temiz (hata yok)
- [ ] Firewall 443 portu açık (Migros API için)

---

## 📞 Sorun Çözme

| Sorun | Çözüm |
|-------|-------|
| Module bulunamıyor | `npm install-all` çalıştır |
| Port meşgul | `lsof -i :3000` → `kill -9 PID` |
| Database yok | Agent'i kontrol et, login başarılı mı? |
| API timeout | Firewall kontrol et, 443 portu açık mı? |
| Loglar görmüyorum | `pm2 logs` çalıştır |

---

**Başarılı deployment dileriz! 🚀**
