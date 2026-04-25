function parseList(value, fallback = []) {
  if (!value) return fallback;
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getAppEnv() {
  return process.env.APP_ENV || process.env.NODE_ENV || "development";
}

function isProductionLike() {
  return ["production", "staging"].includes(getAppEnv()) || process.env.NODE_ENV === "production";
}

function getAllowedCorsOrigins() {
  if (process.env.CORS_ALLOWED_ORIGINS) {
    return parseList(process.env.CORS_ALLOWED_ORIGINS);
  }

  const env = getAppEnv();
  if (env === "production") {
    return ["https://app.5sek.app"];
  }

  if (env === "staging") {
    return ["https://staging-app.5sek.app"];
  }

  return [
    "http://localhost:8081",
    "http://localhost:19006",
    "http://localhost:3000",
    "exp://127.0.0.1:8081",
  ];
}

function getTrustedProxyHops() {
  const raw = process.env.TRUST_PROXY_HOPS;
  if (!raw) return 1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 1;
}

function requireHttpsInEdge() {
  return isProductionLike() && process.env.REQUIRE_HTTPS !== "false";
}

function useStructuredLogs() {
  return process.env.LOG_FORMAT !== "plain";
}

function getLogLevel() {
  return process.env.LOG_LEVEL || "info";
}

module.exports = {
  getAllowedCorsOrigins,
  getAppEnv,
  getLogLevel,
  getTrustedProxyHops,
  isProductionLike,
  requireHttpsInEdge,
  useStructuredLogs,
};
