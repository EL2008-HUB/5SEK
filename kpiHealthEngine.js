/**
 * KPI Health Engine — Self-Correcting Feed System
 *
 * METRICS:
 *   1. Scroll Depth — % of feed consumed per session
 *   2. Session Length — time spent in app
 *   3. Content Distribution — creator diversity in feed
 *   4. Exploration Success — do new posts perform?
 *
 * ALERTS:
 *   avgSession < 40s → "Retention drop"
 *   scrollDepth < 0.3 → "Feed boring"
 *   explorationSuccess < 0.1 → "Discovery broken"
 *   distribution < 0.3 → "Creator monopoly"
 *
 * AUTO-ADAPTATION:
 *   KPI drives feed weights automatically.
 *   scrollDepth low → increase exploration
 *   avgSession high → increase personalization
 */

// ─────────────────────────────────────────────
// METRICS STORAGE (in-memory, rolling window)
// ─────────────────────────────────────────────

const metrics = {
  // Scroll depth: { userId → [depths] }
  scrollDepths: new Map(),

  // Sessions: { userId → [{ start, end, duration }] }
  sessions: new Map(),

  // Distribution: { userId → Set<creatorId> per session }
  distributions: new Map(),

  // Exploration: { totalViews, totalEngagements }
  exploration: { views: 0, engagements: 0 },

  // Global aggregates (computed periodically)
  global: {
    avgScrollDepth: 0,
    avgSessionLength: 0,
    avgDistribution: 0,
    explorationSuccess: 0,
    lastComputed: 0,
    totalSessions: 0,
  },
};

// ─────────────────────────────────────────────
// 1. SCROLL DEPTH
// ─────────────────────────────────────────────

function trackScrollDepth(userId, depth) {
  if (!userId || typeof depth !== "number") return;
  const clamped = Math.max(0, Math.min(1, depth));

  if (!metrics.scrollDepths.has(userId)) {
    metrics.scrollDepths.set(userId, []);
  }
  const depths = metrics.scrollDepths.get(userId);
  depths.push(clamped);
  // Keep last 20 sessions
  if (depths.length > 20) depths.shift();
}

function getUserScrollDepth(userId) {
  const depths = metrics.scrollDepths.get(userId);
  if (!depths || depths.length === 0) return 0;
  return depths.reduce((a, b) => a + b, 0) / depths.length;
}

// ─────────────────────────────────────────────
// 2. SESSION LENGTH
// ─────────────────────────────────────────────

function trackSessionStart(userId) {
  if (!userId) return;
  if (!metrics.sessions.has(userId)) {
    metrics.sessions.set(userId, []);
  }
  const sessions = metrics.sessions.get(userId);
  sessions.push({ start: Date.now(), end: null, duration: 0 });
  // Keep last 20
  if (sessions.length > 20) sessions.shift();
}

function trackSessionEnd(userId, durationMs) {
  if (!userId) return;
  const sessions = metrics.sessions.get(userId);
  if (!sessions || sessions.length === 0) return;

  const last = sessions[sessions.length - 1];
  last.end = Date.now();
  last.duration = typeof durationMs === "number" ? durationMs : (last.end - last.start);
}

function getUserAvgSession(userId) {
  const sessions = metrics.sessions.get(userId);
  if (!sessions || sessions.length === 0) return 0;
  const completed = sessions.filter(s => s.duration > 0);
  if (completed.length === 0) return 0;
  return completed.reduce((a, s) => a + s.duration, 0) / completed.length / 1000; // seconds
}

// ─────────────────────────────────────────────
// 3. CONTENT DISTRIBUTION
// ─────────────────────────────────────────────

function trackCreatorSeen(userId, creatorId) {
  if (!userId || !creatorId) return;
  if (!metrics.distributions.has(userId)) {
    metrics.distributions.set(userId, { creators: new Set(), totalItems: 0 });
  }
  const dist = metrics.distributions.get(userId);
  dist.creators.add(creatorId);
  dist.totalItems++;
}

function getUserDistribution(userId) {
  const dist = metrics.distributions.get(userId);
  if (!dist || dist.totalItems === 0) return 0;
  return dist.creators.size / dist.totalItems;
}

// Reset per session
function resetDistribution(userId) {
  if (userId) metrics.distributions.delete(userId);
}

// ─────────────────────────────────────────────
// 4. EXPLORATION SUCCESS
// ─────────────────────────────────────────────

function trackExplorationView() {
  metrics.exploration.views++;
}

function trackExplorationEngagement() {
  metrics.exploration.engagements++;
}

