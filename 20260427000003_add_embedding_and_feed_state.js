/**
 * TikTok-level feed upgrade:
 * - feed_seen_state: server-side seen tracking (removes seenIds from cursor)
 * - user_embeddings: interest vectors per user (pseudo-ML)
 * - user_sessions: session-based feed adaptation
 */
exports.up = async function (knex) {
  // 1) Server-side seen state (replaces seenIds in cursor)
  await knex.schema.createTable("feed_seen_state", (table) => {
    table.increments("id").primary();
    table.integer("user_id").unsigned().notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.integer("answer_id").unsigned().notNullable();
    table.timestamp("seen_at").defaultTo(knex.fn.now());

    table.unique(["user_id", "answer_id"], { indexName: "idx_feed_seen_unique" });
    table.index(["user_id", "seen_at"], "idx_feed_seen_user_time");
  });

  // 2) User embeddings (interest vectors)
  await knex.schema.createTable("user_embeddings", (table) => {
    table.integer("user_id").unsigned().primary().references("id").inTable("users").onDelete("CASCADE");
    table.jsonb("interest_vector").notNullable().defaultTo("{}");
    table.jsonb("negative_vector").notNullable().defaultTo("{}");
    table.integer("total_interactions").notNullable().defaultTo(0);
    table.float("exploration_rate").notNullable().defaultTo(0.3); // starts high, decays
    table.timestamp("computed_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());
  });

  // 3) User feed sessions (for session-based adaptation)
  await knex.schema.createTable("feed_sessions", (table) => {
    table.increments("id").primary();
    table.integer("user_id").unsigned().notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.string("session_id", 64).notNullable();
    table.integer("items_seen").notNullable().defaultTo(0);
    table.integer("items_liked").notNullable().defaultTo(0);
    table.integer("items_skipped").notNullable().defaultTo(0);
    table.integer("items_shared").notNullable().defaultTo(0);
    table.float("session_exploration_rate").notNullable().defaultTo(0.3);
    table.timestamp("started_at").defaultTo(knex.fn.now());
    table.timestamp("last_activity_at").defaultTo(knex.fn.now());

    table.index(["user_id", "started_at"], "idx_feed_sessions_user");
    table.index("session_id", "idx_feed_sessions_sid");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("feed_sessions");
  await knex.schema.dropTableIfExists("user_embeddings");
  await knex.schema.dropTableIfExists("feed_seen_state");
};
