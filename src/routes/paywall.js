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

// ── GET /api/paywall/status ──────────────────────────────────
// Returns the current user's paywall status and daily usage
router.get("/status", authMiddleware, async (req, res) => {
  try {
    const user = await req.db("users")
      .where({ id: req.userId })
      .select("id", "is_premium", "subscription_status", "premium_expires_at", "bonus_answers_today", "bonus_answers_date")
      .first();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const today = new Date().toISOString().split("T")[0];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const answersToday = await req.db("answers")
      .where("user_id", req.userId)
      .where("created_at", ">=", todayStart.toISOString())
      .count("id as count")
      .first();

    const { getEffectiveAnswerLimit } = require("../services/usageLimits");
    const usageLimit = getEffectiveAnswerLimit(user, today);
    const used = parseInt(answersToday?.count || 0);

    res.json({
      is_premium: Boolean(user.is_premium),
      subscription_status: user.subscription_status || "free",
      premium_expires_at: user.premium_expires_at || null,
      daily_usage: {
        used,
        limit: usageLimit.limit,
        remaining: user.is_premium ? null : Math.max(0, usageLimit.limit - used),
        bonus_used: usageLimit.bonusUsed,
        bonus_available: Math.max(0, 2 - usageLimit.bonusUsed),
      },
    });
  } catch (error) {
    console.error("Get paywall status error:", error);
    res.status(500).json({ error: "Failed to get paywall status" });
  }
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
