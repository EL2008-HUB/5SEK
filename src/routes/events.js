const express = require("express");
const router = express.Router();
const { trackEvents, getEntityStats, getKPIDashboard } = require("../controllers/eventController");
const { optionalAuthMiddleware, authMiddleware } = require("../controllers/authController");
const { getFeedContext, checkReturnTriggers, getCacheStats } = require("../services/behaviorStateEngine");

// POST /api/events — batch event ingestion (works for both auth + anon users)
router.post("/", optionalAuthMiddleware, trackEvents);

// GET /api/events/stats — derived metrics (internal/admin)
router.get("/stats", optionalAuthMiddleware, getEntityStats);

// GET /api/events/kpi — Day-1 KPI Dashboard
router.get("/kpi", optionalAuthMiddleware, getKPIDashboard);

// 🔥 v3: GET /api/events/state — Read pre-computed user behavior state
router.get("/state", authMiddleware, (req, res) => {
  const ctx = getFeedContext(req.userId);
  res.json({ user_id: req.userId, state: ctx });
});

// 🔥 v3: GET /api/events/returns — Check return triggers for user
router.get("/returns", authMiddleware, (req, res) => {
  const triggers = checkReturnTriggers(req.userId);
  res.json({ user_id: req.userId, triggers });
});

// 🔥 v3: GET /api/events/cache-stats — Engine cache stats (admin/debug)
router.get("/cache-stats", optionalAuthMiddleware, (req, res) => {
  res.json(getCacheStats());
});

// 🌍 Global Trending Engine v2
const {
  getTrending, getTrending1h, getTrending24h,
  getBreakoutItems, getStats: getTrendingStats,
} = require("../services/globalTrending");

// GET /api/events/trending — Global trending (per-item decay)
router.get("/trending", optionalAuthMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const country = req.query.country || null;
  res.json({
    trending: getTrending(limit, country),
    country: country || "global",
  });
});

// GET /api/events/trending/1h — Fresh spikes (last hour)
router.get("/trending/1h", optionalAuthMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 15;
  res.json({ window: "1h", trending: getTrending1h(limit) });
});

// GET /api/events/trending/24h — Stable winners (last 24h)
router.get("/trending/24h", optionalAuthMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json({ window: "24h", trending: getTrending24h(limit) });
});

// GET /api/events/breakout — Content that's going viral NOW
router.get("/breakout", optionalAuthMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  res.json({ breakouts: getBreakoutItems(limit) });
});

// GET /api/events/global-stats — Full engine stats + KPIs
router.get("/global-stats", optionalAuthMiddleware, (req, res) => {
  res.json(getTrendingStats());
});

// 🔍 Content Discovery stats (exploration + quality + creators)
const { getDiscoveryStats } = require("../services/contentDiscovery");
router.get("/discovery-stats", optionalAuthMiddleware, (req, res) => {
  res.json(getDiscoveryStats());
});

// 📊 KPI Health Engine — self-correcting feed metrics
const { getKPIHealth } = require("../services/kpiHealthEngine");
router.get("/health", optionalAuthMiddleware, (req, res) => {
  res.json(getKPIHealth());
});

// 🧪 A/B Testing Engine
const { getExperimentResults, listExperiments, getBucket } = require("../services/abTestEngine");
router.get("/experiments", optionalAuthMiddleware, (req, res) => {
  res.json({ experiments: listExperiments() });
});
router.get("/experiments/results", optionalAuthMiddleware, (req, res) => {
  const experimentId = req.query.id || "feed_weights_v1";
  res.json(getExperimentResults(experimentId));
});
router.get("/experiments/bucket", optionalAuthMiddleware, (req, res) => {
  const userId = req.userId || req.query.userId;
  res.json({ userId, bucket: getBucket(userId) });
});

// 🔔 Notification Intelligence
const { getNotifStats, processQueue } = require("../services/notificationIntelligence");
router.get("/notifications/stats", optionalAuthMiddleware, (req, res) => {
  res.json(getNotifStats());
});
router.get("/notifications/process", optionalAuthMiddleware, (req, res) => {
  const sent = processQueue();
  res.json({ processed: sent.length, notifications: sent });
});

module.exports = router;
