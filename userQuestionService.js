/**
 * User Question Service — Production-Ready
 *
 * Handles:
 * - Question submission with daily limits
 * - Moderation (heuristic rules + AI via Groq)
 * - Viral scoring with time-decay
 * - Duplicate detection
 * - Feed ranking with boost priority
 * - Trending / viral pick
 */

const { moderatePublicContent } = require("./aiService");
const { scoreQuestionQuality, getQuestionQualityPrior } = require("./questionQuality");

// ─────────────────────────────────────────────
// Banned word lists (shared with moderationService)
// ─────────────────────────────────────────────
const BLOCKED_TERMS = [
  "kill yourself",
  "self harm",
  "nazi",
  "rape",
  "terrorist",
  "faggot",
  "retard",
  "nude",
  "nudes",
  "porn",
  "nsfw",
  "escort",
];

const SPAM_TERMS = [
  "http://",
  "https://",
  "telegram",
  "whatsapp",
  "cashapp",
  "onlyfans",
  "free money",
  "dm me",
  "link in bio",
  "click here",
  "subscribe",
  "promo",
  "xxx",
];

// ─────────────────────────────────────────────
// Daily limit check
// ─────────────────────────────────────────────

/**
 * Check if a user can submit a question today.
 * Free users: 1/day. Premium users: 3/day.
 * @param {import('knex').Knex} db
 * @param {number} userId
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: string}>}
 */
async function checkDailyLimit(db, userId) {
  const user = await db("users")
    .where({ id: userId })
    .select(
      "id",
      "is_premium",
      "daily_question_count",
      "last_question_date"
    )
    .first();

  if (!user) {
    return { allowed: false, remaining: 0, resetAt: null };
  }

  const today = new Date().toISOString().slice(0, 10);
  const lastDate = user.last_question_date
    ? new Date(user.last_question_date).toISOString().slice(0, 10)
    : null;

  const maxPerDay = user.is_premium ? 3 : 1;

  // Reset count if it's a new day
  const currentCount = lastDate === today ? (user.daily_question_count || 0) : 0;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  return {
    allowed: currentCount < maxPerDay,
    remaining: Math.max(0, maxPerDay - currentCount),
    resetAt: tomorrow.toISOString(),
  };
}

/**
 * Increment the user's daily question counter.
 * @param {import('knex').Knex} db
 * @param {number} userId
 */
async function incrementDailyCount(db, userId) {
  const today = new Date().toISOString().slice(0, 10);
  const user = await db("users")
    .where({ id: userId })
    .select("last_question_date", "daily_question_count")
    .first();

  const lastDate = user?.last_question_date
    ? new Date(user.last_question_date).toISOString().slice(0, 10)
    : null;

  if (lastDate === today) {
    await db("users")
      .where({ id: userId })
      .increment("daily_question_count", 1);
  } else {
    await db("users").where({ id: userId }).update({
      daily_question_count: 1,
      last_question_date: today,
    });
  }
}

// ─────────────────────────────────────────────
// Duplicate detection
// ─────────────────────────────────────────────

/**
 * Check if an identical (case-insensitive) question already exists.
 * @param {import('knex').Knex} db
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function isDuplicate(db, text) {
  const existing = await db("user_questions")
    .whereRaw("LOWER(text) = ?", [text.toLowerCase().trim()])
    .whereNot("status", "rejected")
    .first();

  return Boolean(existing);
}

// ─────────────────────────────────────────────
// Moderation (rules + AI)
// ─────────────────────────────────────────────

/**
 * Run heuristic + AI moderation on question text.
 * @param {string} text
 * @returns {Promise<{status: string, reason: string|null, labels: string[], abuseScore: number}>}
 */
