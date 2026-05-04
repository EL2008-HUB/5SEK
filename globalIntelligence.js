/**
 * Global Viral Intelligence (Level 5)
 *
 * COLLECTIVE INTELLIGENCE across all users:
 *   - Global trending scores (all users' engagement aggregated)
 *   - Content velocity detection (rapid engagement spikes)
 *   - Cross-user signal propagation
 *   - Global topic heat map
 *
 * This is NOT per-user state. This is the "hive mind".
 *
 * TikTok "For You" = personal state + global intelligence
 */

// ─────────────────────────────────────────────
// GLOBAL TRENDING STATE (in-memory, computed continuously)
// ─────────────────────────────────────────────

const globalState = {
  // Content trending scores (answerId → score)
  contentScores: new Map(),

  // Topic heat map (topic → { score, velocity, lastUpdated })
  topicHeat: new Map(),

  // Recent engagement velocity (answerId → events in last 5 min)
  velocityWindow: new Map(),

  // Global stats
  totalEventsLastHour: 0,
  activeUsersLastHour: new Set(),
  lastComputed: Date.now(),
};

// ─────────────────────────────────────────────
// CONTENT TRENDING SCORE
//
// globalTrendingScore =
//   sum(allUsers.engagement) * velocity * decay(time)
//
// This is what makes "For You" work globally.
// ─────────────────────────────────────────────

const GLOBAL_WEIGHTS = {
  view: 0.5,
  complete: 3,
  like: 2,
  share: 4,
  replay: 2.5,
  skip: -1,
  share_clicked: 5,
};

function ingestGlobalSignal(event) {
  if (!event.entity_id || event.entity_type !== "answer") return;

  const answerId = event.entity_id;
  const weight = GLOBAL_WEIGHTS[event.event_type] || 0;
  if (weight === 0) return;

  // Update content score
  const current = globalState.contentScores.get(answerId) || {
    score: 0,
    views: 0,
    completes: 0,
    shares: 0,
    firstSeen: Date.now(),
    lastEngaged: Date.now(),
  };

  current.score += weight;
  current.lastEngaged = Date.now();

  if (event.event_type === "view") current.views++;
  if (event.event_type === "complete") current.completes++;
  if (event.event_type === "share" || event.event_type === "share_clicked") current.shares++;

  globalState.contentScores.set(answerId, current);

  // Update velocity window (5-min sliding window)
  const now = Date.now();
  if (!globalState.velocityWindow.has(answerId)) {
    globalState.velocityWindow.set(answerId, []);
  }
  const window = globalState.velocityWindow.get(answerId);
  window.push(now);

  // Track active users
  if (event.user_id) {
    globalState.activeUsersLastHour.add(event.user_id);
  }
  globalState.totalEventsLastHour++;

  // Update topic heat
  if (event.metadata) {
    const meta = typeof event.metadata === "string"
      ? (() => { try { return JSON.parse(event.metadata); } catch (_) { return {}; } })()
      : event.metadata;

    const topic = meta.topic || meta.category;
    if (topic && weight > 0) {
      const heat = globalState.topicHeat.get(topic) || { score: 0, velocity: 0, lastUpdated: now };
      heat.score += weight;
      heat.lastUpdated = now;
      globalState.topicHeat.set(topic, heat);
    }
  }
}

// ─────────────────────────────────────────────
// COMPUTE GLOBAL TRENDING (called periodically)
// ─────────────────────────────────────────────

