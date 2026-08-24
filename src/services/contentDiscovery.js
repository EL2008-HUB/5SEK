/**
 * Content Discovery Layer — The Missing 3 Systems + 4 Fail-Safes
 *
 * SYSTEMS:
 *   1. EXPLORATION POOL (gated: qualityScore > 0.3 required)
 *   2. CONTENT QUALITY SCORE (stops clickbait)
 *   3. CREATOR LEVEL BOOST (saturation-capped)
 *
 * FAIL-SAFES:
 *   ⚠️ FIX 1: Controlled randomness (10% chaos injection)
 *   ⚠️ FIX 2: Creator saturation cap (max 0.8, reduce if >5 posts/24h)
 *   ⚠️ FIX 3: Gated exploration (qualityScore > 0.3 minimum)
 *   ⚠️ FIX 4: Score clamping (0 to 1000)
 */

// ─────────────────────────────────────────────
// 1. EXPLORATION POOL
// ─────────────────────────────────────────────

/**
 * Build an exploration pool from the feed candidates.
 * Prioritizes: new content, low-exposure, diverse creators.
 *
 * @param {Array} allItems - full candidate pool
 * @param {number} limit - max items to return
 * @returns {Array} exploration candidates with boost applied
 */
function buildExplorationPool(allItems, limit = 10) {
  if (!allItems || allItems.length === 0) return [];

  const now = Date.now();
  const candidates = [];

  for (const item of allItems) {
    const createdAt = new Date(item.created_at).getTime();
    const ageHours = (now - createdAt) / (1000 * 60 * 60);
    const views = item.views || 0;

    let explorationBoost = 0;
    let reason = null;

    // COLD START BOOST: age < 1h AND views < 20 → ×3
    if (ageHours < 1 && views < 20) {
      explorationBoost = 3;
      reason = "cold_start";
    }
    // LOW EXPOSURE: views < 50 → ×2
    else if (views < 50) {
      explorationBoost = 2;
      reason = "low_exposure";
    }
    // FRESH CONTENT: age < 6h → ×1.5
    else if (ageHours < 6) {
      explorationBoost = 1.5;
      reason = "fresh";
    }

    if (explorationBoost > 0) {
      // ⚠️ FIX 3: GATED EXPLORATION — only boost content with minimum quality
      const quality = computeQualityScore(item);
      if (quality < 0.3 && reason !== "cold_start") {
        continue; // skip low-quality items (cold start exempt — too new to judge)
      }

      candidates.push({
        ...item,
        exploration_boost: explorationBoost,
        exploration_reason: reason,
        exploration_quality: quality,
        exploration_score: (item.feed_score || 1) * explorationBoost,
      });
    }
  }

  // Sort by exploration score (cold start first, then low exposure)
  candidates.sort((a, b) => b.exploration_score - a.exploration_score);

  // Enforce creator diversity: max 2 items per creator
  const creatorCounts = new Map();
  const diverse = [];

  for (const item of candidates) {
    const creatorId = item.user_id || "unknown";
    const count = creatorCounts.get(creatorId) || 0;
    if (count < 2) {
      diverse.push(item);
      creatorCounts.set(creatorId, count + 1);
    }
    if (diverse.length >= limit) break;
  }

  return diverse;
}

/**
 * Inject exploration items into feed.
 * Uses probabilistic placement (not every Nth).
 *
 * @param {Array} feed - current feed
 * @param {Array} allCandidates - full candidate pool (for exploration)
 * @param {number} limit - max exploration items
 * @returns {Array} feed with exploration items injected
 */
function injectExploration(feed, allCandidates, limit = 3) {
  if (!feed || feed.length < 5) return feed;

  const explorationPool = buildExplorationPool(allCandidates, limit * 2);
  if (explorationPool.length === 0) return feed;

  const feedIds = new Set(feed.map(item => item.id));
  const newItems = explorationPool.filter(item => !feedIds.has(item.id));
  if (newItems.length === 0) return feed;

  const result = [...feed];
  let injected = 0;

  // Inject after position 4, ~15% chance per slot
  for (let i = 4; i < result.length && injected < limit; i++) {
    if (Math.random() < 0.18) {
      const item = newItems[injected];
      if (item) {
        item.is_exploration = true;
        result.splice(i, 0, item);
        injected++;
        i++; // skip inserted item
      }
    }
  }

  // If we didn't inject enough, append at position 6-8
  while (injected < Math.min(limit, newItems.length)) {
    const item = newItems[injected];
    if (item) {
      item.is_exploration = true;
      const insertAt = Math.min(6 + injected * 2, result.length);
      result.splice(insertAt, 0, item);
      injected++;
    }
  }

  return result;
}

