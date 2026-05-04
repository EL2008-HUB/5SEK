const { scoreForFeed, scoreForExploration } = require("./questionQuality");
const { applyRemixBoost } = require("./remixService");
const { applyDropBoost, isActiveDrop } = require("./dropService");
const { computeFeedStrategy, applyFeedStrategy } = require("./sessionAdaptiveFeedService");

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getHoursAgo(dateString) {
  const timestamp = new Date(dateString).getTime();
  if (!Number.isFinite(timestamp)) return 999;
  return Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60));
}

function classifyAnswerBucket(category, responseTime) {
  const normalizedCategory = String(category || "").toLowerCase();
  const time = responseTime == null ? null : safeNumber(responseTime, null);

  if (time !== null && time <= 2.2) return "fast";
  if (normalizedCategory === "funny") return "funny";
  if (normalizedCategory === "personal") return "awkward";
  if (["opinion", "imagination"].includes(normalizedCategory)) return "provocative";
  return "funny";
}

function buildAnswerSocialProof({
  todayAnswers = 0,
  recentAnswers = 0,
  hourlyAnswers = 0,
  responseTime = null,
  completionCount = 0,
  completionRate = 0,
  replayCount = 0,
  replayRate = 0,
}) {
  let badge = "live";
  let label = "Be the first to react";

  if (replayCount >= 3 && replayRate >= 0.25) {
    badge = "replayed";
    label = `${replayCount} replay sessions`;
  } else if (completionCount >= 8 && completionRate >= 0.72) {
    badge = "replayed";
    label = `${completionCount} watched to the end`;
  } else if (hourlyAnswers >= 8) {
    badge = "trending";
    label = `${hourlyAnswers} answered this hour`;
  } else if (recentAnswers >= 3) {
    badge = "moving_fast";
    label = `${recentAnswers} answered in 10 min`;
  } else if (todayAnswers >= 20) {
    badge = "popular";
    label = `${todayAnswers} answered today`;
  } else if (todayAnswers > 0) {
    badge = "warm";
    label = `${todayAnswers} answered`;
  }

  if (responseTime !== null && responseTime <= 2.2) {
    badge = "fast_answer";
  }

  return {
    badge,
    label,
    today_answers: todayAnswers,
    recent_answers: recentAnswers,
    hourly_answers: hourlyAnswers,
    replay_count: replayCount,
    replay_rate: Number(replayRate.toFixed(4)),
  };
}

function calculateAnswerFeedScore(row, counters = {}) {
  const likes = safeNumber(row.likes);
  const views = safeNumber(row.views);
  const shares = safeNumber(row.shares);
  const watchTimeTotal = safeNumber(row.watch_time_total);
  const completionCount = safeNumber(row.completion_count);
  const skipCount = safeNumber(row.skip_count);
  const replayCount = safeNumber(row.replay_count);
  const abuseScore = safeNumber(row.abuse_score);
  const reportCount = safeNumber(row.report_count);
  const trustScore = safeNumber(row.trust_score, 100);
  const questionAnswers = safeNumber(counters.todayAnswers, safeNumber(row.question_answers_count));
  const hourlyAnswers = safeNumber(counters.hourlyAnswers);
  const recentAnswers = safeNumber(counters.recentAnswers);
  const questionScore = safeNumber(
    row.country_score,
    safeNumber(row.global_score, safeNumber(row.performance_score))
  );
  const responseTime = row.response_time == null ? null : safeNumber(row.response_time, null);
  const hoursAgo = getHoursAgo(row.created_at);
  const engagementCount = completionCount + skipCount;
  const completionRate = engagementCount > 0 ? completionCount / engagementCount : 0;
  const avgWatchTime = engagementCount > 0 ? watchTimeTotal / engagementCount : watchTimeTotal;
  const replayRate = views > 0 ? replayCount / views : 0;

  // 🔥 Question Quality Integration: scoreForFeed returns 0–1
  const questionText = row.question_text || "";
  const qualityScore = questionText ? scoreForFeed(questionText) : 0;

  const base =
    views * 1 +
    likes * 2 +
    questionAnswers * 3 +
    hourlyAnswers * 2 +
    shares * 3 +
    questionScore * 0.4 +
    watchTimeTotal * 1.2 +
    completionCount * 5 -
    skipCount * 2.5 +
    replayCount * 7;

  // 🔥 Question quality boost: finalScore += questionScore * 2
  const questionQualityBoost = qualityScore * 2;

  const freshnessBoost = Math.max(0, 18 - hoursAgo) * 1.4;
  const hookBoost =
    responseTime === null ? 0 : responseTime <= 2.2 ? 14 : responseTime <= 3.2 ? 7 : 2;
  const recencyBoost = recentAnswers >= 3 ? 8 : recentAnswers > 0 ? 4 : 0;
  const retentionBoost = completionRate * 18 + Math.min(avgWatchTime, 5) * 2 + replayRate * 24;
  const trendingMultiplier = hourlyAnswers >= 8 ? 1.35 : hourlyAnswers >= 3 ? 1.15 : 1;
  const trustBoost = trustScore * 0.1;
  const moderationPenalty =
    abuseScore * 0.6 +
    reportCount * 20 +
    (String(row.moderation_status || "") === "flagged" ? 50 : 0) +
    (row.requires_human_review ? 20 : 0);

  // 🔥 Exploration boost: high-quality questions get ×2 in exploration
  const explorationMultiplier = (row.is_exploration && questionText)
    ? scoreForExploration(questionText)
    : 1;

  // 🔥 K22 rankFeed boost: engagementAffinity[topic] * 3 + retentionScore * 2 + viralScore
  // These come from the behavior profile attached to the row (if available).
  const behaviorProfile = row._behaviorProfile || null;
  const topic = String(row.category || "").toLowerCase();
  const engagementAffinity = (behaviorProfile && behaviorProfile.topic_affinity)
    ? (typeof behaviorProfile.topic_affinity === "string"
        ? JSON.parse(behaviorProfile.topic_affinity)
        : behaviorProfile.topic_affinity)[topic] || 0
    : 0;
  const retentionScore = behaviorProfile ? (Number(behaviorProfile.retention_score) || 0) : 0;
  const viralScoreBoost = safeNumber(row.viral_score);

  const rankFeedBoost = engagementAffinity * 3 + retentionScore * 2 + viralScoreBoost;

  return (
    Math.round(
      (base + freshnessBoost + hookBoost + recencyBoost + retentionBoost + trustBoost + questionQualityBoost - moderationPenalty + rankFeedBoost) *
        trendingMultiplier *
        explorationMultiplier *
        10
    ) / 10
  );
}

