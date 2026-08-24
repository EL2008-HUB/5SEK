/**
 * User Question Controller — Production-Ready
 *
 * Endpoints:
 * - POST   /submit           — submit a question (1/day free, 3/day premium)
 * - GET    /mine              — user's own submitted questions
 * - GET    /feed              — full ranked feed (seed + user + boosted)
 * - GET    /viral             — top viral user questions
 * - POST   /:id/like          — like a user question
 * - POST   /:id/share         — share a user question
 * - POST   /:id/boost         — boost a question (monetization)
 * - GET    /limit             — check daily submission limit
 * - POST   /recalculate       — admin: recalculate all scores
 * - PATCH  /:id/status        — admin: approve/reject a question
 * - GET    /pending           — admin: pending moderation queue
 */

const {
  checkDailyLimit,
  incrementDailyCount,
  isDuplicate,
  moderateQuestion,
  calculateUserQuestionScore,
  recalculateUserQuestionScores,
  getViralUserQuestions,
  composeFeed,
  incrementUserQuestionStat,
} = require("../services/userQuestionService");
const { logAdminAction } = require("../services/adminAuditService");
const { scoreQuestionQuality } = require("../services/questionQuality");

// ─────────────────────────────────────────────
// Helper: resolve country from request
// ─────────────────────────────────────────────
function resolveCountry(req) {
  if (req.query.country) return req.query.country.toUpperCase();
  if (req.body?.country) return req.body.country.toUpperCase();
  if (req.userCountry) return req.userCountry;
  if (req.detectedCountry) return req.detectedCountry;
  return "GLOBAL";
}

// ─────────────────────────────────────────────
// POST /api/user-questions/submit
// ─────────────────────────────────────────────
exports.submit = async (req, res) => {
  try {
    const { text, category = "general" } = req.body;
    const userId = req.userId;
    const country = resolveCountry(req);

    // 1) Daily limit check
    const limit = await checkDailyLimit(req.db, userId);
    if (!limit.allowed) {
      return res.status(429).json({
        error: "daily_limit_reached",
        message: "You've reached your daily question limit",
        remaining: 0,
        reset_at: limit.resetAt,
      });
    }

    // 2) Length validation
    if (!text || text.trim().length < 10) {
      return res.status(400).json({
        error: "question_too_short",
        message: "Question must be at least 10 characters",
      });
    }

    if (text.trim().length > 280) {
      return res.status(400).json({
        error: "question_too_long",
        message: "Question must be 280 characters or less",
      });
    }

    // 3) Duplicate check
    const duplicate = await isDuplicate(req.db, text);
    if (duplicate) {
      return res.status(409).json({
        error: "duplicate_question",
        message: "This question has already been submitted",
      });
    }

    // 4) Moderation (rules + AI)
    const trimmedText = text.trim();
    const questionQuality = scoreQuestionQuality(trimmedText);
    const modResult = await moderateQuestion(trimmedText);
    const initialScore =
      modResult.status === "approved"
        ? calculateUserQuestionScore({
            text: trimmedText,
            created_at: new Date().toISOString(),
          })
        : 0;

    // 5) Insert question
    const [question] = await req.db("user_questions")
      .insert({
        user_id: userId,
        text: trimmedText,
        category,
        country,
        status: modResult.status,
        score: initialScore,
        moderation_reason: modResult.reason,
        moderation_labels: modResult.labels.length > 0 ? modResult.labels : null,
        abuse_score: modResult.abuseScore,
        requires_human_review: modResult.status === "pending",
      })
      .returning("*");

    // 6) Update daily limit counter
    await incrementDailyCount(req.db, userId);

    // 7) Check remaining
    const updatedLimit = await checkDailyLimit(req.db, userId);

    res.status(201).json({
      question,
      question_quality: questionQuality,
      moderation: {
        status: modResult.status,
        message:
          modResult.status === "approved"
            ? "Your question is live! 🎉"
            : modResult.status === "pending"
            ? "Your question is being reviewed 🔍"
            : "Your question was not approved ❌",
      },
      limit: {
        remaining: updatedLimit.remaining,
        reset_at: updatedLimit.resetAt,
      },
    });
  } catch (error) {
    console.error("Submit user question error:", error);
    res.status(500).json({ error: "Failed to submit question" });
  }
};

// ─────────────────────────────────────────────
// GET /api/user-questions/mine
// ─────────────────────────────────────────────
exports.getMyQuestions = async (req, res) => {
  try {
    const userId = req.userId;

    const questions = await req.db("user_questions")
      .where({ user_id: userId })
      .whereNull("deleted_at")
      .orderBy("created_at", "desc")
      .select("*");

    res.json({ questions });
  } catch (error) {
    console.error("Get my questions error:", error);
    res.status(500).json({ error: "Failed to get your questions" });
  }
};

// ─────────────────────────────────────────────
// GET /api/user-questions/feed
// ─────────────────────────────────────────────
exports.getFeed = async (req, res) => {
  try {
    const country = resolveCountry(req);
    const limit = parseInt(req.query.limit) || 30;

    const feed = await composeFeed(req.db, country, limit);

    res.json({
      country,
      total: feed.feed.length,
      seed_count: feed.seed.length,
      user_count: feed.user.length,
      boosted_count: feed.boosted.length,
      feed: feed.feed,
    });
  } catch (error) {
    console.error("Get feed error:", error);
    res.status(500).json({ error: "Failed to get feed" });
  }
};

