const router = require("express").Router();
const moderationController = require("../controllers/moderationController");
const { authMiddleware, requireAdmin } = require("../controllers/authController");
const {
  validateEmptyBody,
  validateModerationCheck,
  validateModerationReport,
  validateResolveReport,
} = require("../middleware/validation");
const { createRateLimiter } = require("../middleware/rateLimit");

const adminRateLimit = createRateLimiter({
  scope: "admin:moderation",
  limit: 60,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "user",
  message: "admin_rate_limited",
});

router.post("/check", authMiddleware, validateModerationCheck, moderationController.checkAnswer);
router.post("/answers/:id/report", authMiddleware, validateModerationReport, moderationController.reportAnswer);
router.post("/users/:id/report", authMiddleware, validateModerationReport, moderationController.reportUser);
router.get("/blocks/me", authMiddleware, moderationController.getMyBlocks);
router.post("/users/:id/block", authMiddleware, validateEmptyBody, moderationController.blockUser);
router.delete("/users/:id/block", authMiddleware, validateEmptyBody, moderationController.unblockUser);
router.get("/queue", authMiddleware, adminRateLimit, requireAdmin, moderationController.getQueue);
router.post("/reports/:id/resolve", authMiddleware, adminRateLimit, requireAdmin, validateResolveReport, moderationController.resolveReport);

module.exports = router;
