# 5SEK Production Roadmap

## Objective

Turn the current app from "working prototype with production scaffolding" into a release that is safe to ship, measurable, and supportable.

## Priority Order

1. Remove demo-user blocking behavior, strengthen validation, add DB indexes, and close auth/ownership gaps.
2. Put CI/CD, backups, monitoring, crash reporting, and real upload infrastructure in place.
3. Collect watch-time analytics, add moderation and admin tools, and roll out behind feature flags.
4. Optimize the feed algorithm, monetization, and scale only after the operational baseline is stable.

## Phase 1: Security And Data Integrity

### Core hardening
- [ ] Remove any remaining demo-user assumptions from production flows.
- [ ] Close auth gaps across admin, legal, payments, uploads, and ownership-sensitive endpoints.
- [ ] Enforce strict request validation on every mutating route.
- [ ] Finish DB indexing for hot read paths: answers, questions, paywall events, moderation queue, session analytics.
- [ ] Verify soft-delete, ban, and ownership checks with regression tests.

### Exit criteria
- [ ] No route accepts spoofed `user_id` or ownership-sensitive body fields.
- [ ] Admin and legal routes are mounted, authenticated, and covered by tests.
- [ ] p95 for key feed/admin queries stays under the production target.

## Phase 2: Release Infrastructure

### Delivery
- [ ] CI runs backend tests, runtime checks, migration dry-run, mobile checks, and smoke checks.
- [ ] CD supports staging first, then production rollout, with rollback steps documented.
- [ ] Feature flags are available for risky launches and country-specific rollout.

### Reliability
- [ ] Daily DB backups are automated and restore drills run monthly.
- [ ] Crash reporting is enabled in backend and app.
- [ ] Monitoring covers API latency, 5xx rate, auth failures, DB saturation, uploads, and backup freshness.
- [ ] Real upload infra is used in production: signed Cloudinary or equivalent CDN-backed path.

### Exit criteria
- [ ] A failed deploy can be rolled back without ad hoc manual steps.
- [ ] Alerts fire to a real channel and are tested.
- [ ] Upload fallback behavior is explicit and safe in production.

## Phase 3: Admin, Analytics, And Moderation

### Admin panel scope
- [ ] Daily question management: create, schedule, edit, activate, deactivate, country targeting.
- [ ] Moderation queue: reports, review state, action history, user actions, appeal-ready audit trail.
- [ ] Hot questions: trending score, last-hour answers, engagement rate, country splits.
- [ ] Patterns: surfaced learned patterns and content-performance hints for admins.
- [ ] Paywall stats: impressions, clicks, closes, conversions, CVR by day and by trigger.

### KPI definitions

| KPI | Definition | How to calculate |
| --- | --- | --- |
| D1 retention | Users who return the day after signup | returned on day 1 / new users from prior day |
| Answer completion rate | Started answers that get published | published / started |
| Feed session length | Average feed session duration in minutes | total feed session seconds / session count |
| Duel participation | Sessions with at least one duel vote | sessions with duel activity / total sessions |
| Paywall conversion | Users shown paywall who later convert | converted users / shown users |

### Production KPI targets
- `D1 retention`: `> 40%`
- `Answer completion rate`: `> 60%`
- `Feed session length`: `> 3 min`
- `Duel participation`: `> 30%`
- `Paywall conversion`: `> 5%`

### Instrumentation required
- [ ] Session analytics with `started_at`, `ended_at`, and duration.
- [ ] Answer funnel stages: `started`, `recorded`, `previewed`, `published`, `discarded`.
- [ ] Watch-time analytics for feed consumption.
- [ ] Paywall events with trigger context and conversion linkage.
- [ ] Admin dashboard aggregates for daily and rolling 7-day views.

## Phase 4: Privacy, Legal, And User Rights

### Basics required for launch
- [ ] Terms of Service endpoint/page.
- [ ] Privacy Policy endpoint/page.
- [ ] Consent storage for optional analytics/marketing choices where applicable.
- [ ] Delete-account flow with confirmation, soft delete, grace period, and session revocation.
- [ ] Export-data flow with request tracking, secure delivery, and expiry.

### Operational rules
- [ ] Assign a document owner for Terms/Privacy updates.
- [ ] Record `lastUpdated` with real dates on every legal document change.
- [ ] Ensure support can verify delete/export requests and completion state.

## Phase 5: Support Workflow

### Intake lanes
- Reports: abusive content, spam, harassment, hate speech, violence, sexual content, copyright.
- User actions: warnings, temporary bans, permanent bans, strikes, content removal.
- Billing: refund request intake, manual review, Stripe processing, audit log.

### Workflow
1. Intake enters report queue or support ticket queue.
2. Triage assigns priority: `low`, `medium`, `high`, `urgent`.
3. Moderator reviews evidence and chooses action.
4. If action affects account standing or billing, admin audit log is written.
5. Support responds with resolution notes and SLA outcome.

### Minimum SLAs
- `Urgent abusive content`: under 1 hour
- `High-risk safety reports`: under 4 hours
- `General moderation reports`: under 24 hours
- `Refund requests`: under 3 business days

## Phase 6: Multi-Market Rules

### Country and content controls
- [ ] Country-level app availability.
- [ ] Minimum age and age verification rules by market.
- [ ] Blocked keywords and content-type restrictions by country.
- [ ] Market-level toggles for duels, paywall, and premium features.
- [ ] Regional moderation and analytics splits.

### Shipping rule
- Do not open a new market until country rules, moderation coverage, legal copy, and payment behavior are explicitly defined.

## Current interpretation of repo status

### Already scaffolded in backend
- Admin routes, admin service, KPI tables, support tables, country rules, feature flags, legal routes.

### Still not fully production-complete
- End-to-end admin UI coverage.
- Consent persistence rollout and migration application in every environment.
- Support SLA ownership and refund operations.
- Multi-market operating policy.
- Full analytics rollout tied to dashboards and alerting.

## Definition Of Done For Release

- [ ] Security/auth gaps are closed and tested.
- [ ] CI/CD, backups, monitoring, crash reporting, and uploads are production-ready.
- [ ] KPI instrumentation is live and visible in admin reporting.
- [ ] Legal basics and delete/export flows are operational.
- [ ] Support workflow is documented and can be executed by a real team.
- [ ] Country rules exist before any multi-market launch.
