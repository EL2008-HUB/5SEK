# 5SEK — Përmbledhje e aplikacionit

Dokument i përditësuar: **28 shtator 2026**

## 1. Çfarë është 5SEK?

**5SEK** është një aplikacion social i fokusuar në përgjigje të shpejta (video, audio, tekst) ndaj pyetjeve — shpesh brenda **5 sekondave**. Përdoruesit shohin pyetjen e ditës, regjistrojnë përgjigjen, votojnë dhe ndajnë përmbajtjen, marrin pjesë në **duele 1v1**, shohin **feed** vertikal (stil TikTok), dhe garojnë në **renditje javore**.

Marka dhe domene të planifikuara: **5sek.app**, API publike (synimi) **api.5sek.app**, bundle/package **`app.fivesek.mobile`**.

---

## 2. Arkitektura e përgjithshme

Projekti është **monorepo** në një folder (`C:\dev\5SEK`):

| Shtresë | Teknologji | Hyrja |
|--------|------------|--------|
| **Klient mobil + web** | Expo SDK 54, React Native 0.81, React 19, TypeScript | `index.ts` → `App.tsx` |
| **API backend** | Node.js, Express 5 | `server.js` → `src/app.js` |
| **Databazë** | PostgreSQL, Knex (migrime) | `src/db/`, `knexfile.js` |
| **Kontratë API** | JSON i përbashkët klient–server | `shared/api-contract.json` |

Në zhvillim lokal, zakonisht punojnë **tre procese**:

1. Postgres lokal (port **5544**)
2. API (`npm run start:api`, port **3000**)
3. Metro / Expo (`npx expo start`, port **8081**)

---

## 3. Klienti (aplikacioni mobil dhe web)

### 3.1 Stack dhe UI

- **Expo** me **New Architecture** të aktivizuar, modalitet i errët (`#050508`), gradientë rozë/vjollcë (`src/theme.ts`).
- **React Navigation**: stack + bottom tabs; **safe areas** përmes `react-native-safe-area-context` dhe hook-ut `useScreenInsets`.
- **Gjuha e UI-së**: kryesisht **shqip** në ekranet kryesore (Kreu, Auth, onboarding, renditja).

### 3.2 Navigimi

**Tabs (Main):**

| Tab | Ekran | Përshkrim i shkurtër |
|-----|--------|----------------------|
| Kreu | `HomeScreen` | Pyetja e ditës, CTA për përgjigje, teaser renditje |
| Duele | `DuelsScreen` | Lista dhe votim duelesh |
| 5 SEK | `RecordScreen` | Regjistrim video 5s (kamera) |
| Feed | `FeedScreen` | Feed vertikal, votim, share |
| Profili | `ProfileScreen` | Profili, upgrade guest, cilësime |

**Stack (pa tab):** Auth, First Session (onboarding), Text/Audio Answer, Deep Answer / Challenge, Duel nga link, Leaderboard, Upgrade Account, Remix Record.

**Fluksi i hyrjes:**

1. Pa token → `AuthScreen` (login, register, **vizitor/guest**).
2. Me token, hera e parë → `FirstSessionFlowScreen`.
3. Pastaj → tabs + stack.

### 3.3 Kontekste dhe shërbime klienti

| Modul | Rol |
|-------|-----|
| `AuthContext` | Sesion, JWT + refresh token, guest, upgrade llogarie |
| `ConnectivityContext` | Gjendja e rrjetit |
| `PushContext` | Leje njoftimesh, Expo push token (jo plotësisht në Expo Go) |
| `FusionLoopContext` | Loop “fusion” / engagement në app |
| `api.ts` | Axios, base URL, refresh token, header shtet/contract |
| `storage.ts` | Tokenët në **SecureStore** (çelësa të vlefshëm native), tjetër në AsyncStorage |
| `deepLinks.ts` / `pendingDeepLink.ts` | Hapje nga linku, pritje derisa auth/onboarding të përfundojë |
| `observability.ts` | Sentry (React Native) |
| `analytics` / `eventTracker` | Ngjarje produkti drejt API-së |

