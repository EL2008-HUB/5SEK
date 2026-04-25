const { bootstrapEnv } = require("../src/config/bootstrapEnv");
bootstrapEnv(require("path").join(__dirname, ".."));

const path = require("path");
const knexConfig = require("../knexfile");
const environment = process.env.APP_ENV && knexConfig[process.env.APP_ENV]
  ? process.env.APP_ENV
  : process.env.NODE_ENV === "production"
  ? "production"
  : "development";

const db = require("knex")(knexConfig[environment]);

(async () => {
  const [completed, pending] = await db.migrate.list();
  console.log(JSON.stringify({
    environment,
    completed,
    pending,
  }, null, 2));
  await db.destroy();
})().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
