/**
 * Migration: user_behavior_state — Cold persistence for behavior engine
 */
exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("user_behavior_state");
  if (exists) return;

  await knex.schema.createTable("user_behavior_state", (table) => {
    table.integer("user_id").unsigned().primary();
    table.float("engagement_score").defaultTo(0);
    table.float("growth_score").defaultTo(0);
    table.float("retention_score").defaultTo(0);
    table.float("scroll_speed").defaultTo(0);
    table.float("skip_rate").defaultTo(0);
    table.float("dwell_time").defaultTo(0);
    table.text("topic_affinity").defaultTo("{}");
    table.integer("total_sessions").defaultTo(0);
    table.timestamp("last_active").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());

    table.index("engagement_score");
    table.index("last_active");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("user_behavior_state");
};
