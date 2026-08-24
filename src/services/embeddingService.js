/**
 * Embedding Service — TikTok-Level Personalization
 *
 * Implements:
 * 1. User interest vectors (pseudo-ML embeddings)
 * 2. Question/answer category vectors
 * 3. Cosine similarity ranking
 * 4. Real-time feedback loop (view/skip/like/share → vector updates)
 * 5. Session-based adaptation (exploration → personalization)
 * 6. Exploration rate decay
 *
 * This is the "For You Page" secret sauce — without a real ML model,
 * we use lightweight vectors updated in real-time from user behavior.
 */

// ─────────────────────────────────────────────
// 1. VECTOR OPERATIONS
// ─────────────────────────────────────────────

/**
 * Compute cosine similarity between two sparse vectors (objects).
 * @param {object} vecA - e.g. {funny: 0.8, personal: 0.3}
 * @param {object} vecB
 * @returns {number} similarity (-1 to 1)
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) return 0;

  const keysA = Object.keys(vecA);
  const keysB = Object.keys(vecB);
  if (keysA.length === 0 || keysB.length === 0) return 0;

  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  const allKeys = new Set([...keysA, ...keysB]);

  for (const key of allKeys) {
    const a = vecA[key] || 0;
    const b = vecB[key] || 0;
    dotProduct += a * b;
    magA += a * a;
    magB += b * b;
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Normalize a vector so its magnitude is 1.
 * @param {object} vec
 * @returns {object}
 */
function normalizeVector(vec) {
  if (!vec) return {};
  const values = Object.values(vec);
  if (values.length === 0) return {};

  const mag = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  if (mag === 0) return { ...vec };

  const result = {};
  for (const [key, val] of Object.entries(vec)) {
    result[key] = Math.round((val / mag) * 1000) / 1000;
  }
  return result;
}

/**
 * Prune a vector to keep only top N dimensions by absolute value.
 * Prevents unbounded growth.
 * @param {object} vec
 * @param {number} maxDims
 * @returns {object}
 */
function pruneVector(vec, maxDims = 20) {
  if (!vec || Object.keys(vec).length <= maxDims) return vec;

  const sorted = Object.entries(vec)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, maxDims);

  return Object.fromEntries(sorted);
}

// ─────────────────────────────────────────────
// 2. BUILD CONTENT VECTOR FROM ANSWER/QUESTION
// ─────────────────────────────────────────────

/**
 * Build a vector representation for a feed item.
 * Uses category, tags, answer type, and country as dimensions.
 *
 * @param {object} item - feed item with category, interest_tags, answer_type, question_country
 * @returns {object} sparse vector
 */
function buildContentVector(item) {
  const vec = {};

  // Category is the primary dimension
  const category = (item.category || "general").toLowerCase();
  vec[`cat:${category}`] = 1.0;

  // Tags add secondary dimensions
  const tags = parseJsonField(item.interest_tags, []);
  for (const tag of tags.slice(0, 5)) {
    vec[`tag:${String(tag).toLowerCase()}`] = 0.7;
  }

  // Answer type
  if (item.answer_type) {
    vec[`type:${item.answer_type}`] = 0.4;
  }

  // Country context
  const country = item.question_country || item.country || "GLOBAL";
  if (country !== "GLOBAL") {
    vec[`country:${country}`] = 0.3;
  }

  return vec;
}

// ─────────────────────────────────────────────
// 3. USER EMBEDDING — GET OR INIT
// ─────────────────────────────────────────────

/**
 * Get or create user embedding.
 * @param {import('knex').Knex} db
 * @param {number} userId
 * @returns {Promise<{interest_vector: object, negative_vector: object, total_interactions: number, exploration_rate: number}>}
 */
async function getOrCreateEmbedding(db, userId) {
  if (!userId) return null;

  let row = await db("user_embeddings").where({ user_id: userId }).first();

  if (!row) {
    try {
      await db("user_embeddings").insert({
        user_id: userId,
        interest_vector: JSON.stringify({}),
        negative_vector: JSON.stringify({}),
        total_interactions: 0,
        exploration_rate: 0.3,
      });
      row = await db("user_embeddings").where({ user_id: userId }).first();
    } catch (err) {
      // Race condition
      row = await db("user_embeddings").where({ user_id: userId }).first();
    }
  }

  return {
    interest_vector: parseJsonField(row.interest_vector, {}),
    negative_vector: parseJsonField(row.negative_vector, {}),
    total_interactions: row.total_interactions || 0,
    exploration_rate: row.exploration_rate || 0.3,
  };
}

