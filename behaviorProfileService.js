/**
 * Behavior Profile Service (K19)
 *
 * Persistent cold-layer for user behavior state.
 * Wraps the `user_behavior_state` table with upsert / fetch / ensure semantics.
 *
 * SLA: upsertBehaviorProfile must complete within 200ms.
 */

// ─────────────────────────────────────────────
// Default profile values (mirrors createDefaultState in behaviorStateEngine)
// ─────────────────────────────────────────────

function buildDefaultProfile(userId) {
  return {
    user_id: userId,
    engagement_score: 0,
    growth_score: 0,
    retention_score: 0,
    scroll_speed: 0,
    skip_rate: 0,
    dwell_time: 0,
    topic_affinity: JSON.stringify({}),
    total_sessions: 0,
    sessions_today: 0,
    is_returning_user: false,
    feedback_weights: JSON.stringify({}),
    topic_skip_counts: JSON.stringify({}),
    last_active: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Upsert a behavior profile for a user.
 *
 * Merges the provided `state` fields into the existing row (or creates a new one).
 * Only columns that exist in the table are written — unknown keys are ignored.
 *
 * SLA: must complete within 200ms.
 *
 * @param {import('knex').Knex} db
 * @param {string|number} userId
 * @param {Object} state - Partial state to merge (camelCase or snake_case keys accepted)
 * @returns {Promise<Object>} The updated/inserted row
 */
async function upsertBehaviorProfile(db, userId, state) {
  if (!db || !userId) return null;

  // Normalise incoming state keys to snake_case DB column names
  const mapped = mapStateToColumns(state);

  const now = new Date().toISOString();
  mapped.updated_at = now;

  const existing = await db('user_behavior_state').where('user_id', userId).first();

  if (existing) {
    // Merge jsonb fields rather than overwriting them
    const merged = mergeJsonbFields(existing, mapped);
    await db('user_behavior_state').where('user_id', userId).update(merged);
    return { ...existing, ...merged };
  } else {
    const defaults = buildDefaultProfile(userId);
    const row = { ...defaults, ...mapped, user_id: userId };
    await db('user_behavior_state').insert(row);
    return row;
  }
}

/**
 * Fetch the behavior profile for a user.
 *
 * @param {import('knex').Knex} db
 * @param {string|number} userId
 * @returns {Promise<Object|null>} The profile row, or null if not found
 */
async function getBehaviorProfile(db, userId) {
  if (!db || !userId) return null;

  const row = await db('user_behavior_state').where('user_id', userId).first();
  return row || null;
}

/**
 * Ensure a behavior profile exists for a user.
 * Creates a default profile if one doesn't exist.
 *
 * @param {import('knex').Knex} db
 * @param {string|number} userId
 * @returns {Promise<Object>} The existing or newly created profile
 */
async function ensureProfileExists(db, userId) {
  if (!db || !userId) return null;

  const existing = await db('user_behavior_state').where('user_id', userId).first();
  if (existing) return existing;

  const defaults = buildDefaultProfile(userId);
  await db('user_behavior_state').insert(defaults);
  return defaults;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Map camelCase state keys to snake_case DB column names.
 * Only known columns are included in the output.
 */
function mapStateToColumns(state) {
  if (!state || typeof state !== 'object') return {};

  const COLUMN_MAP = {
    // camelCase → snake_case
    engagementScore:  'engagement_score',
    growthScore:      'growth_score',
    retentionScore:   'retention_score',
    scrollSpeed:      'scroll_speed',
    skipRate:         'skip_rate',
    dwellTime:        'dwell_time',
    topicAffinity:    'topic_affinity',
    totalSessions:    'total_sessions',
    sessionsToday:    'sessions_today',
    isReturningUser:  'is_returning_user',
    feedbackWeights:  'feedback_weights',
    topicSkipCounts:  'topic_skip_counts',
    lastActive:       'last_active',
    lastEventAt:      'last_active',   // alias used by eventNormalizationService
    eventCount:       null,            // not a DB column — ignored
  };

  const result = {};

  for (const [key, value] of Object.entries(state)) {
    // Accept snake_case keys directly (pass-through)
    const snakeKey = COLUMN_MAP[key] !== undefined ? COLUMN_MAP[key] : key;
    if (snakeKey === null) continue; // explicitly ignored

    // Serialise objects/arrays to JSON strings for text/jsonb columns
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[snakeKey] = JSON.stringify(value);
    } else {
      result[snakeKey] = value;
    }
  }

  return result;
}

/**
 * Merge jsonb fields from existing row with new values.
 * For jsonb columns, deep-merge rather than overwrite.
 */
function mergeJsonbFields(existing, incoming) {
  const JSONB_COLUMNS = ['feedback_weights', 'topic_skip_counts', 'topic_affinity'];
  const merged = { ...incoming };

  for (const col of JSONB_COLUMNS) {
    if (!(col in incoming)) continue;

    let existingObj = {};
    let incomingObj = {};

    try {
      existingObj = typeof existing[col] === 'string'
        ? JSON.parse(existing[col] || '{}')
        : (existing[col] || {});
    } catch (_) { existingObj = {}; }

    try {
      incomingObj = typeof incoming[col] === 'string'
        ? JSON.parse(incoming[col] || '{}')
        : (incoming[col] || {});
    } catch (_) { incomingObj = {}; }

    merged[col] = JSON.stringify({ ...existingObj, ...incomingObj });
  }

  return merged;
}

module.exports = {
  upsertBehaviorProfile,
  getBehaviorProfile,
  ensureProfileExists,

  // Exported for testing
  buildDefaultProfile,
  mapStateToColumns,
};
