/**
 * Migration: Add Fusion Loop State table (v2 — count-based)
 *
 * FIX 2: Count-based tracking instead of binary flags
 * FIX 5: Timing intelligence columns
 */

exports.up = async function (knex) {
  await knex.schema.createTable("user_fusion_state", (table) => {
    table.increments("id").primary();
    table.integer("user_id").unsigned().notNullable().unique();
    table.integer("current_streak").defaultTo(0);
    table.integer("longest_streak").defaultTo(0);
    table.string("last_active_date", 10).nullable();
    table.integer("total_loop_completions").defaultTo(0);

    // FIX 2: Count-based (backward compat — boolean columns kept for DB queries)
    table.boolean("has_answered_today").defaultTo(false);
    table.boolean("has_remixed_today").defaultTo(false);
    table.boolean("has_commented_today").defaultTo(false);
    table.boolean("drop_joined_today").defaultTo(false);

    // FIX 5: Timing intelligence
    table.integer("avg_session_duration_sec").defaultTo(0);
    table.integer("total_sessions").defaultTo(0);

    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());

    table.index("user_id");
    table.index("current_streak");
    table.index("last_active_date");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("user_fusion_state");
};
