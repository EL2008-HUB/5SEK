const { incrementCountryStat } = require("../services/viralScoring");
const {
  rankAnswerFeed,
} = require("../services/feedComposer");
const { hydrateAnswerRow, normalizeAnswerPayload } = require("../services/answerContent");
const { getEffectiveAnswerLimit } = require("../services/usageLimits");
const { evaluateAnswerModeration } = require("../services/moderationService");
const { inferStorageFromUrl } = require("../services/uploadService");
const { adjustUserTrustScore } = require("../services/trustScoreService");
const { kpiService } = require("../services/kpiService");
const {
  applyActiveAnswerFilter,
  applyActiveQuestionFilter,
  applyActiveUserFilter,
  getBlockedUserIds,
} = require("../services/safetyService");

const MIN_SECONDS_BETWEEN_ANSWERS = Number(process.env.ANSWER_POST_COOLDOWN_SECONDS || 5);

// Helper: resolve country from request
function resolveCountry(req) {
  if (req.query?.country) return req.query.country.toUpperCase();
  if (req.body?.country) return req.body.country.toUpperCase();
  if (req.detectedCountry) return req.detectedCountry;
  return "GLOBAL";
}

function countsToMap(rows = []) {
  return rows.reduce((acc, row) => {
    acc[Number(row.question_id)] = parseInt(row.count, 10) || 0;
    return acc;
  }, {});
}

async function getQuestionCountsSince(db, questionIds, sinceIso) {
  if (!questionIds.length) return {};

  const rows = await db("answers")
    .whereIn("question_id", questionIds)
    .where("created_at", ">=", sinceIso)
    .groupBy("question_id")
    .select("question_id")
    .count("id as count");

  return countsToMap(rows);
}

