# 🚀 Migros B2B Reporting System - Kurulum Rehberi

## 📋 Sistem Mimarisi

```
rapor.kittycady.com
    ├── 🌐 Frontend (Dashboard'lar)
    │   ├── Dashboard (15 Rapor)
    │   └── Günlük Satış Analiz
    │
    ├── 🔧 Backend API (Express.js)
    │   ├── /api/login
    │   ├── /api/gunluk-satis-analiz
    │   ├── /api/isletici-satis-analiz
    │   ├── /api/stok-analiz
    │   └── /api/istatistikler
    │
    ├── 🤖 Agent (Otomatik Veri Çekme)
    │   └── Günlük 08:00, 14:00, 20:00'de çalışır
    │
    └── 💾 Database (SQLite)
        ├── gunluk_satis
        ├── isletici_satis
        ├── stok
        └── cekme_loglari
```

---

## 🖥️ Gerekli Yazılımlar

### Minimum Requirements:
- **Node.js 16+** (LTS önerilir)
- **npm 8+** veya **yarn**
- **SQLite3** (Node.js modülü ile birlikte gelir)

### İsteğe Bağlı:
- **Docker** (containerized deployment için)
- **Git** (version control için)

---

## 📥 Yükleme Adımları

### 1️⃣ Repository'yi İndir

```bash
# Git ile
git clone https://github.com/kittycady/migros-b2b-system.git
cd migros-b2b-system

# Veya manual olarak:
# GitHub'dan ZIP indir → Aç
```

### 2️⃣ .env Dosyası Oluştur

```bash
cp .env.example .env
```

`.env` dosyasını düzenle:

```bash
MIGROS_USERNAME=your_username
MIGROS_PASSWORD=your_password
SATICI_ID=your_satici_id
PORT=3000
NODE_ENV=production
DB_PATH=./data/migros-data.db
```

### 3️⃣ Dependencies Yükle

```bash
# Backend dependencies
cd backend
npm install
cd ..

# Agent dependencies
cd agent
npm install
cd ..
```

---

## 🏃 Lokal Çalıştırma

### Terminal 1 - Backend Başlat

```bash
cd backend
npm start
```

Beklenen çıktı:
```
============================================================
🚀 Migros B2B Backend Server Çalışıyor
============================================================
📍 URL: http://localhost:3000
📊 Database: ./data/migros-data.db
🏢 Satıcı ID: 39286
🌍 Environment: development
============================================================
```

### Terminal 2 - Agent Başlat

```bash
cd agent
npm start
```

Beklenen çıktı:
```
============================================================
🚀 Migros B2B Otomatik Veri Çekme Agenti
============================================================
📁 Database: ./data/migros-data.db
👤 Kullanıcı: 30368
🏢 Satıcı ID: 39286
⏰ Çekme saatleri: 8:00, 14:00, 20:00
🌍 Environment: development
============================================================

✅ Database bağlantısı kuruldu
📊 Günlük veri çekme başladı
```

### 3️⃣ Dashboard'ları Aç

```
http://localhost:3000
```

---

## 🐳 Docker ile Deployment

### Prerequisite:
- Docker yüklü olmalı
- docker-compose yüklü olmalı

### Çalıştırma:

```bash
# Build
docker-compose build

# Çalıştır
docker-compose up -d

# Logları görüntüle
docker-compose logs -f

# Durdur
docker-compose down
```

---

## 🌐 Production Deployment (Hosting'te)

### Linux VPS/Hosting (SSH Erişimi Var):

#### 1. Server'a Bağlan
```bash
ssh user@your-server.com
```

#### 2. Node.js Yükle (Eğer Yoksa)
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### 3. Repository'yi İndir
```bash
git clone https://github.com/kittycady/migros-b2b-system.git
cd migros-b2b-system
```

#### 4. .env Dosyası Oluştur
```bash
nano .env
# (Credentials'ı gir)
```

#### 5. Dependencies Yükle
```bash
cd backend && npm ci --only=production && cd ..
cd agent && npm ci --only=production && cd ..
```

