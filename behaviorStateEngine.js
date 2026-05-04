/**
 * User Behavior State Engine v2 (K19)
 *
 * CORE PRINCIPLE:
 *   ❌ Don't compute feed "on request"
 *   ✅ Compute state "on event" → feed just READS
 *
 * Level 4: Learning Feedback Loop
 *   - Topic weights auto-adjust from user behavior
 *   - Skip 3x same topic = reduce weight
 *   - Dwell 20%+ above avg = increase weight
 *   - Weights decay over time (freshness)
 *
 * Level 5: Global intelligence integration
 *   - Every event also feeds the global hive mind
 */

const { ingestEvent: ingestGlobalSignal } = require("./globalTrending");

// ─────────────────────────────────────────────
// K17: EVENT NORMALIZATION LAYER
// ─────────────────────────────────────────────

const EVENT_TAXONOMY = {
  // Engagement signals
  view:       { category: "engagement", weight: 1 },
  watch:      { category: "engagement", weight: 2 },
  complete:   { category: "engagement", weight: 5 },
  replay:     { category: "engagement", weight: 3 },
  like:       { category: "engagement", weight: 3 },
  skip:       { category: "engagement", weight: -3 },

  // Growth signals
  share:           { category: "growth", weight: 4 },
  share_clicked:   { category: "growth", weight: 3 },
  invite_sent:     { category: "growth", weight: 4 },
  invite_accepted: { category: "growth", weight: 4 },

  // Retention signals
  session_return:         { category: "retention", weight: 6 },
  first_session_complete: { category: "retention", weight: 4 },
  feed_open:              { category: "retention", weight: 1 },
  feed_close:             { category: "retention", weight: 0 },

  // Behavior signals (no score, just state update)
  swipe:       { category: "behavior", weight: 0 },
  scroll_depth:{ category: "engagement", weight: 2 },
  record_start:{ category: "engagement", weight: 1 },
  record_post: { category: "engagement", weight: 5 },

  // New event types (K17 expansion)
  session_returned:    { category: "retention", weight: 5 },
  first_30s_complete:  { category: "retention", weight: 3 },
  app_open:            { category: "engagement", weight: 1 },
  notification_clicked:{ category: "retention", weight: 3 },
};

function normalizeEvent(event) {
  const taxonomy = EVENT_TAXONOMY[event.event_type];
  if (!taxonomy) return null;
  return {
    ...event,
    category: taxonomy.category,
    weight: taxonomy.weight,
  };
}

// ─────────────────────────────────────────────
// USER STATE MODEL — "TikTok brain per user"
// ─────────────────────────────────────────────

function createDefaultState() {
  return {
    // Composite scores (updated incrementally)
    engagementScore: 0,
    growthScore: 0,
    retentionScore: 0,

    // Session behavior (real-time)
    scrollSpeed: 0,        // avg seconds between swipes
    skipRate: 0,           // running skip rate (0-1)
    dwellTime: 0,          // total watch time in session
    sessionSwipes: 0,      // swipes in current session

    // Topic affinity (learned from engagement)
    topicAffinity: {},     // { "crypto": 0.8, "tech": 0.5 }

    // Retention tracking
    lastActive: Date.now(),
    sessionsToday: 0,
    totalSessions: 0,
    isReturningUser: false,
    daysSinceFirstSeen: 0,

    // Counters (24h rolling)
    views24h: 0,
    completes24h: 0,
    skips24h: 0,
    shares24h: 0,
    likes24h: 0,

    // 🔥 Level 4: Learning Feedback Loop
    topicSkipCounts: {},   // { "crypto": 3 } — consecutive skips per topic
    topicDwellTimes: {},   // { "crypto": [2.1, 3.5] } — recent dwell times
    avgDwellTime: 0,       // global avg dwell for this user
    feedbackWeights: {},   // { "crypto": 1.2, "tech": 0.7 } — auto-learned

    // Event sequencing
    eventSequence: 0,      // monotonic counter per user

    // Meta
    lastUpdated: Date.now(),
    version: 2,
  };
}

// ─────────────────────────────────────────────
// IN-MEMORY STATE CACHE (hot layer)
// ─────────────────────────────────────────────

const stateCache = new Map();
const STATE_TTL_MS = 30 * 60 * 1000; // evict after 30min idle