// Post an answer (with response_time + daily limit for monetization)
exports.create = async (req, res) => {
  try {
    const payload = req.answerCreatePayload || req.body;
    const user_id = req.userId;
    const question_id = Number(payload.question_id);
    const response_time = payload.response_time;
    const country = resolveCountry(req);
    let normalizedAnswer;

    try {
      normalizedAnswer = normalizeAnswerPayload(payload);
    } catch (error) {
      return res.status(400).json({ error: error.message || "Invalid answer payload" });
    }

    if (!user_id || !question_id) {
      return res.status(400).json({ error: "question_id required" });
    }

    // 💰 MONETIZATION: Check daily limit (5 free per day)
    const user = await req.db("users").where({ id: user_id }).first();

    if (!user || user.deleted_at || user.is_blocked) {
      return res.status(403).json({ error: "account_unavailable" });
    }

    const question = await req.db("questions").where({ id: question_id }).first();
    if (!question || question.deleted_at) {
      return res.status(404).json({ error: "Question not found" });
    }

    const latestAnswer = await req.db("answers")
      .where("user_id", user_id)
      .whereNull("deleted_at")
      .orderBy("created_at", "desc")
      .first();

    if (latestAnswer?.created_at) {
      const secondsSinceLastAnswer = (Date.now() - new Date(latestAnswer.created_at).getTime()) / 1000;
      if (secondsSinceLastAnswer < MIN_SECONDS_BETWEEN_ANSWERS) {
        return res.status(429).json({
          error: "answer_cooldown_active",
          retry_after_seconds: Math.max(1, Math.ceil(MIN_SECONDS_BETWEEN_ANSWERS - secondsSinceLastAnswer)),
        });
      }
    }

    if (!user.is_premium) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const answersToday = await req.db("answers")
        .where("user_id", user_id)
        .where("created_at", ">=", todayStart.toISOString())
        .count("id as count")
        .first();

      const count = parseInt(answersToday.count) || 0;

      // 💰 Base limit (5) + bonus answers from "second chance"
      const today = new Date().toISOString().split("T")[0];
      const usageLimit = getEffectiveAnswerLimit(user, today);
      const effectiveLimit = usageLimit.limit;

      if (count >= effectiveLimit) {
        return res.status(403).json({
          error: "daily_limit_reached",
          message: "You've used all your free answers today!",
          answers_used: count,
          limit: effectiveLimit,
          base_limit: usageLimit.baseLimit,
          bonus_used: usageLimit.bonusUsed,
          upgrade_prompt: "Go Premium for unlimited answers 🔥"
        });
      }
    }

    // Save answer with response_time
    const storage = inferStorageFromUrl(normalizedAnswer.video_url);
    const moderation = await evaluateAnswerModeration(req.db, {
      ...normalizedAnswer,
      user_id,
    });
    const insertData = {
      user_id,
      question_id,
      answer_type: normalizedAnswer.answer_type,
      text_content: normalizedAnswer.text_content,
      video_url: normalizedAnswer.video_url,
      storage_provider: payload.storage_provider || storage.storage_provider,
      storage_public_id: payload.storage_public_id || storage.storage_public_id,
      moderation_status: moderation.moderation_status,
      moderation_reason: moderation.moderation_reason,
      moderation_labels: moderation.moderation_labels || null,
      abuse_score: moderation.abuse_score || 0,
      requires_human_review: Boolean(moderation.requires_human_review),
      is_hidden: Boolean(moderation.shouldHide),
    };
    if (response_time !== undefined && response_time !== null) {
      insertData.response_time = parseFloat(response_time);
    }

    const [answer] = await req.db("answers")
      .insert(insertData)
      .returning("*");

    await kpiService.trackAnswerFunnel(req.db, user_id, question_id, "published", {
      timeInStage: Number.isFinite(Number(response_time)) ? Number(response_time) : null,
    });

    if (moderation.moderation_status === "flagged") {
      await req.db("moderation_reports").insert({
        entity_type: "answer",
        entity_id: answer.id,
        reporter_user_id: null,
        reason: moderation.shouldHide ? "auto_hidden" : "auto_flagged",
        details: moderation.moderation_reason,
        status: "pending",
      });

      await adjustUserTrustScore(req.db, user_id, moderation.shouldHide ? -20 : -10);
    }

    // 📊 Update question stats for viral scoring (country-aware)
    await incrementCountryStat(req.db, question_id, "answers_count", country);

    // 🔥 INSTANT REWARD: Calculate percentile (faster than X% of users)
    let percentile = null;
    if (answer.response_time !== null && answer.response_time !== undefined) {
      const totalAnswers = await req.db("answers")
        .whereNotNull("response_time")
        .count("id as count")
        .first();

      const slowerAnswers = await req.db("answers")
        .whereNotNull("response_time")
        .where("response_time", ">", answer.response_time)
        .count("id as count")
        .first();

      const total = parseInt(totalAnswers.count) || 1;
      const slower = parseInt(slowerAnswers.count) || 0;
      percentile = Math.round((slower / total) * 100);
    }

    // Count remaining answers today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const answersToday = await req.db("answers")
      .where("user_id", user_id)
      .where("created_at", ">=", todayStart.toISOString())
      .count("id as count")
      .first();

    const answersUsedToday = parseInt(answersToday.count) || 0;
    const today = new Date().toISOString().split("T")[0];
    const usageLimit = getEffectiveAnswerLimit(user, today);

    res.status(201).json({
      ...hydrateAnswerRow(answer),
      reward: {
        response_time: answer.response_time,
        percentile: percentile,
        message: percentile !== null
          ? `⚡ Faster than ${percentile}% of users`
          : null,
      },
      daily_usage: {
        used: answersUsedToday,
        limit: usageLimit.limit,
        remaining: user.is_premium ? null : Math.max(0, usageLimit.limit - answersUsedToday),
        is_premium: user.is_premium,
      }
    });
  } catch (error) {
    console.error("Create answer error:", error);
    res.status(500).json({ error: "Failed to create answer" });
  }
};

