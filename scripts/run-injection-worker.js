const { bootstrapEnv } = require("../src/config/bootstrapEnv");
bootstrapEnv(require("path").join(__dirname, ".."));

const db = require("../src/db/knex");
const { startInjectionScheduler } = require("../src/services/processBootstrap");

const scheduler = startInjectionScheduler(db, {
  initialDelayMs: Number(process.env.INJECTION_INITIAL_DELAY_MS || 0),
});

async function shutdown() {
  scheduler.stop();
  await db.destroy();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