#### 6. PM2 ile Çalıştır (Persistent)

```bash
# PM2 yükle
sudo npm install -g pm2

# Backend başlat
pm2 start backend/server.js --name "migros-backend" --env production

# Agent başlat
pm2 start agent/agent.js --name "migros-agent" --env production

# PM2'yi kaydet (reboot sonrası otomatik başlasın)
pm2 startup
pm2 save

# Status kontrol et
pm2 status
```

#### 7. Nginx ile Reverse Proxy (Opsiyonel)

```nginx
server {
    listen 80;
    server_name rapor.kittycady.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

#### 8. SSL Sertifikası (Let's Encrypt)

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d rapor.kittycady.com
```

---

## 🔗 DNS Ayarı (GoDaddy'de)

1. **GoDaddy Control Panel'e Gir**
2. **Domain Settings** → **DNS**
3. **Add Record**:

| Type | Name | Value |
|------|------|-------|
| A | rapor | YOUR_SERVER_IP |
| CNAME | www.rapor | rapor.kittycady.com |

---

## 📊 API Endpoints

### Health Check
```
GET /api/health
```

### Login
```
POST /api/login
```

### Günlük Satış Analiz
```
GET /api/gunluk-satis-analiz?startDate=2024-01-01&endDate=2024-01-31&storeType=1
```

### İşletici Satış Analiz
```
GET /api/isletici-satis-analiz?startDate=2024-01-01&endDate=2024-01-31
```

### Stok Analiz
```
GET /api/stok-analiz
```

### Çekme Logları
```
GET /api/cekme-loglari
```

### İstatistikler
```
GET /api/istatistikler
```

---

## 🔍 Sorun Giderme

### Problem: "Cannot find module 'express'"
**Çözüm:**
```bash
cd backend
npm install
```

### Problem: "EADDRINUSE: address already in use :::3000"
**Çözüm:**
```bash
# Port kullanan process'i bul
lsof -i :3000

# Öldür
kill -9 <PID>

# Veya farklı port kullan
PORT=3001 npm start
```

### Problem: Database boş / Veri yok
**Çözüm:**
- Agent'in çalışıp çalışmadığını kontrol et
- Credentials'ı (.env) kontrol et
- Firewall'da 443 portunun açık olduğunu kontrol et

### Problem: API timeout
**Çözüm:**
- Migros API çok yavaş olabilir
- Timeout 120 saniyeye ayarlanmıştır
- Daha uzun beklemeyi dene

---

## 📈 Monitoring

### Logs Kontrol Et
```bash
# Backend logları
pm2 logs migros-backend

# Agent logları
pm2 logs migros-agent

# Tüm loglar
pm2 logs
```

### Database İstatistikleri
```bash
sqlite3 data/migros-data.db "SELECT COUNT(*) FROM gunluk_satis;"
```

---

## 🔐 Güvenlik Notları

⚠️ **Önemli:**
- Credentials'ı GitHub'a commit etme (.gitignore'da var)
- Production'da HTTPS kullan
- Database'i güvenli şekilde backup al
- Regular olarak logs'ları kontrol et

---

## 📞 Support

Sorun yaşarsan:
1. Logları kontrol et: `pm2 logs`
2. .env dosyasını kontrol et
3. Migros API'ye manual olarak test et
4. GitHub Issues'a sorun oluştur

---

## 📋 Checklist - Production Deployment

- [ ] Node.js 16+ yüklü
- [ ] Repository klonlandı
- [ ] .env dosyası oluşturuldu ve dolduruldu
- [ ] Dependencies yüklendi
- [ ] PM2 yüklü ve çalışıyor
- [ ] Backend çalışıyor (pm2 status)
- [ ] Agent çalışıyor (pm2 status)
- [ ] Dashboard erişilebiliyor (http://server:3000)
- [ ] DNS ayarlandı
- [ ] SSL sertifikası kuruldu
- [ ] Firewall 443 portu açık
- [ ] Backup stratejisi oluşturuldu

---

**Başarılar! 🚀**
