/**
 * Event Tracking Controller v3 — State-Based Architecture
 *
 * CORE PRINCIPLE:
 *   ❌ Don't compute feed "on request"
 *   ✅ Compute state "on event" → feed just READS
 *
 * Pipeline: Event → Normalize → Update State → Update Metrics
 */

const { processEventBatch, persistState } = require("../services/behaviorStateEngine");
const { ingestEvent: ingestTrending } = require("../services/globalTrending");
const { updateCreatorStats } = require("../services/contentDiscovery");
const { processKPIEvent } = require("../services/kpiHealthEngine");
const { getBucket, trackVariantKPI } = require("../services/abTestEngine");
const { evaluateTriggers } = require("../services/notificationIntelligence");

const VALID_EVENT_TYPES = new Set([
  "view", "watch", "complete", "skip",
  "like", "share", "swipe",
  "record_start", "record_post",
  "feed_open", "feed_close",
  "replay",
  // v3: Growth signals
  "invite_sent", "invite_accepted",
  "share_clicked", "session_return",
  "first_session_complete", "scroll_depth",
  // v4: Share tracking
  "share_export", "share_open", "answer_from_share",
]);

const VALID_ENTITY_TYPES = new Set(["answer", "question", "duel"]);

const MAX_BATCH_SIZE = 50;

// UPGRADE 1: Event weights for scoring
const EVENT_WEIGHTS = {
  complete: 5,
  like: 3,
  share: 4,
  replay: 3,
  watch: 2,
  view: 1,
  swipe: 0,
  skip: -3,
  feed_open: 0,
  feed_close: 0,
  record_start: 0,
  record_post: 2,
};

// UPGRADE 3: Anti-spam thresholds (per user per minute)
const SPAM_THRESHOLDS = {
  like: 10,
  share: 8,
  view: 30,
  complete: 20,
  default: 50,
};

// In-memory rate limiter (per userId)
const rateLimiter = new Map();

function checkRateLimit(userId, eventType) {
  if (!userId) return true; // anon users are less risky

  const key = `${userId}:${eventType}`;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const threshold = SPAM_THRESHOLDS[eventType] || SPAM_THRESHOLDS.default;

  if (!rateLimiter.has(key)) {
    rateLimiter.set(key, { count: 1, windowStart: now });
    return true;
  }

  const entry = rateLimiter.get(key);
  if (now - entry.windowStart > windowMs) {
    // Reset window
    entry.count = 1;
    entry.windowStart = now;
    return true;
  }

  entry.count += 1;
  if (entry.count > threshold) {
    return false; // SPAM detected
  }

  return true;
}

// Cleanup rate limiter every 5 min
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, entry] of rateLimiter) {
    if (entry.windowStart < cutoff) rateLimiter.delete(key);
  }
}, 5 * 60 * 1000);

/**
 * POST /api/events — batch event ingestion with dedup + anti-spam
 */