### 3.4 Lidhja me API-n

- **Dev (Expo Go / telefon në Wi‑Fi):** API zakonisht `http://<IP-ja-e-PC>:3000/api` (inferohet nga Metro ose `.env`).
- **Build EAS (preview/production):** `EXPO_PUBLIC_API_URL` nga `eas.json` (p.sh. Render).
- **Release standalone:** fallback në prod nëse nuk ka URL të konfiguruar — nuk përdoret `localhost` në telefon.

### 3.5 Deep links dhe rritje virale

**Skema:** `five-second://` dhe **https://5sek.app** (plus www).

| Rrugë | Qëllimi |
|-------|---------|
| `/a/:id`, `answer/:id` | Shiko përgjigjen e ndarë |
| `/c/:id` | Sfidë ndaj përgjigjes së dikujt |
| `/d/:id` | Duel nga link |
| `/q/:id` | Hap regjistrimin me pyetje |
| `/feed`, `/invite` | Ftesë / feed |

Backend shërben **faqe HTML landing** (Open Graph) për `/a`, `/c`, `/q`, `/d`, `/feed` — `src/services/shareLanding.js`.

---

## 4. Backend (API)

### 4.1 Nisja

`server.js`:

- Ngarkon env (`bootstrapEnv`), validon `validateRuntimeEnv`, **Sentry** server.
- Ekzekuton **migrimet** Knex.
- Dëgjon në `0.0.0.0:PORT` (default **3000**).
- Nis **workerë inline** sipas env (background jobs, duel scheduler, injection engine).

### 4.2 Middleware dhe siguri

- CORS me allowlist, headers sigurie (HSTS në prod, nosniff, etj.).
- Detektim **shteti** (`X-User-Country` ose GeoIP → `GLOBAL`).
- Logging request, metrika HTTP, rate limiting (routes specifike).
- Gjatë boot-it, `/api/*` kthen **503** derisa `startupState.ready`.

### 4.3 Endpoint-e publike (jo vetëm `/api`)

| Path | Përshkrim |
|------|-----------|
| `/health`, `/ready` | Shëndet / gati për load balancer |
| `/api/meta/contract` | Versioni dhe feature flags e kontratës |
| `/legal/terms`, `/legal/privacy` | HTML legal |
| `/.well-known/apple-app-site-association` | Universal Links iOS |
| `/.well-known/assetlinks.json` | App Links Android |
| `/metrics` | Prometheus (i mbrojtur) |
| `/a/:id`, `/c/:id`, … | Landing pages për share |

### 4.4 API REST (`/api/...`)

| Prefix | Funksion |
|--------|----------|
| `/api/auth` | Register, login, guest, refresh, logout, profil |
| `/api/questions` | Pyetje ditore, trending, sipas ID |
| `/api/answers` | Krijim, listim, like, share metadata |
| `/api/duels` | Duele 1v1, votim, gjendje |
| `/api/leaderboard` | Renditja javore |
| `/api/feed` (përmes answers/composer) | Përmbajtje feed |
| `/api/uploads` | Media (Cloudinary ose dev lokal) |
| `/api/events`, `/api/analytics` | Ngjarje klienti, agregime |
| `/api/push` | Regjistrim token push |
| `/api/payments`, `/api/paywall` | PayPal / paywall |
| `/api/ai` | Groq (përmbajtje/AI) |
| `/api/moderation`, `/api/admin` | Moderim dhe panel admin |
| `/api/share` | Tracking share |
| `/api/drops`, `/api/fusion` | Drops dhe fusion loop |
| `/api/user-questions` | Pyetje të krijuara nga përdoruesit |
| `/api/comments`, `/api/support`, `/api/legal` | Komente, support, legal API |

Autentifikimi: **JWT** (access + refresh), `bcryptjs` për fjalëkalime, rolet përfshijnë **guest** dhe përdorues të regjistruar.

---

## 5. Databaza