async function moderateQuestion(text) {
  const lower = text.toLowerCase().trim();
  const reasons = [];
  const labels = [];
  let abuseScore = 0;
  const quality = scoreQuestionQuality(text);

  // 1) Blocked terms → instant reject
  const matchedBlocked = BLOCKED_TERMS.filter((term) => lower.includes(term));
  if (matchedBlocked.length > 0) {
    return {
      status: "rejected",
      reason: `blocked_terms:${matchedBlocked.join(",")}`,
      labels: ["abuse", "blocked"],
      abuseScore: 100,
    };
  }

  // 2) Spam terms → flag for review
  const matchedSpam = SPAM_TERMS.filter((term) => lower.includes(term));
  if (matchedSpam.length > 0) {
    reasons.push(`spam_terms:${matchedSpam.join(",")}`);
    labels.push("spam");
    abuseScore += 40;
  }

  // 3) Excessive caps
  const upperChars = text.replace(/[^A-Z]/g, "").length;
  if (upperChars >= 12 && upperChars >= Math.ceil(text.length * 0.55)) {
    reasons.push("excessive_caps");
    labels.push("caps");
    abuseScore += 15;
  }

  // 4) Repeated characters
  if (/(.)\\1{6,}/.test(lower)) {
    reasons.push("repeated_characters");
    labels.push("spam");
    abuseScore += 15;
  }

  // 5) Not a question (no question mark) — soft signal
  if (!text.includes("?")) {
    reasons.push("missing_question_mark");
    labels.push("format");
    abuseScore += 5;
  }

  if (quality.adjustedScore < 40) {
    reasons.push(`low_question_quality:${quality.adjustedScore}`);
    labels.push("quality_review");
    abuseScore += 10;
  } else if (quality.adjustedScore >= 70) {
    labels.push("quality_high");
  }

  // 6) AI moderation (if available)
  try {
    const aiResult = await moderatePublicContent({
      content: text,
      answerType: "text",
    });

    if (aiResult === "REJECT") {
      reasons.push("ai_reject");
      labels.push("ai_review");
      abuseScore += 40;
    }
  } catch (_) {
    // AI unavailable — allow with heuristic score only
  }

  // Decision
  if (abuseScore >= 60) {
    return {
      status: "rejected",
      reason: reasons.join(";"),
      labels,
      abuseScore,
    };
  }

  if (abuseScore >= 20) {
    return {
      status: "pending",
      reason: reasons.join(";"),
      labels,
      abuseScore,
    };
  }

  return {
    status: "approved",
    reason: reasons.length > 0 ? reasons.join(";") : null,
    labels,
    abuseScore,
  };
}

// ─────────────────────────────────────────────
// Viral scoring with time decay
// ─────────────────────────────────────────────

/**
 * Calculate viral score for a user question.
 * Formula: (answers×3 + likes×2 + shares×4) / (hours_since_created + 2)
 * @param {object} q - user_questions row
 * @returns {number}
 */
function calculateUserQuestionScore(q) {
  const qualityPrior = getQuestionQualityPrior(q.text || "");
  const rawScore =
    qualityPrior +
    (q.answers_count || 0) * 3 +
    (q.likes || 0) * 2 +
    (q.shares || 0) * 4;

  // Time decay: newer content scores higher
  const hoursAgo = Math.max(
    0,
    (Date.now() - new Date(q.created_at).getTime()) / (1000 * 60 * 60)
  );
  const decayedScore = rawScore / (hoursAgo + 2);

  // Boost multiplier
  const boostMultiplier = q.is_boosted ? 2.5 : 1;

  return Math.round(decayedScore * boostMultiplier * 10) / 10;
}

/**
 * Recalculate scores for all approved user questions.
 * @param {import('knex').Knex} db
 */
async function recalculateUserQuestionScores(db) {
  const questions = await db("user_questions")
    .where("status", "approved")
    .whereNull("deleted_at")
    .select("*");

  for (const q of questions) {
    const score = calculateUserQuestionScore(q);
    await db("user_questions")
      .where({ id: q.id })
      .update({ score, updated_at: db.fn.now() });
  }

  console.log(`✅ Recalculated scores for ${questions.length} user questions`);
}

