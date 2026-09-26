const router = require("express").Router();
const duelController = require("../controllers/duelController");
const { authMiddleware, optionalAuthMiddleware } = require("../controllers/authController");
const {
  validateDuelAuto,
  validateDuelChallenge,
  validateDuelCreate,
  validateDuelFeedQuery,
  validateDuelVote,
} = require("../middleware/validation");
const { createRateLimiter } = require("../middleware/rateLimit");

const duelVoteRateLimit = createRateLimiter({
  scope: "duels:vote",
  limit: 10,
  windowMs: 60 * 1000,
  keyStrategy: "user_or_ip",
  message: "duel_vote_rate_limited",
});

router.get("/", optionalAuthMiddleware, validateDuelFeedQuery, duelController.getFeed);
router.get("/me", authMiddleware, duelController.getMine);
router.delete("/queue/:id", authMiddleware, duelController.cancelQueue);
router.get("/:id", optionalAuthMiddleware, duelController.getById);
router.post("/", authMiddleware, validateDuelCreate, duelController.create);
router.post("/auto", authMiddleware, validateDuelAuto, duelController.createAuto);
router.post("/challenge", authMiddleware, validateDuelChallenge, duelController.challenge);
router.post("/:id/vote", authMiddleware, duelVoteRateLimit, validateDuelVote, duelController.vote);

module.exports = router;
