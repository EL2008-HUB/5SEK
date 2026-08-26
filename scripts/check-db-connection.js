/**
 * Verify the app can reach its configured database.
 *
 * Reports connection target (never credentials), server version, table count
 * and pending migrations, so a failed local setup is diagnosable at a glance.
 *
 * Usage: node scripts/check-db-connection.js
 */

const path = require("path");

const { bootstrapEnv } = require("../src/config/bootstrapEnv");

bootstrapEnv(path.join(__dirname, ".."));

const knexConfig = require("../knexfile");

const environment = process.env.NODE_ENV === "production" ? "production" : process.env.APP_ENV === "staging" ? "staging" : "development";
const knex = require("knex")(knexConfig[environment]);

/** Describes the target without exposing user or password. */
function describeTarget() {
  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      return `${url.hostname}:${url.port || 5432}${url.pathname}`;
    } catch {
      return "DATABASE_URL (unparseable)";
    }
  }

  const host = process.env.DB_HOST || "localhost";
  const port = process.env.DB_PORT || 5432;
  const name = process.env.DB_NAME || "fivesek";
  return `${host}:${port}/${name}`;
}

async function main() {
  console.log(`[db:check] environment: ${environment}`);
  console.log(`[db:check] target: ${describeTarget()}`);

  const { rows } = await knex.raw("select version() as version");
  console.log(`[db:check] connected: ${rows[0].version.split(",")[0]}`);

  const tables = await knex("information_schema.tables")
    .where({ table_schema: "public", table_type: "BASE TABLE" })
    .count({ count: "*" })
    .first();
  console.log(`[db:check] public tables: ${tables.count}`);

  const [, pending] = await knex.migrate.list();
  if (pending.length) {
    console.warn(`[db:check] pending migrations: ${pending.length} (run "npm run migrate")`);
    pending.forEach((entry) => console.warn(`  - ${entry.file || entry}`));
  } else {
    console.log("[db:check] migrations: up to date");
  }

  console.log("[db:check] OK");
}

/**
 * A reachable server that rejects our database/role usually means the port is
 * answered by a different PostgreSQL install than the project's data directory.
 */
const FOREIGN_SERVER_CODES = new Set(["3D000", "28P01", "28000"]);

main()
  .catch((error) => {
    console.error(`[db:check] FAILED: ${error.message}`);

    if (FOREIGN_SERVER_CODES.has(error.code)) {
      console.error("[db:check] The port answered, but not with this project's database.");
      console.error("[db:check] Another PostgreSQL server may be listening on it. Start the project's own server:");
    } else {
      console.error("[db:check] If the local server is not running, try:");
    }

    console.error("[db:check]   npm run db:local:start");
    process.exitCode = 1;
  })
  .finally(() => knex.destroy());
