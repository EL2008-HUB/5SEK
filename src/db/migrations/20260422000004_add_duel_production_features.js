exports.up = async function up(knex) {
  const hasAnswerAId = await knex.schema.hasColumn("duels", "answer_a_id");
  const hasAnswerBId = await knex.schema.hasColumn("duels", "answer_b_id");
  const hasExpiresAt = await knex.schema.hasColumn("duels", "expires_at");
  const hasUpdatedAt = await knex.schema.hasColumn("duels", "updated_at");

  await knex.schema.alterTable("duels", (table) => {
    if (!hasAnswerAId) {
      table
        .integer("answer_a_id")
        .unsigned()
        .nullable()
        .references("id")
        .inTable("answers")
        .onDelete("SET NULL");
    }

    if (!hasAnswerBId) {
      table
        .integer("answer_b_id")
        .unsigned()
        .nullable()
        .references("id")
        .inTable("answers")
        .onDelete("SET NULL");
    }

    if (!hasExpiresAt) {
      table.timestamp("expires_at").nullable();
    }

    if (!hasUpdatedAt) {
      table.timestamp("updated_at").defaultTo(knex.fn.now());
    }
  });

  await knex.raw(`
    UPDATE duels
    SET
      answer_a_id = COALESCE(
        answer_a_id,
        (
          SELECT a.id
          FROM answers a
          WHERE a.question_id = duels.question_id
            AND a.user_id = duels.user_a_id
            AND a.video_url = duels.video_a_url
            AND a.deleted_at IS NULL
          ORDER BY a.created_at DESC
          LIMIT 1
        )
      ),
      answer_b_id = COALESCE(
        answer_b_id,
        (
          SELECT a.id
          FROM answers a
          WHERE a.question_id = duels.question_id
            AND a.user_id = duels.user_b_id
            AND a.video_url = duels.video_b_url
            AND a.deleted_at IS NULL
          ORDER BY a.created_at DESC
          LIMIT 1
        )
      ),
      expires_at = COALESCE(expires_at, created_at + interval '24 hours'),
      updated_at = COALESCE(updated_at, created_at)
  `);

  await knex.raw("CREATE INDEX IF NOT EXISTS idx_duels_status ON duels(status)");
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_duels_question ON duels(question_id)");
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_duels_expires_active ON duels(status, expires_at)");
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_duels_answer_a ON duels(answer_a_id)");
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_duels_answer_b ON duels(answer_b_id)");
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_votes_duel ON duel_votes(duel_id)");
};

exports.down = async function down(knex) {
  await knex.raw("DROP INDEX IF EXISTS idx_votes_duel");
  await knex.raw("DROP INDEX IF EXISTS idx_duels_answer_b");
  await knex.raw("DROP INDEX IF EXISTS idx_duels_answer_a");
  await knex.raw("DROP INDEX IF EXISTS idx_duels_expires_active");
  await knex.raw("DROP INDEX IF EXISTS idx_duels_question");
  await knex.raw("DROP INDEX IF EXISTS idx_duels_status");

  const hasAnswerAId = await knex.schema.hasColumn("duels", "answer_a_id");
  const hasAnswerBId = await knex.schema.hasColumn("duels", "answer_b_id");
  const hasExpiresAt = await knex.schema.hasColumn("duels", "expires_at");
  const hasUpdatedAt = await knex.schema.hasColumn("duels", "updated_at");

  await knex.schema.alterTable("duels", (table) => {
    if (hasAnswerAId) {
      table.dropColumn("answer_a_id");
    }

    if (hasAnswerBId) {
      table.dropColumn("answer_b_id");
    }

    if (hasExpiresAt) {
      table.dropColumn("expires_at");
    }

    if (hasUpdatedAt) {
      table.dropColumn("updated_at");
    }
  });
};