function getUserState(userId) {
  if (!userId) return createDefaultState();

  if (stateCache.has(userId)) {
    return stateCache.get(userId);
  }

  const state = createDefaultState();
  stateCache.set(userId, state);
  return state;
}

function setUserState(userId, state) {
  if (!userId) return;
  state.lastUpdated = Date.now();
  stateCache.set(userId, state);
}

// Evict idle users every 5 min
setInterval(() => {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [userId, state] of stateCache) {
    if (state.lastUpdated < cutoff) {
      stateCache.delete(userId);
    }
  }
}, 5 * 60 * 1000);

// ─────────────────────────────────────────────
// K18: GROWTH SIGNALS PROCESSOR
// ─────────────────────────────────────────────

function processGrowthSignals(state, normalizedEvent) {
  if (normalizedEvent.category === "growth") {
    state.growthScore += normalizedEvent.weight;
    if (normalizedEvent.event_type === "share") state.shares24h++;
  }

  if (normalizedEvent.category === "engagement") {
    state.engagementScore += normalizedEvent.weight;

    switch (normalizedEvent.event_type) {
      case "view": state.views24h++; break;
      case "complete": state.completes24h++; break;
      case "skip": state.skips24h++; break;
      case "like": state.likes24h++; break;
    }
  }

  if (normalizedEvent.category === "retention") {
    state.retentionScore += normalizedEvent.weight;

    if (normalizedEvent.event_type === "session_return") {
      state.isReturningUser = true;
      state.totalSessions++;
      state.sessionsToday++;
    }
  }
}

// ─────────────────────────────────────────────
// K19: BEHAVIOR AGGREGATION ENGINE
// ─────────────────────────────────────────────

function updateBehaviorState(state, event) {
  // Scroll speed from swipe metadata
  if (event.event_type === "swipe" && event.metadata) {
    const meta = typeof event.metadata === "string" ? JSON.parse(event.metadata) : event.metadata;
    if (meta.swipe_speed > 0) {
      // Exponential moving average of scroll speed
      state.scrollSpeed = state.scrollSpeed === 0
        ? meta.swipe_speed
        : state.scrollSpeed * 0.7 + meta.swipe_speed * 0.3;
    }
    state.sessionSwipes = meta.swipe_number || (state.sessionSwipes + 1);
  }

  // Skip rate (exponential moving average)
  if (event.event_type === "skip") {
    state.skipRate = Math.min(1, state.skipRate * 0.8 + 0.2);
  } else if (event.event_type === "complete") {
    state.skipRate = Math.max(0, state.skipRate * 0.8);
  }

  // Dwell time from watch events
  if (event.event_type === "watch" && event.watch_time) {
    state.dwellTime += event.watch_time;
  }

  // Topic affinity from engagement on categorized content
  if (event.metadata) {
    const meta = typeof event.metadata === "string" ? JSON.parse(event.metadata) : event.metadata;
    const topic = meta.topic || meta.category;
    if (topic && (event.event_type === "complete" || event.event_type === "like" || event.event_type === "replay")) {
      const current = state.topicAffinity[topic] || 0;
      state.topicAffinity[topic] = Math.min(1, current + 0.1);
    }
    if (topic && event.event_type === "skip") {
      const current = state.topicAffinity[topic] || 0;
      state.topicAffinity[topic] = Math.max(0, current - 0.05);
    }
  }

  // Session tracking
  if (event.event_type === "feed_open") {
    state.sessionsToday++;
    state.totalSessions++;
    state.sessionSwipes = 0;
    state.dwellTime = 0;
  }

  // Scroll depth
  if (event.event_type === "scroll_depth" && event.metadata) {
    const meta = typeof event.metadata === "string" ? JSON.parse(event.metadata) : event.metadata;
    // If they scrolled deep, they're engaged
    if (meta.max_position > 10) {
      state.engagementScore += 2;
    }
  }

  state.lastActive = Date.now();
}

// ─────────────────────────────────────────────
// MAIN: Process event batch → update state
// SLA: <100ms per batch
// ─────────────────────────────────────────────

