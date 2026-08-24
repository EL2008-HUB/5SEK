const router = require("express").Router();
const dropController = require("../controllers/dropController");
const { authMiddleware, optionalAuthMiddleware, requireAdmin } = require("../controllers/authController");
const { createRateLimiter } = require("../middleware/rateLimit");

const dropRateLimit = createRateLimiter({
  scope: "drops:join",
  limit: 30,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "user_or_ip",
  message: "drop_rate_limited",
});

const adminRateLimit = createRateLimiter({
  scope: "admin:drops",
  limit: 30,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "user",
  message: "admin_rate_limited",
});

// ── GET /api/drops/active — get current active drop ──
router.get("/active", optionalAuthMiddleware, dropController.getActive);

// ── GET /api/drops/next — get next upcoming drop (countdown) ──
router.get("/next", optionalAuthMiddleware, dropController.getNext);

// ── POST /api/drops/schedule — admin: schedule a drop ──
router.post("/schedule", authMiddleware, adminRateLimit, requireAdmin, dropController.schedule);

// ── POST /api/drops/:id/join — join an active drop ──
router.post("/:id/join", authMiddleware, dropRateLimit, dropController.join);

// ── POST /api/drops/:id/leave — leave a drop ──
router.post("/:id/leave", authMiddleware, dropController.leave);

// ── GET /api/drops/:id/stats — admin: drop stats ──
router.get("/:id/stats", authMiddleware, adminRateLimit, requireAdmin, dropController.getStats);

// ── GET /api/drops/:id/replay — see answers from completed drop ──
router.get("/:id/replay", optionalAuthMiddleware, dropController.getReplay);

module.exports = router;
