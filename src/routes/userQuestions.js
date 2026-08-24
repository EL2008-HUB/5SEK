const router = require("express").Router();
const userQuestionController = require("../controllers/userQuestionController");
const { authMiddleware, requireAdmin } = require("../controllers/authController");
const {
  validateUserQuestionSubmit,
  validateUserQuestionStatus,
  validateEmptyBody,
} = require("../middleware/validation");
const { createRateLimiter } = require("../middleware/rateLimit");

// Rate limiters
const submitRateLimit = createRateLimiter({
  scope: "user-questions:submit",
  limit: 5,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "user",
  message: "submit_rate_limited",
});

const engagementRateLimit = createRateLimiter({
  scope: "user-questions:engage",
  limit: 60,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "ip",
  message: "engagement_rate_limited",
});

const adminRateLimit = createRateLimiter({
  scope: "admin:user-questions",
  limit: 60,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "user",
  message: "admin_rate_limited",
});

// ── Public routes ───────────────────────────────
// GET /api/user-questions/feed — full ranked feed (seed + user + boosted)
router.get("/feed", userQuestionController.getFeed);

// GET /api/user-questions/viral — top viral user questions
router.get("/viral", userQuestionController.getViral);

// ── Authenticated routes ────────────────────────
// POST /api/user-questions/submit — submit a question (daily limited)
router.post(
  "/submit",
  authMiddleware,
  submitRateLimit,
  validateUserQuestionSubmit,
  userQuestionController.submit
);

// GET /api/user-questions/mine — user's own questions
router.get("/mine", authMiddleware, userQuestionController.getMyQuestions);

// GET /api/user-questions/limit — check daily submission limit
router.get("/limit", authMiddleware, userQuestionController.getLimit);

// POST /api/user-questions/:id/like
router.post("/:id/like", engagementRateLimit, userQuestionController.like);

// POST /api/user-questions/:id/share
router.post("/:id/share", engagementRateLimit, userQuestionController.share);

// POST /api/user-questions/:id/boost (monetization)
router.post("/:id/boost", authMiddleware, userQuestionController.boost);

// ── Admin routes ────────────────────────────────
// GET /api/user-questions/pending — moderation queue
router.get(
  "/pending",
  authMiddleware,
  adminRateLimit,
  requireAdmin,
  userQuestionController.getPending
);

// PATCH /api/user-questions/:id/status — approve/reject
router.patch(
  "/:id/status",
  authMiddleware,
  adminRateLimit,
  requireAdmin,
  validateUserQuestionStatus,
  userQuestionController.updateStatus
);

// POST /api/user-questions/recalculate — refresh all scores
router.post(
  "/recalculate",
  authMiddleware,
  adminRateLimit,
  requireAdmin,
  validateEmptyBody,
  userQuestionController.recalculate
);

module.exports = router;
