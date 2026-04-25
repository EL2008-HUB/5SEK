const router = require("express").Router();
const { generateQuestion, getSupportedCountries } = require("../services/aiService");
const { authMiddleware, requireAdmin } = require("../controllers/authController");
const { createRateLimiter } = require("../middleware/rateLimit");
const {
  JOB_TYPES,
  getBackgroundJob,
  queueBackgroundJob,
} = require("../services/backgroundJobService");

function resolveCountry(req) {
  if (req.query?.country) return req.query.country.toUpperCase();
  if (req.body?.country) return req.body.country.toUpperCase();
  if (req.detectedCountry) return req.detectedCountry;
  return "GLOBAL";
}

const adminRateLimit = createRateLimiter({
  scope: "admin:ai",
  limit: 30,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "user",
  message: "admin_rate_limited",
});

router.get("/countries", (req, res) => {
  res.json(getSupportedCountries());
});

router.get("/question", async (req, res) => {
  try {
    const country = resolveCountry(req);
    const question = await generateQuestion(req.db, null, country);

    if (!question) {
      return res.status(503).json({
        error: "AI not configured",
        hint: "Set OPENROUTER_API_KEY in your .env file",
      });
    }

    res.json({ question, country });
  } catch (err) {
    console.error("AI generate question error:", err);
    res.status(500).json({ error: "AI failed to generate question" });
  }
});

router.post("/questions/bulk", authMiddleware, adminRateLimit, requireAdmin, async (req, res) => {
  try {
    const count = parseInt(req.body.count, 10) || 5;
    const country = resolveCountry(req);
    const job = await queueBackgroundJob(req.db, {
      jobType: JOB_TYPES.AI_GENERATE_QUESTIONS_BULK,
      payload: {
        count,
        country,
        preferredCategory: req.body.category || null,
      },
    });

    res.status(202).json({
      ok: true,
      job_id: job.id,
      status: job.status,
      country,
    });
  } catch (err) {
    console.error("Queue AI bulk generate error:", err);
    res.status(500).json({ error: "Failed to queue AI question generation" });
  }
});

router.post("/daily", authMiddleware, adminRateLimit, requireAdmin, async (req, res) => {
  try {
    const country = resolveCountry(req);
    const job = await queueBackgroundJob(req.db, {
      jobType: JOB_TYPES.AI_GENERATE_DAILY_QUESTION,
      payload: {
        country,
        preferredCategory: req.body.category || null,
      },
      dedupeKey: `ai_daily:${country}:${new Date().toISOString().slice(0, 10)}`,
    });

    res.status(202).json({
      ok: true,
      job_id: job.id,
      status: job.status,
      country,
    });
  } catch (err) {
    console.error("Queue AI daily question error:", err);
    res.status(500).json({ error: "Failed to queue daily AI question" });
  }
});

router.get("/jobs/:id", authMiddleware, adminRateLimit, requireAdmin, async (req, res) => {
  try {
    const job = await getBackgroundJob(req.db, Number(req.params.id));
    if (!job) {
      return res.status(404).json({ error: "job_not_found" });
    }

    res.json(job);
  } catch (error) {
    console.error("Get AI job error:", error);
    res.status(500).json({ error: "Failed to get AI job" });
  }
});

module.exports = router;
