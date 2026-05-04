/**
 * Adds personalization system:
 * - user_preferences table: learned taste profile per user
 * - Index on answer_events.user_id for fast preference learning queries
 */
exports.up = async function (knex) {
  await knex.schema.createTable("user_preferences", (table) => {
    table.integer("user_id").unsigned().primary().references("id").inTable("users").onDelete("CASCADE");

    // Learned taste profile (auto-updated from behavior)
    table.jsonb("favorite_tags").notNullable().defaultTo("[]");
    table.jsonb("favorite_categories").notNullable().defaultTo("[]");
    table.jsonb("skip_categories").notNullable().defaultTo("[]");

    // Behavioral signals (aggregated)
    table.float("avg_watch_pct").notNullable().defaultTo(0);        // average % of video watched
    table.float("avg_session_duration").notNullable().defaultTo(0); // avg seconds per session
    table.integer("total_completions").notNullable().defaultTo(0);
    table.integer("total_skips").notNullable().defaultTo(0);
    table.integer("total_likes").notNullable().defaultTo(0);
    table.integer("total_shares").notNullable().defaultTo(0);
    table.integer("total_replays").notNullable().defaultTo(0);

    // Engagement pattern
    table.string("preferred_answer_type", 20).nullable();           // video / audio / text
    table.float("preferred_response_time_max").nullable();          // they like fast or slow?
    table.string("peak_hour", 5).nullable();                        // HH:MM when most active

    // Last computation timestamp
    table.timestamp("computed_at").defaultTo(knex.fn.now());
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());
  });

  // Add user_id index on answer_events for faster preference queries
  const hasIndex = await knex.schema.raw(`
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'answer_events' 
    AND indexname = 'idx_answer_events_user_created'
  `);

  if (hasIndex.rows.length === 0) {
    await knex.schema.alterTable("answer_events", (table) => {
      table.index(["user_id", "created_at"], "idx_answer_events_user_created");
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("user_preferences");

  const hasIndex = await knex.schema.raw(`
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'answer_events' 
    AND indexname = 'idx_answer_events_user_created'
  `);

  if (hasIndex.rows.length > 0) {
    await knex.schema.alterTable("answer_events", (table) => {
      table.dropIndex(["user_id", "created_at"], "idx_answer_events_user_created");
    });
  }
};
