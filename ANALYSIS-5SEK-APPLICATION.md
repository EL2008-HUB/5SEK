# 5SEK Application - Comprehensive Analysis Document

**Generated:** May 2026  
**Version:** 1.0.1  
**Application:** 5SEK - 5 Second Video Answers Platform

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Structure](#2-project-structure)
3. [Backend Architecture (5second-api)](#3-backend-architecture-5second-api)
4. [Frontend Architecture (5second-app)](#4-frontend-architecture-5second-app)
5. [Database Schema](#5-database-schema)
6. [API Reference](#6-api-reference)
7. [Key Features & Services](#7-key-features--services)
8. [Security & Infrastructure](#8-security--infrastructure)
9. [Environment Configuration](#9-environment-configuration)
10. [Testing & Operations](#10-testing--operations)

---

## 1. Executive Summary

**5SEK** is a mobile-first social platform where users answer questions in 5 seconds via video, audio, or text. The platform features AI-generated questions, country-specific content, viral scoring algorithms, duels between users, and comprehensive analytics.

### Core Value Proposition
- **Quick Content Creation:** 5-second answers remove friction
- **Viral Mechanics:** Trending badges, hot questions, social proof
- **AI-Powered:** Auto-generated culturally-relevant questions
- **Gamification:** Duels, streaks, leaderboards
- **Cross-Platform:** React Native mobile + Node.js backend

### Technology Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js, Express, PostgreSQL, Knex.js |
| Frontend | React Native (Expo SDK 54+), TypeScript |
| AI | Groq (multi-model fallback) |
| Storage | Cloudinary (video), PostgreSQL (data) |
| Auth | JWT with refresh tokens |
| Monitoring | Prometheus, Sentry |

---

## 2. Project Structure

```
5SEK/
├── 5second-api/               # Backend API (Node.js)
│   ├── src/
│   │   ├── routes/           # 18 API route modules
│   │   ├── controllers/      # 11 business logic controllers
│   │   ├── services/         # 42 service modules
│   │   ├── middleware/       # Validation & rate limiting
│   │   ├── db/              # Database config & 31 migrations
│   │   └── config/          # Environment & runtime config
│   ├── server.js            # Application entry point
│   ├── knexfile.js          # Database configuration
│   └── Dockerfile           # Container definition
│
├── 5second-app/              # Mobile Application (React Native)
│   ├── src/
│   │   ├── screens/         # 8 main screens
│   │   ├── components/      # 9 reusable components
│   │   ├── services/        # 8 API & utility services
│   │   ├── context/         # 3 React contexts (Auth, Connectivity, Push)
│   │   ├── navigation/      # AppNavigator (React Navigation)
│   │   ├── contracts/       # API contract definitions
│   │   └── utils/           # Helper utilities
│   ├── App.tsx              # Root application component
│   ├── app.json             # Expo configuration
│   └── eas.json             # EAS Build configuration
│
├── shared/                   # Shared configuration
│   └── api-contract.json     # API contract (version, flags, deep links)
│
├── ops/                      # DevOps & Monitoring
│   ├── nginx/               # Reverse proxy configuration
│   ├── prometheus/          # Metrics collection
│   ├── alertmanager/      # Alert routing
│   └── vector/            # Log aggregation
│
├── docker-compose.production.yml  # Production deployment
└── docs/                    # Documentation
```

---

## 3. Backend Architecture (5second-api)

### 3.1 Entry Point & Server Lifecycle (`server.js`, `app.js`)

**Startup Flow:**
1. Bootstrap environment variables
2. Validate JWT_SECRET exists
3. Create Express app with middleware stack
4. Start HTTP server on 0.0.0.0:PORT
5. Run database migrations (latest)
6. Start background workers (if configured)
7. Mark service as "ready"

**Key Middleware Stack:**
- Security headers (Helmet-style)
- CORS with origin validation
- HTTPS enforcement (production)
- Request logging & metrics
- Country detection (GeoIP + X-User-Country header)
- JWT authentication (optional/required routes)
- Rate limiting
- Body parsing (JSON, URL-encoded)

### 3.2 Routes (18 API Modules)

| Route | Purpose | Auth |
|-------|---------|------|
| `/api/auth` | Login, register, refresh, profile | Mixed |
| `/api/questions` | Daily questions, trending, hot | Optional |
| `/api/user-questions` | User-created questions | Required |
| `/api/answers` | Feed, upload, engagement | Mixed |
| `/api/duels` | 1v1 challenges, voting | Mixed |
| `/api/paywall` | Premium features, limits | Required |
| `/api/ai` | AI question generation | Admin |
| `/api/uploads` | Signed upload URLs | Required |
| `/api/moderation` | Content moderation | Mixed |
| `/api/analytics` | Metrics, KPIs | Mixed |
| `/api/events` | Client event pipeline | Optional |
| `/api/push` | Push notification tokens | Required |
| `/api/payments` | Stripe integration | Required |
| `/api/admin` | Admin panel, user management | Admin |
| `/api/legal` | Terms, privacy, GDPR | Mixed |
| `/api/support` | Help requests | Mixed |
| `/api/share` | Deep links, share tracking | Optional |

### 3.3 Controllers (11 Business Logic Modules)

#### `authController.js` (447 lines)
- User registration/login with bcrypt
- JWT access + refresh token rotation
- Account soft delete / block
- Profile updates (country, age_group, interests)
- Role-based access (user, admin, super_admin)

#### `questionController.js` (685 lines)
- Daily question selection (AI + viral scoring)
- Country-specific question pools
- Hot/trending detection
- Cross-country viral potential analysis
- Pattern extraction from successful questions

#### `answerController.js` (882 lines)
- Infinite feed algorithm (cursor-based)
- Personalization engine integration
- Engagement tracking (watch %, skips, replays)
- Creator activation (viral velocity)
- Content diversity enforcement

#### `duelController.js` (1,806 lines)
- 1v1 answer battles
- Auto-matchmaking
- Real-time voting
- Bracket-style tournaments

#### `eventController.js` (1,997 lines)
- Client event ingestion pipeline
- Real-time session tracking
- Replay & debugging tools
- Fraud detection (bot scoring)

### 3.4 Services (42 Service Modules)

#### Core Services

| Service | Purpose |
|---------|---------|
| `aiService.js` | Groq integration (4-model fallback chain) |
| `backgroundJobService.js` | Job queue (AI generation, cleanup) |
| `uploadService.js` | Cloudinary signed uploads + local dev fallback |
| `authSessionService.js` | Refresh token CRUD + rotation |
| `viralScoring.js` | Performance score calculation |
| `infiniteFeedService.js` | Cursor pagination + diversity |
| `feedComposer.js` | Feed item ranking |
| `personalizationService.js` | User taste profiles |
| `embeddingService.js` | Vector embeddings for similarity |
| `behaviorStateEngine.js` | Session state machine |
| `pushNotificationService.js` | Expo push delivery |
| `stripeService.js` | Payment processing |
| `moderationService.js` | Content safety (AI + rules) |
| `globalTrending.js` | Cross-user trending detection |
| `metricsService.js` | Prometheus metrics |

#### AI Integration (`aiService.js`)

**Model Fallback Chain:**
1. `google/gemma-4-31b-it:free`
2. `qwen/qwen3-next-80b-a3b-instruct:free`
3. `openai/gpt-oss-120b:free`
4. `nvidia/nemotron-3-super-120b-a12b:free`

**Features:**
- Country-specific cultural profiles (AL, US, DE, XK, UK, TR, IT, GLOBAL)
- Pattern-aware prompting
- Content moderation
- Question quality ranking

#### Background Jobs (`backgroundJobService.js`)

**Job Types:**
- `AI_GENERATE_DAILY_QUESTION` - Daily country-specific questions
- `AI_GENERATE_QUESTIONS_BULK` - Batch generation
- `PATTERN_EXTRACTION` - Learn from successful content
- `MEDIA_CLEANUP` - Remove hidden/old media
- `RATE_LIMIT_CLEANUP` - Stale rate limit entries
- `ANALYTICS_AGGREGATION` - Daily metrics rollup
- `PUSH_NOTIFICATION_DELIVERY` - Scheduled notifications

---

## 4. Frontend Architecture (5second-app)

### 4.1 Technology Stack

| Component | Technology |
|-----------|------------|
| Framework | React Native 0.81.5 |
| Expo SDK | ~54.0.33 |
| Navigation | React Navigation v7 (Bottom Tabs + Native Stack) |
| State Management | React Context (Auth, Connectivity, Push) |
| HTTP Client | Axios with interceptors |
| Video | expo-av |
| Camera | expo-camera |
| Storage | @react-native-async-storage |
| Observability | Sentry |

### 4.2 Navigation Structure

```
AppNavigator (Stack)
├── Auth (AuthScreen) - when not logged in
└── Main (Bottom Tabs) - when logged in
    ├── Home (HomeScreen)
    ├── Record (RecordScreen) - "5 SEK" central button
    ├── Feed (FeedScreen)
    └── Profile (ProfileScreen)

Modals/Overlays:
├── TextAnswer (TextAnswerScreen)
├── AudioAnswer (AudioAnswerScreen)
└── DeepAnswer (DeepAnswerScreen) - for shared links
```

**Deep Link Support:**
- `five-second://home`
- `five-second://feed`
- `five-second://answer/:id` (viral sharing)
- `five-second://question/:id/text`
- `five-second://question/:id/audio`
- `https://5sek.app/...` (universal links)

### 4.3 Screens (8 Main Screens)

#### `HomeScreen.tsx` (721 lines)
- Daily question with FOMO social proof
- Country badge (detected from IP/header)
- Hot questions discovery section
- Personalized questions (based on age/interests)
- Learned patterns display
- Animated trending/hot badges

#### `RecordScreen.tsx` (1,650 lines)
- **4 Answer Modes:** Video, Audio, Text, Reaction
- 3-2-1 countdown timer
- 5-second recording limit
- Camera controls (front/back)
- Real-time video preview
- Upload queue with retry
- Reward overlay on completion
- Paywall modal (if limit reached)

#### `FeedScreen.tsx` (393 lines)
- Infinite vertical scroll (paging enabled)
- Video cards with auto-play
- Duel cards injected every 5 answers
- Haptic feedback on swipe
- Country header overlay
- Pull-to-refresh

#### `ProfileScreen.tsx`
- User stats (answers, likes, streak)
- Country selector
- Age group & interests
- Premium status
- Admin console (if admin)
- Account deletion

#### `DeepAnswerScreen.tsx`
- Handles shared answer links
- Direct deep link navigation
- Shows single answer with related content

### 4.4 Components (9 Reusable Components)

| Component | Purpose |
|-----------|---------|
| `VideoCard.tsx` | Feed video player with engagement |
| `DuelCard.tsx` | 1v1 voting interface |
| `Timer.tsx` | Recording countdown |
| `RewardOverlay.tsx` | Post-answer rewards/stats |
| `PaywallModal.tsx` | Premium upgrade prompt |
| `ShareOverlay.tsx` | Native share sheet |
| `NetworkBanner.tsx` | Offline indicator |
| `AdminConsole.tsx` | Admin tools (stats, moderation) |
| `AccountOperations.tsx` | Delete account, export data |

### 4.5 Services (8 Client Services)

| Service | Purpose |
|---------|---------|
| `api.ts` | Axios instance with token refresh |
| `analytics.ts` | Event tracking |
| `deepLinks.ts` | Deep link handling |
| `eventTracker.ts` | Session event batching |
| `featureFlags.ts` | A/B test assignments |
| `observability.ts` | Sentry integration |
| `storage.ts` | AsyncStorage wrapper |
| `uploadQueue.ts` | Failed upload retry |

### 4.6 Contexts (3 React Contexts)

1. **AuthContext** - User session, login/logout, profile updates
2. **ConnectivityContext** - Network status (online/degraded)
3. **PushContext** - Push notification permissions & tokens

---

## 5. Database Schema

### 5.1 Core Tables (from 31 Migrations)

#### `users`
```sql
id (PK)
username (unique)
email (unique)
password (bcrypt hashed)
country (default: 'GLOBAL')
age_group
interests (JSON array)
role ('user', 'admin', 'super_admin')
is_premium
subscription_status
premium_expires_at
is_admin / admin_permissions (JSON)
is_blocked / blocked_at / blocked_reason
deleted_at (soft delete)
created_at
```

#### `questions`
```sql
id (PK)
text (content)
country ('GLOBAL', 'AL', 'US', etc.)
is_daily / active_date
created_by (FK users.id)
is_hot / performance_score
category
tags (JSON)
deleted_at (soft delete)
created_at
```

#### `answers`
```sql
id (PK)
user_id (FK)
question_id (FK)
answer_type ('video', 'audio', 'text', 'reaction')
video_url / text_content
response_time (seconds)
likes_count / shares_count / views_count
feed_score / feed_bucket ('funny', 'awkward', 'fast', 'provocative')
hook_label / social_label
storage_provider / storage_public_id
is_hidden / hidden_reason / hidden_at
trust_score
created_at
```

#### `duels`
```sql
id (PK)
creator_id (FK)
opponent_id (FK)
question_id (FK)
challenger_answer_id / opponent_answer_id
status ('pending', 'active', 'completed', 'expired')
votes_challenger / votes_opponent
winner_id
expires_at
created_at
```

#### `background_jobs`
```sql
id (PK)
job_type
payload (JSON)
status ('pending', 'running', 'completed', 'failed')
run_at / started_at / completed_at
attempts / max_attempts
error_message
result (JSON)
dedupe_key (unique)
created_at
```

#### `analytics_events`
```sql
id (PK)
user_id / session_id
event_type
payload (JSON)
country
created_at
```

#### Additional Tables
- `refresh_tokens` - Session management
- `answer_engagements` - Watch progress, skips, replays
- `user_consents` - GDPR consent tracking
- `push_tokens` - Expo push notification tokens
- `request_rate_limits` - Rate limiting counters
- `patterns` - Learned content patterns
- `embeddings` - Vector embeddings for content
- `feed_state` - User feed cursor positions
- `kpi_snapshots` - Daily KPI metrics

### 5.2 Indexes (Performance)

```sql
-- Answers
CREATE INDEX idx_answers_user_id_created ON answers(user_id, created_at DESC);
CREATE INDEX idx_answers_question_id ON answers(question_id);
CREATE INDEX idx_answers_feed_score ON answers(feed_score DESC) WHERE is_hidden = false;
CREATE INDEX idx_answers_created_country ON answers(created_at, country);

-- Questions
CREATE INDEX idx_questions_daily ON questions(is_daily, active_date, country);
CREATE INDEX idx_questions_performance ON questions(performance_score DESC);

-- Events
CREATE INDEX idx_events_user_time ON analytics_events(user_id, created_at);
CREATE INDEX idx_events_type_time ON analytics_events(event_type, created_at);
```

---

## 6. API Reference

### 6.1 Authentication

**POST /api/auth/register**
```json
Request: { "username": "...", "email": "...", "password": "...", "country": "AL" }
Response: { "token": "...", "refresh_token": "...", "user": {...} }
```

**POST /api/auth/login**
```json
Request: { "email": "...", "password": "..." }
Response: { "token": "...", "refresh_token": "...", "user": {...} }
```

**POST /api/auth/refresh**
```json
Request: { "refresh_token": "..." }
Response: { "token": "...", "refresh_token": "..." }
```

### 6.2 Questions

**GET /api/questions/daily**
```json
Response: {
  "id": 1,
  "text": "What makes you instantly happy?",
  "country": "AL",
  "is_hot": true,
  "social_proof": {
    "total_answers_today": 127,
    "recent_label": "47 people just answered",
    "velocity_label": "🔥 Going viral"
  }
}
```

**GET /api/questions/hot**
```json
Response: {
  "questions": [
    { "id": 2, "text": "...", "live_stats": {"label": "23 answering now"} }
  ]
}
```

### 6.3 Answers

**POST /api/answers**
```json
Request: {
  "question_id": 1,
  "video_url": "https://...",
  "answer_type": "video",
  "response_time": 4.2
}
```

**GET /api/answers** (Feed)
```json
Query: ?cursor=xyz&limit=20&country=AL
Response: {
  "items": [...],
  "nextCursor": "abc",
  "hasMore": true
}
```

**POST /api/answers/:id/analytics**
```json
Request: {
  "event": "watch_progress",
  "progress_pct": 75,
  "completed": true
}
```

### 6.4 Duels

**POST /api/duels**
```json
Request: { "question_id": 1, "opponent_id": 5 }
Response: { "id": 10, "status": "pending" }
```

**POST /api/duels/:id/vote**
```json
Request: { "vote_for": "challenger" }
```

---

## 7. Key Features & Services

### 7.1 Viral Mechanics

**Viral Scoring Algorithm:**
```javascript
performance_score = (
  likes_count * 1 +
  shares_count * 3 +
  views_count * 0.1 +
  comments_count * 2
) / age_decay_factor(hours_since_created)
```

**Badges:**
- 🔥 "BLOWING UP RIGHT NOW" - Hot question (>threshold in last hour)
- 📈 "Trending in Albania" - Country-specific trending
- ⚡ "Fastest answer today" - Speed record

### 7.2 AI Question Generation

**Cultural Profiles:**
- **Albania (AL):** Family, traditions, quick wit
- **Germany (DE):** Efficiency, directness
- **USA (US):** Pop culture, personal stories
- **Turkey (TR):** Hospitality, food, relationships

**Prompt Template:**
```
Generate a viral 5-second question for {country}.
Style: {learned_patterns}
Avoid: {previous_low_performers}
Tone: Fun, slightly edgy but safe
```

### 7.3 Personalization Engine

**Taste Profile:**
```javascript
{
  favorite_categories: ['funny', 'provocative'],
  favorite_tags: ['relationships', 'food'],
  skip_categories: ['political'],
  preferred_answer_type: 'video',
  avg_watch_pct: 78,
  total_completions: 45,
  total_skips: 12,
  peak_hour: 20
}
```

**Feed Reranking:**
1. Base score from viral algorithm
2. Boost: Preferred categories (+15%)
3. Boost: Similar embeddings (+10%)
4. Penalty: Skip categories (-20%)
5. Diversity: Max 3 from same creator

### 7.4 Duels System

**Match Types:**
- **Manual Challenge:** Invite specific user
- **Auto-Match:** System finds opponent
- **Tournament:** Bracket-style elimination

**Voting:**
- Public voting (friends + strangers)
- Anonymous option
- Time-limited (24 hours default)

### 7.5 Content Moderation

**3-Layer System:**
1. **Pre-upload:** AI moderation (Groq)
2. **Post-upload:** Community reports
3. **Review Queue:** Admin panel

**Trust Score:**
- New users: 50/100
- Each valid answer: +5
- Reported content: -20
- Hidden below 30: Auto-review

---

## 8. Security & Infrastructure

### 8.1 Security Measures

| Layer | Implementation |
|-------|----------------|
| Auth | JWT (15min) + Refresh tokens (45 days) |
| Passwords | bcrypt (10 rounds) |
| HTTPS | Enforced in production (426 if HTTP) |
| CORS | Whitelist validation |
| Rate Limit | IP + User-based sliding window |
| Headers | Helmet-style security headers |
| Validation | Schema validation on all inputs |
| SQL Injection | Knex parameterized queries |

### 8.2 Rate Limiting

```javascript
// Auth endpoints
limit: 10 requests / 15 min / IP

// Uploads  
limit: 20 requests / 15 min / user_or_ip

// Duel votes
limit: 10 requests / 1 min / user

// Admin
limit: 60 requests / 15 min / user
```

### 8.3 Monitoring & Observability

**Prometheus Metrics:**
- `http_requests_total` (by route, status)
- `http_request_duration_seconds`
- `db_errors_total` (by operation)
- `upload_failures_total` (by stage)

**Health Endpoints:**
- `GET /health` - Basic liveness
- `GET /ready` - Readiness (db + migrations)
- `GET /health/detailed` - Deep health check
- `GET /metrics` - Prometheus format

**Sentry Integration:**
- Backend: Error tracking with breadcrumbs
- Mobile: Crash reporting + release health
- Navigation: Route change tracking

### 8.4 Infrastructure

**Production Deployment:**
```yaml
# docker-compose.production.yml
services:
  api:        # Node.js app
  postgres:   # PostgreSQL 15+
  nginx:      # Reverse proxy + SSL
  prometheus: # Metrics collection
  alertmanager: # Alert routing
```

**Environment Separation:**
- Development: Local SQLite fallback, local uploads
- Staging: Postgres, Cloudinary, test keys
- Production: Postgres, Cloudinary, live keys

---

## 9. Environment Configuration

### 9.1 Required Variables (Backend)

```bash
# Security (Critical)
JWT_SECRET=                    # Min 32 chars, random
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=45

# Database
DATABASE_URL=                # postgres://user:pass@host:5432/db
DB_SSL_MODE=require          # require, no-verify, disable

# Storage (Production Required)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
MEDIA_CDN_BASE_URL=          # Optional: CDN rewrite

# AI (Optional but recommended)
GROQ_API_KEY=          # For question generation

# Payments (Optional)
STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Monitoring (Optional)
SENTRY_DSN=

# Email (Optional)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
```

### 9.2 Mobile App Configuration

```javascript
// app.config.js
extra: {
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
}

// Runtime
EXPO_PUBLIC_API_URL=https://api.5sek.app/api
```

---

## 10. Testing & Operations

### 10.1 Test Suite

```bash
# Backend tests
npm test

# Coverage areas:
- Admin audit service
- AI service (mocked)
- Background jobs
- Database resilience
- Duel state machine
- Feed composer
- Injection engine
- Push controller
- Question quality
- Route hardening
- Safety features
- Stripe service
- Upload service
```

### 10.2 Operations Scripts

```bash
# Database
npm run migrate              # Run migrations
npm run migrate:rollback     # Rollback one
npm run backup:db           # Create backup
npm run backup:restore      # Restore backup

# Workers
npm run start:worker        # Background job worker
npm run start:injector      # Content injection worker

# Maintenance
npm run cleanup:media       # Remove hidden media
npm run smoke               # Health check
npm runtime:check           # Environment validation
```

### 10.3 Deployment Checklist

**Pre-Deploy:**
- [ ] JWT_SECRET set (min 32 chars)
- [ ] DATABASE_URL configured with SSL
- [ ] Cloudinary credentials valid
- [ ] Migrations tested on staging
- [ ] Environment variables validated

**Deploy:**
- [ ] Run migrations
- [ ] Verify /health returns 200
- [ ] Verify /ready returns 200
- [ ] Check Prometheus metrics
- [ ] Test auth flow (register/login)
- [ ] Test video upload
- [ ] Verify push notifications

**Post-Deploy:**
- [ ] Monitor error logs (Sentry)
- [ ] Check KPI dashboard
- [ ] Verify background workers running
- [ ] Test deep links
- [ ] Confirm rate limiting active

---

## Appendices

### A. API Contract (`shared/api-contract.json`)

```json
{
  "api_version": "2026-04-21",
  "contract_name": "5sek-mobile-v1",
  "answer_types": ["video", "audio", "text", "reaction"],
  "feature_flags": {
    "feed_ranker_v2": ["control", "retention_boost"],
    "paywall_v2": ["control", "price_anchor"],
    "duels_v1": ["off", "on"]
  },
  "deep_links": {
    "home": "five-second://home",
    "answer": "five-second://feed?answer=:id"
  }
}
```

### B. Supported Countries

| Code | Country | Cultural Profile |
|------|---------|------------------|
| AL | Albania | Family, traditions |
| XK | Kosovo | Youth culture |
| DE | Germany | Efficiency, directness |
| US | United States | Pop culture, personal |
| UK | United Kingdom | Humor, sarcasm |
| TR | Turkey | Hospitality, relationships |
| IT | Italy | Food, lifestyle |
| GLOBAL | Global | Universal appeal |

### C. File Count Summary

| Category | Count |
|----------|-------|
| Backend Routes | 18 |
| Backend Controllers | 11 |
| Backend Services | 42 |
| Backend Migrations | 31 |
| Mobile Screens | 8 |
| Mobile Components | 9 |
| Mobile Services | 8 |
| Total Files | ~200+ |

---

**Document Status:** Complete  
**Last Updated:** May 2026  
**Version:** 1.2.0

---

## 11. Event Intelligence Stream (Production Readiness Update)

### 11.1 Pipeline Overview

The Event Intelligence Stream is a full pipeline from client event ingestion to adaptive feed personalization and viral scoring.

```
Client → POST /api/events
         ↓
  eventNormalizationService (K17)
  - normalizeEventWithTaxonomy()
  - processAndPersistEvents() → client_events table
  - dedup via event_id
         ↓
  growthSignalsService (K18)
  - processGrowthEvent() → Prometheus counters
  - recordInviteLink() → user_invite_graph table
         ↓
  behaviorProfileService (K19)
  - upsertBehaviorProfile() → user_behavior_state table
  - SLA: 200ms
         ↓
  sessionAdaptiveFeedService (K20)
  - computeFeedStrategy() → trending_inject | exploration_boost | personalized_boost | default
  - recordFeedStrategy() → feed_session_strategies table
  - applyFeedStrategy() → modifies feed ranking
         ↓
  returnEngineService (K21) — background job, hourly
  - checkAndTriggerReturns() → push notifications
  - hasRecentRetentionNotification() — 48h rate limit
         ↓
  viralScoreModelService (K22) — background job, every 15 min
  - calculateNonLinearViralScore()
  - recalculateViralScores() → question_stats table
```

### 11.2 Event Taxonomy

Events are classified into three categories with weights:

| Event Type | Category | Weight |
|-----------|----------|--------|
| `scroll_depth` | engagement | 2 |
| `app_open` | engagement | 1 |
| `view`, `watch` | engagement | 1–2 |
| `complete`, `first_30s_complete` | retention | 3 |
| `session_returned`, `notification_clicked` | retention | 3–5 |
| `share_clicked`, `share` | growth | 3 |
| `invite_sent`, `invite_accepted` | growth | 4 |
| `like` | engagement | 2 |
| `skip` | engagement | -1 |

Unknown event types are discarded (logged as `unknown_event_type`, not propagated).

### 11.3 Viral Score Formula (Non-Linear)

```
engagementRate = (likes + completions) / max(1, views)
viralScore = log(1 + shares) × engagementRate × exp(-ageHours / 24)
viralScore = clamp(viralScore × 1000, 0, 1000)
```

**Properties:**
- Always in `[0, 1000]` (capped)
- Monotonically decreasing with age (exponential decay)
- Sub-linear growth with shares (logarithmic anti-spam)
- `viral_candidate = true` when `viralScore > 100`

### 11.4 Return Engine

The Return Engine runs as a background job every hour (`RETURN_ENGINE_CHECK`). It:

1. Finds users inactive for 24+ hours
2. Checks 48h rate limit (max 1 notification per user per 48h)
3. Builds a dynamic message based on activity:
   - New answers on their question → `"Your question got new answers"`
   - Reactions → `"People are reacting"`
   - Viral score increased > 50 → `"You're trending"`
   - Default → `"Come back and see what's new"`
4. Queues push delivery via `pushNotificationService.queuePushDelivery()`
5. Records in `retention_notifications` with push status

### 11.5 Session Adaptive Feed Strategy

Feed strategy is recalculated every 5 events in a session:

| Condition | Strategy | Effect |
|-----------|----------|--------|
| `scrollSpeed > 1.5` | `trending_inject` | Inject trending content |
| `skipRate > 0.6` | `exploration_boost` | 1.5× boost for new content |
| `dwellTime > 20s` | `personalized_boost` | 2× boost for personalized |
| default | `default` | Standard ranking |

---

## 12. Sentry Integration

### 12.1 Backend (`sentryService.js`)

- Initialized in `server.js` before `createApp()` when `SENTRY_DSN` is set
- `captureException()` called in global error handler (`app.use((err, req, res, next)...)`)
- `captureException()` called in `process.on('unhandledRejection')` and `process.on('uncaughtException')`
- Graceful degradation: if `SENTRY_DSN` is not set, Sentry is skipped without error

### 12.2 Frontend (`@sentry/react-native`)

- Initialized in `App.tsx` with `EXPO_PUBLIC_SENTRY_DSN`
- `Sentry.wrap(App)` captures native crashes
- `ErrorBoundary` with `Sentry.captureException` for JS errors

### 12.3 Environment Variables

```bash
# Backend
SENTRY_DSN=https://xxx@sentry.io/project-id

# Frontend (Expo)
EXPO_PUBLIC_SENTRY_DSN=https://xxx@sentry.io/project-id
```

---

## 13. Production Deployment Checklist

### Pre-Deploy

- [ ] `JWT_SECRET` set (min 32 chars, random)
- [ ] `DATABASE_URL` configured with SSL (`DB_SSL_MODE=require`)
- [ ] Cloudinary credentials valid
- [ ] `SENTRY_DSN` configured (backend + frontend)
- [ ] `GROQ_API_KEY` configured for AI question generation
- [ ] Stripe keys configured (if payments enabled)
- [ ] Migrations tested on staging: `npm run migrate`
- [ ] Environment variables validated: `npm run runtime:check`
- [ ] Smoke check passes on staging: `npm run smoke`

### Deploy

1. Pull latest image / deploy new version
2. Run migrations: `npm run migrate`
3. Verify `/health` returns 200
4. Verify `/health/detailed` returns `status: "healthy"`, `db: "ok"`
5. Check Prometheus metrics at `/metrics`
6. Test auth flow (register → login → refresh)
7. Test video upload (Cloudinary)
8. Verify push notifications (Expo)
9. Verify background workers running (`start:worker`)

### Post-Deploy

- [ ] Monitor Sentry for new errors (first 30 min)
- [ ] Check KPI dashboard (`/api/admin/stats/kpis`)
- [ ] Verify background jobs processing (`background_jobs` table)
- [ ] Test deep links (`five-second://feed?answer=:id`)
- [ ] Confirm rate limiting active (test with 11 rapid requests)
- [ ] Verify viral score recalculation job running (every 15 min)
- [ ] Verify return engine job running (every hour)

### Rollback Procedure

If a deployment fails:

1. **Immediate rollback:** Deploy previous image version
2. **Database rollback:** `npm run migrate:rollback` (rolls back last migration)
3. **Verify rollback:** Check `/health/detailed` and `/ready`
4. **Investigate:** Check Sentry for error details
5. **Notify:** Alert team via configured Alertmanager webhook

**Rollback SLA:** Target < 5 minutes for full rollback.

**Migration safety:** All migrations use `IF NOT EXISTS` for idempotence. Rollback scripts are in `scripts/rollback-last-migration.js`.

---

**Document Status:** Complete  
**Last Updated:** May 2026  
**Version:** 1.2.0
