/**
 * Migration: Admin Panel, KPI Tracking, and Support Infrastructure
 */

async function hasColumns(knex, tableName, columns) {
  for (const column of columns) {
    const exists = await knex.schema.hasColumn(tableName, column);
    if (!exists) {
      return false;
    }
  }

  return true;
}

async function createIndexIfColumnsExist(knex, tableName, columns, indexName, sql) {
  const canCreate = await hasColumns(knex, tableName, columns);
  if (!canCreate) {
    return;
  }

  await knex.raw(sql);
}

exports.up = async function(knex) {
  // 1. Admin users table extension
  await knex.raw(`
    UPDATE users
    SET role = 'user'
    WHERE role IS NULL
      OR role NOT IN ('user', 'moderator', 'admin', 'super_admin')
  `);

  await knex.raw(`
    ALTER TABLE users
    ALTER COLUMN role SET DEFAULT 'user'
  `);

  await knex.raw(`
    ALTER TABLE users
    ALTER COLUMN role SET NOT NULL
  `);

  await knex.raw(`
    ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check
  `);

  await knex.raw(`
    ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('user', 'moderator', 'admin', 'super_admin'))
  `);

  await knex.schema.alterTable('users', (table) => {
    table.boolean('is_admin').defaultTo(false).index();
    table.timestamp('admin_since');
    table.jsonb('admin_permissions'); // ['moderate', 'analytics', 'users', 'content']
  });

  await knex('users')
    .whereIn('role', ['moderator', 'admin', 'super_admin'])
    .update({
      is_admin: true,
      admin_since: knex.raw('COALESCE(admin_since, created_at, NOW())'),
      admin_permissions: knex.raw(`
        CASE
          WHEN role = 'moderator' THEN '["moderate"]'::jsonb
          WHEN role IN ('admin', 'super_admin') THEN '["moderate","analytics","users","content"]'::jsonb
          ELSE admin_permissions
        END
      `)
    });

  // 2. KPI Tracking - User retention
  await knex.schema.createTable('user_retention', (table) => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.date('first_seen_date').notNullable().index();
    table.date('retention_date').notNullable();
    table.enum('retention_type', ['d1', 'd7', 'd30', 'd90']).notNullable();
    table.boolean('returned').defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.unique(['user_id', 'retention_type']);
    table.index(['first_seen_date', 'retention_type']);
  });

  // 3. KPI Tracking - Session analytics
  await knex.schema.createTable('session_analytics', (table) => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('SET NULL');
    table.string('session_id', 64).notNullable().index();
    table.timestamp('started_at').defaultTo(knex.fn.now());
    table.timestamp('ended_at');
    table.integer('duration_seconds');
    table.integer('screens_viewed').defaultTo(0);
    table.integer('answers_created').defaultTo(0);
    table.integer('feed_items_viewed').defaultTo(0);
    table.integer('duels_participated').defaultTo(0);
    table.string('country', 10).index();
    table.jsonb('features_used'); // ['record', 'feed', 'duel', 'profile']
    table.timestamps(true, true);
    
    table.index(['user_id', 'started_at']);
    table.index(['country', 'started_at']);
  });

  // 4. KPI Tracking - Answer completion funnel
  await knex.schema.createTable('answer_funnel', (table) => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('SET NULL');
    table.integer('question_id').references('id').inTable('questions').onDelete('SET NULL');
    table.string('session_id', 64).index();
    table.enum('stage', ['started', 'recorded', 'previewed', 'published', 'discarded']).notNullable();
    table.timestamp('reached_at').defaultTo(knex.fn.now());
    table.integer('time_in_stage_seconds');
    table.string('abandoned_reason'); // 'user_cancel', 'timeout', 'error'
    table.timestamps(true, true);
    
    table.index(['user_id', 'question_id', 'stage']);
  });

  // 5. KPI Tracking - Paywall analytics
  await knex.schema.createTable('paywall_analytics', (table) => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('SET NULL');
    table.enum('event_type', ['shown', 'clicked', 'closed', 'converted', 'dismissed']).notNullable();
    table.string('trigger_context'); // 'feed_limit', 'duel_limit', 'premium_feature'
    table.timestamp('event_at').defaultTo(knex.fn.now());
    table.jsonb('metadata');
    table.timestamps(true, true);
    
    table.index(['user_id', 'event_type']);
    table.index(['event_at']);
  });

  // 6. Daily Questions Management
  await knex.schema.createTable('daily_questions_schedule', (table) => {
    table.increments('id').primary();
    table.integer('question_id').references('id').inTable('questions').onDelete('CASCADE');
    table.date('scheduled_for').notNullable().index();
    table.string('country', 10).defaultTo('GLOBAL').index();
    table.enum('status', ['draft', 'scheduled', 'active', 'completed', 'cancelled']).defaultTo('draft');
    table.integer('priority').defaultTo(0); // Higher = more important
    table.timestamp('activated_at');
    table.timestamp('deactivated_at');
    table.integer('created_by_admin').references('id').inTable('users');
    table.jsonb('performance_metrics'); // views, answers, engagement
    table.timestamps(true, true);
    
    table.unique(['scheduled_for', 'country']);
  });

  // 7. Hot Questions / Trending
  await knex.schema.createTable('trending_questions', (table) => {
    table.increments('id').primary();
    table.integer('question_id').references('id').inTable('questions').onDelete('CASCADE');
    table.float('trending_score').notNullable().index();
    table.integer('views_last_hour').defaultTo(0);
    table.integer('answers_last_hour').defaultTo(0);
    table.integer('engagement_rate').defaultTo(0); // Percentage
    table.string('country', 10).defaultTo('GLOBAL').index();
    table.timestamp('calculated_at').defaultTo(knex.fn.now());
    table.timestamp('expires_at');
    table.timestamps(true, true);
    
    table.index(['country', 'trending_score']);
  });

  // 8. Support Tickets
  await knex.schema.createTable('support_tickets', (table) => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('SET NULL');
    table.enum('category', ['report_content', 'report_user', 'account_issue', 'billing', 'bug', 'feature_request', 'other']).notNullable();
    table.enum('priority', ['low', 'medium', 'high', 'urgent']).defaultTo('medium');
    table.enum('status', ['open', 'in_progress', 'waiting_user', 'resolved', 'closed']).defaultTo('open');
    table.text('subject').notNullable();
    table.text('description').notNullable();
    table.jsonb('reported_content'); // {type: 'answer', id: 123}
    table.integer('assigned_to').references('id').inTable('users'); // Admin/Moderator
    table.timestamp('resolved_at');
    table.text('resolution_notes');
    table.timestamps(true, true);
    
    table.index(['status', 'priority']);
    table.index(['user_id', 'created_at']);
    table.index(['category', 'status']);
  });

  // 9. Content Reports
  await knex.schema.createTable('content_reports', (table) => {
    table.increments('id').primary();
    table.integer('reporter_id').references('id').inTable('users').onDelete('SET NULL');
    table.enum('content_type', ['answer', 'question', 'user_profile', 'comment']).notNullable();
    table.integer('content_id').notNullable();
    table.enum('reason', ['spam', 'harassment', 'hate_speech', 'violence', 'sexual_content', 'copyright', 'misinformation', 'other']).notNullable();
    table.text('details');
    table.enum('status', ['pending', 'under_review', 'action_taken', 'dismissed']).defaultTo('pending');
    table.integer('reviewed_by').references('id').inTable('users');
    table.enum('action_taken', ['none', 'content_removed', 'user_warned', 'user_banned', 'escalated']);
    table.timestamp('reviewed_at');
    table.timestamps(true, true);
    
    table.index(['content_type', 'content_id']);
    table.index(['status', 'created_at']);
  });

  // 10. User Bans/Warnings
  await knex.schema.createTable('user_moderation_actions', (table) => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.enum('action_type', ['warning', 'temporary_ban', 'permanent_ban', 'content_removal', 'strike']).notNullable();
    table.text('reason').notNullable();
    table.integer('duration_hours'); // For temporary bans
    table.timestamp('expires_at'); // When ban expires
    table.integer('issued_by').references('id').inTable('users').notNullable();
    table.boolean('appealable').defaultTo(true);
    table.text('appeal_response');
    table.enum('appeal_status', ['none', 'pending', 'approved', 'denied']);
    table.timestamps(true, true);
    
    table.index(['user_id', 'action_type']);
    table.index(['expires_at']);
  });

  // 11. Refund Requests
  await knex.schema.createTable('refund_requests', (table) => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.string('stripe_payment_intent_id');
    table.decimal('amount', 10, 2).notNullable();
    table.string('currency', 3).defaultTo('USD');
    table.enum('reason', ['accidental_purchase', 'unsatisfied', 'technical_issue', 'not_as_described', 'other']).notNullable();
    table.text('details');
    table.enum('status', ['pending', 'approved', 'denied', 'processed']).defaultTo('pending');
    table.integer('reviewed_by').references('id').inTable('users');
    table.text('admin_notes');
    table.timestamp('processed_at');
    table.timestamps(true, true);
    
    table.index(['user_id', 'status']);
    table.index(['stripe_payment_intent_id']);
  });

  // 12. Country Content Rules
  await knex.schema.createTable('country_content_rules', (table) => {
    table.increments('id').primary();
    table.string('country_code', 10).notNullable().unique().index();
    table.boolean('app_available').defaultTo(true);
    table.integer('min_age').defaultTo(13);
    table.boolean('requires_age_verification').defaultTo(false);
    table.jsonb('blocked_keywords'); // Array of banned words
    table.jsonb('allowed_content_types').defaultTo(JSON.stringify(['video', 'audio', 'text']));
    table.boolean('duels_enabled').defaultTo(true);
    table.boolean('paywall_enabled').defaultTo(true);
    table.jsonb('custom_settings'); // Country-specific settings
    table.timestamps(true, true);
  });

  // 13. Feature Flags
  await knex.schema.createTable('feature_flags', (table) => {
    table.increments('id').primary();
    table.string('feature_key', 100).notNullable().unique().index();
    table.text('description');
    table.enum('status', ['disabled', 'beta', 'gradual_rollout', 'enabled']).defaultTo('disabled');
    table.integer('rollout_percentage').defaultTo(0); // 0-100
    table.jsonb('target_countries'); // ['US', 'GB']
    table.jsonb('target_user_segments'); // ['premium', 'new_users']
    table.timestamp('enabled_at');
    table.timestamp('disabled_at');
    table.integer('created_by').references('id').inTable('users');
    table.timestamps(true, true);
  });

  // 14. User Feature Assignments
  await knex.schema.createTable('user_feature_assignments', (table) => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.integer('feature_flag_id').references('id').inTable('feature_flags').onDelete('CASCADE');
    table.enum('status', ['enabled', 'disabled', 'control_group']).defaultTo('enabled');
    table.timestamp('assigned_at').defaultTo(knex.fn.now());
    table.timestamps(true, true);
    
    table.unique(['user_id', 'feature_flag_id']);
  });

  // 15. GDPR / Data Export
  await knex.schema.createTable('data_export_requests', (table) => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.enum('status', ['pending', 'processing', 'ready', 'downloaded', 'expired']).defaultTo('pending');
    table.enum('export_type', ['full', 'answers_only', 'account_only']).defaultTo('full');
    table.string('download_url');
    table.timestamp('expires_at');
    table.timestamp('processed_at');
    table.timestamps(true, true);
    
    table.index(['user_id', 'status']);
  });

  // 16. Admin Activity Log
  await knex.schema.createTable('admin_activity_log', (table) => {
    table.increments('id').primary();
    table.integer('admin_id').references('id').inTable('users').onDelete('SET NULL');
    table.enum('action_type', ['user_ban', 'content_remove', 'question_schedule', 'refund_approve', 'feature_toggle', 'other']).notNullable();
    table.text('description');
    table.jsonb('metadata'); // Details of the action
    table.string('ip_address', 45);
    table.string('user_agent');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.index(['admin_id', 'created_at']);
    table.index(['action_type', 'created_at']);
  });

  // 17. Content Views (for watch time tracking)
  await knex.schema.createTable('content_views', (table) => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('SET NULL');
    table.enum('content_type', ['answer', 'question', 'duel']).notNullable();
    table.integer('content_id').notNullable();
    table.integer('duration_seconds').defaultTo(0);
    table.integer('completion_percentage').defaultTo(0);
    table.string('country', 10).index();
    table.timestamp('viewed_at').defaultTo(knex.fn.now());
    
    table.index(['content_type', 'content_id']);
    table.index(['user_id', 'viewed_at']);
    table.index(['country', 'viewed_at']);
  });

  // 18. User Consents (GDPR/privacy)
  await knex.schema.createTable('user_consents', (table) => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE').unique();
    table.boolean('analytics_consent').defaultTo(false);
    table.boolean('marketing_consent').defaultTo(false);
    table.boolean('third_party_consent').defaultTo(false);
    table.timestamp('consented_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index(['analytics_consent']);
  });

  // Add indexes for performance
  await createIndexIfColumnsExist(
    knex,
    'answers',
    ['user_id', 'created_at'],
    'idx_answers_user_created',
    'CREATE INDEX IF NOT EXISTS idx_answers_user_created ON answers(user_id, created_at DESC)'
  );
  await createIndexIfColumnsExist(
    knex,
    'answers',
    ['question_id', 'created_at'],
    'idx_answers_question_created',
    'CREATE INDEX IF NOT EXISTS idx_answers_question_created ON answers(question_id, created_at DESC)'
  );
  await createIndexIfColumnsExist(
    knex,
    'answers',
    ['country', 'created_at'],
    'idx_answers_country_created',
    'CREATE INDEX IF NOT EXISTS idx_answers_country_created ON answers(country, created_at DESC)'
  );
  await createIndexIfColumnsExist(
    knex,
    'answers',
    ['answer_type', 'created_at'],
    'idx_answers_type_created',
    'CREATE INDEX IF NOT EXISTS idx_answers_type_created ON answers(answer_type, created_at DESC)'
  );
  await createIndexIfColumnsExist(
    knex,
    'questions',
    ['country', 'created_at'],
    'idx_questions_country_created',
    'CREATE INDEX IF NOT EXISTS idx_questions_country_created ON questions(country, created_at DESC)'
  );
  await createIndexIfColumnsExist(
    knex,
    'users',
    ['country', 'role'],
    'idx_users_country_role',
    'CREATE INDEX IF NOT EXISTS idx_users_country_role ON users(country, role)'
  );
  await createIndexIfColumnsExist(
    knex,
    'users',
    ['created_at'],
    'idx_users_created_at',
    'CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC)'
  );
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('user_consents');
  await knex.schema.dropTableIfExists('content_views');
  await knex.schema.dropTableIfExists('admin_activity_log');
  await knex.schema.dropTableIfExists('data_export_requests');
  await knex.schema.dropTableIfExists('user_feature_assignments');
  await knex.schema.dropTableIfExists('feature_flags');
  await knex.schema.dropTableIfExists('country_content_rules');
  await knex.schema.dropTableIfExists('refund_requests');
  await knex.schema.dropTableIfExists('user_moderation_actions');
  await knex.schema.dropTableIfExists('content_reports');
  await knex.schema.dropTableIfExists('support_tickets');
  await knex.schema.dropTableIfExists('trending_questions');
  await knex.schema.dropTableIfExists('daily_questions_schedule');
  await knex.schema.dropTableIfExists('paywall_analytics');
  await knex.schema.dropTableIfExists('answer_funnel');
  await knex.schema.dropTableIfExists('session_analytics');
  await knex.schema.dropTableIfExists('user_retention');
  
  await knex.schema.alterTable('users', (table) => {
    table.dropColumns('is_admin', 'admin_since', 'admin_permissions');
  });

  await knex.raw(`
    ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check
  `);

  await knex.raw(`
    UPDATE users
    SET role = 'user'
    WHERE role IS NULL
  `);
};
