const router = require("express").Router();
const questionController = require("../controllers/questionController");
const { authMiddleware, requireAdmin } = require("../controllers/authController");
const {
  validateEmptyBody,
  validateCrossCountryCheck,
  validateQuestionCreate,
  validateRecalculate,
  validateSetDaily,
} = require("../middleware/validation");
const { createRateLimiter } = require("../middleware/rateLimit");

const adminRateLimit = createRateLimiter({
  scope: "admin:questions",
  limit: 60,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "user",
  message: "admin_rate_limited",
});

// GET /api/questions/daily — today's viral question + social proof (country-aware)
router.get("/daily", questionController.getDaily);

// GET /api/questions/hot — currently hot/spiking questions (FOMO)
router.get("/hot", questionController.getHot);

// GET /api/questions/personalized — hyper-personalized (country+age+interests)
router.get("/personalized", questionController.getPersonalized);

// GET /api/questions/patterns — learned patterns for a country
router.get("/patterns", questionController.getPatterns);

// GET /api/questions/injection-stats — admin: injection engine activity
router.get("/injection-stats", authMiddleware, adminRateLimit, requireAdmin, questionController.getInjectionStatsEndpoint);

// GET /api/questions/all — all questions sorted by viral score (country filter)
router.get("/all", questionController.getAll);

// GET /api/questions/stats — category performance breakdown (country filter)
router.get("/stats", questionController.getStats);

// GET /api/questions/trending/:country — top trending in a specific country
router.get("/trending/:country", questionController.getTrending);

// GET /api/questions/trending — top trending for auto-detected country
router.get("/trending", questionController.getTrending);

// GET /api/questions — random question (country-aware)
router.get("/", questionController.getRandom);

// POST /api/questions — create question manually (with country)
router.post("/", authMiddleware, adminRateLimit, requireAdmin, validateQuestionCreate, questionController.create);
router.delete("/:id", authMiddleware, adminRateLimit, requireAdmin, validateEmptyBody, questionController.deleteQuestion);
router.post("/:id/restore", authMiddleware, adminRateLimit, requireAdmin, validateEmptyBody, questionController.restoreQuestion);

// POST /api/questions/set-daily — admin: set daily question
router.post("/set-daily", authMiddleware, adminRateLimit, requireAdmin, validateSetDaily, questionController.setDaily);

// POST /api/questions/recalculate — admin: refresh all viral scores
router.post("/recalculate", authMiddleware, adminRateLimit, requireAdmin, validateRecalculate, questionController.recalculateScores);

// POST /api/questions/:id/like (country-aware)
router.post("/:id/like", questionController.likeQuestion);

// POST /api/questions/:id/share (country-aware)
router.post("/:id/share", questionController.shareQuestion);

// POST /api/questions/:id/cross-country — check cross-country viral potential
router.post("/:id/cross-country", authMiddleware, adminRateLimit, requireAdmin, validateCrossCountryCheck, questionController.checkCrossCountry);

module.exports = router;
