const router = require("express").Router();
const paywallController = require("../controllers/paywallController");
const { authMiddleware, requireAdmin } = require("../controllers/authController");
const { ensureSelfOrAdmin, validatePaywallEvent } = require("../middleware/validation");
const { createRateLimiter } = require("../middleware/rateLimit");

const paywallEventRateLimit = createRateLimiter({
  scope: "paywall:track",
  limit: 60,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "user_or_ip",
  message: "paywall_rate_limited",
});

const adminRateLimit = createRateLimiter({
  scope: "admin:paywall",
  limit: 60,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "user",
  message: "admin_rate_limited",
});

// ── POST /api/paywall/track ──────────────────────────────────
// Track a paywall event (shown, clicked, closed, etc.)
router.post("/track", authMiddleware, paywallEventRateLimit, validatePaywallEvent, paywallController.trackEvent);

// ── POST /api/paywall/bonus/:userId ──────────────────────────
// Grant a bonus answer (second chance after closing paywall)
router.post("/bonus/:userId", authMiddleware, ensureSelfOrAdmin("userId"), paywallController.grantBonusAnswer);

// ── GET /api/paywall/stats ───────────────────────────────────
// Get paywall analytics (last 24h)
router.get("/stats", authMiddleware, adminRateLimit, requireAdmin, paywallController.getStats);

module.exports = router;
