exports.up = async function up(knex) {
  await knex.schema.createTable("push_tokens", (table) => {
    table.increments("id").primary();
    table.integer("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.string("provider", 32).notNullable().defaultTo("expo");
    table.string("token", 255).notNullable().unique();
    table.string("platform", 32).notNullable();
    table.string("device_id", 128);
    table.string("project_id", 128);
    table.string("app_version", 64);
    table.string("status", 32).notNullable().defaultTo("active");
    table.timestamp("last_seen_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("revoked_at");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.index(["user_id", "status"], "push_tokens_user_status_idx");
    table.index(["provider", "status"], "push_tokens_provider_status_idx");
  });

  await knex.schema.createTable("push_deliveries", (table) => {
    table.increments("id").primary();
    table.integer("background_job_id").references("id").inTable("background_jobs").onDelete("SET NULL");
    table.integer("user_id").references("id").inTable("users").onDelete("SET NULL");
    table.integer("push_token_id").references("id").inTable("push_tokens").onDelete("SET NULL");
    table.string("provider", 32).notNullable().defaultTo("expo");
    table.string("status", 32).notNullable().defaultTo("queued");
    table.string("ticket_id", 255);
    table.string("error_code", 128);
    table.text("error_message");
    table.string("title", 160);
    table.string("body", 512);
    table.jsonb("data");
    table.timestamp("delivered_at");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["background_job_id", "status"], "push_deliveries_job_status_idx");
    table.index(["user_id", "created_at"], "push_deliveries_user_created_idx");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("push_deliveries");
  await knex.schema.dropTableIfExists("push_tokens");
};
