/**
 * Session Adaptive Feed Service (K20)
 *
 * Computes and applies feed strategies based on real-time behavior signals.
 * Strategies are persisted in `feed_session_strategies` and re-evaluated
 * every 5 new session events.
 *
 * Priority order: trending_inject > exploration_boost > personalized_boost > default
 *
 * SLA: the updated feed must be returned within 300ms.
 */

// ─────────────────────────────────────────────
// Strategy computation
// ─────────────────────────────────────────────

/**
 * Compute the feed strategy based on a behavior profile and session events.
 *
 * Priority order (highest first):
 *   1. trending_inject   — scrollSpeed > 1.5
 *   2. exploration_boost — skipRate > 0.6
 *   3. personalized_boost — dwellTime > 20 (seconds)
 *   4. default
 *
 * @param {Object|null} behaviorProfile - Row from user_behavior_state (snake_case keys)
 * @param {Array}       sessionEvents   - Array of session event objects (unused for now,
 *                                        reserved for future signal enrichment)
 * @returns {{ strategy: string, params: Object }}
 */
function computeFeedStrategy(behaviorProfile, sessionEvents = []) {
  if (!behaviorProfile) {
    return { strategy: 'default', params: {} };
  }

  const scrollSpeed = Number(behaviorProfile.scroll_speed) || 0;
  const skipRate    = Number(behaviorProfile.skip_rate)    || 0;
  const dwellTime   = Number(behaviorProfile.dwell_time)   || 0;

  // Priority 1 — trending_inject
  if (scrollSpeed > 1.5) {
    return {
      strategy: 'trending_inject',
      params: { scrollSpeed },
    };
  }

  // Priority 2 — exploration_boost
  if (skipRate > 0.6) {
    return {
      strategy: 'exploration_boost',
      params: { skipRate, scoreMultiplier: 1.5 },
    };
  }

  // Priority 3 — personalized_boost
  if (dwellTime > 20) {
    return {
      strategy: 'personalized_boost',
      params: { dwellTime, scoreMultiplier: 2 },
    };
  }

  return { strategy: 'default', params: {} };
}

// ─────────────────────────────────────────────
// Strategy persistence
// ─────────────────────────────────────────────

/**
 * Record (upsert) the feed strategy for a session.
 *
 * - Inserts a new row if none exists for (user_id, session_id).
 * - Increments `event_count` on every call.
 * - When `event_count % 5 === 0` (after increment), recomputes the strategy
 *   using the latest behavior profile and updates the row.
 *
 * @param {import('knex').Knex} db
 * @param {string|number}       userId
 * @param {string}              sessionId
 * @param {{ strategy: string, params: Object }} strategy
 * @returns {Promise<void>}
 */
async function recordFeedStrategy(db, userId, sessionId, strategy) {
  if (!db || !userId || !sessionId) return;

  const existing = await db('feed_session_strategies')
    .where({ user_id: userId, session_id: sessionId })
    .first();

  if (existing) {
    const newEventCount = (existing.event_count || 0) + 1;

    // Every 5 events: recompute strategy from the latest behavior profile
    if (newEventCount % 5 === 0) {
      const profile = await db('user_behavior_state').where('user_id', userId).first();
      const recomputed = computeFeedStrategy(profile, []);

      await db('feed_session_strategies')
        .where({ user_id: userId, session_id: sessionId })
        .update({
          strategy:    recomputed.strategy,
          event_count: newEventCount,
          computed_at: new Date().toISOString(),
        });
    } else {
      await db('feed_session_strategies')
        .where({ user_id: userId, session_id: sessionId })
        .update({
          event_count: newEventCount,
        });
    }
  } else {
    await db('feed_session_strategies').insert({
      user_id:     userId,
      session_id:  sessionId,
      strategy:    strategy.strategy,
      event_count: 1,
      computed_at: new Date().toISOString(),
    });
  }
}

// ─────────────────────────────────────────────
// Strategy application
// ─────────────────────────────────────────────

/**
 * Apply the feed strategy to a ranked list of answers.
 *
 * Strategies:
 *   - trending_inject:    no score modification (trending items are already surfaced
 *                         by the base ranker; future: inject trending items from a
 *                         separate pool)
 *   - exploration_boost:  multiply feed_score by 1.5x for non-personalized content
 *                         (answers where is_personalized is falsy)
 *   - personalized_boost: multiply feed_score by 2x for personalized content
 *                         (answers where is_personalized is truthy)
 *   - default:            no modification
 *
 * The function returns a NEW sorted array — it does not mutate the input.
 *
 * @param {Array}       rankedAnswers   - Output of feedComposer.rankAnswerFeed
 * @param {{ strategy: string, params: Object }} strategyObj
 * @param {Object|null} behaviorProfile - Behavior profile (reserved for future use)
 * @returns {Array} Re-ranked answers
 */
function applyFeedStrategy(rankedAnswers, strategyObj, behaviorProfile) {
  if (!rankedAnswers || rankedAnswers.length === 0) return rankedAnswers || [];

  const strategy = (strategyObj && strategyObj.strategy) || 'default';

  if (strategy === 'default' || strategy === 'trending_inject') {
    // No score modification for these strategies
    return rankedAnswers;
  }

  const boosted = rankedAnswers.map((answer) => {
    let newScore = answer.feed_score;

    if (strategy === 'exploration_boost') {
      // 1.5x for non-personalized content
      if (!answer.is_personalized) {
        newScore = Math.round((answer.feed_score * 1.5) * 10) / 10;
      }
    } else if (strategy === 'personalized_boost') {
      // 2x for personalized content
      if (answer.is_personalized) {
        newScore = Math.round((answer.feed_score * 2) * 10) / 10;
      }
    }

    return { ...answer, feed_score: newScore };
  });

  // Re-sort after score modification
  return boosted.sort((a, b) => {
    if (b.feed_score !== a.feed_score) return b.feed_score - a.feed_score;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

// ─────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────

module.exports = {
  computeFeedStrategy,
  recordFeedStrategy,
  applyFeedStrategy,
};
