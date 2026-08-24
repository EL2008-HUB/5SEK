2/**
 * Migration: Analytics event log + daily metrics tables
 * For offline analytics, replay, and A/B testing results
 */
exports.up = function (knex) {
  return knex.schema
    .createTable("events_log", (table) => {
      table.bigIncrements("id").primary();
      table.integer("user_id").unsigned().nullable();
      table.string("event_type", 50).notNullable();
      table.string("entity_type", 30).nullable();
      table.integer("entity_id").unsigned().nullable();
      table.string("session_id", 50).nullable();
      table.string("ab_bucket", 50).nullable();
      table.jsonb("metadata").nullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());

      table.index(["user_id", "created_at"]);
      table.index(["event_type", "created_at"]);
      table.index(["entity_id", "event_type"]);
    })
    .createTable("daily_metrics", (table) => {
      table.increments("id").primary();
      table.date("date").notNullable();
      table.float("avg_session_length").defaultTo(0);
      table.float("avg_scroll_depth").defaultTo(0);
      table.float("exploration_success").defaultTo(0);
      table.float("distribution_score").defaultTo(0);
      table.integer("total_sessions").defaultTo(0);
      table.integer("active_users").defaultTo(0);
      table.integer("new_users").defaultTo(0);
      table.integer("returning_users").defaultTo(0);
      table.jsonb("feed_weights").nullable();
      table.jsonb("ab_results").nullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());

      table.unique("date");
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists("daily_metrics")
    .dropTableIfExists("events_log");
};
