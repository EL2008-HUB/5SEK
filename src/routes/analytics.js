const router = require("express").Router();
const analyticsController = require("../controllers/analyticsController");
const { authMiddleware, requireAdmin } = require("../controllers/authController");
const { createRateLimiter } = require("../middleware/rateLimit");
const { validateClientEvent } = require("../middleware/validation");

const adminRateLimit = createRateLimiter({
  scope: "admin:analytics",
  limit: 60,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "user",
  message: "admin_rate_limited",
});

router.post("/events", authMiddleware, validateClientEvent, analyticsController.trackClientEvent);
router.get("/experiments/me", authMiddleware, analyticsController.getExperimentAssignments);
router.get("/dashboard", authMiddleware, adminRateLimit, requireAdmin, analyticsController.getDashboard);

// ── GET /api/analytics/feed ──────────────────────────────────────
// Returns feed health metrics for the current user's session context
// (lightweight alias used by the mobile app — not admin-only)
router.get("/feed", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [answerMetrics, sessionMetrics] = await Promise.all([
      req.db("answers")
        .where("user_id", userId)
        .where("created_at", ">=", sevenDaysAgo)
        .sum("completion_count as completions")
        .sum("skip_count as skips")
        .sum("views as views")
        .count("id as total")
        .first(),
      req.db("client_events")
        .where("user_id", userId)
        .where("event_type", "app_open")
        .where("created_at", ">=", sevenDaysAgo)
        .count("id as sessions")
        .first(),
    ]);

    const completions = Number(answerMetrics?.completions || 0);
    const skips = Number(answerMetrics?.skips || 0);
    const total = completions + skips;

    res.json({
      user_id: userId,
      period: "7d",
      answers_created: Number(answerMetrics?.total || 0),
      completion_rate: total > 0 ? Number(((completions / total) * 100).toFixed(1)) : 0,
      skip_rate: total > 0 ? Number(((skips / total) * 100).toFixed(1)) : 0,
      total_views: Number(answerMetrics?.views || 0),
      sessions_7d: Number(sessionMetrics?.sessions || 0),
    });
  } catch (error) {
    console.error("Get feed analytics error:", error);
    res.status(500).json({ error: "Failed to get feed analytics" });
  }
});

module.exports = router;
