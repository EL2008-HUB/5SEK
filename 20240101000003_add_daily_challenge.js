/**
 * Adds daily challenge fields to questions table
 */
exports.up = function (knex) {
  return knex.schema.alterTable("questions", (table) => {
    table.boolean("is_daily").defaultTo(false);
    table.date("active_date").nullable();
    table.index(["is_daily", "active_date"], "idx_daily_question");
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable("questions", (table) => {
    table.dropIndex(["is_daily", "active_date"], "idx_daily_question");
    table.dropColumn("active_date");
    table.dropColumn("is_daily");
  });
};
