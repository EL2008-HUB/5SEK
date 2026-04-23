const { bootstrapEnv } = require("./src/config/bootstrapEnv");
bootstrapEnv(__dirname);

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

const db = require("./src/db/knex");
const { createApp } = require("./src/app");
const { startBackgroundJobWorker } = require("./src/services/backgroundJobService");
const {
  shouldRunInlineBackgroundWorker,
  shouldRunInlineDuelWorker,
  shouldRunInlineInjectionWorker,
  startDuelScheduler,
  startInjectionScheduler,
} = require("./src/services/processBootstrap");

const app = createApp({ db });
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await db.migrate.latest();
    console.log("Database migrations up to date");
    let backgroundWorker = null;
    let duelScheduler = null;
    let injectionScheduler = null;

    if (shouldRunInlineBackgroundWorker()) {
      backgroundWorker = startBackgroundJobWorker(db);
      console.log("Inline background worker enabled");
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`5SEK API running on http://localhost:${PORT}`);
      console.log("Country system active");

      if (shouldRunInlineDuelWorker()) {
        duelScheduler = startDuelScheduler(db);
        console.log("Inline duel scheduler enabled");
      }

      if (shouldRunInlineInjectionWorker()) {
        injectionScheduler = startInjectionScheduler(db);
        console.log("Inline injection scheduler enabled");
      }

      const shutdown = async () => {
        backgroundWorker?.stop?.();
        duelScheduler?.stop?.();
        injectionScheduler?.stop?.();
        await db.destroy();
        process.exit(0);
      };

      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
};
