const { bootstrapEnv } = require("../config/bootstrapEnv");
bootstrapEnv(require("path").join(__dirname, "../.."));

const {
  getAcquireConnectionTimeout,
  getConnectionConfig,
  getPoolConfig,
} = require("./config");
const { incCounter } = require("../services/metricsService");
const { logger } = require("../services/logger");

const knex = require("knex")({
  client: "pg",
  connection: getConnectionConfig(),
  migrations: {
    directory: __dirname + "/migrations"
  },
  pool: getPoolConfig(),
  acquireConnectionTimeout: getAcquireConnectionTimeout(),
});

knex.on("query-error", (error, queryData) => {
  incCounter("db_errors_total", { operation: queryData?.method || "unknown" });
  logger.errorObject("db_query_error", error, {
    sql: queryData?.sql || null,
    bindings_count: Array.isArray(queryData?.bindings) ? queryData.bindings.length : 0,
  });
});

module.exports = knex;
