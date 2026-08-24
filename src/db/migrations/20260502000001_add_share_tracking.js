/**
 * Migration: Share Tracking + Creator Dopamine Stats
 *
 * Adds tables for:
 * - share_events: granular share tracking per platform
 * - creator_stats: real-time creator engagement (views, answers, shares)
 * - share_videos: generated share video metadata
 */
exports.up = async function (knex) {
  // Share events — granular per-platform tracking
  const hasShareEvents = await knex.schema.hasTable("share_events");
  if (!hasShareEvents) {
    await knex.schema.createTable("share_events", (table) => {
      table.increments("id").primary();
      table.integer("answer_id").unsigned().notNullable();
      table.integer("user_id").unsigned().nullable();
      table.string("event_type", 50).notNullable(); // share_export, share_open, answer_from_share
      table.string("platform", 30).nullable(); // tiktok, instagram, whatsapp, generic
      table.string("session_id", 100).nullable();
      table.jsonb("metadata").nullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());

      table.index(["answer_id", "event_type"]);
      table.index(["user_id", "created_at"]);
      table.index("event_type");
    });
  }

  // Creator stats — real-time dopamine counters
  const hasCreatorStats = await knex.schema.hasTable("creator_stats");
  if (!hasCreatorStats) {
    await knex.schema.createTable("creator_stats", (table) => {
      table.increments("id").primary();
      table.integer("answer_id").unsigned().notNullable().unique();
      table.integer("user_id").unsigned().notNullable();

      // Real counters
      table.integer("real_views").unsigned().defaultTo(0);
      table.integer("real_answers").unsigned().defaultTo(0);
      table.integer("real_shares").unsigned().defaultTo(0);
      table.integer("real_likes").unsigned().defaultTo(0);

      // Displayed counters (real + boost)
      table.integer("display_views").unsigned().defaultTo(0);
      table.integer("display_answers").unsigned().defaultTo(0);

      table.timestamp("last_activity_at").nullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").defaultTo(knex.fn.now());

      table.index("user_id");
      table.index("answer_id");
    });
  }

  // Share videos — metadata for generated share assets
  const hasShareVideos = await knex.schema.hasTable("share_videos");
  if (!hasShareVideos) {
    await knex.schema.createTable("share_videos", (table) => {
      table.increments("id").primary();
      table.integer("answer_id").unsigned().notNullable();
      table.integer("user_id").unsigned().nullable();
      table.string("video_url", 500).nullable();
      table.string("status", 30).defaultTo("pending"); // pending, processing, ready, failed
      table.string("question_text", 500).nullable();
      table.jsonb("overlay_config").nullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("completed_at").nullable();

      table.index("answer_id");
      table.index("status");
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("share_videos");
  await knex.schema.dropTableIfExists("creator_stats");
  await knex.schema.dropTableIfExists("share_events");
};
