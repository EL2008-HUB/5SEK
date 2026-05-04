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

// Optional auth — guests can view share data, logged users get tracked
let optionalAuthMiddleware;
try {
  optionalAuthMiddleware = require("../middleware/optionalAuth");
} catch (_) {
  optionalAuthMiddleware = (req, res, next) => next();
}

// GET /api/share/top — Top 30 shareable questions for share assets
router.get("/top", optionalAuthMiddleware, getTopShareable);

// GET /api/share/kpis — Share growth KPIs (open_rate, answer_rate, share_rate)
router.get("/kpis", optionalAuthMiddleware, getShareKPIs);

// GET /api/share/:answerId — Get share video data + overlay config
router.get("/:answerId", optionalAuthMiddleware, getShareData);

// GET /api/share/:answerId/stats — Creator dopamine stats (views/answers/shares)
router.get("/:answerId/stats", optionalAuthMiddleware, getCreatorStats);

// POST /api/share/video — Generate share video (overlay config for client render)
router.post("/video", optionalAuthMiddleware, generateShareVideo);

// POST /api/share/:answerId/track — Track share events (share_export, share_open, etc.)
router.post("/:answerId/track", optionalAuthMiddleware, trackShareEvent);

module.exports = router;
