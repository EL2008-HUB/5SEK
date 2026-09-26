/**
 * Duel hardening:
 * - duel_queue: users waiting for an opponent on a question (auto-matched later)
 * - video urls become nullable (text / reaction answers have no media)
 * - one active duel per user pair per question (race-safe)
 * - vote lookups by user
 */
exports.up = async function up(knex) {
  const hasQueue = await knex.schema.hasTable("duel_queue");
  if (!hasQueue) {
    await knex.schema.createTable("duel_queue", (table) => {
      table.increments("id").primary();
      table
        .integer("user_id")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("users")
        .onDelete("CASCADE");
      table
        .integer("question_id")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("questions")
        .onDelete("CASCADE");
      table
        .integer("answer_id")
        .unsigned()
        .nullable()
        .references("id")
        .inTable("answers")
        .onDelete("CASCADE");
      table.string("status").notNullable().defaultTo("waiting"); // waiting | matched | cancelled | expired
      table
        .integer("duel_id")
        .unsigned()
        .nullable()
        .references("id")
        .inTable("duels")
        .onDelete("SET NULL");
      table.integer("attempts").notNullable().defaultTo(0);
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").defaultTo(knex.fn.now());
      table.timestamp("expires_at").nullable();
      table.timestamp("matched_at").nullable();

      table.index(["question_id", "status", "created_at"], "duel_queue_question_status_idx");
      table.index(["user_id", "status"], "duel_queue_user_status_idx");
    });

    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS duel_queue_waiting_unique
      ON duel_queue (user_id, question_id)
      WHERE status = 'waiting'
    `);
  }

  await knex.raw("ALTER TABLE duels ALTER COLUMN video_a_url DROP NOT NULL");
  await knex.raw("ALTER TABLE duels ALTER COLUMN video_b_url DROP NOT NULL");

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS duels_active_pair_unique
    ON duels (question_id, LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id))
    WHERE status = 'active'
  `);

  await knex.raw("CREATE INDEX IF NOT EXISTS idx_duels_user_a_status ON duels(user_a_id, status)");
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_duels_user_b_status ON duels(user_b_id, status)");
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_votes_user ON duel_votes(user_id)");
};

exports.down = async function down(knex) {
  await knex.raw("DROP INDEX IF EXISTS idx_votes_user");
  await knex.raw("DROP INDEX IF EXISTS idx_duels_user_b_status");
  await knex.raw("DROP INDEX IF EXISTS idx_duels_user_a_status");
  await knex.raw("DROP INDEX IF EXISTS duels_active_pair_unique");
  await knex.raw("UPDATE duels SET video_a_url = '' WHERE video_a_url IS NULL");
  await knex.raw("UPDATE duels SET video_b_url = '' WHERE video_b_url IS NULL");
  await knex.raw("ALTER TABLE duels ALTER COLUMN video_a_url SET NOT NULL");
  await knex.raw("ALTER TABLE duels ALTER COLUMN video_b_url SET NOT NULL");
  await knex.raw("DROP INDEX IF EXISTS duel_queue_waiting_unique");
  await knex.schema.dropTableIfExists("duel_queue");
};
