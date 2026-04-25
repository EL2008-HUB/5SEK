const { bootstrapEnv } = require("../src/config/bootstrapEnv");
bootstrapEnv(require("path").join(__dirname, ".."));

const bcrypt = require("bcryptjs");
const db = require("../src/db/knex");

if ((process.env.APP_ENV || "") !== "staging" && process.env.ALLOW_STAGING_SEED !== "true") {
  throw new Error("seed-staging is restricted to APP_ENV=staging or ALLOW_STAGING_SEED=true");
}

const QUESTIONS = [
  { text: "What is your least popular opinion right now?", country: "GLOBAL", category: "opinion", source: "staging_seed" },
  { text: "What would you do with 5 free seconds?", country: "US", category: "funny", source: "staging_seed" },
  { text: "Cila eshte gjeja me e paperseritshme qe ke bere?", country: "AL", category: "personal", source: "staging_seed" },
];

(async () => {
  const password = await bcrypt.hash("staging-pass-123", 10);

  await db.transaction(async (trx) => {
    await trx("answers").whereIn("user_id", trx("users").select("id").where("email", "like", "%@staging.5sek.app")).del();
    await trx("auth_refresh_tokens").whereIn("user_id", trx("users").select("id").where("email", "like", "%@staging.5sek.app")).del();
    await trx("push_tokens").whereIn("user_id", trx("users").select("id").where("email", "like", "%@staging.5sek.app")).del();
    await trx("users").where("email", "like", "%@staging.5sek.app").del();
    await trx("questions").where({ source: "staging_seed" }).del();

    const [admin] = await trx("users").insert({
      username: "staging_admin",
      email: "admin@staging.5sek.app",
      password,
      country: "US",
      role: "admin",
    }).returning("*");

    const [creator] = await trx("users").insert({
      username: "staging_creator",
      email: "creator@staging.5sek.app",
      password,
      country: "AL",
      role: "user",
    }).returning("*");

    const insertedQuestions = await trx("questions").insert(QUESTIONS).returning("*");

    console.log(JSON.stringify({
      admin_id: admin.id,
      creator_id: creator.id,
      question_ids: insertedQuestions.map((row) => row.id),
    }, null, 2));
  });

  await db.destroy();
})().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