// ─────────────────────────────────────────────
// 4. REAL-TIME FEEDBACK LOOP
// ─────────────────────────────────────────────

// Signal weights for vector updates
const SIGNAL_WEIGHTS = {
  view: 0.05,       // slight interest
  completed: 0.15,  // watched fully → real interest
  like: 0.25,       // explicit positive signal
  share: 0.40,      // strongest positive signal
  skip: -0.10,      // negative signal
  replayed: 0.30,   // very strong interest
};

/**
 * Update user embedding in real-time based on a feed interaction.
 *
 * This is the core learning loop:
 * - Positive signals (like, share, complete, replay) → move interest vector toward content
 * - Negative signals (skip) → move negative vector toward content
 * - Exploration rate decays with more interactions
 *
 * @param {import('knex').Knex} db
 * @param {number} userId
 * @param {object} contentItem - the feed item interacted with
 * @param {string} signalType - 'view' | 'completed' | 'like' | 'share' | 'skip' | 'replayed'
 */
async function updateEmbedding(db, userId, contentItem, signalType) {
  if (!userId || !contentItem) return;

  const weight = SIGNAL_WEIGHTS[signalType];
  if (weight === undefined) return;

  const embedding = await getOrCreateEmbedding(db, userId);
  if (!embedding) return;

  const contentVec = buildContentVector(contentItem);
  const isNegative = weight < 0;

  // Update the appropriate vector
  const targetVector = isNegative ? { ...embedding.negative_vector } : { ...embedding.interest_vector };

  for (const [dim, value] of Object.entries(contentVec)) {
    const currentVal = targetVector[dim] || 0;
    // Exponential moving average: gradually shift toward new signal
    targetVector[dim] = Math.round((currentVal + Math.abs(weight) * value) * 1000) / 1000;
  }

  // Decay old dimensions slightly (prevents stale interests from dominating)
  const DECAY = 0.995;
  for (const dim of Object.keys(targetVector)) {
    if (!contentVec[dim]) {
      targetVector[dim] = Math.round(targetVector[dim] * DECAY * 1000) / 1000;
      if (Math.abs(targetVector[dim]) < 0.01) delete targetVector[dim];
    }
  }

  const prunedVector = pruneVector(targetVector, 25);
  const newInteractions = embedding.total_interactions + 1;

  // Exploration rate decays: starts at 0.3, decays toward 0.05
  // After ~100 interactions, exploration is minimal
  const newExplorationRate = Math.max(0.05, 0.3 * Math.exp(-newInteractions / 80));

  const updates = {
    total_interactions: newInteractions,
    exploration_rate: Math.round(newExplorationRate * 1000) / 1000,
    updated_at: db.fn.now(),
  };

  if (isNegative) {
    updates.negative_vector = JSON.stringify(prunedVector);
  } else {
    updates.interest_vector = JSON.stringify(prunedVector);
  }

  await db("user_embeddings")
    .where({ user_id: userId })
    .update(updates);
}

// ─────────────────────────────────────────────
// 5. EMBEDDING-BASED RANKING
// ─────────────────────────────────────────────

/**
 * Compute embedding-based score for a feed item.
 *
 * @param {object} item - feed item
 * @param {object} embedding - user embedding
 * @returns {{similarityScore: number, explorationBonus: number, penaltyScore: number, embeddingScore: number}}
 */