function reorderAnswerFeed(rows = []) {
  if (rows.length <= 2) return rows;

  const grouped = new Map();
  rows.forEach((row) => {
    const bucket = row.feed_bucket || "funny";
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket).push(row);
  });

  for (const bucketRows of grouped.values()) {
    bucketRows.sort((a, b) => safeNumber(b.feed_score) - safeNumber(a.feed_score));
  }

  const preferredStartOrder = ["funny", "fast", "awkward", "provocative"];
  const result = [];
  let previousBucket = null;

  while (result.length < rows.length) {
    const availableBuckets = [...grouped.entries()]
      .filter(([, bucketRows]) => bucketRows.length > 0)
      .map(([bucket]) => bucket);

    if (availableBuckets.length === 0) break;

    const rankedBuckets = [...availableBuckets].sort((bucketA, bucketB) => {
      const firstA = grouped.get(bucketA)?.[0];
      const firstB = grouped.get(bucketB)?.[0];
      const scoreDelta = safeNumber(firstB?.feed_score) - safeNumber(firstA?.feed_score);
      if (scoreDelta !== 0) return scoreDelta;
      return preferredStartOrder.indexOf(bucketA) - preferredStartOrder.indexOf(bucketB);
    });

    const nextBucket =
      result.length === 0
        ? preferredStartOrder.find((bucket) => availableBuckets.includes(bucket)) || rankedBuckets[0]
        : rankedBuckets.find((bucket) => bucket !== previousBucket) || rankedBuckets[0];

    const nextRow = grouped.get(nextBucket).shift();
    result.push(nextRow);
    previousBucket = nextBucket;
  }

  return result;
}

/**
 * Rank and compose the answer feed.
 *
 * @param {Array}       rows            - Raw answer rows from DB
 * @param {Object}      counters        - { todayCounts, recentCounts, hourlyCounts }
 * @param {Object|null} behaviorProfile - Optional user behavior profile (from user_behavior_state).
 *                                        When provided, a session-adaptive strategy is applied
 *                                        after the base ranking.
 * @returns {Array} Ranked and strategy-adjusted answer list
 */
