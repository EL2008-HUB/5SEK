/**
 * Adds user-submitted questions system:
 * - user_questions table for community-generated content
 * - daily_question_count + last_question_date on users for rate limiting
 * - Indexes for feed ranking and moderation queries
 */
exports.up = function (knex) {
  return knex.schema
    .createTable("user_questions", (table) => {
      table.increments("id").primary();
      table
        .integer("user_id")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("users")
        .onDelete("CASCADE");
      table.text("text").notNullable();
      table
        .string("status", 20)
        .notNullable()
        .defaultTo("pending")
        .comment("pending | approved | rejected");
      table.string("country", 10).notNullable().defaultTo("GLOBAL");
      table.string("category", 64).defaultTo("general");
      table.integer("answers_count").notNullable().defaultTo(0);
      table.integer("likes").notNullable().defaultTo(0);
      table.integer("shares").notNullable().defaultTo(0);
      table.float("score").notNullable().defaultTo(0);
      table.boolean("is_boosted").notNullable().defaultTo(false);
      table.timestamp("boosted_at").nullable();
      table.string("moderation_reason").nullable();
      table.specificType("moderation_labels", "text[]").nullable();
      table.float("abuse_score").notNullable().defaultTo(0);
      table.boolean("requires_human_review").notNullable().defaultTo(false);
      table.timestamp("deleted_at").nullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").defaultTo(knex.fn.now());

      // Indexes for common queries
      table.index(["status", "country", "score"], "idx_uq_feed");
      table.index(["user_id", "created_at"], "idx_uq_user_history");
      table.index(["is_boosted", "score"], "idx_uq_boosted");
      table.index("created_at", "idx_uq_recency");
    })
    .then(() =>
      knex.schema.alterTable("users", (table) => {
        table.integer("daily_question_count").notNullable().defaultTo(0);
        table.date("last_question_date").nullable();
      })
    );
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists("user_questions")
    .then(() =>
      knex.schema.alterTable("users", (table) => {
        table.dropColumn("daily_question_count");
        table.dropColumn("last_question_date");
      })
    );
};
