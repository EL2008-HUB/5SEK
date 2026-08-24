/**
 * Event Pipeline v2 — Production Hardening
 *
 * FIX 1: event_id unique column for dedup
 * UPGRADE 2: answer_metrics aggregation table
 * FIX position: add position to client_events
 */
exports.up = async function (knex) {
  // FIX 1: Add event_id column + unique index for dedup
  const hasEventId = await knex.schema.hasColumn("client_events", "event_id");
  if (!hasEventId) {
    await knex.schema.alterTable("client_events", (table) => {
      table.string("event_id", 36).nullable();
      table.integer("position").nullable(); // FIX 2: feed position
    });

    // Unique index — prevents duplicate events from retries
    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_client_events_event_id
      ON client_events(event_id)
      WHERE event_id IS NOT NULL
    `);
  }

  // UPGRADE 2: Real-time aggregation table
  const hasMetrics = await knex.schema.hasTable("answer_metrics");
  if (!hasMetrics) {
    await knex.schema.createTable("answer_metrics", (table) => {
      table.integer("answer_id").unsigned().primary();
      table.integer("views_24h").defaultTo(0);
      table.integer("completes_24h").defaultTo(0);
      table.integer("skips_24h").defaultTo(0);
      table.integer("likes_24h").defaultTo(0);
      table.integer("shares_24h").defaultTo(0);
      table.integer("replays_24h").defaultTo(0);
      table.float("avg_watch_time").defaultTo(0);
      table.float("total_watch_time").defaultTo(0);
      table.float("completion_rate").defaultTo(0);
      table.float("skip_rate").defaultTo(0);
      table.float("engagement_score").defaultTo(0);
      table.timestamp("last_aggregated_at").defaultTo(knex.fn.now());
      table.timestamp("created_at").defaultTo(knex.fn.now());

      table.index("engagement_score");
      table.index("completion_rate");
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("answer_metrics");

  const hasEventId = await knex.schema.hasColumn("client_events", "event_id");
  if (hasEventId) {
    await knex.schema.alterTable("client_events", (table) => {
      table.dropColumn("event_id");
      table.dropColumn("position");
    });
  }
};
