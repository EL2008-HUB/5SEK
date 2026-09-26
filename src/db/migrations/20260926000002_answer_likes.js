/**
 * Per-user answer likes so feed "voting" is idempotent:
 * - one like per (answer, user), toggleable
 * - feed can report liked_by_me
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable("answer_likes");
  if (hasTable) return;

  await knex.schema.createTable("answer_likes", (table) => {
    table.increments("id").primary();
    table
      .integer("answer_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("answers")
      .onDelete("CASCADE");
    table
      .integer("user_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.unique(["answer_id", "user_id"], { indexName: "answer_likes_answer_user_unique" });
    table.index(["user_id"], "idx_answer_likes_user");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("answer_likes");
};
