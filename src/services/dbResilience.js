const CONNECTIVITY_ERROR_CODES = new Set([
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

const CONNECTIVITY_ERROR_PATTERNS = [
  /connection terminated unexpectedly/i,
  /connection ended unexpectedly/i,
  /timeout acquiring a connection/i,
  /server closed the connection unexpectedly/i,
  /getaddrinfo enotfound/i,
  /connect etimedout/i,
];

function isDatabaseConnectivityError(error) {
  if (!error) {
    return false;
  }

  if (CONNECTIVITY_ERROR_CODES.has(error.code)) {
    return true;
  }

  if (error.name === "KnexTimeoutError") {
    return true;
  }

  const message = String(error.message || "");
  return CONNECTIVITY_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function createDatabaseBackoffController({
  label,
  baseDelayMs = Number(process.env.DB_WORKER_BASE_BACKOFF_MS || 5000),
  maxDelayMs = Number(process.env.DB_WORKER_MAX_BACKOFF_MS || 60000),
  logger = console,
  now = () => Date.now(),
} = {}) {
  let failureCount = 0;
  let blockedUntil = 0;

  return {
    shouldRun() {
      return now() >= blockedUntil;
    },
    getBlockedMs() {
      return Math.max(blockedUntil - now(), 0);
    },
    onSuccess() {
      failureCount = 0;
      blockedUntil = 0;
    },
    onError(error) {
      if (!isDatabaseConnectivityError(error)) {
        return false;
      }

      failureCount += 1;
      const delayMs = Math.min(baseDelayMs * (2 ** (failureCount - 1)), maxDelayMs);
      blockedUntil = now() + delayMs;
      logger.warn(
        `${label} paused after database connectivity failure; retrying in ${delayMs}ms`,
        {
          code: error.code || null,
          message: error.message,
        }
      );
      return true;
    },
  };
}

module.exports = {
  createDatabaseBackoffController,
  isDatabaseConnectivityError,
};
