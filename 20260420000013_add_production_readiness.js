exports.up = async function up(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.string("stripe_customer_id").nullable().unique();
    table.string("subscription_status").notNullable().defaultTo("free");
    table.string("premium_source").nullable();
    table.timestamp("premium_started_at").nullable();
    table.timestamp("premium_expires_at").nullable();
  });

  await knex.schema.alterTable("answers", (table) => {
    table.string("storage_provider").notNullable().defaultTo("app");
    table.text("storage_public_id").nullable();
    table.string("moderation_status").notNullable().defaultTo("approved");
    table.text("moderation_reason").nullable();
    table.index(["moderation_status", "created_at"], "answers_moderation_created_idx");
  });

  await knex.schema.createTable("auth_refresh_tokens", (table) => {
    table.increments("id").primary();
    table.integer("user_id").unsigned().references("id").inTable("users").onDelete("CASCADE");
    table.string("token_hash", 128).notNullable().unique();
    table.timestamp("expires_at").notNullable();
    table.timestamp("revoked_at").nullable();
    table.timestamp("last_used_at").nullable();
    table.integer("replaced_by_token_id").unsigned().nullable();
    table.string("user_agent").nullable();
    table.string("ip_address", 64).nullable();
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.index(["user_id", "revoked_at"], "refresh_tokens_user_revoked_idx");
  });

  await knex.schema.createTable("client_events", (table) => {
    table.increments("id").primary();
    table.integer("user_id").unsigned().references("id").inTable("users").onDelete("SET NULL");
    table.string("event_type").notNullable();
    table.string("screen").nullable();
    table.jsonb("metadata").nullable();
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.index(["event_type", "created_at"], "client_events_type_created_idx");
    table.index(["user_id", "created_at"], "client_events_user_created_idx");
  });

  await knex.schema.createTable("payment_events", (table) => {
    table.increments("id").primary();
    table.string("provider").notNullable().defaultTo("stripe");
    table.string("provider_event_id").notNullable().unique();
    table.string("event_type").notNullable();
    table.jsonb("payload").nullable();
    table.timestamp("processed_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("experiment_assignments", (table) => {
    table.increments("id").primary();
    table.integer("user_id").unsigned().references("id").inTable("users").onDelete("CASCADE");
    table.string("experiment_key").notNullable();
    table.string("variant").notNullable();
    table.timestamp("assigned_at").defaultTo(knex.fn.now());
    table.unique(["user_id", "experiment_key"], {
      indexName: "experiment_assignments_user_key_uq",
    });
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("experiment_assignments");
  await knex.schema.dropTableIfExists("payment_events");
  await knex.schema.dropTableIfExists("client_events");
  await knex.schema.dropTableIfExists("auth_refresh_tokens");

  await knex.schema.alterTable("answers", (table) => {
    table.dropIndex(["moderation_status", "created_at"], "answers_moderation_created_idx");
    table.dropColumn("moderation_reason");
    table.dropColumn("moderation_status");
    table.dropColumn("storage_public_id");
    table.dropColumn("storage_provider");
  });

  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("premium_expires_at");
    table.dropColumn("premium_started_at");
    table.dropColumn("premium_source");
    table.dropColumn("subscription_status");
    table.dropColumn("stripe_customer_id");
  });
};
