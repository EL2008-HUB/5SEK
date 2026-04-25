/**
 * Viral Scoring System — Country-Aware
 *
 * Score formula (weights tuned for engagement):
 *   answers  × 3   — strongest signal (people committed to answering)
 *   shares   × 5   — highest value (organic growth)
 *   likes    × 2   — passive engagement
 *   views    × 0.5 — weakest (passive)
 *
 * Fast-feedback bonus: questions answered heavily in the last 2h
 * get a 1.5× multiplier so trending content rises quickly.
 *
 * Country isolation: each country has its own question_stats row,
 * so a question can be #1 in Albania but mediocre globally.
 */

// ─────────────────────────────────────────────
// Score calculation
// ─────────────────────────────────────────────

/**
 * Calculate viral score from a stat row (question_stats or question aggregate).
 * @param {object} stat - row with answers_count, likes, shares, views
 * @param {number} recentAnswers - answers in last 2 hours (for fast-feedback)
 * @returns {number}
 */
function calculateScore(stat, recentAnswers = 0) {
  const base =
    (stat.answers_count || 0) * 3 +
    (stat.shares || stat.total_shares || 0) * 5 +
    (stat.likes || stat.total_likes || 0) * 2 +
    (stat.views || stat.total_views || 0) * 0.5;

  // Fast-feedback boost: if 10+ answers in last 2h → 1.5× multiplier
  const trendingBoost =
    recentAnswers >= 10 ? 1.5 : recentAnswers >= 3 ? 1.2 : 1;

  return Math.round(base * trendingBoost * 10) / 10;
}

// ─────────────────────────────────────────────
// Per-country question_stats helpers
// ─────────────────────────────────────────────

/**
 * Get or create a question_stats row for a question × country pair.
 * @param {import('knex').Knex} db
 * @param {number} questionId
 * @param {string} country - ISO country code or "GLOBAL"
 * @returns {Promise<object>}
 */
async function getOrCreateCountryStat(db, questionId, country = "GLOBAL") {
  let row = await db("question_stats")
    .where({ question_id: questionId, country })
    .first();

  if (!row) {
    try {
      [row] = await db("question_stats")
        .insert({ question_id: questionId, country })
        .returning("*");
    } catch (err) {
      // Race condition — another request created it first
      row = await db("question_stats")
        .where({ question_id: questionId, country })
        .first();
    }
  }

  return row;
}

/**
 * Increment a counter on question_stats for a specific country AND on the
 * global question aggregate (questions table) in one shot.
 * @param {import('knex').Knex} db
 * @param {number} questionId
 * @param {'answers_count'|'views'|'likes'|'shares'} statField - field on question_stats
 * @param {string} country
 */
async function incrementCountryStat(db, questionId, statField, country = "GLOBAL") {
  // 1) Ensure country-level row exists, then increment
  await getOrCreateCountryStat(db, questionId, country);
  await db("question_stats")
    .where({ question_id: questionId, country })
    .increment(statField, 1);

  // 2) Also bump GLOBAL row (so cross-country totals stay accurate)
  if (country !== "GLOBAL") {
    await getOrCreateCountryStat(db, questionId, "GLOBAL");
    await db("question_stats")
      .where({ question_id: questionId, country: "GLOBAL" })
      .increment(statField, 1);
  }

  // 3) Legacy: keep questions table aggregates in sync
  const legacyField = {
    answers_count: "answers_count",
    views: "total_views",
    likes: "total_likes",
    shares: "total_shares",
  }[statField];

  if (legacyField) {
    await db("questions").where({ id: questionId }).increment(legacyField, 1);
  }
}

/**
 * Recalculate score for every question_stats row and also for questions.performance_score.
 * @param {import('knex').Knex} db
 */
async function recalculateAllScores(db) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const recentAnswerCounts = await db("answers")
    .where("created_at", ">=", twoHoursAgo)
    .groupBy("question_id")
    .select("question_id")
    .count("id as count");
  const recentAnswersByQuestionId = new Map(
    recentAnswerCounts.map((row) => [Number(row.question_id), parseInt(row.count, 10) || 0])
  );

  // ── Per-country stats ─────────────────────────
  const stats = await db("question_stats").select("*");

  for (const stat of stats) {
    const recentAnswers = recentAnswersByQuestionId.get(Number(stat.question_id)) || 0;
    const score = calculateScore(stat, recentAnswers);

    await db("question_stats")
      .where({ id: stat.id })
      .update({ score, updated_at: db.fn.now() });
  }

  // ── Legacy: update questions.performance_score from GLOBAL stats ──
  const questions = await db("questions").select(
    "id",
    "answers_count",
    "total_shares",
    "total_likes",
    "total_views"
  );

  for (const q of questions) {
    const recentAnswers = recentAnswersByQuestionId.get(Number(q.id)) || 0;
    const score = calculateScore(q, recentAnswers);

    await db("questions").where({ id: q.id }).update({ performance_score: score });
  }

  console.log(
    `✅ Recalculated scores for ${stats.length} country stats + ${questions.length} questions`
  );
}

