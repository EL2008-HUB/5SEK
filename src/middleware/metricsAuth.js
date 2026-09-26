const { parseList } = require("../config/validateRuntimeEnv");

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || "unknown";
}

function createMetricsAuthMiddleware() {
  return function metricsAuth(req, res, next) {
    const allowed = parseList(process.env.METRICS_ALLOWED_IPS);
    const token = process.env.METRICS_AUTH_TOKEN;
    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null;

    if (token && bearer === token) {
      return next();
    }

    if (!allowed.length) {
      return res.status(403).json({ error: "metrics_forbidden" });
    }

    const ip = getClientIp(req);
    if (allowed.includes("*") || allowed.includes(ip)) {
      return next();
    }

    return res.status(403).json({ error: "metrics_forbidden" });
  };
}

module.exports = { createMetricsAuthMiddleware, getClientIp };
