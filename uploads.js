const router = require("express").Router();
const { authMiddleware } = require("../controllers/authController");
const { createSignedUploadPayload } = require("../services/uploadService");
const { createRateLimiter } = require("../middleware/rateLimit");

const uploadRateLimit = createRateLimiter({
  scope: "uploads:signature",
  limit: 30,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "user_or_ip",
  message: "upload_rate_limited",
});

router.get("/signature", authMiddleware, uploadRateLimit, async (req, res) => {
  try {
    const answerType = String(req.query.answer_type || "video").toLowerCase() === "audio" ? "audio" : "video";
    const payload = createSignedUploadPayload({
      userId: req.userId,
      answerType,
    });
    if (!payload) {
      return res.status(503).json({ error: "signed_uploads_unavailable" });
    }

    res.json(payload);
  } catch (error) {
    console.error("Get upload signature error:", error);
    if (error?.code === "production_storage_unavailable") {
      return res.status(503).json({ error: "signed_uploads_unavailable" });
    }
    res.status(500).json({ error: "Failed to create upload signature" });
  }
});

module.exports = router;