function computeEmbeddingScore(item, embedding) {
  if (!embedding || embedding.total_interactions < 3) {
    // Not enough data → pure exploration
    return {
      similarityScore: 0,
      explorationBonus: 0.3,
      penaltyScore: 0,
      embeddingScore: 0.3,
    };
  }

  const contentVec = buildContentVector(item);
  const interestVec = normalizeVector(embedding.interest_vector);
  const negativeVec = normalizeVector(embedding.negative_vector);

  // Cosine similarity with interest vector (0 to 1)
  const similarityScore = Math.max(0, cosineSimilarity(contentVec, interestVec));

  // Penalty from negative vector (things they skip)
  const penaltyScore = Math.max(0, cosineSimilarity(contentVec, negativeVec)) * 0.5;

  // Exploration bonus (random chance to show diverse content)
  const explorationBonus = Math.random() < embedding.exploration_rate ? 0.2 : 0;

  const embeddingScore = Math.round(
    Math.max(0, similarityScore - penaltyScore + explorationBonus) * 1000
  ) / 1000;

  return {
    similarityScore: Math.round(similarityScore * 1000) / 1000,
    explorationBonus,
    penaltyScore: Math.round(penaltyScore * 1000) / 1000,
    embeddingScore,
  };
}

/**
 * Apply embedding-based re-ranking to a scored feed.
 * Combines quality score with embedding similarity.
 *
 * Final score = qualityScore × (0.6) + embeddingScore × qualityScale × (0.4)
 *
 * This gives 60% weight to quality, 40% to personalization.
 *
 * @param {Array} feed - items with feed_score
 * @param {object} embedding - user embedding
 * @param {object} opts
 * @returns {Array} re-ranked feed
 */
function applyEmbeddingRanking(feed, embedding, opts = {}) {
  if (!feed || feed.length === 0) return feed;
  if (!embedding || embedding.total_interactions < 3) return feed;

  const sessionDepth = opts.sessionDepth || 0;

  // Session-based adaptation: more personalization as user scrolls deeper
  // Early in session: 70% quality, 30% embedding
  // Deep in session:  50% quality, 50% embedding
  const qualityWeight = Math.max(0.50, 0.70 - sessionDepth * 0.005);
  const embeddingWeight = 1 - qualityWeight;

  // Find max quality score for normalization
  const maxQuality = Math.max(1, ...feed.map((item) => Math.abs(item.feed_score || 0)));

  return feed
    .map((item) => {
      const embResult = computeEmbeddingScore(item, embedding);
      const normalizedQuality = (item.feed_score || 0) / maxQuality;

      const combinedScore = Math.round(
        (normalizedQuality * qualityWeight + embResult.embeddingScore * embeddingWeight) * maxQuality * 10
      ) / 10;

      return {
        ...item,
        feed_score_quality: item.feed_score,
        feed_score: combinedScore,
        embedding: {
          similarity: embResult.similarityScore,
          penalty: embResult.penaltyScore,
          exploration: embResult.explorationBonus > 0,
          quality_weight: qualityWeight,
          embedding_weight: embeddingWeight,
        },
      };
    })
    .sort((a, b) => {
      if (a.is_boosted && !b.is_boosted) return -1;
      if (!a.is_boosted && b.is_boosted) return 1;
      return b.feed_score - a.feed_score;
    });
}

// ─────────────────────────────────────────────
// 6. SESSION MANAGEMENT
// ─────────────────────────────────────────────

/**
 * Get or create a feed session. Sessions expire after 30 min of inactivity.
 * @param {import('knex').Knex} db
 * @param {number} userId
 * @param {string} sessionId
 * @returns {Promise<object>}
 */
async function getOrCreateSession(db, userId, sessionId) {
  if (!userId || !sessionId) return { items_seen: 0, session_exploration_rate: 0.3 };

  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  // Try to find active session
  let session = await db("feed_sessions")
    .where({ user_id: userId, session_id: sessionId })
    .where("last_activity_at", ">=", thirtyMinAgo)
    .first();

  if (session) {
    // Update activity timestamp
    await db("feed_sessions")
      .where({ id: session.id })
      .update({ last_activity_at: db.fn.now() });
    return session;
  }

  // Create new session
  try {
    const [newSession] = await db("feed_sessions")
      .insert({
        user_id: userId,
        session_id: sessionId,
        items_seen: 0,
        session_exploration_rate: 0.3,
      })
      .returning("*");
    return newSession;
  } catch (_) {
    return { items_seen: 0, session_exploration_rate: 0.3 };
  }
}

