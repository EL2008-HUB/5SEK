# 5SEK Production Go-Live Checklist

## ✅ Pre-Deployment Checklist

### 1. Environment Setup
- [ ] `5second-api/.env` është krijuar me vlera reale
- [ ] `JWT_SECRET` është minimum 32 karaktere (random & secure)
- [ ] `DATABASE_URL` është e saktë dhe database është e arritshme
- [ ] `NODE_ENV=production` është vendosur
- [ ] Cloudinary credentials janë konfiguruar (për video storage)
- [ ] Sentry DSN është konfiguruar (për error tracking)

### 2. Frontend Setup
- [ ] `5second-app/.env` është krijuar
- [ ] `EXPO_PUBLIC_API_URL` ka URL-në e saktë të backend
- [ ] `EXPO_PUBLIC_EAS_PROJECT_ID` është vendosur
- [ ] `metro.config.js` ekziston (për JSON imports)

### 3. Database
- [ ] Migrimet janë të aplikuara: `npm run migrate` (në backend)
- [ ] Të gjitha tabelat ekzistojnë
- [ ] Connection pooling është konfiguruar

### 4. Local Testing
- [ ] `npm test` kalon në backend
- [ ] `npm run runtime:check` kalon
- [ ] Aplikacioni hapet pa faqe të bardhë
- [ ] API responds në `http://localhost:3000/health`

---

## 🚀 Deployment Steps

### Step 1: Verify Production Ready
```powershell
.\scripts\verify-production.ps1
```

### Step 2: Run Migrations
```powershell
.\scripts\migrate-production.ps1
```

### Step 3: Deploy
```powershell
.\scripts\deploy-production.ps1 -WithLogs
```

### Step 4: Verify Deployment
```powershell
.\scripts\health-check.ps1
```

---

## 🔧 Post-Deployment Verification

### Health Checks
- [ ] `curl http://localhost:3000/health` returns `{"status":"healthy"}`
- [ ] `curl http://localhost:3000/health/detailed` shows DB: ok
- [ ] Docker containers janë RUNNING: `docker ps`

### API Verification
- [ ] Endpoint `/` liston të gjitha routes
- [ ] `/api/meta/contract` shfaq API contract
- [ ] `/api/auth` regjistron përdorues të ri

### Mobile App
- [ ] EAS build kompletohet me sukses
- [ ] Aplikacioni lidhet me backend
- [ ] Video upload funksionon (testo me një video të shkurtër)

---

## 📊 Monitoring & Maintenance

### Daily Checks
```powershell
# Status dashboard
.\scripts\production-status.ps1
```

### Log Monitoring
```bash
# View real-time logs
docker-compose -f docker-compose.production.yml logs -f api

# View errors only
docker-compose -f docker-compose.production.yml logs -f api | grep ERROR
```

### Backup Verification
- [ ] Database backup është konfiguruar (opsional: GitHub Actions nightly)
- [ ] Test restore të një backup (1x muaj)

---

## 🚨 Emergency Procedures

### App Won't Start (White Screen)
1. Check `.env` file exists in `5second-app/`
2. Run `npx expo start --clear`
3. Check Metro bundler logs

### API Down
1. Check Docker: `docker ps`
2. View logs: `docker logs 5sek_api_1`
3. Restart: `docker-compose -f docker-compose.production.yml restart api`

### Database Connection Error
1. Verifiko `DATABASE_URL` në `.env`
2. Test connection: `psql $DATABASE_URL`
3. Check if migrations ran: `npx knex migrate:status`

---

## 📞 Support Commands

| Problemi | Komanda |
|----------|---------|
| Verifikimi | `.\scripts\verify-production.ps1` |
| Deploy | `.\scripts\deploy-production.ps1` |
| Health | `.\scripts\health-check.ps1` |
| Status | `.\scripts\production-status.ps1` |
| Migration | `.\scripts\migrate-production.ps1` |
| Logs | `docker-compose -f docker-compose.production.yml logs -f` |

---

## 🎉 Go Live!

Pas të gjitha checkmarks:

1. **Deploy backend**: `.\scripts\deploy-production.ps1`
2. **Build mobile**: `eas build --platform all --profile production`
3. **Submit stores**: `eas submit --platform all`
4. **Monitor**: `.\scripts\production-status.ps1`

**PROJEKTI ËSHTË LIVE! 🚀**
