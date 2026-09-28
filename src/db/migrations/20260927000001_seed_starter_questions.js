/**
 * Fresh deployments start with an empty questions table, which makes
 * /api/questions/daily return 404. Seed a starter set only when empty.
 */
const STARTER_QUESTIONS = require("../starterQuestions.json");

exports.up = async function up(knex) {
  const row = await knex("questions").count("* as n").first();
  if (Number(row?.n || 0) > 0) return;

  await knex("questions").insert(
    STARTER_QUESTIONS.map((question) => ({ ...question, source: "starter" }))
  );
};

exports.down = async function down(knex) {
  await knex("questions")
    .where({ source: "starter" })
    .whereNotExists(knex("answers").select(1).whereRaw("answers.question_id = questions.id"))
    .del();
};
