/**
 * Start/stop the local development PostgreSQL server via pg_ctl.
 *
 * This drives a portable (non-service) PostgreSQL install, so the server only
 * runs while it has been explicitly started.
 *
 * Usage: node scripts/start-local-postgres.js <start|stop|restart|status>
 *
 * Overridable via env: LOCAL_PG_BIN, LOCAL_PG_DATA, LOCAL_PG_PORT.
 */

const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawnSync } = require("child_process");

const { bootstrapEnv } = require("../src/config/bootstrapEnv");

bootstrapEnv(path.join(__dirname, ".."));

const isWindows = process.platform === "win32";

const BIN_DIR = process.env.LOCAL_PG_BIN || (isWindows ? "C:\\dev\\pg17\\pgsql\\bin" : "/usr/lib/postgresql/17/bin");
const DATA_DIR = process.env.LOCAL_PG_DATA || (isWindows ? "C:\\dev\\pgdata" : "/var/lib/postgresql/17/main");
const PORT = Number(process.env.LOCAL_PG_PORT || process.env.DB_PORT || 5544);

const PG_CTL = path.join(BIN_DIR, isWindows ? "pg_ctl.exe" : "pg_ctl");
const LOG_FILE = path.join(DATA_DIR, "server.log");

function fail(message) {
  console.error(`[db:local] ${message}`);
  process.exit(1);
}

function verifyLayout() {
  if (!fs.existsSync(PG_CTL)) {
    fail(`pg_ctl not found at ${PG_CTL}. Set LOCAL_PG_BIN to the PostgreSQL bin directory.`);
  }

  if (!fs.existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    fail(`${DATA_DIR} is not a PostgreSQL data directory. Set LOCAL_PG_DATA.`);
  }
}

function pgCtl(args, { capture = false } = {}) {
  return spawnSync(PG_CTL, ["-D", DATA_DIR, ...args], {
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
}

/**
 * Authoritative running check for OUR data directory.
 *
 * Deliberately not a port check: another PostgreSQL install may be listening on
 * the same port, which would make a port probe report a false positive.
 */
function isRunning() {
  return pgCtl(["status"], { capture: true }).status === 0;
}

function portInUse() {
  return new Promise((resolve) => {
    const socket = net.connect(PORT, "127.0.0.1");
    const settle = (value) => {
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(1500);
    socket.on("connect", () => settle(true));
    socket.on("timeout", () => settle(false));
    socket.on("error", () => settle(false));
  });
}

async function warnAboutForeignServer() {
  if (!(await portInUse())) {
    return;
  }

  console.warn(
    `[db:local] Warning: something else is already listening on port ${PORT} ` +
    `but it is not the server in ${DATA_DIR}. Connections may reach the wrong database.`
  );
}

async function start() {
  if (isRunning()) {
    console.log(`[db:local] Already running (data dir ${DATA_DIR}, port ${PORT}).`);
    return;
  }

  await warnAboutForeignServer();

  const result = pgCtl(["-l", LOG_FILE, "-o", `-p ${PORT}`, "-w", "start"]);
  if (result.status !== 0) {
    fail(`Failed to start PostgreSQL. See ${LOG_FILE} for details.`);
  }

  console.log(`[db:local] Started on port ${PORT} (data dir ${DATA_DIR}, log ${LOG_FILE}).`);
}

function stop() {
  if (!isRunning()) {
    console.log(`[db:local] Not running (data dir ${DATA_DIR}).`);
    return;
  }

  if (pgCtl(["-m", "fast", "-w", "stop"]).status !== 0) {
    fail("Failed to stop PostgreSQL.");
  }

  console.log("[db:local] Stopped.");
}

async function status() {
  if (isRunning()) {
    console.log(`[db:local] Running (data dir ${DATA_DIR}, port ${PORT}).`);
    return;
  }

  console.log(`[db:local] Not running (data dir ${DATA_DIR}).`);
  await warnAboutForeignServer();
  process.exitCode = 1;
}

const commands = {
  start,
  stop,
  status,
  async restart() {
    stop();
    await start();
  },
};

const command = process.argv[2] || "start";
const handler = commands[command];

if (!handler) {
  fail(`Unknown command "${command}". Expected one of: ${Object.keys(commands).join(", ")}.`);
}

verifyLayout();

Promise.resolve()
  .then(handler)
  .catch((error) => fail(error.message));