// Get all answers (feed) - country-aware filtering
exports.getFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const country = resolveCountry(req);
    const experimentVariant = String(req.query.experiment_variant || "retention_boost");
    const candidateLimit = Math.min(Math.max((offset + limit) * 6, 40), 200);
    const blockedUserIds = await getBlockedUserIds(req.db, req.userId);

    let query = req.db("answers")
      .join("users", "answers.user_id", "users.id")
      .join("questions", "answers.question_id", "questions.id")
      .leftJoin("question_stats as country_stats", function joinCountryStats() {
        this.on("questions.id", "=", "country_stats.question_id").andOn(
          "country_stats.country",
          "=",
          req.db.raw("?", [country])
        );
      })
      .leftJoin("question_stats as global_stats", function joinGlobalStats() {
        this.on("questions.id", "=", "global_stats.question_id").andOn(
          "global_stats.country",
          "=",
          req.db.raw("?", ["GLOBAL"])
        );
      })
      .select(
        "answers.id",
        "answers.answer_type",
        "answers.video_url",
        "answers.text_content",
        "answers.response_time",
        "answers.created_at",
        "answers.likes",
        "answers.shares",
        "answers.views",
        "answers.watch_time_total",
        "answers.completion_count",
        "answers.skip_count",
        "answers.replay_count",
        "answers.abuse_score",
        "answers.report_count",
        "answers.requires_human_review",
        "answers.moderation_status",
        "users.username",
        "users.id as user_id",
        "users.country as user_country",
        "users.trust_score",
        "questions.text as question_text",
        "questions.id as question_id",
        "questions.country as question_country",
        "questions.category",
        "questions.answers_count as question_answers_count",
        "questions.performance_score",
        "country_stats.score as country_score",
        "global_stats.score as global_score"
      )
      .orderBy("answers.created_at", "desc")
      .limit(candidateLimit);

    applyActiveAnswerFilter(query, "answers");
    applyActiveUserFilter(query, "users");
    applyActiveQuestionFilter(query, "questions");

    // If a specific country is requested, prioritize that country's content
    if (country && country !== "GLOBAL") {
      query = query.whereIn("questions.country", [country, "GLOBAL"]);
    }

    if (blockedUserIds.length > 0) {
      query = query.whereNotIn("users.id", blockedUserIds);
    }

    const answers = await query;
    const questionIds = [...new Set(answers.map((answer) => Number(answer.question_id)))];

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const [todayCounts, recentCounts, hourlyCounts] = await Promise.all([
      getQuestionCountsSince(req.db, questionIds, todayStart.toISOString()),
      getQuestionCountsSince(req.db, questionIds, tenMinAgo),
      getQuestionCountsSince(req.db, questionIds, oneHourAgo),
    ]);

    const ranked = rankAnswerFeed(
      answers.map((answer) => {
        const hydrated = hydrateAnswerRow(answer);
        if (experimentVariant === "control") {
          return {
            ...hydrated,
            watch_time_total: 0,
            completion_count: 0,
            skip_count: 0,
            replay_count: 0,
          };
        }

        return hydrated;
      }),
      { todayCounts, recentCounts, hourlyCounts }
    );

    res.json(ranked.slice(offset, offset + limit));
  } catch (error) {
    console.error("Get feed error:", error);
    res.status(500).json({ error: "Failed to get answers" });
  }
};

// Get answers by user
exports.getByUser = async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    if (req.userRole !== "admin" && req.userId !== userId) {
      return res.status(403).json({ error: "forbidden" });
    }

    const answers = await req.db("answers")
      .join("questions", "answers.question_id", "questions.id")
      .where("answers.user_id", userId)
      .whereNull("answers.deleted_at")
      .whereNull("questions.deleted_at")
      .select(
        "answers.id",
        "answers.answer_type",
        "answers.video_url",
        "answers.text_content",
        "answers.response_time",
        "answers.created_at",
        "answers.is_hidden",
        "answers.report_count",
        "answers.replay_count",
        "questions.text as question_text"
      )
      .orderBy("answers.created_at", "desc");

    res.json(answers.map((answer) => hydrateAnswerRow(answer)));
  } catch (error) {
    console.error("Get user answers error:", error);
    res.status(500).json({ error: "Failed to get user answers" });
  }
};

// Like an answer — also increments question's total_likes (country-aware)
exports.likeAnswer = async (req, res) => {
  try {
    const { id } = req.params;
    const country = resolveCountry(req);

    const answer = await req.db("answers").where({ id }).whereNull("deleted_at").first();
    if (!answer) return res.status(404).json({ error: "Answer not found" });

    await req.db("answers").where({ id }).increment("likes", 1);
    await incrementCountryStat(req.db, answer.question_id, "likes", country);

    res.json({ ok: true });
  } catch (error) {
    console.error("Like answer error:", error);
    res.status(500).json({ error: "Failed to like answer" });
  }
};

