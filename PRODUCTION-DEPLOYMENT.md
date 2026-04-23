# 5SEK Production Deployment Guide

## Përmbledhje e Hapave të Production

| Hapi | Përshkrimi | Status |
|------|-----------|--------|
| 1 | Environment Variables Setup | ✅ Kompletuar |
| 2 | Database Migration | ✅ Kompletuar |
| 3 | Docker Build | ✅ Kompletuar |
| 4 | SSL/Nginx Setup | ✅ Kompletuar |
| 5 | Health Monitoring | ✅ Kompletuar |
| 6 | Deployment Scripts | ✅ Kompletuar |

---

## 🚀 Hapat për të Shkuar Live

### **HAPI 1: Konfigurimi i Environment Variables**

#### Backend (`5second-api/.env`)
```env
NODE_ENV=production
PORT=3000
JWT_SECRET=your-strong-secret-here-min-32-chars
DATABASE_URL=postgres://user:pass@host:5432/fivesek
INLINE_BACKGROUND_WORKER=false
INLINE_INJECTION_WORKER=false

# Cloudinary (Required for video storage)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Sentry (Error tracking)
SENTRY_DSN=https://your-key@o0.ingest.sentry.io/0
```

#### Frontend (`5second-app/.env`)
```env
EXPO_PUBLIC_API_URL=https://api.yourdomain.com/api
EXPO_PUBLIC_EAS_PROJECT_ID=your-eas-project-id
EXPO_PUBLIC_SENTRY_DSN=https://your-key@o0.ingest.sentry.io/0
EXPO_PUBLIC_SENTRY_ENVIRONMENT=production
```

**Template gati:** `.env.production.template` në root të projektit

---

### **HAPI 2: Database Migration**

```bash
cd 5second-api
npm run migrate
```

**Verifikimi:**
```bash
# Check migrations status
npx knex migrate:status
```

---

### **HAPI 3: Build & Deploy me Docker**

#### A) Deploy me PowerShell Script (Rekomanduar)

```powershell
# Hap Powershell si Administrator
# Vendos në folderin e projektit
cd c:\Users\eb826\OneDrive\Desktop\5SEK

# Vrapo deployment script
.\scripts\deploy-production.ps1

# Me logje live
.\scripts\deploy-production.ps1 -WithLogs

# Vetëm build, pa deploy
.\scripts\deploy-production.ps1 -BuildOnly
```

#### B) Deploy Manual me Docker Compose

```bash
# Build images
docker-compose -f docker-compose.production.yml build --no-cache

# Start services
docker-compose -f docker-compose.production.yml up -d

# View logs
docker-compose -f docker-compose.production.yml logs -f

# Stop services
docker-compose -f docker-compose.production.yml down
```

---

### **HAPI 4: SSL & Nginx Setup (Opcional por rekomanduar)**

```bash
# Nginx setup
1. Kopjo certifikatat në nginx/ssl/
   - cert.pem
   - key.pem

2. Ndrysho "api.yourdomain.com" në nginx/nginx.conf

3. Start nginx
cd nginx
docker-compose -f docker-compose.nginx.yml up -d
```

---

### **HAPI 5: Health Check & Monitoring**

```powershell
# Verifiko shëndetin e sistemit
.\scripts\health-check.ps1
```

**Manual check:**
```bash
# Basic health
curl http://localhost:3000/health

# Detailed health (me DB, Stripe, Cloudinary status)
curl http://localhost:3000/health/detailed

# API Contract
curl http://localhost:3000/api/meta/contract
```

---

### **HAPI 6: Mobile App Build (EAS)**

```bash
cd 5second-app

# Login në Expo
npx eas-cli login

# Build production iOS
eas build --platform ios --profile production

# Build production Android
eas build --platform android --profile production

# Submit në stores (pas build-it të suksesshëm)
eas submit --platform ios
eas submit --platform android
```

---

## 📁 Struktura e Skedarëve të Krijuar

```
5SEK/
├── .env.production.template          # Template për environment
├── docker-compose.production.yml     # Docker production config (updated)
├── PRODUCTION-DEPLOYMENT.md          # Ky dokument
├── nginx/
│   ├── nginx.conf                    # Nginx reverse proxy config
│   └── docker-compose.nginx.yml      # Nginx docker compose
└── scripts/
    ├── deploy-production.ps1         # PowerShell deployment script
    └── health-check.ps1              # Health check script
```

---

## 🔧 Komandat e Rëndësishme për Maintenance

### Docker Management
```bash
# Shiko containerat
docker-compose -f docker-compose.production.yml ps

# Restart një shërbim
docker-compose -f docker-compose.production.yml restart api

# Update një shërbim pa ndalur të tjerët
docker-compose -f docker-compose.production.yml up -d --no-deps --build api

# View resource usage
docker stats
```

### Database Backup
```bash
cd 5second-api
npm run backup:db
```

### Media Cleanup
```bash
cd 5second-api
npm run cleanup:media
```

---

## 🏗️ Arkitektura e Production

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENTS                             │
│              (iOS App / Android App / Web)                  │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                      NGINX (443)                              │
│            SSL Termination + Reverse Proxy                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                      API (Port 3000)                          │
│                   Express.js Server                         │
│  ┌──────────────┬──────────────┬──────────────┐             │
│  │  /api/auth   │ /api/upload  │ /api/payments│             │
│  │ /api/questions│ /api/duels │ /api/push    │             │
│  └──────────────┴──────────────┴──────────────┘             │
└─────────────────────────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌───────────┐  ┌───────────┐  ┌───────────┐
│  WORKER   │  │  INJECTOR │  │ PostgreSQL│
│  (Jobs)   │  │(Scheduler)│  │ (Database)│
└───────────┘  └───────────┘  └───────────┘
        │              │              │
        └──────────────┼──────────────┘
                       ▼
              ┌──────────────┐
              │  Cloudinary  │
              │(Video Storage)│
              └──────────────┘
```

---

## ✅ Checklist para se të shkosh Live

- [ ] `.env` file është konfiguruar me vlera reale
- [ ] `JWT_SECRET` është minimum 32 karaktere i gjatë
- [ ] Database URL është e saktë dhe e arritshme
- [ ] Cloudinary credentials janë të vlefshme
- [ ] Migrimet janë të aplikuara në database
- [ ] Testet kalojnë (`npm test` në backend)
- [ ] Docker images ndërtohen me sukses
- [ ] Health check returns "healthy"
- [ ] SSL certifikatat janë të instalura (nëse përdor Nginx)
- [ ] Sentry është konfiguruar për error tracking
- [ ] Backup strategy është e konfiguruar

---

## 🆘 Troubleshooting

### Problem: Container nuk starton
```bash
# Check logs
docker-compose -f docker-compose.production.yml logs api

# Check environment
docker-compose -f docker-compose.production.yml exec api env
```

### Problem: Database connection error
```bash
# Verifiko DATABASE_URL
docker-compose -f docker-compose.production.yml exec api echo $DATABASE_URL

# Test connection manually
docker-compose -f docker-compose.production.yml exec api npx knex migrate:status
```

### Problem: Health check failing
```bash
# Inside container
docker-compose -f docker-compose.production.yml exec api wget -qO- http://localhost:3000/health
```

---

## 📞 Kontakt & Mbështetje

Për probleme gjatë deployment, verifiko:
1. Logs e containerave (`docker-compose logs`)
2. Environment variables (`docker-compose exec api env`)
3. Health endpoint (`curl http://localhost:3000/health/detailed`)

---

**Produkti është gati për production! 🚀**
