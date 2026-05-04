function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return req.ip || req.connection?.remoteAddress || "unknown";
}

function normalizeWindowStart(windowMs, now = Date.now()) {
  return new Date(Math.floor(now / windowMs) * windowMs).toISOString();
}

function resolveActorKey(req, keyStrategy) {
  if (typeof keyStrategy === "function") {
    const customKey = keyStrategy(req);
    if (customKey) return String(customKey);
  }

  if (keyStrategy === "user") {
    return req.userId ? `user:${req.userId}` : `ip:${getClientIp(req)}`;
  }

  if (keyStrategy === "ip") {
    return `ip:${getClientIp(req)}`;
  }

  if (req.userId) {
    return `user:${req.userId}`;
  }

  return `ip:${getClientIp(req)}`;
}

function createRateLimiter({
  scope,
  limit,
  windowMs,
  keyStrategy = "user_or_ip",
  message = "rate_limit_exceeded",
}) {
  if (!scope || !limit || !windowMs) {
    throw new Error("scope, limit and windowMs are required for rate limiting");
  }

  return async function rateLimitMiddleware(req, res, next) {
    try {
      if (!req.db) {
        throw new Error("Database handle missing for rate limiting");
      }

      const actorKey = resolveActorKey(req, keyStrategy);
      const windowStart = normalizeWindowStart(windowMs);

      const [row] = await req.db("request_rate_limits")
        .insert({
          scope,
          actor_key: actorKey,
          window_start: windowStart,
          count: 1,
        })
        .onConflict(["scope", "actor_key", "window_start"])
        .merge({
          count: req.db.raw("request_rate_limits.count + 1"),
          updated_at: req.db.fn.now(),
        })
        .returning(["count", "window_start"]);

      const attempts = Number(row?.count || 0);
      const remaining = Math.max(0, limit - attempts);
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((new Date(windowStart).getTime() + windowMs - Date.now()) / 1000)
      );

      res.setHeader("X-RateLimit-Limit", String(limit));
      res.setHeader("X-RateLimit-Remaining", String(remaining));
      res.setHeader("X-RateLimit-Reset", String(Math.floor((Date.parse(windowStart) + windowMs) / 1000)));

      if (attempts > limit) {
        res.setHeader("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({
          error: message,
          retry_after_seconds: retryAfterSeconds,
        });
      }

      return next();
    } catch (error) {
      console.error(`Rate limit middleware failed for ${scope}:`, error);
      return res.status(500).json({ error: "rate_limit_failed" });
    }
  };
}

module.exports = {
  createRateLimiter,
  getClientIp,
  normalizeWindowStart,
};
