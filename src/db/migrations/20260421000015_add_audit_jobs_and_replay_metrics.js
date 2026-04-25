exports.up = async function up(knex) {
  await knex.schema.alterTable("answers", (table) => {
    table.integer("replay_count").notNullable().defaultTo(0);
    table.integer("abuse_score").notNullable().defaultTo(0);
    table.boolean("requires_human_review").notNullable().defaultTo(false);
    table.jsonb("moderation_labels").nullable();
    table.index(["requires_human_review", "created_at"], "answers_human_review_created_idx");
  });

  await knex.schema.createTable("admin_audit_logs", (table) => {
    table.increments("id").primary();
    table.integer("admin_user_id").unsigned().references("id").inTable("users").onDelete("SET NULL");
    table.string("action").notNullable();
    table.string("entity_type").nullable();
    table.integer("entity_id").nullable();
    table.jsonb("metadata").nullable();
    table.string("ip_address", 64).nullable();
    table.string("user_agent").nullable();
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.index(["admin_user_id", "created_at"], "admin_audit_logs_admin_created_idx");
    table.index(["action", "created_at"], "admin_audit_logs_action_created_idx");
  });

  await knex.schema.createTable("background_jobs", (table) => {
    table.increments("id").primary();
    table.string("job_type").notNullable();
    table.jsonb("payload").nullable();
    table.jsonb("result").nullable();
    table.string("status").notNullable().defaultTo("queued");
    table.timestamp("run_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("locked_at").nullable();
    table.string("locked_by").nullable();
    table.integer("attempts").notNullable().defaultTo(0);
    table.integer("max_attempts").notNullable().defaultTo(5);
    table.text("last_error").nullable();
    table.string("dedupe_key").nullable().unique();
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());
    table.timestamp("completed_at").nullable();
    table.index(["status", "run_at"], "background_jobs_status_run_at_idx");
    table.index(["job_type", "created_at"], "background_jobs_type_created_idx");
  });

  await knex.schema.createTable("analytics_daily_rollups", (table) => {
    table.increments("id").primary();
    table.date("day").notNullable();
    table.string("rollup_key").notNullable().unique();
    table.string("scope").notNullable();
    table.integer("entity_id").nullable();
    table.string("country").nullable();
    table.jsonb("metrics").notNullable().defaultTo("{}");
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());
    table.index(["day", "scope"], "analytics_daily_rollups_day_scope_idx");
    table.index(["country", "day"], "analytics_daily_rollups_country_day_idx");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("analytics_daily_rollups");
  await knex.schema.dropTableIfExists("background_jobs");
  await knex.schema.dropTableIfExists("admin_audit_logs");

  await knex.schema.alterTable("answers", (table) => {
    table.dropIndex(["requires_human_review", "created_at"], "answers_human_review_created_idx");
    table.dropColumn("moderation_labels");
    table.dropColumn("requires_human_review");
    table.dropColumn("abuse_score");
    table.dropColumn("replay_count");
  });
};
