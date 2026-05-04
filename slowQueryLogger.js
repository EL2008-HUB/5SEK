/**
 * Slow Query Logger
 * Attaches Knex event hooks to detect and log queries that exceed a duration threshold.
 * SQL parameter values are stripped before logging to protect PII.
 */

/**
 * Sanitizes a SQL string by replacing bound parameter values with '?' placeholders.
 * The Knex query object already uses '?' as placeholders in the sql property,
 * so this function ensures no inline values are present.
 *
 * @param {string} sql - The SQL string from the Knex query object
 * @returns {string} - Sanitized SQL with only structural placeholders
 */
function sanitizeSql(sql) {
  if (!sql || typeof sql !== 'string') return '';
  // Replace any inline literal values that may have been interpolated.
  // Knex typically uses '?' placeholders, but we strip string literals and numbers
  // to be safe and ensure no PII leaks.
  return sql
    // Remove single-quoted string literals (e.g., 'some value')
    .replace(/'[^']*'/g, '?')
    // Remove double-quoted identifiers that look like values (numeric-only)
    .replace(/\b\d+(\.\d+)?\b/g, '?')
    .trim();
}

/**
 * Attaches slow query logging hooks to a Knex instance.
 *
 * @param {import('knex').Knex} knexInstance - The Knex instance to attach hooks to
 * @param {number} [thresholdMs=1000] - Duration threshold in milliseconds; queries
 *   taking >= this value will be logged as warnings
 * @returns {import('knex').Knex} - The same knex instance (for chaining)
 */
function attachSlowQueryLogger(knexInstance, thresholdMs = 1000) {
  // Map from queryUid → start timestamp (ms)
  const queryStartTimes = new Map();

  knexInstance.on('query', (queryData) => {
    const uid = queryData.__knexQueryUid;
    if (uid != null) {
      queryStartTimes.set(uid, Date.now());
    }
  });

  knexInstance.on('query-response', (_response, queryData) => {
    const uid = queryData.__knexQueryUid;
    if (uid == null) return;

    const startTime = queryStartTimes.get(uid);
    if (startTime == null) return;

    // Clean up the map entry to avoid memory leaks
    queryStartTimes.delete(uid);

    const duration = Date.now() - startTime;
    if (duration >= thresholdMs) {
      const sanitized = sanitizeSql(queryData.sql);
      console.warn('[slow-query]', {
        duration_ms: duration,
        threshold_ms: thresholdMs,
        sql: sanitized,
        bindings_count: Array.isArray(queryData.bindings) ? queryData.bindings.length : 0,
      });
    }
  });

  return knexInstance;
}

module.exports = { attachSlowQueryLogger, sanitizeSql };