- **PostgreSQL** me **Knex migrations** (`src/db/migrations/` — dhjetëra migrime: përgjigje, duele, feed v3, push, paywall, trust score, remix, fusion, guest, likes, etj.).
- Lokal: DB **`fivesek_root_dev`**, port **5544** (`npm run db:local:start`).
- Seed: `npm run seed:dev`, migrime seed (p.sh. pyetje fillestare).

Entitete kryesore (logjikisht): **users**, **questions**, **answers** (video/audio/text), **duels**, **votes/likes**, **leaderboard**, **events**, **jobs**, **push tokens**, **payments/subscriptions**, **moderation**.

---

## 6. Si funksionon produkti (rrjedha)

### 6.1 Pyetja e ditës dhe përgjigja

1. Kreu merr `/api/questions/daily` (proof social, countdown, etiketa shqip).
2. Përdoruesi hap **Record** (video), **Tekst** ose **Audio**.
3. Përgjigja ngarkohet (Cloudinary në prod), lidhet me pyetjen, shfaqet në feed.

### 6.2 Feed

- Scroll vertikal, kartat (`VideoCard`), votim, share overlay (WhatsApp, link `/c/` për sfidë).
- Feed lokal vs global (header AL/GLOBAL).
- Offline banner dhe cache pyetjesh ku aplikohet.

### 6.3 Duele

- Çift përgjigjesh, votim A/B, timer, share duel me `/d/:id`.
- Worker/scheduler: mbyllje duelesh, maintenance (`duelService`, `INLINE_DUEL_WORKER`).

### 6.4 Renditja dhe guest

- **Leaderboard** javore; teaser në Kreu.
- **Guest login** pa email; **upgrade** në llogari të plotë (`UpgradeAccountScreen`).

### 6.5 Remix, drops, fusion

- **Remix**: përgjigje ndaj përgjigjes së dikujt (`RemixRecordScreen`, deep link).
- **Drops**: pyetje të planifikuara “drop”.
- **Fusion loop**: gamifikim / streak në UI (`FusionBadgeToast`, `FloatingPrompt`).

### 6.6 Monetizim

- Paywall modal, PayPal (sandbox në dev), feature flag `monetizationEnabled` (off në prod build sipas `eas.json`).

---

## 7. Workerë dhe procese në background

| Worker | Skript / trigger | Përshkrim |
|--------|------------------|-----------|
| Background jobs | `scripts/run-job-worker.js` / inline | Punë të përgjithshme (audit, cleanup, etj.) |
| Injection engine | `run-injection-worker.js` / scheduler | Fut pyetje të reja / injection content |
| Duel maintenance | inline scheduler | Duele, skadime |
| Docker prod | `docker-compose.production.yml` | API + **worker** + **injection-worker** + **duel-worker** + Postgres |

Në **Render** (free tier) shpesh përdoret **një instancë API** me workerë **inline** (`INLINE_*=true`, `SINGLE_INSTANCE_WORKERS`).

---

## 8. Integrime të jashtme

| Shërbim | Përdorim |
|---------|----------|
| **Cloudinary** | Video/audio/image upload dhe CDN |
| **Groq** | AI (modele fallback në server) |
| **PayPal** | Pagesa / abonime (env lokal `.env.local`) |
| **Sentry** | Gabime klient + server |
| **Expo Push** | Njoftime (kërkon build të vërtetë, jo plotësisht Expo Go SDK 53+) |
| **geoip-lite** | Shtet nga IP në API |

---

## 9. Infrastrukturë dhe deploy

### 9.1 Zhvillim lokal (Windows)

```powershell
npm run db:local:start
npm run start:api
npx expo start --port 8081
```

- Postgres: `C:\dev\pgdata`, port **5544**
- Firewall: lejo **3000** dhe **8081** për telefonin

### 9.2 Docker (prod-like)

- `docker-compose.production.yml`: Postgres 16, API, workerë të ndarë, healthcheck `/ready`
- `Dockerfile`: Node 20 Alpine, `npm ci --omit=dev`

### 9.3 Render

