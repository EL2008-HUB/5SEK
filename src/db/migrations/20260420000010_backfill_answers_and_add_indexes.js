const REACTION_PREFIXES = ["😳", "😂", "🤯", "😎"];

function decodeLegacyText(videoUrl) {
  if (typeof videoUrl !== "string" || !videoUrl.startsWith("text://")) {
    return null;
  }

  try {
    return decodeURIComponent(videoUrl.slice("text://".length));
  } catch (_) {
    return videoUrl.slice("text://".length);
  }
}

function inferAnswerType(text, currentType) {
  if (REACTION_PREFIXES.some((entry) => String(text || "").startsWith(entry))) {
    return "reaction";
  }

  if (["text", "reaction"].includes(currentType)) {
    return currentType;
  }

  return "text";
}

exports.up = async function up(knex) {
  await knex.schema.alterTable("answers", (table) => {
    table.index(["question_id", "created_at"], "idx_answers_question_created");
    table.index(["user_id", "created_at"], "idx_answers_user_created");
    table.index(["answer_type", "created_at"], "idx_answers_type_created");
  });

  await knex.schema.alterTable("duels", (table) => {
    table.index(["user_a_id", "status"], "idx_duels_user_a_status");
    table.index(["user_b_id", "status"], "idx_duels_user_b_status");
  });

  await knex.schema.alterTable("duel_votes", (table) => {
    table.index(["duel_id", "user_id"], "idx_duel_votes_duel_user");
  });

  await knex.schema.alterTable("questions", (table) => {
    table.index(["country", "active_date"], "idx_questions_country_active_date");
  });

  await knex.schema.alterTable("paywall_events", (table) => {
    table.index(["user_id", "created_at"], "idx_paywall_events_user_created");
    table.index(["event_type", "created_at"], "idx_paywall_events_type_created");
  });

  const textAnswers = await knex("answers")
    .select("id", "video_url", "answer_type", "text_content")
    .where(function whereLegacyText() {
      this.where("video_url", "like", "text://%")
        .orWhere(function whereMissingText() {
          this.whereIn("answer_type", ["text", "reaction"]);
          this.whereNull("text_content");
        });
    });

  for (const answer of textAnswers) {
    const decodedText = answer.text_content || decodeLegacyText(answer.video_url);
    if (!decodedText) continue;

    await knex("answers")
      .where({ id: answer.id })
      .update({
        answer_type: inferAnswerType(decodedText, answer.answer_type),
        text_content: decodedText,
        video_url: null,
      });
  }
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("answers", (table) => {
    table.dropIndex(["question_id", "created_at"], "idx_answers_question_created");
    table.dropIndex(["user_id", "created_at"], "idx_answers_user_created");
    table.dropIndex(["answer_type", "created_at"], "idx_answers_type_created");
  });

  await knex.schema.alterTable("duels", (table) => {
    table.dropIndex(["user_a_id", "status"], "idx_duels_user_a_status");
    table.dropIndex(["user_b_id", "status"], "idx_duels_user_b_status");
  });

  await knex.schema.alterTable("duel_votes", (table) => {
    table.dropIndex(["duel_id", "user_id"], "idx_duel_votes_duel_user");
  });

  await knex.schema.alterTable("questions", (table) => {
    table.dropIndex(["country", "active_date"], "idx_questions_country_active_date");
  });

  await knex.schema.alterTable("paywall_events", (table) => {
    table.dropIndex(["user_id", "created_at"], "idx_paywall_events_user_created");
    table.dropIndex(["event_type", "created_at"], "idx_paywall_events_type_created");
  });
};
