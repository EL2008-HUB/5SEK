const express = require("express");
const router = express.Router();
const {
  getShareData,
  generateShareVideo,
  trackShareEvent,
  getTopShareable,
  getCreatorStats,
  getShareKPIs,
} = require("../services/shareService");
const { authMiddleware, optionalAuthMiddleware, requireAdmin } = require("../controllers/authController");

router.get("/top", optionalAuthMiddleware, getTopShareable);
router.get("/kpis", authMiddleware, requireAdmin, getShareKPIs);
router.get("/:answerId", optionalAuthMiddleware, getShareData);
router.get("/:answerId/stats", optionalAuthMiddleware, getCreatorStats);
router.post("/video", optionalAuthMiddleware, generateShareVideo);
router.post("/:answerId/track", optionalAuthMiddleware, trackShareEvent);

module.exports = router;