// ─────────────────────────────────────────────
// Feed ranking
// ─────────────────────────────────────────────

/**
 * Rank user questions for feed display.
 * Boosted questions float to top, then by score.
 * @param {Array} questions
 * @returns {Array}
 */
function rankUserQuestionFeed(questions) {
  return [...questions].sort((a, b) => {
    // Boosted always on top
    if (a.is_boosted && !b.is_boosted) return -1;
    if (!a.is_boosted && b.is_boosted) return 1;
    // Then by score (already includes decay + boost multiplier)
    return b.score - a.score;
  });
}

// ─────────────────────────────────────────────
// Query helpers
// ─────────────────────────────────────────────

/**
 * Get viral/trending user questions for a country.
 * @param {import('knex').Knex} db
 * @param {string} country
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function getViralUserQuestions(db, country, limit = 10) {
  const questions = await db("user_questions")
    .where("status", "approved")
    .whereNull("deleted_at")
    .where(function () {
      this.where("country", country).orWhere("country", "GLOBAL");
    })
    .orderBy("score", "desc")
    .limit(limit)
    .select("*");

  return rankUserQuestionFeed(questions);
}

/**
 * Get the full feed: seed questions + approved user questions + boosted.
 * @param {import('knex').Knex} db
 * @param {string} country
 * @param {number} limit
 * @returns {Promise<{seed: Array, user: Array, boosted: Array, feed: Array}>}
 */
async function composeFeed(db, country, limit = 30) {
  // 1) Seed questions (from main questions table)
  const seedQuestions = await db("questions")
    .whereIn("country", [country, "GLOBAL"])
    .whereNull("deleted_at")
    .orderBy("performance_score", "desc")
    .limit(20)
    .select("*");

  // 2) Approved user questions
  const userQuestions = await db("user_questions")
    .where("status", "approved")
    .whereNull("deleted_at")
    .where(function () {
      this.where("country", country).orWhere("country", "GLOBAL");
    })
    .orderBy("score", "desc")
    .limit(limit)
    .select("*");

  // 3) Separate boosted
  const boosted = userQuestions.filter((q) => q.is_boosted);
  const organic = userQuestions.filter((q) => !q.is_boosted);

  // 4) Merge: boosted first, then interleave seed + user by score
  const combined = [
    ...boosted.map((q) => ({ ...q, source: "user_boosted" })),
    ...seedQuestions.map((q) => ({ ...q, source: "seed", score: q.performance_score || 0 })),
    ...organic.map((q) => ({ ...q, source: "user_organic" })),
  ];

  // Re-rank: boosted → then by score
  const feed = combined.sort((a, b) => {
    if (a.source === "user_boosted" && b.source !== "user_boosted") return -1;
    if (a.source !== "user_boosted" && b.source === "user_boosted") return 1;
    return (b.score || 0) - (a.score || 0);
  });

  return {
    seed: seedQuestions,
    user: userQuestions,
    boosted,
    feed: feed.slice(0, limit),
  };
}

/**
 * Increment a stat field on a user question and recalculate score.
 * @param {import('knex').Knex} db
 * @param {number} questionId
 * @param {'answers_count'|'likes'|'shares'} field
 */
async function incrementUserQuestionStat(db, questionId, field) {
  await db("user_questions")
    .where({ id: questionId })
    .whereNull("deleted_at")
    .increment(field, 1);

  // Recalculate score for this question
  const q = await db("user_questions").where({ id: questionId }).first();
  if (q) {
    const score = calculateUserQuestionScore(q);
    await db("user_questions")
      .where({ id: questionId })
      .update({ score, updated_at: db.fn.now() });
  }
}

module.exports = {
  checkDailyLimit,
  incrementDailyCount,
  isDuplicate,
  moderateQuestion,
  calculateUserQuestionScore,
  recalculateUserQuestionScores,
  rankUserQuestionFeed,
  getViralUserQuestions,
  composeFeed,
  incrementUserQuestionStat,
};
