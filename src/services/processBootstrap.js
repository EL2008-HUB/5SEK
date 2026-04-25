const { runInjectionCycle } = require("./injectionEngine");
const { createDatabaseBackoffController } = require("./dbResilience");
const { closeExpiredDuels } = require("./duelService");

function readBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true";
}

function shouldRunInlineBackgroundWorker() {
  return readBooleanEnv("INLINE_BACKGROUND_WORKER", process.env.NODE_ENV !== "production");
}

function shouldRunInlineInjectionWorker() {
  return readBooleanEnv("INLINE_INJECTION_WORKER", process.env.NODE_ENV !== "production");
}

function shouldRunInlineDuelWorker() {
  return readBooleanEnv("INLINE_DUEL_WORKER", process.env.NODE_ENV !== "production");
}

function startInjectionScheduler(db, {
  initialDelayMs = Number(process.env.INJECTION_INITIAL_DELAY_MS || 5 * 60 * 1000),
  intervalMs = Number(process.env.INJECTION_INTERVAL_MS || 60 * 60 * 1000),
  setTimeoutFn = setTimeout,
  setIntervalFn = setInterval,
} = {}) {
  const backoff = createDatabaseBackoffController({
    label: "Injection scheduler",
  });
  let running = false;

  const runCycle = async (contextLabel) => {
    if (running) {
      return;
    }

    if (!backoff.shouldRun()) {
      return;
    }

    running = true;
    try {
      await runInjectionCycle(db);
      backoff.onSuccess();
    } catch (error) {
      if (!backoff.onError(error)) {
        console.error(`${contextLabel} failed:`, error);
      }
    } finally {
      running = false;
    }
  };

  const timeout = setTimeoutFn(() => {
    runCycle("First injection cycle").catch((error) => {
      console.error("First injection cycle failed:", error);
    });
  }, initialDelayMs);

  const interval = setIntervalFn(() => {
    runCycle("Injection cycle").catch((error) => {
      console.error("Injection cycle failed:", error);
    });
  }, intervalMs);

  return {
    stop() {
      clearTimeout(timeout);
      clearInterval(interval);
    },
  };
}

function startDuelScheduler(db, {
  initialDelayMs = Number(process.env.DUEL_INITIAL_DELAY_MS || 15 * 1000),
  intervalMs = Number(process.env.DUEL_INTERVAL_MS || 5 * 60 * 1000),
} = {}) {
  const runCycle = () =>
    closeExpiredDuels(db).catch((error) => {
      console.error("Duel closure cycle failed:", error);
    });

  const timeout = setTimeout(runCycle, initialDelayMs);
  const interval = setInterval(runCycle, intervalMs);

  return {
    stop() {
      clearTimeout(timeout);
      clearInterval(interval);
    },
  };
}

module.exports = {
  shouldRunInlineBackgroundWorker,
  shouldRunInlineDuelWorker,
  shouldRunInlineInjectionWorker,
  startDuelScheduler,
  startInjectionScheduler,
};
