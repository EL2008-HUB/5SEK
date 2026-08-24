/**
 * Personalization Service — Smart Feed Engine
 *
 * Formula: Score = Quality × Personalization × Freshness
 *
 * Learns user preferences from their behavior (answer_events):
 * - What categories/tags they engage with (completions, likes, replays)
 * - What they skip immediately
 * - Their preferred content type and response time
 * - Country affinity
 *
 * Then boosts feed items that match learned preferences.
 */

const LEARNING_WINDOW_DAYS = 30;
const STALE_HOURS = 6; // re-learn if preferences older than this

// ─────────────────────────────────────────────
// 1. LEARN: Build user preference profile from behavior
// ─────────────────────────────────────────────

/**
 * Analyze a user's recent answer_events to learn their taste profile.
 * @param {import('knex').Knex} db
 * @param {number} userId
 * @returns {Promise<object>} preference profile
 */
async function learnUserPreferences(db, userId) {
  const since = new Date(Date.now() - LEARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // 1) Get all recent events for this user, joined with answer+question data
  const events = await db("answer_events as ae")
    .join("answers as a", "ae.answer_id", "a.id")
    .join("questions as q", "a.question_id", "q.id")
    .where("ae.user_id", userId)
    .where("ae.created_at", ">=", since)
    .select(
      "ae.event_type",
      "ae.watch_time",
      "ae.created_at",
      "a.answer_type",
      "a.response_time",
      "q.category",
      "q.country as question_country",
      "q.interest_tags"
    );

  if (events.length === 0) {
    return null; // not enough data
  }

  // 2) Aggregate by category
  const categoryEngagement = {};
  const categorySkips = {};
  const tagCounts = {};
  const answerTypeCounts = {};
  const responseTimes = [];
  const hourCounts = {};
  let totalWatchTime = 0;
  let watchTimeEvents = 0;
  let completions = 0;
  let skips = 0;
  let likes = 0;
  let shares = 0;
  let replays = 0;

  for (const event of events) {
    const cat = event.category || "general";
    const type = event.event_type;

    // Category engagement scoring
    if (!categoryEngagement[cat]) categoryEngagement[cat] = 0;
    if (!categorySkips[cat]) categorySkips[cat] = 0;

    if (type === "completed") {
      categoryEngagement[cat] += 3;
      completions++;
    } else if (type === "replayed") {
      categoryEngagement[cat] += 5; // replay = strongest signal
      replays++;
    } else if (type === "skipped") {
      categorySkips[cat] += 1;
      skips++;
    } else if (type === "watch_progress") {
      categoryEngagement[cat] += 1;
    }

    // Tag extraction
    if (event.interest_tags) {
      const tags = typeof event.interest_tags === "string"
        ? safeJsonParse(event.interest_tags, [])
        : event.interest_tags;

      if (Array.isArray(tags)) {
        for (const tag of tags) {
          if (type !== "skipped") {
            tagCounts[tag] = (tagCounts[tag] || 0) + (type === "completed" ? 3 : type === "replayed" ? 5 : 1);
          }
        }
      }
    }

    // Answer type preference
    if (event.answer_type && type !== "skipped") {
      answerTypeCounts[event.answer_type] = (answerTypeCounts[event.answer_type] || 0) + 1;
    }

    // Response time preference
    if (event.response_time != null && type === "completed") {
      responseTimes.push(Number(event.response_time));
    }

    // Watch time
    if (event.watch_time > 0) {
      totalWatchTime += event.watch_time;
      watchTimeEvents++;
    }

    // Peak hour
    const hour = new Date(event.created_at).getHours();
    const hourKey = String(hour).padStart(2, "0") + ":00";
    hourCounts[hourKey] = (hourCounts[hourKey] || 0) + 1;
  }

  // 3) Derive preferences
  const sortedCategories = Object.entries(categoryEngagement)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([cat]) => cat);

  const sortedSkipCategories = Object.entries(categorySkips)
    .filter(([cat]) => {
      const engagement = categoryEngagement[cat] || 0;
      const skipCount = categorySkips[cat] || 0;
      return skipCount > engagement; // only flag if more skips than engagement
    })
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([cat]) => cat);

  const sortedTags = Object.entries(tagCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([tag]) => tag);

  const preferredType = Object.entries(answerTypeCounts)
    .sort(([, a], [, b]) => b - a)[0]?.[0] || null;

  const avgResponseTime = responseTimes.length > 0
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : null;

  const peakHour = Object.entries(hourCounts)
    .sort(([, a], [, b]) => b - a)[0]?.[0] || null;

  const avgWatchPct = watchTimeEvents > 0
    ? Math.min(100, (totalWatchTime / watchTimeEvents) / 5 * 100) // assume 5s avg video
    : 0;

  return {
    favorite_tags: sortedTags,
    favorite_categories: sortedCategories,
    skip_categories: sortedSkipCategories,
    avg_watch_pct: Math.round(avgWatchPct * 10) / 10,
    avg_session_duration: watchTimeEvents > 0 ? Math.round(totalWatchTime / watchTimeEvents * 10) / 10 : 0,
    total_completions: completions,
    total_skips: skips,
    total_likes: likes,
    total_shares: shares,
    total_replays: replays,
    preferred_answer_type: preferredType,
    preferred_response_time_max: avgResponseTime ? Math.round(avgResponseTime * 10) / 10 : null,
    peak_hour: peakHour,
  };
}

