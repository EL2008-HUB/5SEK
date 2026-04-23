const path = require("path");
const { bootstrapEnv } = require("./src/config/bootstrapEnv");

bootstrapEnv(__dirname);

module.exports = {
  development: {
    client: "pg",
    connection: process.env.DATABASE_URL || {
      host: process.env.DB_HOST || "localhost",
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || "fivesek",
      user: process.env.DB_USER || "user",
      password: process.env.DB_PASSWORD || "password"
    },
    migrations: {
      directory: path.join(__dirname, "src/db/migrations")
    },
    seeds: {
      directory: path.join(__dirname, "src/db/seeds")
    }
  },
  production: {
    client: "pg",
    connection: process.env.DATABASE_URL,
    migrations: {
      directory: path.join(__dirname, "src/db/migrations")
    },
    seeds: {
      directory: path.join(__dirname, "src/db/seeds")
    },
    pool: {
      min: 2,
      max: 10
    }
  },
  staging: {
    client: "pg",
    connection: process.env.DATABASE_URL,
    migrations: {
      directory: path.join(__dirname, "src/db/migrations")
    },
    seeds: {
      directory: path.join(__dirname, "src/db/seeds")
    },
    pool: {
      min: 2,
      max: 10
    }
  }
};