// ─────────────────────────────────────────────
// 2. CONTENT QUALITY SCORE
// ─────────────────────────────────────────────

/**
 * Compute quality score for a piece of content.
 *
 * qualityScore =
 *   (avgWatchTime / videoLength) × 0.6 +
 *   (replays / views) × 0.4
 *
 * Stops clickbait (high views but low watch time).
 * Rewards content people actually watch and replay.
 *
 * @param {Object} item - answer/content item with metrics
 * @returns {number} quality score (0 to ~1.0)
 */
function computeQualityScore(item) {
  const videoLength = item.duration || item.video_length || 5; // default 5s
  const avgWatchTime = item.avg_watch_time || item.watch_time || 0;
  const replays = item.replays || 0;
  const views = Math.max(item.views || 1, 1);

  // Watch completion ratio (capped at 1.0)
  const completionRatio = Math.min(avgWatchTime / Math.max(videoLength, 1), 1.0);

  // Replay ratio (typically < 0.3 for good content)
  const replayRatio = Math.min(replays / views, 1.0);

  const qualityScore =
    completionRatio * 0.6 +
    replayRatio * 0.4;

  return Math.round(qualityScore * 1000) / 1000;
}

/**
 * Apply quality scoring to entire feed.
 * Adds quality_score field and adjusts feed_score.
 */
function applyQualityScoring(feed) {
  if (!feed || feed.length === 0) return feed;

  return feed.map(item => {
    const quality = computeQualityScore(item);
    return {
      ...item,
      quality_score: quality,
      feed_score: (item.feed_score || 0) + quality * 5,
    };
  });
}

// ─────────────────────────────────────────────
// 3. CREATOR LEVEL SYSTEM
// ─────────────────────────────────────────────

// In-memory creator stats cache
const creatorStats = new Map(); // userId → { posts: [{engRate}], avgScore, lastUpdated }

/**
 * Update creator stats when their content gets engagement.
 *
 * @param {number} creatorId - user ID of content creator
 * @param {Object} metrics - { views, likes, shares, completes }
 */
function updateCreatorStats(creatorId, metrics) {
  if (!creatorId) return;

  const views = Math.max(metrics.views || 1, 1);
  const engagementRate = ((metrics.likes || 0) + (metrics.shares || 0) * 2 + (metrics.completes || 0)) / views;

  let stats = creatorStats.get(creatorId);
  if (!stats) {
    stats = { posts: [], avgScore: 0, totalPosts: 0, lastUpdated: Date.now() };
    creatorStats.set(creatorId, stats);
  }

  // Keep last 10 posts' engagement rates
  stats.posts.push(engagementRate);
  if (stats.posts.length > 10) stats.posts.shift();
  stats.totalPosts++;
  stats.lastUpdated = Date.now();

  // Compute average engagement rate
  stats.avgScore = stats.posts.reduce((a, b) => a + b, 0) / stats.posts.length;
}

/**
 * Get creator boost for feed ranking.
 *
 * @param {number} creatorId
 * @returns {number} boost value (0 to ~2.0)
 */
function getCreatorBoost(creatorId) {
  if (!creatorId) return 0;
  const stats = creatorStats.get(creatorId);
  if (!stats || stats.posts.length < 3) return 0;

  // ⚠️ FIX 2: SATURATION CAP — prevent creator monopoly
  // Base boost: creatorScore × 2, hard cap at 0.8 (was 2.0)
  let boost = Math.min(0.8, stats.avgScore * 2);

  // If creator posted >5 times in 24h, reduce boost (anti-spam)
  if (stats.postsLast24h && stats.postsLast24h > 5) {
    boost *= 0.5; // halve the boost for spammy creators
  }

  return boost;
}