function processEventBatch(userId, events) {
  if (!userId || !events || events.length === 0) return null;

  const state = getUserState(userId);

  for (const event of events) {
    // Event sequencing (monotonic per user)
    state.eventSequence++;

    const normalized = normalizeEvent(event);
    if (!normalized) continue;

    processGrowthSignals(state, normalized);
    updateBehaviorState(state, event);

    // 🔥 Level 4: Learning feedback loop
    applyLearningFeedback(state, event);

    // 🔥 Level 5: Feed global intelligence
    try { ingestGlobalSignal(event); } catch (_) {}
  }

  setUserState(userId, state);
  return state;
}

// ─────────────────────────────────────────────
// LEVEL 4: LEARNING FEEDBACK LOOP
//
// The system that improves itself from user behavior.
// No ML needed — just EMA + threshold logic.
//
// Rules:
//   skip(topic) >= 3 times  → reduce topic weight
//   dwell(topic) > avg+20%  → increase topic weight
//   complete(topic)          → boost topic weight
//   weights decay 5% daily   → freshness
// ─────────────────────────────────────────────

function applyLearningFeedback(state, event) {
  // Extract topic from event metadata
  let topic = null;
  if (event.metadata) {
    const meta = typeof event.metadata === "string"
      ? (() => { try { return JSON.parse(event.metadata); } catch (_) { return {}; } })()
      : event.metadata;
    topic = meta.topic || meta.category || null;
  }

  if (!topic) return;

  // Initialize if needed
  if (!state.feedbackWeights[topic]) state.feedbackWeights[topic] = 1.0;
  if (!state.topicSkipCounts[topic]) state.topicSkipCounts[topic] = 0;
  if (!state.topicDwellTimes[topic]) state.topicDwellTimes[topic] = [];

  // RULE 1: Skip detection
  if (event.event_type === "skip") {
    state.topicSkipCounts[topic]++;

    if (state.topicSkipCounts[topic] >= 3) {
      // Reduce weight by 15% (floor at 0.2)
      state.feedbackWeights[topic] = Math.max(0.2,
        state.feedbackWeights[topic] * 0.85
      );
      state.topicSkipCounts[topic] = 0; // reset counter
    }
  }

  // RULE 2: Complete = reset skip counter + boost
  if (event.event_type === "complete") {
    state.topicSkipCounts[topic] = 0; // reset skips
    state.feedbackWeights[topic] = Math.min(2.0,
      state.feedbackWeights[topic] * 1.05
    );
  }

  // RULE 3: Dwell time learning
  if (event.event_type === "watch" && event.watch_time > 0) {
    // Keep last 10 dwell times per topic
    state.topicDwellTimes[topic].push(event.watch_time);
    if (state.topicDwellTimes[topic].length > 10) {
      state.topicDwellTimes[topic].shift();
    }

    // Compute topic avg dwell
    const topicDwells = state.topicDwellTimes[topic];
    const topicAvg = topicDwells.reduce((a, b) => a + b, 0) / topicDwells.length;

    // Update global avg dwell (EMA)
    state.avgDwellTime = state.avgDwellTime === 0
      ? topicAvg
      : state.avgDwellTime * 0.9 + topicAvg * 0.1;

    // If topic dwell > avg + 20% → user is interested
    if (topicAvg > state.avgDwellTime * 1.2 && topicDwells.length >= 3) {
      state.feedbackWeights[topic] = Math.min(2.0,
        state.feedbackWeights[topic] * 1.08
      );
    }

    // If topic dwell < avg - 30% → user is bored
    if (topicAvg < state.avgDwellTime * 0.7 && topicDwells.length >= 3) {
      state.feedbackWeights[topic] = Math.max(0.3,
        state.feedbackWeights[topic] * 0.95
      );
    }
  }

  // RULE 4: Like = strong positive signal
  if (event.event_type === "like") {
    state.topicSkipCounts[topic] = 0;
    state.feedbackWeights[topic] = Math.min(2.0,
      state.feedbackWeights[topic] * 1.1
    );
  }

  // RULE 5: Share = strongest signal
  if (event.event_type === "share" || event.event_type === "share_clicked") {
    state.feedbackWeights[topic] = Math.min(2.0,
      state.feedbackWeights[topic] * 1.15
    );
  }
}

// Daily weight decay (call from a scheduled job or on session start)
function decayFeedbackWeights(state) {
  for (const topic in state.feedbackWeights) {
    // 5% decay toward 1.0 (neutral)
    const current = state.feedbackWeights[topic];
    state.feedbackWeights[topic] = current + (1.0 - current) * 0.05;
  }
}