// ─────────────────────────────────────────────
// GET /api/user-questions/viral
// ─────────────────────────────────────────────
exports.getViral = async (req, res) => {
  try {
    const country = resolveCountry(req);
    const limit = parseInt(req.query.limit) || 10;

    const questions = await getViralUserQuestions(req.db, country, limit);

    res.json({ country, questions });
  } catch (error) {
    console.error("Get viral user questions error:", error);
    res.status(500).json({ error: "Failed to get viral questions" });
  }
};

// ─────────────────────────────────────────────
// POST /api/user-questions/:id/like
// ─────────────────────────────────────────────
exports.like = async (req, res) => {
  try {
    const { id } = req.params;

    const question = await req.db("user_questions")
      .where({ id, status: "approved" })
      .whereNull("deleted_at")
      .first();

    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    await incrementUserQuestionStat(req.db, parseInt(id), "likes");

    res.json({ ok: true });
  } catch (error) {
    console.error("Like user question error:", error);
    res.status(500).json({ error: "Failed to like question" });
  }
};

// ─────────────────────────────────────────────
// POST /api/user-questions/:id/share
// ─────────────────────────────────────────────
exports.share = async (req, res) => {
  try {
    const { id } = req.params;

    const question = await req.db("user_questions")
      .where({ id, status: "approved" })
      .whereNull("deleted_at")
      .first();

    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    await incrementUserQuestionStat(req.db, parseInt(id), "shares");

    res.json({ ok: true });
  } catch (error) {
    console.error("Share user question error:", error);
    res.status(500).json({ error: "Failed to share question" });
  }
};

// ─────────────────────────────────────────────
// POST /api/user-questions/:id/boost  (MONETIZATION)
// ─────────────────────────────────────────────
exports.boost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const question = await req.db("user_questions")
      .where({ id, user_id: userId, status: "approved" })
      .whereNull("deleted_at")
      .first();

    if (!question) {
      return res.status(404).json({
        error: "question_not_found",
        message: "Only your own approved questions can be boosted",
      });
    }

    if (question.is_boosted) {
      return res.status(409).json({
        error: "already_boosted",
        message: "This question is already boosted",
      });
    }

    // Mark as boosted and recalculate score
    const newScore = calculateUserQuestionScore({ ...question, is_boosted: true });

    const [updated] = await req.db("user_questions")
      .where({ id })
      .update({
        is_boosted: true,
        boosted_at: req.db.fn.now(),
        score: newScore,
        updated_at: req.db.fn.now(),
      })
      .returning("*");

    res.json({
      success: true,
      question: updated,
      message: "Your question is now boosted! 🚀",
    });
  } catch (error) {
    console.error("Boost user question error:", error);
    res.status(500).json({ error: "Failed to boost question" });
  }
};

// ─────────────────────────────────────────────
// GET /api/user-questions/limit
// ─────────────────────────────────────────────
exports.getLimit = async (req, res) => {
  try {
    const limit = await checkDailyLimit(req.db, req.userId);

    res.json({
      allowed: limit.allowed,
      remaining: limit.remaining,
      reset_at: limit.resetAt,
    });
  } catch (error) {
    console.error("Get limit error:", error);
    res.status(500).json({ error: "Failed to get limit" });
  }
};

// ─────────────────────────────────────────────
// Admin: GET /api/user-questions/pending
// ─────────────────────────────────────────────
exports.getPending = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;

    const questions = await req.db("user_questions")
      .where("status", "pending")
      .whereNull("deleted_at")
      .orderBy("created_at", "asc")
      .limit(limit)
      .select("*");

    // Enrich with username
    const userIds = [...new Set(questions.map((q) => q.user_id))];
    const users = userIds.length > 0
      ? await req.db("users").whereIn("id", userIds).select("id", "username", "country")
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const enriched = questions.map((q) => ({
      ...q,
      username: userMap.get(q.user_id)?.username || "unknown",
      user_country: userMap.get(q.user_id)?.country || "GLOBAL",
    }));

    res.json({
      pending_count: enriched.length,
      questions: enriched,
    });
  } catch (error) {
    console.error("Get pending questions error:", error);
    res.status(500).json({ error: "Failed to get pending questions" });
  }
};

// ─────────────────────────────────────────────
// Admin: PATCH /api/user-questions/:id/status
// ─────────────────────────────────────────────
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Status must be 'approved' or 'rejected'" });
    }

    const question = await req.db("user_questions").where({ id }).first();
    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    const [updated] = await req.db("user_questions")
      .where({ id })
      .update({
        status,
        requires_human_review: false,
        updated_at: req.db.fn.now(),
      })
      .returning("*");

    await logAdminAction(req, {
      action: "user_questions.update_status",
      entityType: "user_question",
      entityId: parseInt(id),
      metadata: {
        previous_status: question.status,
        new_status: status,
      },
    });

    res.json({ ok: true, question: updated });
  } catch (error) {
    console.error("Update status error:", error);
    res.status(500).json({ error: "Failed to update status" });
  }
};

// ─────────────────────────────────────────────
// Admin: POST /api/user-questions/recalculate
// ─────────────────────────────────────────────
exports.recalculate = async (req, res) => {
  try {
    await recalculateUserQuestionScores(req.db);

    await logAdminAction(req, {
      action: "user_questions.recalculate_scores",
      entityType: "system",
      metadata: {
        triggered_at: new Date().toISOString(),
      },
    });

    res.json({ ok: true, message: "User question scores recalculated" });
  } catch (error) {
    console.error("Recalculate user question scores error:", error);
    res.status(500).json({ error: "Failed to recalculate scores" });
  }
};