/**
 * Get or compute user preferences (with staleness check).
 * @param {import('knex').Knex} db
 * @param {number} userId
 * @returns {Promise<object|null>}
 */
async function getOrComputePreferences(db, userId) {
  if (!userId) return null;

  // Check if we have fresh preferences
  const existing = await db("user_preferences").where({ user_id: userId }).first();

  if (existing) {
    const hoursSinceComputed = (Date.now() - new Date(existing.computed_at).getTime()) / (1000 * 60 * 60);
    if (hoursSinceComputed < STALE_HOURS) {
      return parseStoredPreferences(existing);
    }
  }

  // Recompute
  const learned = await learnUserPreferences(db, userId);
  if (!learned) {
    return existing ? parseStoredPreferences(existing) : null;
  }

  // Upsert
  const row = {
    user_id: userId,
    favorite_tags: JSON.stringify(learned.favorite_tags),
    favorite_categories: JSON.stringify(learned.favorite_categories),
    skip_categories: JSON.stringify(learned.skip_categories),
    avg_watch_pct: learned.avg_watch_pct,
    avg_session_duration: learned.avg_session_duration,
    total_completions: learned.total_completions,
    total_skips: learned.total_skips,
    total_likes: learned.total_likes,
    total_shares: learned.total_shares,
    total_replays: learned.total_replays,
    preferred_answer_type: learned.preferred_answer_type,
    preferred_response_time_max: learned.preferred_response_time_max,
    peak_hour: learned.peak_hour,
    computed_at: db.fn.now(),
    updated_at: db.fn.now(),
  };

  try {
    if (existing) {
      await db("user_preferences").where({ user_id: userId }).update(row);
    } else {
      row.created_at = db.fn.now();
      await db("user_preferences").insert(row);
    }
  } catch (err) {
    // Race condition — another request computed first, that's fine
    console.log(`⚠️ Preference upsert race for user ${userId}: ${err.message}`);
  }

  return learned;
}

// ─────────────────────────────────────────────
// 2. SCORE: Compute personalization multiplier
// ─────────────────────────────────────────────

/**
 * Calculate personalization boost for an answer based on user preferences.
 *
 * Returns a multiplier (1.0 = neutral, >1 = boosted, <1 = demoted).
 *
 * BALANCED RANGE: ×0.8 – ×1.5
 * Old range (×0.5 – ×2.5) was too aggressive → filter bubble risk.
 * New range ensures personalization without suppressing diversity.
 *
 * @param {object} answer - feed row with category, answer_type, question_country, etc.
 * @param {object} prefs - user preferences object
 * @param {string} userCountry - the requesting user's country
 * @returns {number} multiplier (0.8 – 1.5)
 */
