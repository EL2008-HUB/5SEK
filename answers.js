const router = require("express").Router();
const answerController = require("../controllers/answerController");
const remixController = require("../controllers/remixController");
const { authMiddleware, optionalAuthMiddleware } = require("../controllers/authController");
const {
  ensureSelfOrAdmin,
  validateAnswerCreate,
  validateAnswerEngagement,
  validateAnswerUpload,
} = require("../middleware/validation");
const { createRateLimiter } = require("../middleware/rateLimit");
const { uploadVideo } = require("../services/uploadService");
const { incCounter } = require("../services/metricsService");
const { getOrComputePreferences } = require("../services/personalizationService");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ── Multer: accept video AND audio files ──────────────────────────
const upload = multer({
  dest: "uploads/tmp/",
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype.startsWith("video/") ||
      file.mimetype.startsWith("audio/") ||
      file.mimetype === "application/octet-stream"; // some browsers send this for blobs
    if (ok) cb(null, true);
    else cb(new Error("Only video or audio files allowed"), false);
  },
});

const uploadRateLimit = createRateLimiter({
  scope: "uploads:answers",
  limit: 20,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "user_or_ip",
  message: "upload_rate_limited",
});

// Rate limiter for like/share — 60 actions per 15 min per user/IP (anti-bot)
const engagementRateLimit = createRateLimiter({
  scope: "answers:engagement",
  limit: 60,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "user_or_ip",
  message: "engagement_rate_limited",
});

// ── POST /api/answers ─────────────────────────────────────────────
// Accept a pre-uploaded video_url (Cloudinary URL or text:// scheme)
router.post("/", authMiddleware, validateAnswerCreate, async (req, res) => {
  try {
    const { question_id } = req.body;
    if (!question_id) {
      return res.status(400).json({ error: "question_id required" });
    }
    return answerController.create(req, res);
  } catch (error) {
    console.error("Create answer error:", error);
    res.status(500).json({ error: "Failed to create answer" });
  }
});

// ── POST /api/answers/upload ──────────────────────────────────────
// Upload a video/audio file, store it (Cloudinary or local), then save answer
router.post("/upload", authMiddleware, uploadRateLimit, upload.single("video"), validateAnswerUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const { question_id, response_time, answer_type } = req.body;
    if (!question_id) {
      // Clean up temp file
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "question_id required" });
    }

    // Upload (Cloudinary or local fallback)
    let uploadResult;
    try {
      uploadResult = await uploadVideo(req.file.path, req.file.originalname, {
        userId: req.userId,
      });
    } catch (uploadErr) {
      console.error("Upload error:", uploadErr);
      incCounter("upload_failures_total", { stage: "storage" });
      fs.unlink(req.file.path, () => {});
      if (uploadErr?.code === "production_storage_unavailable") {
        return res.status(503).json({ error: "signed_uploads_required" });
      }
      return res.status(500).json({ error: "File upload failed" });
    }

    // Build answer payload and delegate to controller
    req.answerCreatePayload = {
      question_id,
      video_url: uploadResult.url,
      response_time,
      answer_type,
      storage_provider: uploadResult.url.includes("res.cloudinary.com") ? "cloudinary" : "local",
      storage_public_id: uploadResult.public_id || null,
    };

    return answerController.create(req, res);
  } catch (error) {
    console.error("Upload answer error:", error);
    incCounter("upload_failures_total", { stage: "controller" });
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: "Failed to upload answer" });
  }
});

// ── GET /api/answers ──────────────────────────────────────────────
// Use optional auth so personalization works for logged-in users
router.get("/", optionalAuthMiddleware, answerController.getFeed);

// ── GET /api/answers/preferences ──────────────────────────────────
// Returns the user's learned taste profile
router.get("/preferences", authMiddleware, async (req, res) => {
  try {
    const prefs = await getOrComputePreferences(req.db, req.userId);
    if (!prefs) {
      return res.json({
        message: "Not enough data yet. Keep using the app!",
        has_preferences: false,
        preferences: null,
      });
    }

    res.json({
      has_preferences: true,
      preferences: {
        favorite_categories: prefs.favorite_categories || [],
        favorite_tags: prefs.favorite_tags || [],
        skip_categories: prefs.skip_categories || [],
        preferred_answer_type: prefs.preferred_answer_type,
        avg_watch_pct: prefs.avg_watch_pct,
        total_completions: prefs.total_completions,
        total_skips: prefs.total_skips,
        total_replays: prefs.total_replays,
        peak_hour: prefs.peak_hour,
      },
    });
  } catch (error) {
    console.error("Get preferences error:", error);
    res.status(500).json({ error: "Failed to get preferences" });
  }
});

// ── GET /api/answers/user/:userId ─────────────────────────────────
router.get("/user/:userId", authMiddleware, ensureSelfOrAdmin("userId"), answerController.getByUser);

// ── GET /api/answers/daily-usage/:userId ──────────────────────────
router.get("/daily-usage/:userId", authMiddleware, ensureSelfOrAdmin("userId"), answerController.getDailyUsage);

// ── GET /api/answers/:id ──────────────────────────────────────────
// FIX 5: Deep link — shared links open directly to this answer
router.get("/:id", optionalAuthMiddleware, answerController.getById);

// ── POST /api/answers/:id/like ────────────────────────────────────
// optional auth so anonymous users can still like, but rate-limited (anti-bot)
router.post("/:id/like", optionalAuthMiddleware, engagementRateLimit, answerController.likeAnswer);

// ── POST /api/answers/:id/share ───────────────────────────────────
// optional auth so anonymous users can still share, but rate-limited (anti-bot)
router.post("/:id/share", optionalAuthMiddleware, engagementRateLimit, answerController.shareAnswer);

router.post("/:id/analytics", authMiddleware, validateAnswerEngagement, answerController.trackEngagement);

// ── REMIX CHAIN ENDPOINTS ─────────────────────────────────────────
// POST /api/answers/:id/remix — create a remix of an answer
router.post("/:id/remix", authMiddleware, remixController.createRemix);

// GET /api/answers/:id/chain — get full remix chain
router.get("/:id/chain", optionalAuthMiddleware, remixController.getChain);

// GET /api/answers/:id/remixes — remix count + can-remix check
router.get("/:id/remixes", optionalAuthMiddleware, remixController.getRemixInfo);

module.exports = router;
