const path = require("path");
const { bootstrapEnv } = require("./src/config/bootstrapEnv");
const {
  getAcquireConnectionTimeout,
  getConnectionConfig,
  getPoolConfig,
} = require("./src/db/config");

bootstrapEnv(__dirname);

module.exports = {
  development: {
    client: "pg",
    connection: getConnectionConfig(),
    migrations: {
      directory: path.join(__dirname, "src/db/migrations")
    },
    seeds: {
      directory: path.join(__dirname, "src/db/seeds")
    },
    pool: getPoolConfig(),
    acquireConnectionTimeout: getAcquireConnectionTimeout(),
  },
  production: {
    client: "pg",
    connection: getConnectionConfig(),
    migrations: {
      directory: path.join(__dirname, "src/db/migrations")
    },
    seeds: {
      directory: path.join(__dirname, "src/db/seeds")
    },
    pool: getPoolConfig(),
    acquireConnectionTimeout: getAcquireConnectionTimeout(),
  },
  staging: {
    client: "pg",
    connection: getConnectionConfig(),
    migrations: {
      directory: path.join(__dirname, "src/db/migrations")
    },
    seeds: {
      directory: path.join(__dirname, "src/db/seeds")
    },
    pool: getPoolConfig(),
    acquireConnectionTimeout: getAcquireConnectionTimeout(),
  }
};