// ─────────────────────────────────────────────
// Country-aware daily pick
// ─────────────────────────────────────────────

/**
 * Pick the best question for a given country using per-country viral score.
 * Falls back to GLOBAL if not enough country-specific questions exist.
 * @param {import('knex').Knex} db
 * @param {string} today - YYYY-MM-DD
 * @param {string} country - ISO code
 * @returns {Promise<object|null>}
 */
async function pickBestQuestion(db, today, country = "GLOBAL") {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // 1) Try country-specific questions ONLY (not GLOBAL)
  let best = await db("questions")
    .leftJoin("question_stats", function () {
      this.on("questions.id", "=", "question_stats.question_id").andOn(
        "question_stats.country",
        "=",
        db.raw("?", [country])
      );
    })
    .where("questions.country", country)
    .where(function () {
      this.whereNull("questions.active_date").orWhere(
        "questions.active_date",
        "<",
        thirtyDaysAgo
      );
    })
    .orderBy("question_stats.score", "desc")
    .select("questions.*", "question_stats.score as country_score")
    .first();

  // 2) If no country-specific, try GLOBAL
  if (!best) {
    best = await db("questions")
      .where("questions.country", "GLOBAL")
      .where(function () {
        this.whereNull("active_date").orWhere("active_date", "<", thirtyDaysAgo);
      })
      .orderBy("performance_score", "desc")
      .first();
  }

  return best || null;
}

// ─────────────────────────────────────────────
// Legacy helpers (still used by some routes)
// ─────────────────────────────────────────────

/**
 * Increment a counter column on a question atomically (legacy).
 * @param {import('knex').Knex} db
 * @param {number} questionId
 * @param {'answers_count'|'total_views'|'total_likes'|'total_shares'} field
 */
async function incrementQuestionStat(db, questionId, field) {
  await db("questions").where({ id: questionId }).increment(field, 1);
}

/**
 * Analyse category performance and return sorted stats.
 * @param {import('knex').Knex} db
 * @param {string|null} country - filter by country (null = all)
 * @returns {Promise<Array<{category: string, avg_score: number, count: number}>>}
 */
async function getCategoryStats(db, country = null) {
  const query = db("questions")
    .select("category")
    .avg("performance_score as avg_score")
    .count("id as count")
    .groupBy("category")
    .orderBy("avg_score", "desc");

  if (country) {
    query.whereIn("country", [country, "GLOBAL"]);
  }

  return query;
}

/**
 * Get top trending questions for a specific country.
 * @param {import('knex').Knex} db
 * @param {string} country
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function getTrendingByCountry(db, country, limit = 10) {
  return db("question_stats")
    .join("questions", "question_stats.question_id", "questions.id")
    .where("question_stats.country", country)
    .where("question_stats.score", ">", 0)
    .orderBy("question_stats.score", "desc")
    .limit(limit)
    .select(
      "questions.*",
      "question_stats.score as country_score",
      "question_stats.answers_count as country_answers",
      "question_stats.likes as country_likes",
      "question_stats.shares as country_shares",
      "question_stats.views as country_views"
    );
}

/**
 * Check if a question should be cross-promoted to other countries.
 * Returns a list of countries it could be pushed to.
 * @param {import('knex').Knex} db
 * @param {number} questionId
 * @param {number} threshold - minimum score to trigger cross-country push
 * @returns {Promise<Array<{country: string, score: number}>>}
 */
async function checkCrossCountryPotential(db, questionId, threshold = 120) {
  const highPerformers = await db("question_stats")
    .where({ question_id: questionId })
    .where("score", ">", threshold)
    .select("country", "score");

  if (highPerformers.length === 0) return [];

  // Get all countries that already have this question's stats
  const existingCountries = await db("question_stats")
    .where({ question_id: questionId })
    .pluck("country");

  // Suggest countries where the question hasn't been pushed yet
  // For now, return the high performers — the caller can decide what to do
  return highPerformers;
}

module.exports = {
  calculateScore,
  getOrCreateCountryStat,
  incrementCountryStat,
  recalculateAllScores,
  pickBestQuestion,
  incrementQuestionStat,
  getCategoryStats,
  getTrendingByCountry,
  checkCrossCountryPotential,
};
