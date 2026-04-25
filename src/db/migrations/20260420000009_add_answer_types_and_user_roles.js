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

function inferLegacyAnswerType(text) {
  if (!text) return "text";
  return REACTION_PREFIXES.some((entry) => text.startsWith(entry)) ? "reaction" : "text";
}

exports.up = async function up(knex) {
  await knex.schema.alterTable("answers", (table) => {
    table.string("answer_type").notNullable().defaultTo("video");
    table.text("text_content").nullable();
  });

  await knex.schema.alterTable("answers", (table) => {
    table.text("video_url").nullable().alter();
  });

  await knex.schema.alterTable("users", (table) => {
    table.string("role").notNullable().defaultTo("user");
  });

  const legacyTextAnswers = await knex("answers")
    .select("id", "video_url")
    .where("video_url", "like", "text://%");

  for (const answer of legacyTextAnswers) {
    const decodedText = decodeLegacyText(answer.video_url);
    if (!decodedText) continue;

    await knex("answers")
      .where({ id: answer.id })
      .update({
        answer_type: inferLegacyAnswerType(decodedText),
        text_content: decodedText,
        video_url: null,
      });
  }
};

exports.down = async function down(knex) {
  const textAnswers = await knex("answers")
    .select("id", "answer_type", "text_content", "video_url")
    .whereIn("answer_type", ["text", "reaction"]);

  for (const answer of textAnswers) {
    const payloadText = typeof answer.text_content === "string" && answer.text_content.trim()
      ? answer.text_content.trim()
      : null;

    await knex("answers")
      .where({ id: answer.id })
      .update({
        video_url: payloadText ? `text://${encodeURIComponent(payloadText)}` : answer.video_url || "legacy://removed",
      });
  }

  await knex("answers")
    .whereNull("video_url")
    .update({ video_url: "legacy://removed" });

  await knex.schema.alterTable("answers", (table) => {
    table.text("video_url").notNullable().alter();
    table.dropColumn("text_content");
    table.dropColumn("answer_type");
  });

  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("role");
  });
};
