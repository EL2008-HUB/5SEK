# 5SEK — 5-Second Video Answers Platform

## Overview

A mobile-first social app where users answer questions in 5 seconds via video, audio, or text. Features AI-generated questions, viral scoring, 1v1 duels, and a personalized infinite feed.

## Architecture

This is a monorepo with two components:

### Backend (Node.js / Express API)
- Entry point: `server.js`
- App setup: `src/app.js`
- Routes: `src/routes/` (auth, questions, answers, duels, paywall, ai, uploads, moderation, analytics, push, payments, admin, legal, support)
- Controllers: `src/controllers/`
- Services: `src/services/` (AI, feed, viral scoring, background jobs, etc.)
- Database: PostgreSQL via Knex.js (`src/db/`)
- Migrations: `src/db/migrations/` (31+ migration files)
- Config: `src/config/runtime.js`, `src/config/bootstrapEnv.js`

### Frontend (React Native / Expo — Mobile Only)
- Entry: `App.tsx`, `AppNavigator.tsx`
- Screens: `HomeScreen.tsx`, `FeedScreen.tsx`, `RecordScreen.tsx`, `ProfileScreen.tsx`, etc.
- Client services: `api.ts`, `eventTracker.ts`, `storage.ts`
- Built with Expo SDK 54+ for iOS and Android (not browser-runnable)

## Running the Project

The **backend API** runs on port 5000 via the "Start application" workflow:
```
npm run start:api
```

The frontend is a React Native mobile app and runs via Expo CLI / EAS Build — it is not served from this environment.

## Environment Variables

Set in Replit secrets/env:
- `JWT_SECRET` — Required for auth token signing
- `PORT` — Set to 5000
- `NODE_ENV` / `APP_ENV` — Set to `development`
- `DATABASE_URL` — Auto-set by Replit PostgreSQL
- `OPENROUTER_API_KEY` — Optional: enables AI question generation (Groq/OpenRouter)
- `CLOUDINARY_URL` — Optional: enables cloud video/media storage (falls back to local `/uploads`)
- `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` — Optional: enables payments
- `INLINE_BACKGROUND_WORKER` — Set to `true` to run background jobs inline
- `DB_SSL_MODE` — Set to `disable` for local development

## Key APIs

- `GET /` — App info and route list
- `GET /health` — Health check
- `GET /health/detailed` — DB, Stripe, Cloudinary status
- `GET /metrics` — Prometheus-format metrics
- `POST /api/auth/register` / `POST /api/auth/login` — Auth
- `GET /api/questions` — Fetch questions
- `POST /api/answers` — Submit answers
- `GET /api/feed` — Personalized feed (via answers routes)
- `GET /api/duels` — Duel system

## Database

- PostgreSQL (Replit built-in)
- Knex.js migrations auto-run on startup
- Migrations in `src/db/migrations/`

## Bugs Fixed (Production Review)

Two real bugs were found and fixed during the production-readiness review:

### Bug 1 — Float inserted into INTEGER column (`kpiService.js`)
- **File:** `src/services/kpiService.js` line ~145
- **Problem:** `time_in_stage_seconds` is an `INTEGER` column. The `response_time` value coming from the client (e.g. `3.14`) was inserted as a float, causing PostgreSQL to throw `invalid input syntax for type integer: "3.2"` on every answer creation.
- **Fix:** Wrapped the value with `Math.round(Number(metadata.timeInStage))` before insert.

### Bug 2 — Invalid SQL in analytics dashboard (`analyticsController.js`)
- **File:** `src/controllers/analyticsController.js` lines ~135-145
- **Problem:** Knex `.sum(db.raw("CASE WHEN ... END as alias"))` generates SQL with the alias *inside* the `SUM()` call — e.g. `SUM(CASE ... END as shown)` — which is invalid PostgreSQL syntax (error code `42601`). This caused `GET /api/analytics/dashboard` to always return 500.
- **Fix:** Replaced `.sum(db.raw("... as alias"))` with `.select(db.raw("SUM(...) as alias"))` for all CASE-based aggregations.

## Deployment

Configured for Replit autoscale deployment:
- Run: `node server.js`
- Port: 5000
