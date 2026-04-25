/**
 * Creates users, questions, and answers tables
 */
exports.up = function (knex) {
  return knex.schema
    .createTable("users", (table) => {
      table.increments("id").primary();
      table.string("username").notNullable().unique();
      table.string("email").notNullable().unique();
      table.string("password").notNullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());
    })
    .createTable("questions", (table) => {
      table.increments("id").primary();
      table.text("text").notNullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());
    })
    .createTable("answers", (table) => {
      table.increments("id").primary();
      table
        .integer("user_id")
        .unsigned()
        .references("id")
        .inTable("users")
        .onDelete("CASCADE");
      table
        .integer("question_id")
        .unsigned()
        .references("id")
        .inTable("questions")
        .onDelete("CASCADE");
      table.text("video_url").notNullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists("answers")
    .dropTableIfExists("questions")
    .dropTableIfExists("users");
};
