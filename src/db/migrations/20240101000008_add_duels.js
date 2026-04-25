/**
 * ⚔️ DUEL SYSTEM
 * - duels: challenges between two users on the same question
 * - duel_votes: one vote per user per duel
 */
exports.up = async function (knex) {
  await knex.schema.createTable("duels", (table) => {
    table.increments("id").primary();
    table
      .integer("question_id")
      .unsigned()
      .references("id")
      .inTable("questions")
      .onDelete("CASCADE");
    table
      .integer("user_a_id")
      .unsigned()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table
      .integer("user_b_id")
      .unsigned()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.text("video_a_url").notNullable();
    table.text("video_b_url").notNullable();
    table.integer("votes_a").defaultTo(0);
    table.integer("votes_b").defaultTo(0);
    table.string("status").defaultTo("active"); // active | finished
    table.string("winner").nullable(); // 'A' | 'B' | 'tie'
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("finished_at").nullable();

    table.index(["status", "created_at"]);
    table.index("question_id");
  });

  await knex.schema.createTable("duel_votes", (table) => {
    table.increments("id").primary();
    table
      .integer("duel_id")
      .unsigned()
      .references("id")
      .inTable("duels")
      .onDelete("CASCADE");
    table
      .integer("user_id")
      .unsigned()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.string("vote").notNullable(); // 'A' or 'B'
    table.timestamp("created_at").defaultTo(knex.fn.now());

    table.unique(["duel_id", "user_id"]); // one vote per user per duel
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("duel_votes");
  await knex.schema.dropTableIfExists("duels");
};