- `render.yaml`: web service **5sek-api**, Postgres **5sek-db**, env JWT/Cloudinary/Groq (sync manual)
- URL e konfiguruar në EAS: `https://5sek-api.onrender.com/api` (duhet deploy i suksesshëm që telefonat në prod të lidhen)

### 9.4 Mobile builds (EAS)

- `eas.json`: profile **preview** (APK Android, IPA internal), **production** (AAB + store)
- Skript: `scripts/build-phones.ps1`, `npm run build:android` / `build:ios`
- Kërkon: `npx eas-cli login`; iOS kërkon **Apple Developer** për nënshkrim

### 9.5 Nginx / SSL

- Folder `nginx/` dhe udhëzime në `PRODUCTION-DEPLOYMENT.md` (reverse proxy, certifikata)

---

## 10. Konfigurim mjedisi

- Shembuj: `.env.example`, `.env.development.example`, `.env.production.template`
- Lokal (jo commit): `.env`, `.env.local`, `.env.production.local`
- **`app.config.js`**: lexon env, plugins (camera, notifications, secure-store, Sentry), bundle ID, intent filters Android, associated domains iOS
- **`eas.json`**: URL API/web për build cloud; nuk mbishkruhet nga `.env` lokal gjatë preview/production

Variabla kyçe:

- Backend: `DATABASE_URL`, `JWT_SECRET`, `CLOUDINARY_*`, `GROQ_API_KEY`, `SENTRY_DSN`, `INLINE_*_WORKER`
- Frontend: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_URL`, `EXPO_PUBLIC_EAS_PROJECT_ID`, Sentry publik

---

## 11. Cilësi dhe teste

- **TypeScript:** `npm run typecheck`
- **Teste Node:** `npm test` — **42** teste në `test/` (duel, feed, share landing, upload, route hardening, etj.)
- **Smoke:** `npm run smoke`

---

## 12. Strukturë folderësh (e thjeshtuar)

```
5SEK/
├── App.tsx                 # Root React, Sentry, providers
├── app.config.js / app.json
├── eas.json
├── server.js               # Entry API
├── assets/                 # Ikona, splash (PNG 1024 për store)
├── scripts/                # DB lokal, deploy, build telefonash, workerë
├── shared/api-contract.json
├── src/
│   ├── screens/            # Ekranet UI
│   ├── components/         # Kartat, bannerat, modals
│   ├── navigation/         # AppNavigator, deep linking
│   ├── context/            # Auth, Push, Connectivity, Fusion
│   ├── services/           # api.ts, analytics, storage, deepLinks
│   ├── controllers/        # Logjikë HTTP (Express)
│   ├── routes/             # Router Express
│   ├── db/migrations/      # Skema Postgres
│   └── services/*.js       # Biznes: feed, duel, injection, AI, etj.
├── test/
├── docker-compose.production.yml
├── render.yaml
└── PERMBLEDHJE-5SEK.md     # Ky dokument
```

---

## 13. Gjendje aktuale dhe hapa të ardhshëm

| Tema | Gjendje |
|------|---------|
| Dev lokal | Funksional: Postgres + API + Metro + Expo Go |
| API publike | Render/domain (`api.5sek.app`) duhet deploy/konfigurim i plotë që build-et në telefon të kenë backend live |
| Push remote | Kërkon **development build** ose APK/IPA, jo vetëm Expo Go |
| `expo-av` | Deprecate në SDK 54 — migrim i planifikuar te `expo-audio` / `expo-video` |
| Store | Ikona dhe EAS preview gati; Apple Developer + Play Console për publikim zyrtar |

---

## 14. Dokumentacion tjetër në repo

- `PRODUCTION-DEPLOYMENT.md` — deploy Docker, SSL, EAS
- `PRODUCTION-CHECKLIST.md` — checklist live
- `ROADMAP-PRODUCTION.md` — roadmap
- `ANALYSIS-5SEK-APPLICATION.md` — analizë e thellë historike

---

*Ky dokument përshkruan arkitekturën dhe funksionimin e projektit 5SEK në nivel produkti dhe teknik. Për detaje API route-by-route, shiko `src/routes/` dhe `shared/api-contract.json`.*
