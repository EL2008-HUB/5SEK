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

module.exports = router;
