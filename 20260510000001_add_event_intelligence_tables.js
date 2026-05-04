/**
 * Event Intelligence Tables (K18)
 *
 * Adds three tables to support the Growth Signals Layer:
 *   - user_invite_graph: tracks invite relationships between users
 *   - retention_notifications: records push/notification sends for retention
 *   - feed_session_strategies: stores computed feed strategies per session
 */
exports.up = function (knex) {
  return knex.schema

    // ── 1. User Invite Graph ──
    .createTable('user_invite_graph', (table) => {
      table.increments('id').primary();
      table.integer('inviter_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      table.integer('invitee_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.string('invite_type').defaultTo('direct');

      table.index('inviter_id', 'idx_invite_graph_inviter');
      table.index('invitee_id', 'idx_invite_graph_invitee');
    })

    // ── 2. Retention Notifications ──
    .createTable('retention_notifications', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      table.string('message_type').notNullable();
      table.string('trigger_reason').notNullable();
      table.timestamp('sent_at').defaultTo(knex.fn.now());
      table.string('status').defaultTo('sent');

      table.index('user_id', 'idx_retention_notif_user');
      table.index(['user_id', 'sent_at'], 'idx_retention_notif_user_sent');
    })

    // ── 3. Feed Session Strategies ──
    .createTable('feed_session_strategies', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable();
      table.string('session_id').notNullable();
      table.string('strategy').notNullable();
      table.timestamp('computed_at').defaultTo(knex.fn.now());
      table.integer('event_count').defaultTo(0);

      table.index('user_id', 'idx_feed_strategy_user');
      table.index('session_id', 'idx_feed_strategy_session');
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('feed_session_strategies')
    .dropTableIfExists('retention_notifications')
    .dropTableIfExists('user_invite_graph');
};
