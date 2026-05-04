/**
 * Adds paywall_events table for tracking paywall interactions
 * and bonus_answers tracking for "second chance" feature
 */
exports.up = function (knex) {
  return knex.schema
    .createTable("paywall_events", (table) => {
      table.increments("id").primary();
      table.integer("user_id").unsigned().references("id").inTable("users").onDelete("CASCADE");
      table.string("event_type").notNullable(); // paywall_shown, paywall_clicked, paywall_closed, second_chance_used
      table.jsonb("metadata").nullable(); // Extra context (answers_used, screen, etc.)
      table.timestamp("created_at").defaultTo(knex.fn.now());
    })
    .alterTable("users", (table) => {
      // Track bonus answers earned (from watching ads, second chance, etc.)
      table.integer("bonus_answers_today").defaultTo(0);
      table.date("bonus_answers_date").nullable(); // Reset daily
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists("paywall_events")
    .alterTable("users", (table) => {
      table.dropColumn("bonus_answers_today");
      table.dropColumn("bonus_answers_date");
    });
};
