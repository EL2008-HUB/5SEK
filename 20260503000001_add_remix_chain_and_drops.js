/**
 * Adds Remix Chain columns to answers + Live Question Drops to questions
 *
 * Remix Chain: parent_answer_id, chain_depth on answers
 * Live Drops:  scheduled_drop_time on questions, plus drop_participants table
 */
exports.up = function (knex) {
  return knex.schema

    // ── 1. Remix Chain columns on answers ──
    .alterTable("answers", (table) => {
      table.integer("parent_answer_id").unsigned().nullable()
        .references("id").inTable("answers").onDelete("SET NULL");
      table.integer("chain_depth").defaultTo(0).notNullable();
      table.boolean("is_remix").defaultTo(false).notNullable();

      table.index("parent_answer_id", "idx_parent_answer");
      table.index("chain_depth", "idx_chain_depth");
      table.index("is_remix", "idx_is_remix");
    })

    // ── 2. Scheduled drop time on questions ──
    .alterTable("questions", (table) => {
      table.timestamp("scheduled_drop_time").nullable();
      table.boolean("is_drop").defaultTo(false).notNullable();
      table.string("drop_status", 20).defaultTo("pending").notNullable(); // pending | active | completed

      table.index("scheduled_drop_time", "idx_drop_time");
      table.index("is_drop", "idx_is_drop");
      table.index("drop_status", "idx_drop_status");
    })

    // ── 3. Drop participants tracking table ──
    .createTable("drop_participants", (table) => {
      table.increments("id").primary();
      table.integer("question_id").unsigned().notNullable()
        .references("id").inTable("questions").onDelete("CASCADE");
      table.integer("user_id").unsigned().notNullable()
        .references("id").inTable("users").onDelete("CASCADE");
      table.integer("answer_id").unsigned().nullable()
        .references("id").inTable("answers").onDelete("SET NULL");
      table.timestamp("joined_at").defaultTo(knex.fn.now());
      table.timestamp("answered_at").nullable();

      table.unique(["question_id", "user_id"]);
      table.index("question_id", "idx_drop_part_question");
      table.index("user_id", "idx_drop_part_user");
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists("drop_participants")
    .alterTable("questions", (table) => {
      table.dropIndex("", "idx_drop_time");
      table.dropIndex("", "idx_is_drop");
      table.dropIndex("", "idx_drop_status");
      table.dropColumn("scheduled_drop_time");
      table.dropColumn("is_drop");
      table.dropColumn("drop_status");
    })
    .alterTable("answers", (table) => {
      table.dropIndex("", "idx_parent_answer");
      table.dropIndex("", "idx_chain_depth");
      table.dropIndex("", "idx_is_remix");
      table.dropColumn("parent_answer_id");
      table.dropColumn("chain_depth");
      table.dropColumn("is_remix");
    });
};