function computePersonalizationBoost(answer, prefs, userCountry) {
  if (!prefs) return 1.0;

  let boost = 1.0;

  // ── Category match (strongest signal) ──────────
  const favCategories = prefs.favorite_categories || [];
  const skipCategories = prefs.skip_categories || [];
  const answerCategory = (answer.category || "general").toLowerCase();

  if (favCategories.length > 0) {
    const catIndex = favCategories.indexOf(answerCategory);
    if (catIndex === 0) boost += 0.25;       // #1 favorite → moderate boost
    else if (catIndex === 1) boost += 0.15;  // #2
    else if (catIndex >= 2) boost += 0.08;   // top 5
  }

  // Demote skipped categories (gentle — don't bury them)
  if (skipCategories.includes(answerCategory)) {
    boost -= 0.15;
  }

  // ── Tag match ──────────────────────────────────
  const favTags = prefs.favorite_tags || [];
  if (favTags.length > 0 && answer.interest_tags) {
    const answerTags = typeof answer.interest_tags === "string"
      ? safeJsonParse(answer.interest_tags, [])
      : (answer.interest_tags || []);

    const matchCount = answerTags.filter((t) => favTags.includes(t)).length;
    if (matchCount >= 2) boost += 0.2;
    else if (matchCount === 1) boost += 0.1;
  }

  // ── Country match ──────────────────────────────
  const questionCountry = answer.question_country || answer.country || "GLOBAL";
  if (userCountry && questionCountry === userCountry) {
    boost += 0.12;
  }

  // ── Answer type match ──────────────────────────
  if (prefs.preferred_answer_type && answer.answer_type === prefs.preferred_answer_type) {
    boost += 0.06;
  }

  // ── Response time preference ───────────────────
  // If user prefers fast answers and this is fast, boost it
  if (prefs.preferred_response_time_max && answer.response_time != null) {
    const rt = Number(answer.response_time);
    if (rt <= prefs.preferred_response_time_max * 0.8) {
      boost += 0.08; // faster than their average preference
    }
  }

  // Clamp to balanced range (×0.8 – ×1.5)
  return Math.max(0.8, Math.min(1.5, Math.round(boost * 100) / 100));
}

// ─────────────────────────────────────────────
// 3. FRESHNESS: Time decay factor
// ─────────────────────────────────────────────

/**
 * Calculate freshness multiplier. Newer content scores higher.
 *
 * @param {string|Date} createdAt
 * @returns {number} multiplier (0.3 – 1.5)
 */
function computeFreshness(createdAt) {
  const hoursAgo = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60));

  if (hoursAgo < 1) return 1.5;     // fresh: last hour
  if (hoursAgo < 3) return 1.3;     // recent
  if (hoursAgo < 6) return 1.15;
  if (hoursAgo < 12) return 1.0;    // neutral
  if (hoursAgo < 24) return 0.85;
  if (hoursAgo < 48) return 0.7;
  return 0.5;                        // older than 2 days → significant decay
}

// ─────────────────────────────────────────────
// 4. COMBINED: Final personalized score
// ─────────────────────────────────────────────

/**
 * Compute the final personalized feed score.
 *
 * Formula: quality × personalization × freshness
 *
 * @param {object} answer - feed row
 * @param {number} qualityScore - base quality score from feedComposer
 * @param {object|null} prefs - user preferences
 * @param {string} userCountry
 * @returns {{personalizedScore: number, qualityScore: number, personalizationBoost: number, freshnessMultiplier: number}}
 */
