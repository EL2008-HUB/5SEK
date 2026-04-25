const { bootstrapEnv } = require("../src/config/bootstrapEnv");
bootstrapEnv(require("path").join(__dirname, ".."));

const db = require("../src/db/knex");
const { startBackgroundJobWorker } = require("../src/services/backgroundJobService");

const worker = startBackgroundJobWorker(db);

process.on("SIGINT", async () => {
  worker.stop();
  await db.destroy();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  worker.stop();
  await db.destroy();
  process.exit(0);
});