function getExplorationSuccess() {
  if (metrics.exploration.views === 0) return 0;
  return metrics.exploration.engagements / metrics.exploration.views;
}

// ─────────────────────────────────────────────
// EVENT PROCESSOR — call from eventController
// ─────────────────────────────────────────────

function processKPIEvent(userId, event) {
  if (!event) return;

  switch (event.event_type) {
    case "scroll_depth": {
      const meta = parseMeta(event.metadata);
      if (meta.depth !== undefined) {
        trackScrollDepth(userId, meta.depth);
      } else if (meta.max_position && meta.total_loaded) {
        trackScrollDepth(userId, meta.max_position / meta.total_loaded);
      }
      break;
    }

    case "feed_open":
    case "session_return":
      trackSessionStart(userId);
      resetDistribution(userId);
      break;

    case "feed_close": {
      const meta = parseMeta(event.metadata);
      trackSessionEnd(userId, meta.duration);
      break;
    }

    case "view":
    case "complete":
    case "like":
    case "skip": {
      // Track creator distribution
      const meta = parseMeta(event.metadata);
      if (meta.creator_id) {
        trackCreatorSeen(userId, meta.creator_id);
      }

      // Track exploration performance
      if (meta.is_exploration) {
        trackExplorationView();
        if (event.event_type === "complete" || event.event_type === "like") {
          trackExplorationEngagement();
        }
      }
      break;
    }
  }
}

function parseMeta(metadata) {
  if (!metadata) return {};
  if (typeof metadata === "object") return metadata;
  try { return JSON.parse(metadata); } catch (_) { return {}; }
}

// ─────────────────────────────────────────────
// GLOBAL AGGREGATION (periodic)
// ─────────────────────────────────────────────

function computeGlobalMetrics() {
  let totalDepth = 0, depthCount = 0;
  for (const [, depths] of metrics.scrollDepths) {
    if (depths.length > 0) {
      totalDepth += depths.reduce((a, b) => a + b, 0) / depths.length;
      depthCount++;
    }
  }

  let totalSession = 0, sessionCount = 0;
  for (const [, sessions] of metrics.sessions) {
    const completed = sessions.filter(s => s.duration > 0);
    for (const s of completed) {
      totalSession += s.duration / 1000;
      sessionCount++;
    }
  }

  let totalDist = 0, distCount = 0;
  for (const [, dist] of metrics.distributions) {
    if (dist.totalItems > 0) {
      totalDist += dist.creators.size / dist.totalItems;
      distCount++;
    }
  }

  metrics.global = {
    avgScrollDepth: depthCount > 0 ? Math.round((totalDepth / depthCount) * 1000) / 1000 : 0,
    avgSessionLength: sessionCount > 0 ? Math.round(totalSession / sessionCount) : 0,
    avgDistribution: distCount > 0 ? Math.round((totalDist / distCount) * 1000) / 1000 : 0,
    explorationSuccess: Math.round(getExplorationSuccess() * 1000) / 1000,
    lastComputed: Date.now(),
    totalSessions: sessionCount,
  };

  return metrics.global;
}

// Auto-compute every 5 min
setInterval(computeGlobalMetrics, 5 * 60 * 1000);

// ─────────────────────────────────────────────
// 7. ALERT SYSTEM
// ─────────────────────────────────────────────

function checkAlerts() {
  const g = metrics.global;
  const alerts = [];

  if (g.totalSessions >= 10) { // need enough data
    if (g.avgSessionLength > 0 && g.avgSessionLength < 40) {
      alerts.push({
        level: "critical",
        metric: "session_length",
        value: g.avgSessionLength,
        target: 60,
        message: "🚨 Retention drop — avg session < 40s",
      });
    }

    if (g.avgScrollDepth > 0 && g.avgScrollDepth < 0.3) {
      alerts.push({
        level: "warning",
        metric: "scroll_depth",
        value: g.avgScrollDepth,
        target: 0.6,
        message: "⚠️ Feed boring — scroll depth < 30%",
      });
    }

    if (g.explorationSuccess > 0 && g.explorationSuccess < 0.1) {
      alerts.push({
        level: "critical",
        metric: "exploration_success",
        value: g.explorationSuccess,
        target: 0.2,
        message: "🚨 Discovery broken — exploration success < 10%",
      });
    }

    if (g.avgDistribution > 0 && g.avgDistribution < 0.3) {
      alerts.push({
        level: "warning",
        metric: "distribution",
        value: g.avgDistribution,
        target: 0.5,
        message: "⚠️ Creator monopoly — distribution < 30%",
      });
    }
  }

  return alerts;
}