function computePersonalizedScore(answer, qualityScore, prefs, userCountry) {
  const personalizationBoost = computePersonalizationBoost(answer, prefs, userCountry);
  const freshnessMultiplier = computeFreshness(answer.created_at);
  const personalizedScore = Math.round(qualityScore * personalizationBoost * freshnessMultiplier * 10) / 10;

  return {
    personalizedScore,
    qualityScore,
    personalizationBoost,
    freshnessMultiplier,
  };
}

/**
 * Apply personalization to an already-scored feed array.
 * Re-ranks the feed based on personalized scores.
 *
 * @param {Array} scoredFeed - feed items with feed_score already computed
 * @param {object|null} prefs - user preferences
 * @param {string} userCountry
 * @returns {Array} re-ranked feed
 */
function personalizeAndRerankFeed(scoredFeed, prefs, userCountry) {
  if (!prefs || scoredFeed.length === 0) return scoredFeed;

  return scoredFeed
    .map((item) => {
      const { personalizedScore, personalizationBoost, freshnessMultiplier } =
        computePersonalizedScore(item, item.feed_score || 0, prefs, userCountry);

      return {
        ...item,
        feed_score_raw: item.feed_score,
        feed_score: personalizedScore,
        personalization: {
          boost: personalizationBoost,
          freshness: freshnessMultiplier,
          reasons: buildBoostReasons(item, prefs, userCountry),
        },
      };
    })
    .sort((a, b) => {
      // Boosted user questions still on top
      if (a.is_boosted && !b.is_boosted) return -1;
      if (!a.is_boosted && b.is_boosted) return 1;
      // Then by personalized score
      if (b.feed_score !== a.feed_score) return b.feed_score - a.feed_score;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
}

// ─────────────────────────────────────────────
// 5. HELPERS
// ─────────────────────────────────────────────

function buildBoostReasons(answer, prefs, userCountry) {
  const reasons = [];
  const answerCategory = (answer.category || "general").toLowerCase();
  const favCategories = prefs.favorite_categories || [];
  const favTags = prefs.favorite_tags || [];

  if (favCategories.includes(answerCategory)) {
    reasons.push(`favorite_category:${answerCategory}`);
  }

  if ((prefs.skip_categories || []).includes(answerCategory)) {
    reasons.push(`skip_category:${answerCategory}`);
  }

  const questionCountry = answer.question_country || answer.country || "GLOBAL";
  if (userCountry && questionCountry === userCountry) {
    reasons.push("country_match");
  }

  if (prefs.preferred_answer_type && answer.answer_type === prefs.preferred_answer_type) {
    reasons.push(`preferred_type:${prefs.preferred_answer_type}`);
  }

  if (favTags.length > 0 && answer.interest_tags) {
    const answerTags = typeof answer.interest_tags === "string"
      ? safeJsonParse(answer.interest_tags, [])
      : (answer.interest_tags || []);

    const matches = answerTags.filter((t) => favTags.includes(t));
    if (matches.length > 0) {
      reasons.push(`tag_match:${matches.join(",")}`);
    }
  }

  return reasons;
}

function parseStoredPreferences(row) {
  return {
    ...row,
    favorite_tags: safeJsonParse(row.favorite_tags, []),
    favorite_categories: safeJsonParse(row.favorite_categories, []),
    skip_categories: safeJsonParse(row.skip_categories, []),
  };
}

function safeJsonParse(value, fallback) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

/**
 * Force recompute preferences for a user (called after significant events).
 * @param {import('knex').Knex} db
 * @param {number} userId
 */
async function invalidatePreferences(db, userId) {
  try {
    await db("user_preferences")
      .where({ user_id: userId })
      .update({ computed_at: new Date(0).toISOString() });
  } catch (_) {
    // Table might not exist yet or user has no preferences row — fine
  }
}

module.exports = {
  learnUserPreferences,
  getOrComputePreferences,
  computePersonalizationBoost,
  computeFreshness,
  computePersonalizedScore,
  personalizeAndRerankFeed,
  invalidatePreferences,
};