function rankAnswerFeed(rows = [], counters = {}, behaviorProfile = null) {
  const todayCounts = counters.todayCounts || {};
  const recentCounts = counters.recentCounts || {};
  const hourlyCounts = counters.hourlyCounts || {};

  // ── Base ranking ──────────────────────────────────────────────────────────
  const baseRanked = reorderAnswerFeed(
    rows
      .map((answer) => {
        const answerCounters = {
          todayAnswers: todayCounts[answer.question_id] || 0,
          recentAnswers: recentCounts[answer.question_id] || 0,
          hourlyAnswers: hourlyCounts[answer.question_id] || 0,
        };
        const completionCount = safeNumber(answer.completion_count);
        const skipCount = safeNumber(answer.skip_count);
        const replayCount = safeNumber(answer.replay_count);
        const completionRate =
          completionCount + skipCount > 0 ? completionCount / (completionCount + skipCount) : 0;
        const replayRate = safeNumber(answer.views) > 0 ? replayCount / safeNumber(answer.views) : 0;
        const feed_bucket = classifyAnswerBucket(answer.category, answer.response_time);
        const social_proof = buildAnswerSocialProof({
          ...answerCounters,
          responseTime: answer.response_time,
          completionCount,
          completionRate,
          replayCount,
          replayRate,
        });
        const feed_score = calculateAnswerFeedScore(answer, answerCounters);

        // 🔥 Remix boost: answers in active chains get priority
        const remixBoostedScore = applyRemixBoost(feed_score, answer.chain_depth || 0, answer.is_remix || false);

        // 🔥 Drop boost: answers from active drops get 1.5x
        const fromDrop = answer.from_drop || isActiveDrop(answer.question_id);
        const finalScore = applyDropBoost(remixBoostedScore, fromDrop);

        return {
          ...answer,
          feed_bucket,
          feed_score: finalScore,
          social_proof,
          hook_label: social_proof.badge,
          social_label: social_proof.label,
          is_trending: answerCounters.hourlyAnswers >= 8 || answerCounters.recentAnswers >= 3,
          is_remix: answer.is_remix || false,
          chain_depth: answer.chain_depth || 0,
          parent_answer_id: answer.parent_answer_id || null,
        };
      })
      .sort((a, b) => {
        if (b.feed_score !== a.feed_score) return b.feed_score - a.feed_score;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })
  );

  // ── Session-adaptive strategy (K20) ──────────────────────────────────────
  // Compute strategy from behavior profile (falls back to 'default' when null)
  const strategyObj = computeFeedStrategy(behaviorProfile, []);
  return applyFeedStrategy(baseRanked, strategyObj, behaviorProfile);
}

function calculateDuelFeedScore(duel) {
  const totalVotes = safeNumber(duel.total_votes, safeNumber(duel.votes_a) + safeNumber(duel.votes_b));
  const totalViews = safeNumber(
    duel.total_views,
    safeNumber(duel.answer_a_views) + safeNumber(duel.answer_b_views)
  );
  const hoursAgo = getHoursAgo(duel.created_at);
  const recencyBoost = Math.max(0, 24 - hoursAgo) * 1.6;
  const activeBoost = duel.status === "active" ? 10 : 0;
  const tensionBoost =
    duel.status === "active" && totalVotes > 0 && Math.abs(safeNumber(duel.pct_a, 50) - 50) <= 10
      ? 8
      : 0;

  return Math.round((totalVotes * 2 + totalViews + recencyBoost + activeBoost + tensionBoost) * 10) / 10;
}/**
 * Apply Fusion Loop feed adaptation.
 *
 * Boosts content types based on what the user is missing in their loop:
 * - Missing remix → boost remix content (+15)
 * - Missing comment → boost controversial content (+10)
 * - Missing answer → boost easy questions (+8)
 *
 * @param {Array} feed - Ranked feed items
 * @param {number|null} userId - User ID (null = no adaptation)
 * @returns {Array} Adapted feed
 */
function applyFusionAdaptation(feed, userId) {
  if (!userId || !feed.length) return feed;

  let adaptation;
  try {
    const { getFeedAdaptation } = require('./fusionLoopService');
    adaptation = getFeedAdaptation(userId);
  } catch (_) {
    return feed;
  }

  if (!adaptation) return feed;

  const { BASE_LOOP_SCORE } = require('./fusionLoopService');
  if (adaptation.loopScore >= (BASE_LOOP_SCORE || 4.5)) return feed;

  // FIX 4: Quality gate threshold
  const qualityGate = adaptation.qualityGate || 0.3;

  return feed.map((item) => {
    let boost = 0;

    // FIX 4: Only boost if item has decent quality
    const itemQuality = item._qualityScore || item.feed_score || 0;
    const normalizedQuality = item._qualityScore != null
      ? item._qualityScore
      : Math.min(itemQuality / 100, 1); // normalize feed_score to 0-1
    if (normalizedQuality < qualityGate) return item; // ❌ Skip low quality

    // Boost remix content if user hasn't remixed today
    if (adaptation.injectHighRemixContent && item.is_remix) {
      boost += 15;
    }

    // Boost controversial if user hasn't commented
    if (adaptation.injectControversialContent) {
      const cat = String(item.category || '').toLowerCase();
      if (['opinion', 'personal', 'imagination'].includes(cat)) {
        boost += 10;
      }
    }

    // Boost easy questions if user hasn't answered
    if (adaptation.injectEasyQuestions) {
      const cat = String(item.category || '').toLowerCase();
      if (['funny', 'general'].includes(cat)) {
        boost += 8;
      }
    }

    // UPGRADE 2: Chain reaction — boost next 3 videos extra
    if (adaptation.chainReactionActive && boost > 0) {
      boost *= 1.5; // 50% extra during chain reaction
    }

    if (boost === 0) return item;
    return {
      ...item,
      feed_score: (item.feed_score || 0) + boost,
      _fusion_boosted: true,
    };
  }).sort((a, b) => (b.feed_score || 0) - (a.feed_score || 0));
}

module.exports = {
  buildAnswerSocialProof,
  calculateAnswerFeedScore,
  calculateDuelFeedScore,
  classifyAnswerBucket,
  rankAnswerFeed,
  reorderAnswerFeed,
  applyFusionAdaptation,
};
