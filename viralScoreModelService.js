/**
 * Viral Score Model Service (K22)
 *
 * Implements the non-linear viral score formula:
 *   engagementRate = (likes + completions) / max(1, views)
 *   viralScore     = log(1 + shares) * engagementRate * exp(-ageHours / 24)
 *   result         = clamp(viralScore, 0, 1000)
 *
 * A question is a "viral candidate" when its score exceeds 100.
 */

/**
 * Calculate the non-linear viral score for a single question.
 *
 * @param {Object} params
 * @param {number} params.shares      - Total share count (≥ 0)
 * @param {number} params.likes       - Total like count (≥ 0)
 * @param {number} params.completions - Total completion count (≥ 0)
 * @param {number} params.views       - Total view count (≥ 0)
 * @param {number} params.ageHours    - Age of the question in hours (≥ 0)
 * @returns {number} Viral score in [0, 1000]
 */
function calculateNonLinearViralScore({ shares, likes, completions, views, ageHours }) {
  const safeShares = Math.max(0, Number(shares) || 0);
  const safeLikes = Math.max(0, Number(likes) || 0);
  const safeCompletions = Math.max(0, Number(completions) || 0);
  const safeViews = Math.max(0, Number(views) || 0);
  const safeAgeHours = Math.max(0, Number(ageHours) || 0);

  const engagementRate = (safeLikes + safeCompletions) / Math.max(1, safeViews);
  const viralScore = Math.log(1 + safeShares) * engagementRate * Math.exp(-safeAgeHours / 24);

  return Math.min(1000, Math.max(0, viralScore));
}

/**
 * Recalculate viral scores for all active questions and persist the results.
 *
 * Fetches all active questions joined with their stats, computes the viral score
 * for each, and updates `viral_score`, `viral_candidate`, and
 * `viral_score_updated_at` in `question_stats`.
 *
 * @param {import('knex').Knex} db - Knex database instance
 * @returns {Promise<{ updated: number }>}
 */
async function recalculateViralScores(db) {
  // Fetch all active questions with their stats
  const rows = await db('questions as q')
    .join('question_stats as qs', 'qs.question_id', 'q.id')
    .where('q.is_active', true)
    .select(
      'q.id as question_id',
      'q.created_at as question_created_at',
      db.raw('COALESCE(qs.shares, 0) as shares'),
      db.raw('COALESCE(qs.likes, 0) as likes'),
      db.raw('COALESCE(qs.completion_count, 0) as completions'),
      db.raw('COALESCE(qs.views, 0) as views')
    );

  let updated = 0;

  for (const row of rows) {
    const ageHours = Math.max(
      0,
      (Date.now() - new Date(row.question_created_at).getTime()) / (1000 * 60 * 60)
    );

    const viralScore = calculateNonLinearViralScore({
      shares: row.shares,
      likes: row.likes,
      completions: row.completions,
      views: row.views,
      ageHours,
    });

    await db('question_stats')
      .where({ question_id: row.question_id })
      .update({
        viral_score: viralScore,
        viral_candidate: viralScore > 100,
        viral_score_updated_at: db.fn.now(),
      });

    updated += 1;
  }

  return { updated };
}

module.exports = {
  calculateNonLinearViralScore,
  recalculateViralScores,
};
