/**
 * Migration: Add comments table
 */
exports.up = async function (knex) {
  await knex.schema.createTable("comments", (table) => {
    table.increments("id").primary();
    table.integer("answer_id").unsigned().notNullable();
    table.integer("user_id").unsigned().notNullable();
    table.text("text").notNullable();
    table.integer("parent_id").unsigned().nullable(); // reply support
    table.integer("likes").defaultTo(0);
    table.boolean("is_deleted").defaultTo(false);
    table.timestamp("created_at").defaultTo(knex.fn.now());

    table.index("answer_id");
    table.index("user_id");
    table.index("parent_id");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("comments");
};