exports.trackEvents = async (req, res) => {
  try {
    const events = req.body.events;

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: "events must be a non-empty array" });
    }

    if (events.length > MAX_BATCH_SIZE) {
      return res.status(400).json({ error: `max ${MAX_BATCH_SIZE} events per batch` });
    }

    const userId = req.userId || null;
    const now = new Date().toISOString();
    let spamBlocked = 0;

    const rows = [];
    for (const e of events) {
      const eventType = String(e.type || e.event_type || "").toLowerCase();
      if (!VALID_EVENT_TYPES.has(eventType)) continue;

      const entityType = e.entityType || e.entity_type || null;
      if (entityType && !VALID_ENTITY_TYPES.has(entityType)) continue;

      // UPGRADE 3: Anti-spam check
      if (!checkRateLimit(userId, eventType)) {
        spamBlocked++;
        continue;
      }

      rows.push({
        event_id: typeof e.id === "string" ? e.id.slice(0, 36) : null,
        user_id: userId,
        session_id: typeof e.sessionId === "string" ? e.sessionId.slice(0, 50) : null,
        event_type: eventType,
        entity_type: entityType || null,
        entity_id: Number(e.entityId || e.entity_id) || null,
        watch_time: Number.isFinite(Number(e.watchTime || e.watch_time)) ? Number(e.watchTime || e.watch_time) : null,
        duration: Number.isFinite(Number(e.duration)) ? Number(e.duration) : null,
        position: Number.isFinite(Number(e.position)) ? Number(e.position) : null,
        metadata: e.metadata ? JSON.stringify(e.metadata) : null,
        created_at: now,
      });
    }

    if (rows.length > 0) {
      // FIX 1: Use onConflict to ignore duplicate event_ids
      const hasEventIdColumn = rows.some((r) => r.event_id);
      if (hasEventIdColumn) {
        // Insert with conflict handling — duplicates are silently ignored
        try {
          await req.db("client_events")
            .insert(rows)
            .onConflict("event_id")
            .ignore();
        } catch (conflictErr) {
          // Fallback: insert one by one, skip dupes
          for (const row of rows) {
            try {
              await req.db("client_events").insert(row).onConflict("event_id").ignore();
            } catch (_) {}
          }
        }
      } else {
        await req.db("client_events").insert(rows);
      }

      // UPGRADE 2: Update answer_metrics in background (fire-and-forget)
      updateAnswerMetrics(req.db, rows).catch(() => {});

      // 🔥 v3: Update user behavior state (state-based architecture)
      // Events → Normalize → Update State (K17 → K18 → K19)
      if (userId) {
        try {
          processEventBatch(userId, rows);
          if (Math.random() < 0.1) {
            persistState(req.db, userId).catch(() => {});
          }
        } catch (_) {}
      }

      // 🌍 Global Trending + 📊 KPI + 🔔 Notifications + 📁 Analytics
      const bucket = userId ? getBucket(userId) : "anon";
      for (const row of rows) {
        try { ingestTrending(row); } catch (_) {}
        try { processKPIEvent(userId, row); } catch (_) {}
        try { evaluateTriggers(userId, row.event_type, row.metadata ? JSON.parse(row.metadata) : {}); } catch (_) {}
        // A/B: tag session events
        if (row.event_type === "feed_close" && userId) {
          try {
            const meta = row.metadata ? JSON.parse(row.metadata) : {};
            trackVariantKPI(userId, { sessionLength: meta.duration ? meta.duration / 1000 : 0 });
          } catch (_) {}
        }
        if (row.event_type === "scroll_depth" && userId) {
          try {
            const meta = row.metadata ? JSON.parse(row.metadata) : {};
            trackVariantKPI(userId, { scrollDepth: meta.depth || 0 });
          } catch (_) {}
        }
      }

      // 📁 Offline Analytics: archive to events_log (async, non-blocking)
      if (rows.length > 0) {
        archiveEvents(req.db, rows, bucket).catch(() => {});
      }
    }

    res.json({ ok: true, accepted: rows.length, spam_blocked: spamBlocked, ab_bucket: bucket });
  } catch (error) {
    console.error("Event tracking error:", error);
    res.json({ ok: false, accepted: 0 });
  }
};

/**
 * 📁 Archive events to events_log for offline analytics + replay.
 * Async, non-blocking — never fails the main request.
 */
async function archiveEvents(db, rows, bucket) {
  if (!db) return;
  try {
    const hasTable = await db.schema.hasTable("events_log");
    if (!hasTable) return;

    const archiveRows = rows.map(r => ({
      user_id: r.user_id || null,
      event_type: r.event_type,
      entity_type: r.entity_type || null,
      entity_id: r.entity_id || null,
      session_id: r.session_id || null,
      ab_bucket: bucket || null,
      metadata: r.metadata || null,
      created_at: r.created_at,
    }));

    await db("events_log").insert(archiveRows);
  } catch (_) {
    // Silent — analytics should never break event tracking
  }
}

/**
 * UPGRADE 2: Incremental answer_metrics update
 * Instead of querying raw events every time, we maintain running counters.
 */
