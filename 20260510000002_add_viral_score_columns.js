/**
 * Migration: Add viral score columns to question_stats
 * and behavior profile columns to user_behavior_state (K19/K22)
 *
 * question_stats:
 *   - viral_score (float, default 0)
 *   - viral_candidate (boolean, default false)
 *   - viral_score_updated_at (timestamp, nullable)
 *
 * user_behavior_state:
 *   - feedback_weights (jsonb, nullable)
 *   - topic_skip_counts (jsonb, nullable)
 *   - sessions_today (integer, default 0)
 *   - is_returning_user (boolean, default false)
 */
exports.up = async function (knex) {
  // ── 1. question_stats columns ──
  const hasQuestionStats = await knex.schema.hasTable('question_stats');
  if (hasQuestionStats) {
    const hasViralScore = await knex.schema.hasColumn('question_stats', 'viral_score');
    if (!hasViralScore) {
      await knex.schema.alterTable('question_stats', (table) => {
        table.float('viral_score').defaultTo(0);
      });
    }

    const hasViralCandidate = await knex.schema.hasColumn('question_stats', 'viral_candidate');
    if (!hasViralCandidate) {
      await knex.schema.alterTable('question_stats', (table) => {
        table.boolean('viral_candidate').defaultTo(false);
      });
    }

    const hasViralScoreUpdatedAt = await knex.schema.hasColumn('question_stats', 'viral_score_updated_at');
    if (!hasViralScoreUpdatedAt) {
      await knex.schema.alterTable('question_stats', (table) => {
        table.timestamp('viral_score_updated_at').nullable();
      });
    }

    // Indexes for viral score queries
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_question_stats_viral
        ON question_stats (viral_score DESC)
    `);
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_question_stats_candidate
        ON question_stats (viral_candidate)
        WHERE viral_candidate = TRUE
    `);
  }

  // ── 2. user_behavior_state columns ──
  const hasBehaviorState = await knex.schema.hasTable('user_behavior_state');
  if (hasBehaviorState) {
    const hasFeedbackWeights = await knex.schema.hasColumn('user_behavior_state', 'feedback_weights');
    if (!hasFeedbackWeights) {
      await knex.schema.alterTable('user_behavior_state', (table) => {
        table.jsonb('feedback_weights').nullable();
      });
    }

    const hasTopicSkipCounts = await knex.schema.hasColumn('user_behavior_state', 'topic_skip_counts');
    if (!hasTopicSkipCounts) {
      await knex.schema.alterTable('user_behavior_state', (table) => {
        table.jsonb('topic_skip_counts').nullable();
      });
    }

    const hasSessionsToday = await knex.schema.hasColumn('user_behavior_state', 'sessions_today');
    if (!hasSessionsToday) {
      await knex.schema.alterTable('user_behavior_state', (table) => {
        table.integer('sessions_today').defaultTo(0);
      });
    }

    const hasIsReturningUser = await knex.schema.hasColumn('user_behavior_state', 'is_returning_user');
    if (!hasIsReturningUser) {
      await knex.schema.alterTable('user_behavior_state', (table) => {
        table.boolean('is_returning_user').defaultTo(false);
      });
    }
  }
};

exports.down = async function (knex) {
  // Remove question_stats columns
  const hasQuestionStats = await knex.schema.hasTable('question_stats');
  if (hasQuestionStats) {
    const hasViralScore = await knex.schema.hasColumn('question_stats', 'viral_score');
    if (hasViralScore) {
      await knex.schema.alterTable('question_stats', (table) => {
        table.dropColumn('viral_score');
      });
    }

    const hasViralCandidate = await knex.schema.hasColumn('question_stats', 'viral_candidate');
    if (hasViralCandidate) {
      await knex.schema.alterTable('question_stats', (table) => {
        table.dropColumn('viral_candidate');
      });
    }

    const hasViralScoreUpdatedAt = await knex.schema.hasColumn('question_stats', 'viral_score_updated_at');
    if (hasViralScoreUpdatedAt) {
      await knex.schema.alterTable('question_stats', (table) => {
        table.dropColumn('viral_score_updated_at');
      });
    }
  }

  // Remove user_behavior_state columns
  const hasBehaviorState = await knex.schema.hasTable('user_behavior_state');
  if (hasBehaviorState) {
    const hasFeedbackWeights = await knex.schema.hasColumn('user_behavior_state', 'feedback_weights');
    if (hasFeedbackWeights) {
      await knex.schema.alterTable('user_behavior_state', (table) => {
        table.dropColumn('feedback_weights');
      });
    }

    const hasTopicSkipCounts = await knex.schema.hasColumn('user_behavior_state', 'topic_skip_counts');
    if (hasTopicSkipCounts) {
      await knex.schema.alterTable('user_behavior_state', (table) => {
        table.dropColumn('topic_skip_counts');
      });
    }

    const hasSessionsToday = await knex.schema.hasColumn('user_behavior_state', 'sessions_today');
    if (hasSessionsToday) {
      await knex.schema.alterTable('user_behavior_state', (table) => {
        table.dropColumn('sessions_today');
      });
    }

    const hasIsReturningUser = await knex.schema.hasColumn('user_behavior_state', 'is_returning_user');
    if (hasIsReturningUser) {
      await knex.schema.alterTable('user_behavior_state', (table) => {
        table.dropColumn('is_returning_user');
      });
    }
  }
};
