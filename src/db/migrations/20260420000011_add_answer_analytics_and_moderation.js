exports.up = async function (knex) {
  await knex.schema.alterTable("answers", (table) => {
    table.float("watch_time_total").notNullable().defaultTo(0);
    table.integer("completion_count").notNullable().defaultTo(0);
    table.integer("skip_count").notNullable().defaultTo(0);
  });

  await knex.schema.createTable("answer_events", (table) => {
    table.increments("id").primary();
    table.integer("answer_id").unsigned().references("id").inTable("answers").onDelete("CASCADE");
    table.integer("user_id").unsigned().references("id").inTable("users").onDelete("SET NULL");
    table.string("event_type").notNullable();
    table.float("watch_time").defaultTo(0);
    table.string("session_id").nullable();
    table.jsonb("metadata").nullable();
    table.timestamp("created_at").defaultTo(knex.fn.now());

    table.index(["answer_id", "created_at"], "idx_answer_events_answer_created");
    table.index(["event_type", "created_at"], "idx_answer_events_type_created");
  });

  await knex.schema.createTable("moderation_reports", (table) => {
    table.increments("id").primary();
    table.string("entity_type").notNullable();
    table.integer("entity_id").notNullable();
    table.integer("reporter_user_id").unsigned().references("id").inTable("users").onDelete("SET NULL");
    table.integer("reviewed_by_user_id").unsigned().references("id").inTable("users").onDelete("SET NULL");
    table.string("reason").notNullable();
    table.text("details").nullable();
    table.string("status").notNullable().defaultTo("pending");
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("reviewed_at").nullable();

    table.index(["status", "created_at"], "idx_moderation_reports_status_created");
    table.index(["entity_type", "entity_id"], "idx_moderation_reports_entity");
  });

  await knex.schema.createTable("moderation_actions", (table) => {
    table.increments("id").primary();
    table.integer("report_id").unsigned().references("id").inTable("moderation_reports").onDelete("CASCADE");
    table.integer("admin_user_id").unsigned().references("id").inTable("users").onDelete("SET NULL");
    table.string("action").notNullable();
    table.jsonb("metadata").nullable();
    table.timestamp("created_at").defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("moderation_actions");
  await knex.schema.dropTableIfExists("moderation_reports");
  await knex.schema.dropTableIfExists("answer_events");

  await knex.schema.alterTable("answers", (table) => {
    table.dropColumn("watch_time_total");
    table.dropColumn("completion_count");
    table.dropColumn("skip_count");
  });
};