/**
 * Record items seen in this session (for session-based adaptation).
 * @param {import('knex').Knex} db
 * @param {number} userId
 * @param {string} sessionId
 * @param {number} newItemsSeen
 */
async function recordSessionProgress(db, userId, sessionId, newItemsSeen) {
  if (!userId || !sessionId) return;

  try {
    await db("feed_sessions")
      .where({ user_id: userId, session_id: sessionId })
      .increment("items_seen", newItemsSeen)
      .update({ last_activity_at: db.fn.now() });
  } catch (_) {}
}

/**
 * Record a skip event in the current session.
 * Increments both recent_skips and consecutive_skips.
 * Used by the feed engine to detect "skip loops" and inject diverse content.
 *
 * @param {import('knex').Knex} db
 * @param {number} userId
 * @param {string} sessionId
 */
async function recordSessionSkip(db, userId, sessionId) {
  if (!userId || !sessionId) return;

  try {
    await db("feed_sessions")
      .where({ user_id: userId, session_id: sessionId })
      .increment({ recent_skips: 1, consecutive_skips: 1 })
      .update({ last_activity_at: db.fn.now() });
  } catch (_) {}
}

/**
 * Reset consecutive skip counter (called on completion/like/replay).
 * This signals that the user found something engaging.
 *
 * @param {import('knex').Knex} db
 * @param {number} userId
 * @param {string} sessionId
 */
async function resetSessionSkips(db, userId, sessionId) {
  if (!userId || !sessionId) return;

  try {
    await db("feed_sessions")
      .where({ user_id: userId, session_id: sessionId })
      .update({ consecutive_skips: 0, last_activity_at: db.fn.now() });
  } catch (_) {}
}

// ─────────────────────────────────────────────
// 7. SERVER-SIDE SEEN STATE
// ─────────────────────────────────────────────

/**
 * Mark answers as seen by a user (server-side, replaces cursor seenIds).
 * @param {import('knex').Knex} db
 * @param {number} userId
 * @param {number[]} answerIds
 */
async function markAsSeen(db, userId, answerIds) {
  if (!userId || !answerIds || answerIds.length === 0) return;

  const rows = answerIds.map((answerId) => ({
    user_id: userId,
    answer_id: answerId,
  }));

  try {
    await db("feed_seen_state")
      .insert(rows)
      .onConflict(["user_id", "answer_id"])
      .ignore();
  } catch (_) {
    // Some DBs don't support onConflict — fall back to individual inserts
    for (const row of rows) {
      try {
        await db("feed_seen_state").insert(row);
      } catch (__) {}
    }
  }
}

/**
 * Get set of answer IDs the user has already seen (last 24h to limit scope).
 * @param {import('knex').Knex} db
 * @param {number} userId
 * @returns {Promise<Set<number>>}
 */
async function getSeenIds(db, userId) {
  if (!userId) return new Set();

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const rows = await db("feed_seen_state")
    .where({ user_id: userId })
    .where("seen_at", ">=", oneDayAgo)
    .select("answer_id");

  return new Set(rows.map((r) => r.answer_id));
}

/**
 * Clean up old seen state (run periodically).
 * @param {import('knex').Knex} db
 */
async function cleanupSeenState(db) {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const deleted = await db("feed_seen_state")
    .where("seen_at", "<", threeDaysAgo)
    .del();
  if (deleted > 0) {
    console.log(`🧹 Cleaned ${deleted} old feed_seen_state rows`);
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function parseJsonField(value, fallback) {
  if (typeof value === "object" && value !== null) return value;
  if (!value || typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

module.exports = {
  // Vector ops
  cosineSimilarity,
  normalizeVector,
  buildContentVector,

  // Embeddings
  getOrCreateEmbedding,
  updateEmbedding,
  computeEmbeddingScore,
  applyEmbeddingRanking,

  // Sessions
  getOrCreateSession,
  recordSessionProgress,
  recordSessionSkip,
  resetSessionSkips,

  // Seen state
  markAsSeen,
  getSeenIds,
  cleanupSeenState,

  // Constants
  SIGNAL_WEIGHTS,
};