async function updateAnswerMetrics(db, events) {
  // Group events by answer_id
  const answerEvents = new Map();

  for (const e of events) {
    if (e.entity_type !== "answer" || !e.entity_id) continue;
    if (!answerEvents.has(e.entity_id)) {
      answerEvents.set(e.entity_id, {
        views: 0, completes: 0, skips: 0,
        likes: 0, shares: 0, replays: 0,
        watchTimeSum: 0, watchCount: 0,
      });
    }

    const stats = answerEvents.get(e.entity_id);
    switch (e.event_type) {
      case "view": stats.views++; break;
      case "complete": stats.completes++; break;
      case "skip": stats.skips++; break;
      case "like": stats.likes++; break;
      case "share": stats.shares++; break;
      case "replay": stats.replays++; break;
      case "watch":
        if (e.watch_time) {
          stats.watchTimeSum += e.watch_time;
          stats.watchCount++;
        }
        break;
    }
  }

  // Upsert each answer's metrics
  for (const [answerId, stats] of answerEvents) {
    try {
      const existing = await db("answer_metrics").where("answer_id", answerId).first();

      if (existing) {
        const newViews = (existing.views_24h || 0) + stats.views;
        const newCompletes = (existing.completes_24h || 0) + stats.completes;
        const newSkips = (existing.skips_24h || 0) + stats.skips;
        const totalWatchTime = (existing.total_watch_time || 0) + stats.watchTimeSum;
        const avgWatchTime = newViews > 0 ? totalWatchTime / newViews : 0;
        const completionRate = newViews > 0 ? newCompletes / newViews : 0;
        const skipRate = newViews > 0 ? newSkips / newViews : 0;

        // UPGRADE 1: Engagement score with weights
        // FIX 3: Diminishing returns for shares after 5
        const totalShares = (existing.shares_24h || 0) + stats.shares;
        const effectiveShareWeight = totalShares > 5
          ? EVENT_WEIGHTS.share * (1 - Math.min(0.4, (totalShares - 5) * 0.08))
          : EVENT_WEIGHTS.share;

        const engagementScore =
          (newViews * EVENT_WEIGHTS.view) +
          (newCompletes * EVENT_WEIGHTS.complete) +
          ((existing.likes_24h || 0) + stats.likes) * EVENT_WEIGHTS.like +
          totalShares * effectiveShareWeight +
          ((existing.replays_24h || 0) + stats.replays) * EVENT_WEIGHTS.replay +
          (newSkips * EVENT_WEIGHTS.skip);

        await db("answer_metrics").where("answer_id", answerId).update({
          views_24h: newViews,
          completes_24h: newCompletes,
          skips_24h: newSkips,
          likes_24h: (existing.likes_24h || 0) + stats.likes,
          shares_24h: (existing.shares_24h || 0) + stats.shares,
          replays_24h: (existing.replays_24h || 0) + stats.replays,
          total_watch_time: totalWatchTime,
          avg_watch_time: Math.round(avgWatchTime * 100) / 100,
          completion_rate: Math.round(completionRate * 1000) / 1000,
          skip_rate: Math.round(skipRate * 1000) / 1000,
          engagement_score: Math.round(engagementScore * 10) / 10,
          last_aggregated_at: new Date().toISOString(),
        });
      } else {
        const avgWatchTime = stats.views > 0 ? stats.watchTimeSum / stats.views : 0;
        const completionRate = stats.views > 0 ? stats.completes / stats.views : 0;
        const skipRate = stats.views > 0 ? stats.skips / stats.views : 0;

        const engagementScore =
          (stats.views * EVENT_WEIGHTS.view) +
          (stats.completes * EVENT_WEIGHTS.complete) +
          (stats.likes * EVENT_WEIGHTS.like) +
          (stats.shares * EVENT_WEIGHTS.share) +
          (stats.replays * EVENT_WEIGHTS.replay) +
          (stats.skips * EVENT_WEIGHTS.skip);

        await db("answer_metrics").insert({
          answer_id: answerId,
          views_24h: stats.views,
          completes_24h: stats.completes,
          skips_24h: stats.skips,
          likes_24h: stats.likes,
          shares_24h: stats.shares,
          replays_24h: stats.replays,
          total_watch_time: stats.watchTimeSum,
          avg_watch_time: Math.round(avgWatchTime * 100) / 100,
          completion_rate: Math.round(completionRate * 1000) / 1000,
          skip_rate: Math.round(skipRate * 1000) / 1000,
          engagement_score: Math.round(engagementScore * 10) / 10,
        });
      }
    } catch (_) {
      // Non-critical — don't fail the request
    }
  }
}