function computeGlobalTrending(topN = 30) {
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  const oneHourAgo = now - 60 * 60 * 1000;

  // Clean velocity windows
  for (const [answerId, timestamps] of globalState.velocityWindow) {
    const recent = timestamps.filter(t => t > fiveMinAgo);
    if (recent.length === 0) {
      globalState.velocityWindow.delete(answerId);
    } else {
      globalState.velocityWindow.set(answerId, recent);
    }
  }

  // Compute trending scores with velocity + decay
  const trending = [];

  for (const [answerId, data] of globalState.contentScores) {
    const ageHours = Math.max((now - data.firstSeen) / (1000 * 60 * 60), 0.1);

    // Velocity: events in last 5 minutes
    const recentEvents = (globalState.velocityWindow.get(answerId) || []).length;
    const velocity = recentEvents; // raw count in 5-min window

    // Time decay: halves every 6 hours (faster than per-user decay)
    const decay = Math.pow(0.5, ageHours / 6);

    // Engagement rate
    const engagementRate = data.views > 0
      ? (data.completes + data.shares * 2) / data.views
      : 0;

    // GLOBAL TRENDING SCORE
    // = log(1 + rawScore) * (1 + velocity/5) * engagementRate * decay
    const trendingScore =
      Math.log(1 + data.score) *
      (1 + velocity / 5) *
      (1 + engagementRate) *
      decay;

    trending.push({
      answerId,
      trendingScore: Math.round(trendingScore * 1000) / 1000,
      velocity,
      views: data.views,
      completes: data.completes,
      shares: data.shares,
      ageHours: Math.round(ageHours * 10) / 10,
      engagementRate: Math.round(engagementRate * 1000) / 1000,
    });
  }

  // Sort by trending score, take top N
  trending.sort((a, b) => b.trendingScore - a.trendingScore);

  // Clean old entries (> 24h with no recent engagement)
  for (const [answerId, data] of globalState.contentScores) {
    if (now - data.lastEngaged > 24 * 60 * 60 * 1000) {
      globalState.contentScores.delete(answerId);
    }
  }

  // Reset hourly counters
  if (now - globalState.lastComputed > 60 * 60 * 1000) {
    globalState.totalEventsLastHour = 0;
    globalState.activeUsersLastHour = new Set();
    globalState.lastComputed = now;
  }

  return trending.slice(0, topN);
}

// ─────────────────────────────────────────────
// TOPIC HEAT MAP (global topic popularity)
// ─────────────────────────────────────────────

function getTopicHeatMap() {
  const now = Date.now();
  const heatMap = {};

  for (const [topic, data] of globalState.topicHeat) {
    const ageHours = (now - data.lastUpdated) / (1000 * 60 * 60);
    const decay = Math.pow(0.5, ageHours / 12);
    const heat = data.score * decay;

    if (heat > 0.1) {
      heatMap[topic] = Math.round(heat * 100) / 100;
    }
  }

  return heatMap;
}

// ─────────────────────────────────────────────
// FEED INTEGRATION: Get global trending IDs for injection
// ─────────────────────────────────────────────

function getGlobalTrendingIds(limit = 10) {
  const trending = computeGlobalTrending(limit);
  return trending.map(t => t.answerId);
}

function getGlobalBoostForAnswer(answerId) {
  const data = globalState.contentScores.get(answerId);
  if (!data) return 0;

  const now = Date.now();
  const ageHours = Math.max((now - data.firstSeen) / (1000 * 60 * 60), 0.1);
  const velocity = (globalState.velocityWindow.get(answerId) || []).length;
  const decay = Math.pow(0.5, ageHours / 6);

  // Returns a 0-10 boost value
  return Math.min(10, Math.log(1 + data.score) * (1 + velocity / 5) * decay);
}

// ─────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────

function getGlobalStats() {
  return {
    trackedContent: globalState.contentScores.size,
    activeVelocityTrackers: globalState.velocityWindow.size,
    topicsTracked: globalState.topicHeat.size,
    totalEventsLastHour: globalState.totalEventsLastHour,
    activeUsersLastHour: globalState.activeUsersLastHour.size,
    topicHeatMap: getTopicHeatMap(),
    topTrending: computeGlobalTrending(5),
  };
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  ingestGlobalSignal,
  computeGlobalTrending,
  getGlobalTrendingIds,
  getGlobalBoostForAnswer,
  getTopicHeatMap,
  getGlobalStats,
};
