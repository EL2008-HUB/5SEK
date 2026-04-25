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

const PORT = process.env.PORT || 3000;
const startupState = {
  phase: "booting",
  ready: false,
  startedAt: new Date().toISOString(),
  readyAt: null,
  error: null,
};
const app = createApp({ db, startupState });

function updateStartupState(patch) {
  Object.assign(startupState, patch);
}

async function startServer() {
  let backgroundWorker = null;
  let duelScheduler = null;
  let injectionScheduler = null;
  let server = null;

  try {
    updateStartupState({ phase: "binding_port" });

    server = await new Promise((resolve, reject) => {
      const createdServer = app.listen(PORT, "0.0.0.0", () => {
        console.log(`5SEK API listening on 0.0.0.0:${PORT}`);
        console.log("Startup state: waiting for migrations");
        resolve(createdServer);
      });

      createdServer.on("error", reject);
    });

    const shutdown = async () => {
      backgroundWorker?.stop?.();
      duelScheduler?.stop?.();
      injectionScheduler?.stop?.();
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await db.destroy();
      process.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    updateStartupState({ phase: "running_migrations" });
    await db.migrate.latest();
    console.log("Database migrations up to date");

    if (shouldRunInlineBackgroundWorker()) {
      backgroundWorker = startBackgroundJobWorker(db);
      console.log("Inline background worker enabled");
    }

    if (shouldRunInlineDuelWorker()) {
      duelScheduler = startDuelScheduler(db);
      console.log("Inline duel scheduler enabled");
    }

    if (shouldRunInlineInjectionWorker()) {
      injectionScheduler = startInjectionScheduler(db);
      console.log("Inline injection scheduler enabled");
    }

    updateStartupState({
      phase: "ready",
      ready: true,
      readyAt: new Date().toISOString(),
    });
    console.log("Country system active");
    console.log("Startup state: ready");
  } catch (error) {
    updateStartupState({
      phase: "failed",
      ready: false,
      error: error.message,
    });
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