/**
 * GET /api/events/stats — derived metrics for an entity
 */
exports.getEntityStats = async (req, res) => {
  try {
    const entityType = req.query.entity_type || "answer";
    const entityId = Number(req.query.entity_id);
    if (!entityId) return res.status(400).json({ error: "entity_id required" });

    // Try answer_metrics first (fast path)
    if (entityType === "answer") {
      const metrics = await req.db("answer_metrics").where("answer_id", entityId).first();
      if (metrics) {
        return res.json({
          entity_type: entityType,
          entity_id: entityId,
          views_24h: metrics.views_24h,
          completes_24h: metrics.completes_24h,
          skips_24h: metrics.skips_24h,
          likes_24h: metrics.likes_24h,
          shares_24h: metrics.shares_24h,
          replays_24h: metrics.replays_24h,
          completion_rate: metrics.completion_rate,
          skip_rate: metrics.skip_rate,
          avg_watch_time: metrics.avg_watch_time,
          total_watch_time: metrics.total_watch_time,
          engagement_score: metrics.engagement_score,
          source: "aggregated",
        });
      }
    }

    // Fallback: compute from raw events
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [views, completes, skips, watchStats] = await Promise.all([
      req.db("client_events")
        .where({ entity_type: entityType, entity_id: entityId, event_type: "view" })
        .where("created_at", ">=", oneDayAgo)
        .count("id as count").first(),

      req.db("client_events")
        .where({ entity_type: entityType, entity_id: entityId, event_type: "complete" })
        .where("created_at", ">=", oneDayAgo)
        .count("id as count").first(),

      req.db("client_events")
        .where({ entity_type: entityType, entity_id: entityId, event_type: "skip" })
        .where("created_at", ">=", oneDayAgo)
        .count("id as count").first(),

      req.db("client_events")
        .where({ entity_type: entityType, entity_id: entityId, event_type: "watch" })
        .where("created_at", ">=", oneDayAgo)
        .avg("watch_time as avg_watch_time")
        .sum("watch_time as total_watch_time")
        .first(),
    ]);

    const viewCount = parseInt(views?.count) || 0;
    const completeCount = parseInt(completes?.count) || 0;
    const skipCount = parseInt(skips?.count) || 0;

    res.json({
      entity_type: entityType,
      entity_id: entityId,
      views_24h: viewCount,
      completes_24h: completeCount,
      skips_24h: skipCount,
      completion_rate: viewCount > 0 ? Math.round((completeCount / viewCount) * 100) / 100 : 0,
      skip_rate: viewCount > 0 ? Math.round((skipCount / viewCount) * 100) / 100 : 0,
      avg_watch_time: Math.round((Number(watchStats?.avg_watch_time) || 0) * 100) / 100,
      total_watch_time: Math.round((Number(watchStats?.total_watch_time) || 0) * 100) / 100,
      source: "raw_events",
    });
  } catch (error) {
    console.error("Event stats error:", error);
    res.status(500).json({ error: "Failed to get event stats" });
  }
};

// Export weights for use in feed scoring
exports.EVENT_WEIGHTS = EVENT_WEIGHTS;

/**
 * HAPI 5: GET /api/events/kpi — Day-1 KPI Dashboard
 *
 * Returns the 4 critical metrics:
 *   1. avg_watch_time (target: > 3s)
 *   2. completion_rate (target: 40%+)
 *   3. swipes_per_session (target: > 5)
 *   4. dau (daily active users)
 */
