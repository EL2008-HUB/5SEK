const router = require("express").Router();
const { optionalAuthMiddleware } = require("../controllers/authController");
const leaderboardController = require("../controllers/leaderboardController");

// GET /api/leaderboard?period=today|week|all&limit=20
router.get("/", optionalAuthMiddleware, leaderboardController.getLeaderboard);

module.exports = router;
