/**
 * Adds viral scoring system:
 * - questions: category, performance_score, answers_count, total_views, total_likes, total_shares, source
 * - answers: likes, shares, views
 */
exports.up = function (knex) {
  return knex.schema
    .alterTable("questions", (table) => {
      table.string("category").defaultTo("general").notNullable();
      table.float("performance_score").defaultTo(0);
      table.integer("answers_count").defaultTo(0);
      table.integer("total_views").defaultTo(0);
      table.integer("total_likes").defaultTo(0);
      table.integer("total_shares").defaultTo(0);
      // "seed" | "ai" | "manual"
      table.string("source").defaultTo("seed");
      table.index("performance_score", "idx_performance_score");
      table.index("category", "idx_category");
    })
    .alterTable("answers", (table) => {
      table.integer("likes").defaultTo(0);
      table.integer("shares").defaultTo(0);
      table.integer("views").defaultTo(0);
    });
};

exports.down = function (knex) {
  return knex.schema
    .alterTable("questions", (table) => {
      table.dropIndex("performance_score", "idx_performance_score");
      table.dropIndex("category", "idx_category");
      table.dropColumn("category");
      table.dropColumn("performance_score");
      table.dropColumn("answers_count");
      table.dropColumn("total_views");
      table.dropColumn("total_likes");
      table.dropColumn("total_shares");
      table.dropColumn("source");
    })
    .alterTable("answers", (table) => {
      table.dropColumn("likes");
      table.dropColumn("shares");
      table.dropColumn("views");
    });
};