exports.getKPIDashboard = async (req, res) => {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [watchStats, viewCount, completeCount, skipCount, swipeSessions, dauCount] = await Promise.all([
      // 1. AVG WATCH TIME
      req.db("client_events")
        .where("event_type", "watch")
        .where("created_at", ">=", oneDayAgo)
        .avg("watch_time as avg")
        .count("id as total")
        .first(),

      // views
      req.db("client_events")
        .where("event_type", "view")
        .where("created_at", ">=", oneDayAgo)
        .count("id as count")
        .first(),

      // 2. COMPLETION RATE
      req.db("client_events")
        .where("event_type", "complete")
        .where("created_at", ">=", oneDayAgo)
        .count("id as count")
        .first(),

      // skips
      req.db("client_events")
        .where("event_type", "skip")
        .where("created_at", ">=", oneDayAgo)
        .count("id as count")
        .first(),

      // 3. SWIPES PER SESSION
      req.db("client_events")
        .where("event_type", "swipe")
        .where("created_at", ">=", oneDayAgo)
        .whereNotNull("session_id")
        .select("session_id")
        .count("id as swipes")
        .groupBy("session_id"),

      // 4. DAU
      req.db("client_events")
        .where("created_at", ">=", oneDayAgo)
        .whereNotNull("user_id")
        .countDistinct("user_id as count")
        .first(),
    ]);

    const views = parseInt(viewCount?.count) || 0;
    const completes = parseInt(completeCount?.count) || 0;
    const skips = parseInt(skipCount?.count) || 0;

    const totalSessions = swipeSessions.length;
    const totalSwipes = swipeSessions.reduce((sum, s) => sum + (parseInt(s.swipes) || 0), 0);

    const avgWatchTime = Math.round((Number(watchStats?.avg) || 0) * 100) / 100;
    const completionRate = views > 0 ? Math.round((completes / views) * 1000) / 10 : 0;
    const skipRate = views > 0 ? Math.round((skips / views) * 1000) / 10 : 0;
    const swipesPerSession = totalSessions > 0 ? Math.round((totalSwipes / totalSessions) * 10) / 10 : 0;
    const dau = parseInt(dauCount?.count) || 0;

    // Health signals
    const health = {
      avg_watch_time: avgWatchTime >= 3 ? "🟢" : avgWatchTime >= 2 ? "🟡" : "🔴",
      completion_rate: completionRate >= 40 ? "🟢" : completionRate >= 25 ? "🟡" : "🔴",
      swipes_per_session: swipesPerSession >= 5 ? "🟢" : swipesPerSession >= 3 ? "🟡" : "🔴",
    };

    // FIX 4: Alert logging for critical KPI drops
    if (views > 10) {
      if (avgWatchTime < 2.5) {
        console.warn(`🚨 KPI ALERT: Low avg watch time (${avgWatchTime}s) — content may be weak`);
      }
      if (completionRate < 30) {
        console.warn(`🚨 KPI ALERT: Low completion rate (${completionRate}%) — videos not engaging`);
      }
      if (swipesPerSession < 3 && totalSessions > 5) {
        console.warn(`🚨 KPI ALERT: Low swipes/session (${swipesPerSession}) — feed not interesting`);
      }
    }

    res.json({
      period: "24h",
      kpis: {
        avg_watch_time: { value: avgWatchTime, unit: "seconds", target: 3, health: health.avg_watch_time },
        completion_rate: { value: completionRate, unit: "%", target: 40, health: health.completion_rate },
        skip_rate: { value: skipRate, unit: "%" },
        swipes_per_session: { value: swipesPerSession, target: 5, health: health.swipes_per_session },
        dau: { value: dau },
        total_events: { value: parseInt(watchStats?.total) || 0 },
        total_sessions: { value: totalSessions },
      },
      alerts: [
        ...(avgWatchTime < 2.5 && views > 10 ? [{ level: "critical", metric: "avg_watch_time", message: "Watch time below 2.5s — content quality issue" }] : []),
        ...(completionRate < 30 && views > 10 ? [{ level: "critical", metric: "completion_rate", message: "Completion below 30% — videos not engaging" }] : []),
        ...(swipesPerSession < 3 && totalSessions > 5 ? [{ level: "warning", metric: "swipes_per_session", message: "Users not scrolling — feed needs work" }] : []),
      ],
    });
  } catch (error) {
    console.error("KPI dashboard error:", error);
    res.status(500).json({ error: "Failed to compute KPIs" });
  }
};
