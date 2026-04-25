const express = require("express");
const cors = require("cors");
const path = require("path");
const defaultDb = require("./db/knex");
const { hasCloudinary, isProduction } = require("./services/uploadService");
const { API_CONTRACT, API_VERSION, CONTRACT_NAME } = require("./services/contractService");
const { getAllowedCorsOrigins, getAppEnv, getTrustedProxyHops, requireHttpsInEdge } = require("./config/runtime");
const { createRequestLogger, logger } = require("./services/logger");
const { recordHttpRequest, renderPrometheusMetrics } = require("./services/metricsService");

function getStartupSnapshot(startupState) {
  if (!startupState) {
    return {
      phase: "ready",
      ready: true,
      started_at: null,
      ready_at: null,
      error: null,
    };
  }

  return {
    phase: startupState.phase || "starting",
    ready: Boolean(startupState.ready),
    started_at: startupState.startedAt || null,
    ready_at: startupState.readyAt || null,
    error: startupState.error || null,
  };
}

function createCountryDetectionMiddleware() {
  return (req, res, next) => {
    const headerCountry = req.headers["x-user-country"];
    if (headerCountry) {
      req.detectedCountry = String(headerCountry).toUpperCase();
      return next();
    }

    try {
      const geoip = require("geoip-lite");
      const ip =
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.connection?.remoteAddress ||
        req.ip;

      const cleanIp = ip?.replace("::ffff:", "") || "";
      const isLocal =
        !cleanIp ||
        cleanIp === "127.0.0.1" ||
        cleanIp === "::1" ||
        cleanIp.startsWith("192.168.") ||
        cleanIp.startsWith("10.");

      if (!isLocal) {
        const geo = geoip.lookup(cleanIp);
        if (geo?.country) {
          req.detectedCountry = geo.country;
          return next();
        }
      }
    } catch (_) {}

    req.detectedCountry = "GLOBAL";
    return next();
  };
}

 function createApp({ db = defaultDb, startupState = null } = {}) {
  const app = express();
  const jsonLimit = process.env.API_JSON_LIMIT || "1mb";
  const startupRetryAfterSeconds = 5;

  app.locals.startupState = startupState;

  app.disable("x-powered-by");
  app.set("trust proxy", getTrustedProxyHops());
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    if (requireHttpsInEdge()) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });
  app.use(cors({
    origin(origin, callback) {
      const allowed = getAllowedCorsOrigins();
      if (!origin || allowed.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("cors_origin_denied"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-User-Country", "X-Client-Contract", "X-Client-Version", "X-Request-Id"],
  }));
  app.use((req, res, next) => {
    if (requireHttpsInEdge() && req.headers["x-forwarded-proto"] !== "https") {
      return res.status(426).json({ error: "https_required" });
    }
    return next();
  });
  app.use(createRequestLogger());
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      recordHttpRequest(req, res, durationMs);
    });
    next();
  });
  app.use((req, res, next) => {
    req.db = db;
    req.apiContract = API_CONTRACT;
    res.setHeader("X-API-Version", API_VERSION);
    res.setHeader("X-API-Contract", CONTRACT_NAME);
    next();
  });
  app.use((req, res, next) => {
    if (startupState && !startupState.ready && req.path.startsWith("/api") && req.path !== "/api/meta/contract") {
      res.setHeader("Retry-After", String(startupRetryAfterSeconds));
      return res.status(503).json({
        error: "service_starting",
        retry_after_seconds: startupRetryAfterSeconds,
        startup: getStartupSnapshot(startupState),
      });
    }
    return next();
  });
  app.use("/api/payments/webhook", express.raw({ type: "application/json" }));
  app.use("/api/payments/webhook", require("./routes/paymentsWebhook"));
  app.use(express.json({ limit: jsonLimit }));
  app.use(express.urlencoded({ extended: false, limit: jsonLimit }));
  if (!isProduction) {
    app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
  }
  app.use(createCountryDetectionMiddleware());

  app.get("/", (req, res) => {
    const startup = getStartupSnapshot(startupState);
    res.json({
      app: "5SEK API",
      status: startup.ready ? "running" : "starting",
      env: getAppEnv(),
      detected_country: req.detectedCountry,
      startup,
      routes: [
        "/api/auth",
        "/api/questions",
        "/api/answers",
        "/api/duels",
        "/api/paywall",
        "/api/ai",
        "/api/uploads",
        "/api/moderation",
        "/api/analytics",
        "/api/push",
        "/api/payments",
        "/api/admin",
        "/api/legal",
        "/api/support",
      ],
    });
  });

  app.get("/health", (req, res) => {
    const startup = getStartupSnapshot(startupState);
    res.json({
      status: startup.ready ? "healthy" : "starting",
      app: "5SEK API",
      env: getAppEnv(),
      api_version: API_VERSION,
      detected_country: req.detectedCountry,
      startup,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/ready", (req, res) => {
    const startup = getStartupSnapshot(startupState);
    if (!startup.ready) {
      return res.status(503).json({
        status: "starting",
        startup,
      });
    }

    return res.json({
      status: "ready",
      startup,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/meta/contract", (req, res) => {
    res.json(API_CONTRACT);
  });

  app.get("/metrics", async (req, res) => {
    try {
      const metrics = await renderPrometheusMetrics(db);
      res.setHeader("Content-Type", "text/plain; version=0.0.4");
      res.send(metrics);
    } catch (error) {
      logger.errorObject("metrics_render_failed", error);
      res.status(500).send("metrics_failed");
    }
  });

  app.get("/health/detailed", async (req, res) => {
    if (startupState && !startupState.ready) {
      return res.status(503).json({
        status: "starting",
        startup: getStartupSnapshot(startupState),
      });
    }

    try {
      await db.raw("select 1");
      res.json({
        status: "healthy",
        db: "ok",
        stripe: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID),
        cloudinary: hasCloudinary,
        cdn: Boolean(process.env.MEDIA_CDN_BASE_URL) || hasCloudinary,
        uploads_mode: hasCloudinary ? "signed_cloudinary" : isProduction ? "unavailable" : "local_dev_fallback",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        status: "unhealthy",
        db: "error",
        error: error.message,
      });
    }
  });

  app.use("/api/auth", require("./routes/auth"));
  app.use("/api/questions", require("./routes/questions"));
  app.use("/api/answers", require("./routes/answers"));
  app.use("/api/duels", require("./routes/duels"));
  app.use("/api/paywall", require("./routes/paywall"));
  app.use("/api/ai", require("./routes/ai"));
  app.use("/api/uploads", require("./routes/uploads"));
  app.use("/api/moderation", require("./routes/moderation"));
  app.use("/api/analytics", require("./routes/analytics"));
  app.use("/api/push", require("./routes/push"));
  app.use("/api/payments", require("./routes/payments"));
  app.use("/api/admin", require("./routes/admin"));
  app.use("/api/legal", require("./routes/legal"));
  app.use("/api/support", require("./routes/support"));

  app.use((err, req, res, next) => {
    logger.errorObject("server_error", err, {
      request_id: req.requestId || null,
      route: req.originalUrl || req.url,
      user_id: req.userId || null,
    });
    if (String(err.message || "") === "cors_origin_denied") {
      return res.status(403).json({ error: "cors_origin_denied" });
    }
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

module.exports = {
  createApp,
};
