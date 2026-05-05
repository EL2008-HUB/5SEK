# 5SEK — Full Stack App

## Overview
5SEK është një aplikacion social video/audio. Ka dy pjesë:
- **Backend**: Node.js/Express REST API me PostgreSQL (Knex ORM)
- **Frontend**: React Native/Expo (web version) me React Navigation

## Startup
Single workflow runs both services:
```bash
bash start-all.sh
```
- Backend API starts on port 3000 (background)
- Expo web starts on port 5000 (foreground, webview)

## Architecture

### Frontend (React Native/Expo)
- Entry: `index.ts` → `App.tsx`
- Navigation: `src/navigation/AppNavigator.tsx`
- Screens: `src/screens/` (Home, Feed, Record, Profile, Auth, TextAnswer, AudioAnswer, DeepAnswer, RemixRecord)
- Components: `src/components/` (VideoCard, DuelCard, PaywallModal, AdminConsole, etc.)
- Contexts: `src/context/` (Auth, Connectivity, Push, FusionLoop)
- Services: `src/services/api.ts`, `analytics.ts`, `observability.ts`, `storage.ts`, etc.
- Utils: `src/utils/alerts.ts`, `paywallCooldown.ts`
- Contracts: `src/contracts/api.ts` (re-exports shared/api-contract.json)

### Backend (Node.js/Express)
- Entry: `server.js` → `src/app.js`
- Routes: `src/routes/` — auth, questions, answers, duels, paywall, ai, uploads, moderation, analytics, push, payments, admin, legal, support
- Services: `src/services/*.js` — AI (OpenRouter), analytics, feeds, duels, payments (Stripe), push notifications, etc.
- DB: `src/db/knex.js` + migrations in `src/db/migrations/`
- Config: `src/config/bootstrapEnv.js`, `src/config/runtime.js`
- Middleware: `src/middleware/rateLimit.js`, `validation.js`

## Key Environment Variables
- `DATABASE_URL` — PostgreSQL (auto-set by Replit)
- `JWT_SECRET` — Auto-generated random secret (required)
- `PORT` — 3000 (backend API)
- `NODE_ENV` / `APP_ENV` — development
- `EXPO_PUBLIC_API_URL` — Set dynamically to `https://3000-${REPLIT_DEV_DOMAIN}/api`
- `INLINE_BACKGROUND_WORKER` / `INLINE_INJECTION_WORKER` / `INLINE_DUEL_WORKER` — false

### Optional
- `OPENROUTER_API_KEY` — AI question generation via OpenRouter
- `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` — Media uploads
- `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` — Payments

## CORS
Allowed origins in `src/config/runtime.js`:
- `http://localhost:5000` (Expo web dev server)
- `http://localhost:8081`, `http://localhost:19006`, `http://localhost:3000`
- Production: `https://app.5sek.app`

## Assets
Placeholder PNG assets in `assets/` (icon.png, splash-icon.png, adaptive-icon.png, favicon.png)

## Package Management
npm — Backend + Frontend deps in same package.json
Backend deps: express, knex, pg, dotenv, cors, bcryptjs, jsonwebtoken, multer, geoip-lite, cloudinary
Frontend deps: expo, react-native, react-navigation, axios, @sentry/react-native, etc.

## Database
- Replit managed PostgreSQL
- 30+ migration files, run automatically on startup via `db.migrate.latest()`

## API Endpoints
- `GET /` — App info
- `GET /health` — Health check
- `GET /health/detailed` — DB + services health
- `GET /metrics` — Prometheus metrics
- `/api/auth` — Register, login, refresh, logout
- `/api/questions` — Questions CRUD
- `/api/answers` — Answers + engagement tracking
- `/api/duels` — Duel system
- `/api/paywall` — Paywall checks
- `/api/ai` — AI question generation
- `/api/uploads` — Media uploads (Cloudinary)
- `/api/moderation` — Content moderation
- `/api/analytics` — Analytics events
- `/api/push` — Push notifications
- `/api/payments` — Stripe payments + webhooks
- `/api/admin` — Admin panel + KPI tracking
- `/api/legal` — GDPR/legal
- `/api/support` — Support requests
