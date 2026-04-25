/**
 * Country-based localization system
 *
 * - users.country        — ISO 3166-1 alpha-2 (e.g. "AL", "US", "DE")
 * - questions.country    — target country for the question
 * - question_stats       — per-country engagement metrics (the core of the system)
 */
exports.up = function (knex) {
  return knex.schema
    .alterTable("users", (table) => {
      // ISO country code, defaults to GLOBAL for existing / undetected users
      table.string("country", 10).defaultTo("GLOBAL").notNullable();
      table.index("country", "idx_users_country");
    })
    .alterTable("questions", (table) => {
      // Which country this question targets (GLOBAL = fits everywhere)
      table.string("country", 10).defaultTo("GLOBAL").notNullable();
      table.index("country", "idx_questions_country");
    })
    .createTable("question_stats", (table) => {
      table.increments("id").primary();
      table
        .integer("question_id")
        .unsigned()
        .references("id")
        .inTable("questions")
        .onDelete("CASCADE");
      table.string("country", 10).notNullable().defaultTo("GLOBAL");
      table.integer("answers_count").defaultTo(0);
      table.integer("likes").defaultTo(0);
      table.integer("shares").defaultTo(0);
      table.integer("views").defaultTo(0);
      table.float("score").defaultTo(0);
      table.timestamp("updated_at").defaultTo(knex.fn.now());

      // One stats row per question × country
      table.unique(["question_id", "country"], {
        indexName: "uq_question_country",
      });
      table.index("score", "idx_qstats_score");
      table.index("country", "idx_qstats_country");
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists("question_stats")
    .alterTable("questions", (table) => {
      table.dropIndex("country", "idx_questions_country");
      table.dropColumn("country");
    })
    .alterTable("users", (table) => {
      table.dropIndex("country", "idx_users_country");
      table.dropColumn("country");
    });
};