// Share an answer — also increments question's total_shares (country-aware)
exports.shareAnswer = async (req, res) => {
  try {
    const { id } = req.params;
    const country = resolveCountry(req);

    const answer = await req.db("answers").where({ id }).whereNull("deleted_at").first();
    if (!answer) return res.status(404).json({ error: "Answer not found" });

    await req.db("answers").where({ id }).increment("shares", 1);
    await incrementCountryStat(req.db, answer.question_id, "shares", country);

    res.json({ ok: true });
  } catch (error) {
    console.error("Share answer error:", error);
    res.status(500).json({ error: "Failed to share answer" });
  }
};

// Check daily usage for a user
exports.getDailyUsage = async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    if (req.userRole !== "admin" && req.userId !== userId) {
      return res.status(403).json({ error: "forbidden" });
    }

    const user = await req.db("users").where({ id: userId }).first();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const answersToday = await req.db("answers")
      .where("user_id", userId)
      .where("created_at", ">=", todayStart.toISOString())
      .count("id as count")
      .first();

    const count = parseInt(answersToday.count) || 0;

    // Calculate bonus answers
    const today = new Date().toISOString().split("T")[0];
    const usageLimit = getEffectiveAnswerLimit(user, today);

    res.json({
      used: count,
      limit: usageLimit.limit,
      remaining: user.is_premium ? null : Math.max(0, usageLimit.limit - count),
      is_premium: user.is_premium,
      bonus_used: usageLimit.bonusUsed,
      bonus_max: 2,
      bonus_available: Math.max(0, 2 - usageLimit.bonusUsed),
    });
  } catch (error) {
    console.error("Get daily usage error:", error);
    res.status(500).json({ error: "Failed to get daily usage" });
  }
};

exports.trackEngagement = async (req, res) => {
  try {
    const answerId = Number(req.params.id);
    const watchTime = Number(req.body.watch_time || 0);
    const sessionId = typeof req.body.session_id === "string" ? req.body.session_id : null;
    const eventType = String(req.body.event_type || "");
    const metadata = req.body.metadata || null;

    if (!answerId || !["watch_progress", "skipped", "completed", "replayed"].includes(eventType)) {
      return res.status(400).json({ error: "invalid analytics payload" });
    }

    const answer = await req.db("answers").where({ id: answerId }).whereNull("deleted_at").first();
    if (!answer) {
      return res.status(404).json({ error: "answer_not_found" });
    }

    let shouldRewardCreatorTrust = false;

    await req.db.transaction(async (trx) => {
      let incrementViews = 0;
      if (sessionId) {
        const existingSessionEvent = await trx("answer_events")
          .where({ answer_id: answerId, session_id: sessionId, user_id: req.userId })
          .whereIn("event_type", ["watch_progress", "completed", "skipped", "replayed"])
          .first();
        if (!existingSessionEvent) {
          incrementViews = 1;
        }
      }

      shouldRewardCreatorTrust =
        incrementViews === 1 &&
        eventType === "completed" &&
        Number(answer.user_id) !== Number(req.userId);

      await trx("answer_events").insert({
        answer_id: answerId,
        user_id: req.userId,
        event_type: eventType,
        watch_time: Number.isFinite(watchTime) ? watchTime : 0,
        session_id: sessionId,
        metadata: metadata ? JSON.stringify(metadata) : null,
      });

      await trx("answers")
        .where({ id: answerId })
        .increment({
          views: incrementViews,
          watch_time_total: Number.isFinite(watchTime) ? watchTime : 0,
          completion_count: eventType === "completed" ? 1 : 0,
          skip_count: eventType === "skipped" ? 1 : 0,
          replay_count: eventType === "replayed" ? 1 : 0,
        });
    });

    if (shouldRewardCreatorTrust) {
      await adjustUserTrustScore(req.db, answer.user_id, 2);
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("Track answer engagement error:", error);
    res.status(500).json({ error: "Failed to track answer engagement" });
  }
};
