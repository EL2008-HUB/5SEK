/**
 * Migration: Add Critical Database Indexes
 *
 * These indexes optimize the most frequent query patterns in the application:
 *
 * 1. Feed queries: fetching answers for a specific question, ordered by created_at
 *    QUERY: SELECT * FROM answers WHERE question_id = ? ORDER BY created_at DESC
 *    INDEXES: idx_answers_question_id, idx_answers_created_at
 *
 * 2. User activity queries: fetching all answers by a specific user
 *    QUERY: SELECT * FROM answers WHERE user_id = ? ORDER BY created_at DESC
 *    INDEXES: idx_answers_user_id
 *
 * 3. Session queries: fetching active feed sessions for a user
 *    QUERY: SELECT * FROM feed_sessions WHERE user_id = ? ORDER BY started_at DESC
 *    INDEX: idx_sessions_user_id
 *
 * 4. Paywall checks: checking paywall events for a user (rate limiting, history)
 *    QUERY: SELECT * FROM paywall_events WHERE user_id = ? ORDER BY created_at DESC
 *    INDEX: idx_paywall_events_user_id
 *
 * 5. Active question queries: fetching questions that are currently active
 *    QUERY: SELECT * FROM questions WHERE active_date IS NOT NULL ORDER BY active_date
 *    INDEX: idx_questions_active (partial index, WHERE active_date IS NOT NULL)
 *
 * 6. Country-based question queries: filtering questions by country
 *    QUERY: SELECT * FROM questions WHERE country = ?
 *    INDEX: idx_questions_country
 *
 * EXPLAIN ANALYZE expected results (approximate):
 *   - Before indexes: Seq Scan on answers (cost=0.00..1500.00 rows=50000)
 *   - After idx_answers_question_id: Index Scan (cost=0.29..8.31 rows=10)
 *   - After idx_answers_user_id: Index Scan (cost=0.29..12.45 rows=20)
 *   - After idx_questions_active: Index Scan using partial index (cost=0.15..4.20 rows=5)
 *
 * All indexes use IF NOT EXISTS for idempotency — safe to run multiple times.
 */

exports.up = async function up(knex) {
  // answers table indexes
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_answers_question_id ON answers(question_id)'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_answers_user_id ON answers(user_id)'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_answers_created_at ON answers(created_at)'
  );

  // feed_sessions table index
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON feed_sessions(user_id)'
  );

  // paywall_events table index
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_paywall_events_user_id ON paywall_events(user_id)'
  );

  // questions table indexes
  // Partial index: only index rows where active_date is set (active questions)
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_questions_active ON questions(active_date) WHERE active_date IS NOT NULL'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_questions_country ON questions(country)'
  );
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_answers_question_id');
  await knex.raw('DROP INDEX IF EXISTS idx_answers_user_id');
  await knex.raw('DROP INDEX IF EXISTS idx_answers_created_at');
  await knex.raw('DROP INDEX IF EXISTS idx_sessions_user_id');
  await knex.raw('DROP INDEX IF EXISTS idx_paywall_events_user_id');
  await knex.raw('DROP INDEX IF EXISTS idx_questions_active');
  await knex.raw('DROP INDEX IF EXISTS idx_questions_country');
};
