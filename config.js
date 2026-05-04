function parseNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }

  return raw === "true";
}

function getSslConfig() {
  const mode = String(process.env.DB_SSL_MODE || "").trim().toLowerCase();

  if (!mode) {
    return undefined;
  }

  if (["0", "false", "disable", "disabled", "off"].includes(mode)) {
    return false;
  }

  if (["no-verify", "require-no-verify"].includes(mode)) {
    return { rejectUnauthorized: false };
  }

  return true;
}

function withOptionalSsl(connection) {
  const ssl = getSslConfig();
  if (ssl === undefined) {
    return connection;
  }

  return {
    ...connection,
    ssl,
  };
}

function getConnectionConfig() {
  const baseConfig = {
    connectionTimeoutMillis: parseNumberEnv("DB_CONNECTION_TIMEOUT_MS", 10000),
    keepAlive: parseBooleanEnv("DB_KEEP_ALIVE", true),
    query_timeout: parseNumberEnv("DB_QUERY_TIMEOUT_MS", 15000),
    statement_timeout: parseNumberEnv("DB_STATEMENT_TIMEOUT_MS", 15000),
  };

  if (process.env.DATABASE_URL) {
    return withOptionalSsl({
      ...baseConfig,
      connectionString: process.env.DATABASE_URL,
    });
  }

  return withOptionalSsl({
    ...baseConfig,
    host: process.env.DB_HOST || "localhost",
    port: parseNumberEnv("DB_PORT", 5432),
    database: process.env.DB_NAME || "fivesek",
    user: process.env.DB_USER || "user",
    password: process.env.DB_PASSWORD || "password",
  });
}

function getPoolConfig() {
  return {
    min: parseNumberEnv("DB_POOL_MIN", 0),
    max: parseNumberEnv("DB_POOL_MAX", 10),
    idleTimeoutMillis: parseNumberEnv("DB_POOL_IDLE_TIMEOUT_MS", 30000),
    createTimeoutMillis: parseNumberEnv("DB_POOL_CREATE_TIMEOUT_MS", 10000),
    reapIntervalMillis: parseNumberEnv("DB_POOL_REAP_INTERVAL_MS", 1000),
    createRetryIntervalMillis: parseNumberEnv("DB_POOL_CREATE_RETRY_INTERVAL_MS", 200),
  };
}

function getAcquireConnectionTimeout() {
  return parseNumberEnv("DB_ACQUIRE_TIMEOUT_MS", 10000);
}

module.exports = {
  getAcquireConnectionTimeout,
  getConnectionConfig,
  getPoolConfig,
};