// ─────────────────────────────────────────────
// 8. STABLE FEED ADAPTATION
//
// STABILITY CONTROLS:
//   ⚠️ FIX 1: EMA smoothing (no instant jumps)
//   ⚠️ FIX 2: 30-min cooldown between adaptations
//   ⚠️ FIX 3: Weight guardrails (hard min/max)
//   ⚠️ FIX 4: User-level split (new vs returning)
//   🔥 BONUS: Momentum detection (trend awareness)
// ─────────────────────────────────────────────

const feedWeights = {
  personalization: 0.35,
  trending: 0.25,
  breakout: 0.15,
  exploration: 0.15,
  random: 0.10,
};

// ⚠️ FIX 3: WEIGHT GUARDRAILS — hard min/max per key
const GUARDRAILS = {
  personalization: { min: 0.20, max: 0.60 },
  trending:        { min: 0.10, max: 0.40 },
  breakout:        { min: 0.05, max: 0.25 },
  exploration:     { min: 0.05, max: 0.30 },
  random:          { min: 0.05, max: 0.20 },
};

// ⚠️ FIX 2: COOLDOWN — min 30 min between adaptations
const ADAPTATION_COOLDOWN_MS = 30 * 60 * 1000;
let lastAdaptationAt = 0;

// 🔥 MOMENTUM DETECTION — track KPI history for trend awareness
const kpiHistory = []; // [{scrollDepth, avgSession, ts}] — last 6 cycles
const MAX_HISTORY = 6;

function recordKPISnapshot(g) {
  kpiHistory.push({
    scrollDepth: g.avgScrollDepth,
    avgSession: g.avgSessionLength,
    explorationSuccess: g.explorationSuccess,
    distribution: g.avgDistribution,
    ts: Date.now(),
  });
  if (kpiHistory.length > MAX_HISTORY) kpiHistory.shift();
}

function detectMomentum() {
  if (kpiHistory.length < 3) return "unknown";

  const recent3 = kpiHistory.slice(-3);
  const scrollTrend = recent3[2].scrollDepth - recent3[0].scrollDepth;
  const sessionTrend = recent3[2].avgSession - recent3[0].avgSession;

  if (scrollTrend > 0.05 && sessionTrend > 5) return "improving";
  if (scrollTrend < -0.05 || sessionTrend < -10) return "degrading";
  return "stable";
}

// ⚠️ FIX 1: EMA SMOOTH ADAPTATION
// weight = weight × (1 - alpha) + target × alpha
const EMA_ALPHA = 0.1; // 10% toward target per cycle — smooth

function emaSmooth(currentWeight, targetWeight) {
  return currentWeight * (1 - EMA_ALPHA) + targetWeight * EMA_ALPHA;
}

function adaptFeedWeights() {
  const g = metrics.global;
  if (g.totalSessions < 10) return feedWeights; // not enough data

  // ⚠️ FIX 2: COOLDOWN — skip if too recent
  if (Date.now() - lastAdaptationAt < ADAPTATION_COOLDOWN_MS) {
    return feedWeights;
  }

  // Record KPI snapshot for momentum detection
  recordKPISnapshot(g);

  // 🔥 MOMENTUM: if improving, don't change — keep what works
  const momentum = detectMomentum();
  if (momentum === "improving") {
    lastAdaptationAt = Date.now();
    return feedWeights;
  }

  // Only adapt in "bad" or "degrading" states
  const isBadState = (g.avgScrollDepth > 0 && g.avgScrollDepth < 0.4) ||
                     (g.avgSessionLength > 0 && g.avgSessionLength < 40);

  if (!isBadState && momentum === "stable") {
    lastAdaptationAt = Date.now();
    return feedWeights; // Good state + stable → no changes
  }

  // Compute TARGET weights (what we'd ideally want)
  const target = {
    personalization: 0.35,
    trending: 0.25,
    breakout: 0.15,
    exploration: 0.15,
    random: 0.10,
  };

  // Low scroll depth → feed is boring → increase exploration
  if (g.avgScrollDepth > 0 && g.avgScrollDepth < 0.4) {
    target.exploration += 0.10;
    target.personalization -= 0.05;
    target.trending -= 0.05;
  }

  // High session → user is engaged → increase personalization
  if (g.avgSessionLength > 120) {
    target.personalization += 0.10;
    target.exploration -= 0.05;
    target.random -= 0.05;
  }

  // Low exploration success → reduce exploration
  if (g.explorationSuccess > 0 && g.explorationSuccess < 0.1) {
    target.exploration -= 0.05;
    target.trending += 0.05;
  }

  // High exploration success → increase exploration
  if (g.explorationSuccess > 0.25) {
    target.exploration += 0.05;
    target.trending -= 0.05;
  }

  // Low distribution → force diversity
  if (g.avgDistribution > 0 && g.avgDistribution < 0.3) {
    target.random += 0.05;
    target.personalization -= 0.05;
  }

  // ⚠️ FIX 1: Apply EMA smoothing (no instant jumps)
  for (const key in feedWeights) {
    feedWeights[key] = emaSmooth(feedWeights[key], target[key]);
  }

  // ⚠️ FIX 3: Apply guardrails (hard min/max)
  for (const key in feedWeights) {
    const guard = GUARDRAILS[key];
    if (guard) {
      feedWeights[key] = Math.max(guard.min, Math.min(guard.max, feedWeights[key]));
    }
  }

  // Normalize to sum = 1.0
  const total = Object.values(feedWeights).reduce((a, b) => a + b, 0);
  for (const key in feedWeights) {
    feedWeights[key] = Math.round((feedWeights[key] / total) * 1000) / 1000;
  }

  lastAdaptationAt = Date.now();
  return feedWeights;
}