// ─────────────────────────────────────────────
// K21: RETURN ENGINE — Check & trigger
// ─────────────────────────────────────────────

function checkReturnTriggers(userId) {
  const state = getUserState(userId);
  if (!state || !state.lastActive) return [];

  const triggers = [];
  const hoursAway = (Date.now() - state.lastActive) / (1000 * 60 * 60);

  if (hoursAway > 24) {
    triggers.push({
      type: "push_notification",
      template: "your_post_trending",
      message: "🔥 Your post is trending",
    });
  }

  if (hoursAway > 12 && state.engagementScore > 10) {
    triggers.push({
      type: "push_notification",
      template: "new_answers_waiting",
      message: "👀 New answers waiting for you",
    });
  }

  if (hoursAway > 48 && state.totalSessions > 3) {
    triggers.push({
      type: "push_notification",
      template: "miss_you",
      message: "😳 Someone answered your question",
    });
  }

  return triggers;
}

// ─────────────────────────────────────────────
// READ LAYER — Feed reads pre-computed state
// ─────────────────────────────────────────────

function getFeedContext(userId) {
  const state = getUserState(userId);

  return {
    // Session behavior (for adaptive ranking)
    scrollSpeed: state.scrollSpeed,
    skipRate: state.skipRate,
    dwellTime: state.dwellTime,
    sessionSwipes: state.sessionSwipes,

    // User scores (for personalization)
    engagementScore: state.engagementScore,
    growthScore: state.growthScore,
    retentionScore: state.retentionScore,
    isReturningUser: state.isReturningUser,

    // Topic preferences (raw affinity)
    topicAffinity: state.topicAffinity,

    // 🔥 Level 4: Auto-learned weights (this IS the learning loop output)
    feedbackWeights: state.feedbackWeights,

    // 24h counters
    views24h: state.views24h,
    completes24h: state.completes24h,
    skips24h: state.skips24h,

    // Event sequence (for ordering verification)
    eventSequence: state.eventSequence,
  };
}

// ─────────────────────────────────────────────
// DB PERSISTENCE (cold layer, async)
// ─────────────────────────────────────────────

async function persistState(db, userId) {
  if (!userId || !db) return;

  const state = getUserState(userId);
  if (!state) return;

  try {
    const existing = await db("user_behavior_state").where("user_id", userId).first();

    const data = {
      user_id: userId,
      engagement_score: state.engagementScore,
      growth_score: state.growthScore,
      retention_score: state.retentionScore,
      scroll_speed: state.scrollSpeed,
      skip_rate: Math.round(state.skipRate * 1000) / 1000,
      dwell_time: Math.round(state.dwellTime * 100) / 100,
      topic_affinity: JSON.stringify(state.topicAffinity),
      total_sessions: state.totalSessions,
      last_active: new Date(state.lastActive).toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await db("user_behavior_state").where("user_id", userId).update(data);
    } else {
      await db("user_behavior_state").insert(data);
    }
  } catch (_) {
    // Non-critical — state is in memory
  }
}

async function loadState(db, userId) {
  if (!userId || !db) return null;

  try {
    const row = await db("user_behavior_state").where("user_id", userId).first();
    if (!row) return null;

    const state = createDefaultState();
    state.engagementScore = row.engagement_score || 0;
    state.growthScore = row.growth_score || 0;
    state.retentionScore = row.retention_score || 0;
    state.scrollSpeed = row.scroll_speed || 0;
    state.skipRate = row.skip_rate || 0;
    state.dwellTime = row.dwell_time || 0;
    state.totalSessions = row.total_sessions || 0;
    state.lastActive = new Date(row.last_active).getTime();

    try {
      state.topicAffinity = JSON.parse(row.topic_affinity || "{}");
    } catch (_) {
      state.topicAffinity = {};
    }

    stateCache.set(userId, state);
    return state;
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  // Core
  processEventBatch,
  getUserState,
  getFeedContext,

  // Persistence
  persistState,
  loadState,

  // Return engine
  checkReturnTriggers,

  // Level 4: Learning loop
  applyLearningFeedback,
  decayFeedbackWeights,

  // Internals (for testing)
  normalizeEvent,
  createDefaultState,
  EVENT_TAXONOMY,

  // Cache stats
  getCacheStats: () => ({
    activeUsers: stateCache.size,
    users: [...stateCache.keys()],
  }),
};
