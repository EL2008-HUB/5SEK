/**
 * Adds response_time to answers, is_premium to users for monetization + instant reward
 */
exports.up = function (knex) {
  return knex.schema
    .alterTable("answers", (table) => {
      // How fast they answered (seconds, e.g. 4.2 = answered in 4.2s out of 5s)
      table.float("response_time").nullable();
    })
    .alterTable("users", (table) => {
      // Premium status for monetization
      table.boolean("is_premium").defaultTo(false);
    });
};

exports.down = function (knex) {
  return knex.schema
    .alterTable("answers", (table) => {
      table.dropColumn("response_time");
    })
    .alterTable("users", (table) => {
      table.dropColumn("is_premium");
    });
};