// ⚠️ FIX 4: USER-LEVEL WEIGHT ADJUSTMENTS
// Returns per-user adjusted weights based on user type
function getUserWeights(userContext) {
  const base = { ...feedWeights };

  if (!userContext) return base;

  // New users → more exploration (help them discover)
  if (userContext.isNew || (userContext.totalSessions || 0) < 3) {
    base.exploration += 0.10;
    base.personalization -= 0.05;
    base.trending -= 0.05;
  }

  // Returning power users → more personalization (give them what they love)
  if (userContext.isReturningUser && (userContext.totalSessions || 0) > 10) {
    base.personalization += 0.10;
    base.exploration -= 0.05;
    base.random -= 0.05;
  }

  // High skip rate → more trending hooks
  if ((userContext.skipRate || 0) > 0.5) {
    base.trending += 0.05;
    base.personalization -= 0.05;
  }

  // Apply guardrails to user-level too
  for (const key in base) {
    const guard = GUARDRAILS[key];
    if (guard) {
      base[key] = Math.max(guard.min, Math.min(guard.max, base[key]));
    }
  }

  // Normalize
  const total = Object.values(base).reduce((a, b) => a + b, 0);
  for (const key in base) {
    base[key] = Math.round((base[key] / total) * 1000) / 1000;
  }

  return base;
}

// Adapt every 30 min (matches cooldown)
setInterval(adaptFeedWeights, 30 * 60 * 1000);

// ─────────────────────────────────────────────
// KPI ENDPOINT DATA
// ─────────────────────────────────────────────

function getKPIHealth() {
  computeGlobalMetrics();
  const g = metrics.global;
  const alerts = checkAlerts();
  const weights = adaptFeedWeights();
  const momentum = detectMomentum();

  // Determine overall health
  let health = "🟢";
  if (alerts.some(a => a.level === "warning")) health = "🟡";
  if (alerts.some(a => a.level === "critical")) health = "🔴";

  return {
    scrollDepth: g.avgScrollDepth,
    avgSession: g.avgSessionLength,
    distribution: g.avgDistribution,
    explorationSuccess: g.explorationSuccess,
    totalSessions: g.totalSessions,
    health,
    momentum,
    alerts,
    feedWeights: weights,
    stability: {
      cooldownMs: ADAPTATION_COOLDOWN_MS,
      lastAdaptedAt: lastAdaptationAt ? new Date(lastAdaptationAt).toISOString() : null,
      emaAlpha: EMA_ALPHA,
      guardrails: GUARDRAILS,
      kpiHistorySize: kpiHistory.length,
    },
    trackedUsers: {
      scrollDepth: metrics.scrollDepths.size,
      sessions: metrics.sessions.size,
      distributions: metrics.distributions.size,
    },
  };
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  // Event processing
  processKPIEvent,

  // Individual metrics
  trackScrollDepth,
  trackSessionStart,
  trackSessionEnd,
  trackCreatorSeen,
  trackExplorationView,
  trackExplorationEngagement,

  // Reads
  getUserScrollDepth,
  getUserAvgSession,
  getUserDistribution,
  getExplorationSuccess,

  // Global
  computeGlobalMetrics,
  checkAlerts,
  adaptFeedWeights,
  getUserWeights,
  detectMomentum,
  getKPIHealth,

  // Feed weights (live reference)
  getFeedWeights: () => ({ ...feedWeights }),
};
