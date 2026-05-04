# 5SEK API

## Overview
5SEK is a backend REST API for a social video/audio answer app built on Node.js + Express with PostgreSQL via Knex ORM.

## Architecture

### Backend (Node.js/Express)
- Entry point: `server.js` → `src/app.js`
- Database: PostgreSQL (Replit managed) via Knex
- Migrations: `src/db/migrations/` (run automatically on startup)
- Routes: `src/routes/` — auth, questions, answers, duels, paywall, ai, uploads, moderation, analytics, push, payments, admin, legal, support
- Services: `src/services/` — AI, analytics, feeds, duels, payments, push, etc.

### Frontend
- React Native / Expo mobile app (`.tsx` files in root)
- Not served via this backend — the `.tsx` files are the mobile client

## Key Environment Variables
- `DATABASE_URL` — PostgreSQL connection (auto-set by Replit)
- `JWT_SECRET` — Required, auto-generated random secret
- `PORT` — 5000
- `NODE_ENV` — development/production
- `APP_ENV` — development/production
- `INLINE_BACKGROUND_WORKER` — false (disabled in dev for stability)
- `INLINE_INJECTION_WORKER` — false
- `INLINE_DUEL_WORKER` — false
- `CORS_ALLOWED_ORIGINS` — Comma-separated allowed origins (or `*`)

### Optional
- `OPENROUTER_API_KEY` — For AI question generation
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — For media uploads
- `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` — For payments

## Workflow
- `Start application`: `node server.js` on port 5000 (webview)

## Package Management
Uses npm. Backend dependencies: express, knex, pg, dotenv, cors, bcryptjs, jsonwebtoken, multer, geoip-lite, cloudinary

## Database
- Replit managed PostgreSQL
- Migrations run automatically on startup via `db.migrate.latest()`
- 30+ migration files covering: users, questions, answers, duels, analytics, admin, push notifications, viral scoring, etc.

## API Endpoints
- `GET /` — App info + startup status
- `GET /health` — Health check
- `GET /health/detailed` — Detailed health (DB, Stripe, Cloudinary)
- `GET /ready` — Readiness probe
- `GET /metrics` — Prometheus metrics
- `GET /api/meta/contract` — API contract definition
- `/api/auth` — Authentication (register, login, refresh, logout)
- `/api/questions` — Questions CRUD
- `/api/answers` — Answers + engagement
- `/api/duels` — Duel system
- `/api/paywall` — Paywall checks
- `/api/ai` — AI question generation
- `/api/uploads` — Media uploads
- `/api/moderation` — Content moderation
- `/api/analytics` — Analytics events
- `/api/push` — Push notifications
- `/api/payments` — Stripe payments
- `/api/admin` — Admin panel
- `/api/legal` — Legal/GDPR
- `/api/support` — Support requests
