/**
 * Seed a minimal, known-good dataset for local manual testing.
 *
 * Creates a test login, guarantees today's daily question exists for GLOBAL and
 * AL, and attaches a couple of answers so feed/share/comment screens have
 * something to render.
 *
 * Idempotent: safe to re-run. Development only.
 *
 * Usage: node scripts/seed-dev-data.js   (or: npm run seed:dev)
 *
 * Run "npx knex seed:run" first to populate the question bank.
 */

const path = require("path");
const bcrypt = require("bcryptjs");

const { bootstrapEnv } = require("../src/config/bootstrapEnv");

bootstrapEnv(path.join(__dirname, ".."));

if (process.env.NODE_ENV === "production" || process.env.APP_ENV === "production") {
  console.error("[seed:dev] Refusing to run against a production environment.");
  process.exit(1);
}

const knexConfig = require("../knexfile");
const knex = require("knex")(knexConfig.development);

const TEST_USER = {
  username: "devtester",
  email: "dev@5sek.local",
  password: "DevPassword123!",
  country: "AL",
};

const ANSWER_TEXTS = [
  "The one that played on the drive home, windows down.",
  "A song my dad used to hum. I hear it everywhere now.",
];

const today = new Date().toISOString().slice(0, 10);

async function upsertTestUser() {
  const existing = await knex("users").where({ email: TEST_USER.email }).first();
  if (existing) {
    return existing;
  }

  const [user] = await knex("users")
    .insert({
      username: TEST_USER.username,
      email: TEST_USER.email,
      password: await bcrypt.hash(TEST_USER.password, 10),
      country: TEST_USER.country,
    })
    .returning(["id", "username", "email", "country"]);

  return user;
}

/** The daily endpoint looks up questions by (is_daily, active_date, country). */
async function ensureDailyQuestion(country) {
  const existing = await knex("questions")
    .where({ is_daily: true, active_date: today, country })
    .whereNull("deleted_at")
    .first();

  if (existing) {
    return existing;
  }

  const candidate = await knex("questions")
    .where({ country })
    .whereNull("deleted_at")
    .orderBy("performance_score", "desc")
    .first();

  if (!candidate) {
    throw new Error(`No questions for country ${country}. Run "npx knex seed:run" first.`);
  }

  const [updated] = await knex("questions")
    .where({ id: candidate.id })
    .update({ is_daily: true, active_date: today })
    .returning(["id", "text", "country"]);

  return updated;
}

async function ensureAnswers(userId, questionId) {
  const existing = await knex("answers").where({ question_id: questionId }).count({ n: "*" }).first();
  if (Number(existing.n) > 0) {
    return Number(existing.n);
  }

  await knex("answers").insert(
    ANSWER_TEXTS.map((text, index) => ({
      user_id: userId,
      question_id: questionId,
      answer_type: "text",
      text_content: text,
      response_time: 3.2 + index,
      likes: 5 - index,
      views: 40 - index * 10,
    }))
  );

  return ANSWER_TEXTS.length;
}

async function main() {
  const user = await upsertTestUser();
  const global = await ensureDailyQuestion("GLOBAL");
  const albania = await ensureDailyQuestion("AL");
  const answerCount = await ensureAnswers(user.id, global.id);

  const totals = await knex
    .select(
      knex.raw("(select count(*) from users) as users"),
      knex.raw("(select count(*) from questions) as questions"),
      knex.raw("(select count(*) from answers) as answers")
    )
    .first();

  console.log("[seed:dev] test login");
  console.log(`  email:    ${TEST_USER.email}`);
  console.log(`  password: ${TEST_USER.password}`);
  console.log(`[seed:dev] daily question ${today} GLOBAL: #${global.id}`);
  console.log(`[seed:dev] daily question ${today} AL:     #${albania.id}`);
  console.log(`[seed:dev] answers on GLOBAL daily: ${answerCount}`);
  console.log(`[seed:dev] totals — users: ${totals.users}, questions: ${totals.questions}, answers: ${totals.answers}`);
}

main()
  .catch((error) => {
    console.error(`[seed:dev] FAILED: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => knex.destroy());
