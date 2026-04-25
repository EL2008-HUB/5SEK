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

  return (
    Math.round(
      (base + freshnessBoost + hookBoost + recencyBoost + retentionBoost + trustBoost - moderationPenalty) *
        trendingMultiplier *
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

function rankAnswerFeed(rows = [], counters = {}) {
  const todayCounts = counters.todayCounts || {};
  const recentCounts = counters.recentCounts || {};
  const hourlyCounts = counters.hourlyCounts || {};

  return reorderAnswerFeed(
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

        return {
          ...answer,
          feed_bucket,
          feed_score,
          social_proof,
          hook_label: social_proof.badge,
          social_label: social_proof.label,
          is_trending: answerCounters.hourlyAnswers >= 8 || answerCounters.recentAnswers >= 3,
        };
      })
      .sort((a, b) => {
        if (b.feed_score !== a.feed_score) return b.feed_score - a.feed_score;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })
  );
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
}

module.exports = {
  buildAnswerSocialProof,
  calculateAnswerFeedScore,
  calculateDuelFeedScore,
  classifyAnswerBucket,
  rankAnswerFeed,
  reorderAnswerFeed,
};
