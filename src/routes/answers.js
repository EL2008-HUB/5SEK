const router = require("express").Router();
const answerController = require("../controllers/answerController");
const { authMiddleware } = require("../controllers/authController");
const {
  ensureSelfOrAdmin,
  validateAnswerCreate,
  validateAnswerEngagement,
  validateAnswerUpload,
} = require("../middleware/validation");
const { createRateLimiter } = require("../middleware/rateLimit");
const { uploadVideo } = require("../services/uploadService");
const { incCounter } = require("../services/metricsService");
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
router.get("/", answerController.getFeed);

// ── GET /api/answers/user/:userId ─────────────────────────────────
router.get("/user/:userId", authMiddleware, ensureSelfOrAdmin("userId"), answerController.getByUser);

// ── GET /api/answers/daily-usage/:userId ──────────────────────────
router.get("/daily-usage/:userId", authMiddleware, ensureSelfOrAdmin("userId"), answerController.getDailyUsage);

// ── POST /api/answers/:id/like ────────────────────────────────────
router.post("/:id/like", answerController.likeAnswer);

// ── POST /api/answers/:id/share ───────────────────────────────────
router.post("/:id/share", answerController.shareAnswer);

router.post("/:id/analytics", authMiddleware, validateAnswerEngagement, answerController.trackEngagement);

module.exports = router;
