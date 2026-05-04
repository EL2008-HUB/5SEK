const { getClientIp } = require("../middleware/rateLimit");
const { getAppEnv, getLogLevel, useStructuredLogs } = require("../config/runtime");

const LEVELS = ["debug", "info", "warn", "error"];

function shouldLog(level) {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(getLogLevel());
}

function serializeError(error) {
  if (!error) return null;
  return {
    message: error.message,
    stack: error.stack,
    name: error.name,
  };
}

function emit(level, message, meta = {}) {
  if (!shouldLog(level)) return;

  if (!useStructuredLogs()) {
    const args = [`[${level}]`, message];
    if (Object.keys(meta).length > 0) {
      args.push(meta);
    }
    console[level === "debug" ? "log" : level](...args);
    return;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    env: getAppEnv(),
    service: "5second-api",
    message,
    ...meta,
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function createRequestLogger() {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    req.requestId =
      req.headers["x-request-id"] ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    res.setHeader("X-Request-Id", req.requestId);

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      emit(res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info", "http_request", {
        request_id: req.requestId,
        method: req.method,
        route: req.route?.path || req.originalUrl || req.url,
        status_code: res.statusCode,
        duration_ms: Number(durationMs.toFixed(2)),
        ip_address: getClientIp(req),
        user_id: req.userId || null,
        app_env: getAppEnv(),
      });
    });

    next();
  };
}

module.exports = {
  createRequestLogger,
  emit,
  logger: {
    debug(message, meta) {
      emit("debug", message, meta);
    },
    info(message, meta) {
      emit("info", message, meta);
    },
    warn(message, meta) {
      emit("warn", message, meta);
    },
    error(message, meta) {
      emit("error", message, meta);
    },
    errorObject(message, error, meta = {}) {
      emit("error", message, {
        ...meta,
        error: serializeError(error),
      });
    },
  },
};