/**
 * Apply creator boost to entire feed.
 */
function applyCreatorBoost(feed) {
  if (!feed || feed.length === 0) return feed;

  return feed.map(item => {
    const boost = getCreatorBoost(item.user_id);
    if (boost === 0) return item;

    return {
      ...item,
      creator_boost: Math.round(boost * 1000) / 1000,
      feed_score: (item.feed_score || 0) + boost,
    };
  });
}

/**
 * Batch update creator stats from answer_metrics.
 * Call this from a periodic job or after metrics update.
 */
async function refreshCreatorStats(db) {
  if (!db) return;

  try {
    const rows = await db("answer_metrics")
      .join("answers", "answers.id", "answer_metrics.answer_id")
      .select(
        "answers.user_id",
        db.raw("AVG(answer_metrics.views) as avg_views"),
        db.raw("AVG(answer_metrics.likes) as avg_likes"),
        db.raw("AVG(answer_metrics.shares) as avg_shares"),
        db.raw("COUNT(*) as post_count")
      )
      .groupBy("answers.user_id")
      .having("post_count", ">=", 2)
      .orderBy("post_count", "desc")
      .limit(500);

    for (const row of rows) {
      const views = Math.max(row.avg_views || 1, 1);
      const engRate = ((row.avg_likes || 0) + (row.avg_shares || 0) * 2) / views;

      let stats = creatorStats.get(row.user_id);
      if (!stats) {
        stats = { posts: [], avgScore: 0, totalPosts: 0, lastUpdated: Date.now() };
        creatorStats.set(row.user_id, stats);
      }

      stats.avgScore = engRate;
      stats.totalPosts = row.post_count;
      stats.lastUpdated = Date.now();
      // Fill posts array so getCreatorBoost works (needs >= 3)
      if (stats.posts.length < 3) {
        while (stats.posts.length < Math.min(row.post_count, 10)) {
          stats.posts.push(engRate);
        }
      }
    }
  } catch (_) {
    // Non-critical
  }
}

// ─────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────

function getDiscoveryStats() {
  return {
    creatorsTracked: creatorStats.size,
    topCreators: [...creatorStats.entries()]
      .sort((a, b) => b[1].avgScore - a[1].avgScore)
      .slice(0, 5)
      .map(([id, stats]) => ({
        userId: id,
        avgEngagement: Math.round(stats.avgScore * 1000) / 1000,
        posts: stats.totalPosts,
      })),
  };
}

// ─────────────────────────────────────────────
// ⚠️ FIX 1: CONTROLLED RANDOMNESS (10% chaos)
// Prevents feed from becoming too predictable
// ─────────────────────────────────────────────

function injectControlledRandomness(feed) {
  if (!feed || feed.length < 10) return feed;

  const result = [...feed];

  // 10% chance: swap a random high-quality item into top 5
  if (Math.random() < 0.10) {
    // Find a good item from position 8-20
    const pool = result.slice(8, Math.min(20, result.length));
    const goodItem = pool.find(item => (item.quality_score || 0) > 0.4);

    if (goodItem) {
      const fromIdx = result.indexOf(goodItem);
      const toIdx = 3 + Math.floor(Math.random() * 3); // position 3-5
      if (fromIdx > toIdx) {
        const [item] = result.splice(fromIdx, 1);
        item.is_random_boost = true;
        result.splice(toIdx, 0, item);
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────
// ⚠️ FIX 4: SCORE CLAMPING (fail-safe)
// Prevents scores from going out of control
// ─────────────────────────────────────────────

function clampFeedScores(feed) {
  if (!feed || feed.length === 0) return feed;

  return feed.map(item => ({
    ...item,
    feed_score: Math.max(0, Math.min(item.feed_score || 0, 1000)),
  }));
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  // Exploration
  buildExplorationPool,
  injectExploration,

  // Quality
  computeQualityScore,
  applyQualityScoring,

  // Creator
  updateCreatorStats,
  getCreatorBoost,
  applyCreatorBoost,
  refreshCreatorStats,

  // Fail-safes
  injectControlledRandomness,
  clampFeedScores,

  // Stats
  getDiscoveryStats,
};
