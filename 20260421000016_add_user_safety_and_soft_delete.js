exports.up = async function up(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.boolean("is_blocked").notNullable().defaultTo(false);
    table.timestamp("blocked_at").nullable();
    table.text("blocked_reason").nullable();
    table.timestamp("deleted_at").nullable();
    table
      .integer("deleted_by_user_id")
      .unsigned()
      .nullable()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table.text("delete_reason").nullable();
    table.index(["deleted_at", "is_blocked"], "users_deleted_blocked_idx");
  });

  await knex.schema.alterTable("questions", (table) => {
    table.timestamp("deleted_at").nullable();
    table
      .integer("deleted_by_user_id")
      .unsigned()
      .nullable()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table.text("delete_reason").nullable();
    table.index(["deleted_at", "country"], "questions_deleted_country_idx");
  });

  await knex.schema.alterTable("answers", (table) => {
    table.timestamp("deleted_at").nullable();
    table
      .integer("deleted_by_user_id")
      .unsigned()
      .nullable()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table.index(["deleted_at", "user_id"], "answers_deleted_user_idx");
  });

  await knex.schema.createTable("user_blocks", (table) => {
    table.increments("id").primary();
    table
      .integer("blocker_user_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table
      .integer("blocked_user_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.unique(["blocker_user_id", "blocked_user_id"], {
      indexName: "user_blocks_unique_pair",
    });
    table.index(["blocker_user_id", "created_at"], "user_blocks_blocker_created_idx");
    table.index(["blocked_user_id", "created_at"], "user_blocks_blocked_created_idx");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("user_blocks");

  await knex.schema.alterTable("answers", (table) => {
    table.dropIndex(["deleted_at", "user_id"], "answers_deleted_user_idx");
    table.dropColumn("deleted_by_user_id");
    table.dropColumn("deleted_at");
  });

  await knex.schema.alterTable("questions", (table) => {
    table.dropIndex(["deleted_at", "country"], "questions_deleted_country_idx");
    table.dropColumn("delete_reason");
    table.dropColumn("deleted_by_user_id");
    table.dropColumn("deleted_at");
  });

  await knex.schema.alterTable("users", (table) => {
    table.dropIndex(["deleted_at", "is_blocked"], "users_deleted_blocked_idx");
    table.dropColumn("delete_reason");
    table.dropColumn("deleted_by_user_id");
    table.dropColumn("deleted_at");
    table.dropColumn("blocked_reason");
    table.dropColumn("blocked_at");
    table.dropColumn("is_blocked");
  });
};
