const { generateQuestion } = require("../services/aiService");
const { logAdminAction } = require("../services/adminAuditService");
const { JOB_TYPES, queueBackgroundJob } = require("../services/backgroundJobService");
const {
  pickBestQuestion,
  incrementCountryStat,
  incrementQuestionStat,
  recalculateAllScores,
  getCategoryStats,
  getTrendingByCountry,
  checkCrossCountryPotential,
} = require("../services/viralScoring");
const { getHotQuestions, getInjectionStats } = require("../services/injectionEngine");
const { getTopPatterns } = require("../services/patternExtractor");
const {
  restoreQuestion: restoreQuestionRecord,
  softDeleteQuestion,
} = require("../services/safetyService");

// ─────────────────────────────────────────────
// Helper: resolve country from request
// ─────────────────────────────────────────────
function resolveCountry(req) {
  // 1) Explicit query param (highest priority)
  if (req.query.country) return req.query.country.toUpperCase();
  // 2) Body param
  if (req.body?.country) return req.body.country.toUpperCase();
  // 3) Auto-detected via geoip middleware (set by server.js)
  if (req.detectedCountry) return req.detectedCountry;
  // 4) Fallback
  return "GLOBAL";
}

// ─────────────────────────────────────────────
// GET /api/questions  — random question (country-aware)
// ─────────────────────────────────────────────
exports.getRandom = async (req, res) => {
  try {
    const country = resolveCountry(req);

    // Try country-specific first, then fallback to GLOBAL
    let question = await req
      .db("questions")
      .whereIn("country", [country, "GLOBAL"])
      .whereNull("deleted_at")
      .orderByRaw("RANDOM()")
      .first();

    // Fallback: any question
    if (!question) {
      question = await req.db("questions").whereNull("deleted_at").orderByRaw("RANDOM()").first();
    }

    if (!question) {
      return res.status(404).json({ error: "No questions available" });
    }

    // Count a view for this country
    await incrementCountryStat(req.db, question.id, "views", country);

    res.json({ ...question, user_country: country });
  } catch (error) {
    console.error("Get question error:", error);
    res.status(500).json({ error: "Failed to get question" });
  }
};

// ─────────────────────────────────────────────
// GET /api/questions/daily  — country-specific daily question
// ─────────────────────────────────────────────
exports.getDaily = async (req, res) => {
  try {
    const country = resolveCountry(req);
    const today = new Date().toISOString().slice(0, 10);

    // 1️⃣ Already have today's daily for THIS COUNTRY specifically?
    let question = await req
      .db("questions")
      .where({ is_daily: true, active_date: today, country })
      .whereNull("deleted_at")
      .first();

    if (!question) {
      // 2️⃣ Pick best by viral score for this country
      const best = await pickBestQuestion(req.db, today, country);

      // Only use this pick if it matches the user's country (or user is GLOBAL)
      if (best && (best.country === country || country === "GLOBAL")) {
        await req
          .db("questions")
          .where({ id: best.id })
          .update({ is_daily: true, active_date: today });
        question = { ...best, is_daily: true, active_date: today };
        console.log(
          `🏆 [${country}] Viral pick: "${best.text}" (score: ${best.performance_score})`
        );
      } else {
        // 3️⃣ No good DB candidate — try AI (country-aware)
        console.log(`🤖 [${country}] No viral candidate, trying AI...`);

        let aiText = null;
        try {
          const catStats = await getCategoryStats(req.db, country);
          const topCategory = catStats[0]?.category || null;
          aiText = await generateQuestion(req.db, topCategory, country);
        } catch (aiErr) {
          console.log(`⚠️ [${country}] AI failed (${aiErr.message}), using local fallback`);
        }

        if (aiText) {
          const [aiQuestion] = await req
            .db("questions")
            .insert({
              text: aiText,
              is_daily: true,
              active_date: today,
              source: "ai",
              category: topCategory || "general",
              country: country,
            })
            .returning("*");
          question = aiQuestion;
          console.log(
            `🤖 [${country}] AI generated: "${aiText}" (category: ${topCategory || "general"})`
          );
        } else {
          // 4️⃣ AI not configured — reuse a LOCAL question (fallback)
          // Prefer country-specific first, GLOBAL only if country has none
          let fallback = await req
            .db("questions")
            .where("country", country)
            .whereNull("deleted_at")
            .orderByRaw("RANDOM()")
            .first();

          if (!fallback) {
            // Only use GLOBAL if this country has NO questions at all
            fallback = await req
              .db("questions")
              .where("country", "GLOBAL")
              .whereNull("deleted_at")
              .orderByRaw("RANDOM()")
              .first();
          }

          if (fallback) {
            await req
              .db("questions")
              .where({ id: fallback.id })
              .update({ is_daily: true, active_date: today });
            question = { ...fallback, is_daily: true, active_date: today };
          } else {
            // 🔥 ULTIMATE FALLBACK: any question at all
            const anyQuestion = await req
              .db("questions")
              .whereNull("deleted_at")
              .orderByRaw("RANDOM()")
              .first();
            if (anyQuestion) {
              await req
                .db("questions")
                .where({ id: anyQuestion.id })
                .update({ is_daily: true, active_date: today });
              question = { ...anyQuestion, is_daily: true, active_date: today };
            }
          }
        }
      }
    }

    if (!question) {
      return res.status(404).json({ error: "No questions available" });
    }

    // Count a view for this country
    await incrementCountryStat(req.db, question.id, "views", country);

    // ── Social proof ──────────────────────────────
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const totalAnswersResult = await req
      .db("answers")
      .where("question_id", question.id)
      .where("created_at", ">=", todayStart.toISOString())
      .count("id as count")
      .first();
    const totalAnswers = parseInt(totalAnswersResult.count) || 0;

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const recentAnswersResult = await req
      .db("answers")
      .where("question_id", question.id)
      .where("created_at", ">=", tenMinAgo)
      .count("id as count")
      .first();
    const recentAnswers = parseInt(recentAnswersResult.count) || 0;

    const avgTimeResult = await req
      .db("answers")
      .where("question_id", question.id)
      .whereNotNull("response_time")
      .avg("response_time as avg_time")
      .first();
    const avgTime = avgTimeResult?.avg_time
      ? parseFloat(avgTimeResult.avg_time).toFixed(1)
      : null;

    // ── Trending badge + HOT detection ─────────────
    let trendingBadge = null;
    let isHot = question.is_hot || false;
    try {
      const countryStatRow = await req
        .db("question_stats")
        .where({ question_id: question.id, country })
        .first();

      if (countryStatRow && countryStatRow.score > 100) {
        const COUNTRY_NAMES = {
          AL: "Albania 🇦🇱",
          US: "USA 🇺🇸",
          DE: "Germany 🇩🇪",
          UK: "UK 🇬🇧",
          XK: "Kosovo 🇽🇰",
          TR: "Turkey 🇹🇷",
          IT: "Italy 🇮🇹",
        };
        trendingBadge = `🔥 Trending in ${COUNTRY_NAMES[country] || country}`;
      }
    } catch (_) {}

    // ── Enhanced FOMO labels ──────────────────────
    let fomoLabel = "Be the first to answer! 🔥";
    if (isHot && recentAnswers > 5) {
      fomoLabel = `⚡ Blowing up right now — ${recentAnswers} in the last 10 min!`;
    } else if (recentAnswers >= 10) {
      fomoLabel = `🔥 ${recentAnswers} people answered in the last 10 min!`;
    } else if (recentAnswers > 0) {
      fomoLabel = `👀 ${recentAnswers} ${recentAnswers === 1 ? "person" : "people"} answered in the last 10 min`;
    } else if (totalAnswers > 20) {
      fomoLabel = `🚀 ${totalAnswers} people already answered today`;
    } else if (totalAnswers > 0) {
      fomoLabel = `${totalAnswers} ${totalAnswers === 1 ? "person" : "people"} answered today`;
    }

    // 1-hour velocity for extra FOMO
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const hourlyResult = await req
      .db("answers")
      .where("question_id", question.id)
      .where("created_at", ">=", oneHourAgo)
      .count("id as count")
      .first();
    const hourlyAnswers = parseInt(hourlyResult.count) || 0;

    // ── Countdown ─────────────────────────────────
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const secondsUntilTomorrow = Math.floor((tomorrow - now) / 1000);

    res.json({
      ...question,
      user_country: country,
      is_hot: isHot,
      trending_badge: trendingBadge,
      social_proof: {
        total_answers_today: totalAnswers,
        recent_answers: recentAnswers,
        hourly_answers: hourlyAnswers,
        recent_label: fomoLabel,
        avg_response_time: avgTime,
        velocity_label: hourlyAnswers > 10
          ? `⚡ ${hourlyAnswers} answers in the last hour`
          : null,
      },
      countdown: {
        seconds_until_tomorrow: secondsUntilTomorrow,
        label: "New question in",
      },
    });
  } catch (error) {
    console.error("Get daily question error:", error);
    res.status(500).json({ error: "Failed to get daily question" });
  }
};

// ─────────────────────────────────────────────
// GET /api/questions/all  — sorted by score (country filter optional)
// ─────────────────────────────────────────────
exports.getAll = async (req, res) => {
  try {
    const country = resolveCountry(req);

    const questions = await req
      .db("questions")
      .whereIn("country", [country, "GLOBAL"])
      .whereNull("deleted_at")
      .orderBy("performance_score", "desc");

    res.json(questions);
  } catch (error) {
    console.error("Get questions error:", error);
    res.status(500).json({ error: "Failed to get questions" });
  }
};

// ─────────────────────────────────────────────
// POST /api/questions  — create manually (with country)
// ─────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const { text, category = "general", country = "GLOBAL" } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Question text is required" });
    }

    const [question] = await req
      .db("questions")
      .insert({
        text,
        category,
        country: country.toUpperCase(),
        source: "manual",
      })
      .returning("*");

    res.status(201).json(question);
  } catch (error) {
    console.error("Create question error:", error);
    res.status(500).json({ error: "Failed to create question" });
  }
};

// ─────────────────────────────────────────────
// POST /api/questions/set-daily  — admin
// ─────────────────────────────────────────────
exports.setDaily = async (req, res) => {
  try {
    const { question_id, date } = req.body;
    const targetDate = date || new Date().toISOString().slice(0, 10);

    if (!question_id) {
      return res.status(400).json({ error: "question_id is required" });
    }

    const selectedQuestion = await req.db("questions").where({ id: question_id }).first();
    if (!selectedQuestion) {
      return res.status(404).json({ error: "Question not found" });
    }

    await req
      .db("questions")
      .where({ active_date: targetDate, country: selectedQuestion.country })
      .update({ is_daily: false, active_date: null });

    const [question] = await req
      .db("questions")
      .where({ id: question_id })
      .update({ is_daily: true, active_date: targetDate })
      .returning("*");

    await logAdminAction(req, {
      action: "questions.set_daily",
      entityType: "question",
      entityId: question.id,
      metadata: {
        target_date: targetDate,
        country: question.country,
      },
    });

    res.json(question);
  } catch (error) {
    console.error("Set daily error:", error);
    res.status(500).json({ error: "Failed to set daily question" });
  }
};

// ─────────────────────────────────────────────
// POST /api/questions/:id/like  — country-aware
// ─────────────────────────────────────────────
exports.likeQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const country = resolveCountry(req);
    await incrementCountryStat(req.db, id, "likes", country);
    res.json({ ok: true });
  } catch (error) {
    console.error("Like question error:", error);
    res.status(500).json({ error: "Failed to like question" });
  }
};

// ─────────────────────────────────────────────
// POST /api/questions/:id/share  — country-aware
// ─────────────────────────────────────────────
exports.shareQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const country = resolveCountry(req);
    await incrementCountryStat(req.db, id, "shares", country);
    res.json({ ok: true });
  } catch (error) {
    console.error("Share question error:", error);
    res.status(500).json({ error: "Failed to share question" });
  }
};

// ─────────────────────────────────────────────
// POST /api/questions/recalculate  — admin: refresh all scores
// ─────────────────────────────────────────────
exports.recalculateScores = async (req, res) => {
  try {
    await recalculateAllScores(req.db);
    const today = new Date().toISOString().slice(0, 10);
    const [patternJob, analyticsJob] = await Promise.all([
      queueBackgroundJob(req.db, {
        jobType: JOB_TYPES.PATTERN_EXTRACTION,
      }),
      queueBackgroundJob(req.db, {
        jobType: JOB_TYPES.ANALYTICS_AGGREGATION,
        payload: { day: today },
        dedupeKey: `analytics:manual:${today}`,
      }),
    ]);
    await logAdminAction(req, {
      action: "questions.recalculate_scores",
      entityType: "system",
      metadata: {
        triggered_at: new Date().toISOString(),
        pattern_job_id: patternJob?.id || null,
        analytics_job_id: analyticsJob?.id || null,
      },
    });
    res.json({
      ok: true,
      message: "Scores recalculated",
      follow_up_jobs: {
        pattern_extraction: patternJob?.id || null,
        analytics_aggregation: analyticsJob?.id || null,
      },
    });
  } catch (error) {
    console.error("Recalculate scores error:", error);
    res.status(500).json({ error: "Failed to recalculate scores" });
  }
};

// ─────────────────────────────────────────────
// GET /api/questions/stats  — category performance (country filter)
// ─────────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const country = resolveCountry(req);
    const stats = await getCategoryStats(req.db, country);
    res.json(stats);
  } catch (error) {
    console.error("Get stats error:", error);
    res.status(500).json({ error: "Failed to get stats" });
  }
};

// ─────────────────────────────────────────────
// GET /api/questions/trending/:country  — top trending in a country
// ─────────────────────────────────────────────
exports.getTrending = async (req, res) => {
  try {
    const country = (req.params.country || resolveCountry(req)).toUpperCase();
    const limit = parseInt(req.query.limit) || 10;

    const trending = await getTrendingByCountry(req.db, country, limit);

    res.json({
      country,
      questions: trending,
    });
  } catch (error) {
    console.error("Get trending error:", error);
    res.status(500).json({ error: "Failed to get trending questions" });
  }
};

// ─────────────────────────────────────────────
// POST /api/questions/:id/cross-country  — check cross-country viral potential
// ─────────────────────────────────────────────
exports.checkCrossCountry = async (req, res) => {
  try {
    const { id } = req.params;
    const threshold = parseInt(req.query.threshold) || 120;

    const potential = await checkCrossCountryPotential(req.db, id, threshold);

    await logAdminAction(req, {
      action: "questions.cross_country_check",
      entityType: "question",
      entityId: parseInt(id),
      metadata: {
        threshold,
        high_performer_count: potential.length,
      },
    });

    res.json({
      question_id: parseInt(id),
      high_performers: potential,
      should_push: potential.length > 0,
    });
  } catch (error) {
    console.error("Cross-country check error:", error);
    res.status(500).json({ error: "Failed to check cross-country potential" });
  }
};

// ─────────────────────────────────────────────
// GET /api/questions/hot  — currently hot questions (FOMO feed)
// ─────────────────────────────────────────────
exports.getHot = async (req, res) => {
  try {
    const country = resolveCountry(req);
    const hotQuestions = (await getHotQuestions(req.db, country)).filter((question) => !question.deleted_at);

    // Add live stats to each hot question
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const enriched = [];

    for (const q of hotQuestions) {
      const hourlyResult = await req.db("answers")
        .where("question_id", q.id)
        .where("created_at", ">=", oneHourAgo)
        .count("id as count")
        .first();
      const hourlyAnswers = parseInt(hourlyResult.count) || 0;

      enriched.push({
        ...q,
        live_stats: {
          answers_last_hour: hourlyAnswers,
          label: hourlyAnswers > 20
            ? `🔥🔥 ${hourlyAnswers} answers in 1 hour!`
            : hourlyAnswers > 10
            ? `⚡ ${hourlyAnswers} answers in 1 hour`
            : `👀 ${hourlyAnswers} answers in 1 hour`,
        },
      });
    }

    res.json({ country, questions: enriched });
  } catch (error) {
    console.error("Get hot questions error:", error);
    res.status(500).json({ error: "Failed to get hot questions" });
  }
};

// ─────────────────────────────────────────────
// GET /api/questions/personalized — hyper-personalized questions
// Query: ?country=AL&age_group=18-24&interests=memes,relationships
// ─────────────────────────────────────────────
exports.getPersonalized = async (req, res) => {
  try {
    const country = resolveCountry(req);
    const ageGroup = req.query.age_group || null;
    const interests = req.query.interests
      ? req.query.interests.split(",").map((i) => i.trim())
      : null;
    const limit = parseInt(req.query.limit) || 10;

    let query = req.db("questions")
      .whereIn("country", [country, "GLOBAL"])
      .whereNull("deleted_at")
      .orderBy("performance_score", "desc")
      .limit(limit);

    // Filter by age group if specified
    if (ageGroup) {
      query = query.where(function () {
        this.where("age_group", ageGroup).orWhereNull("age_group");
      });
    }

    // Filter by interests if specified
    if (interests && interests.length > 0) {
      query = query.where(function () {
        for (const interest of interests) {
          this.orWhere("interest_tags", "like", `%${interest}%`);
          this.orWhere("category", interest);
        }
        this.orWhereNull("interest_tags");
      });
    }

    // Prioritize hot questions
    query = query.orderByRaw("CASE WHEN is_hot = true THEN 0 ELSE 1 END");

    const questions = await query;

    res.json({
      country,
      age_group: ageGroup,
      interests,
      questions,
    });
  } catch (error) {
    console.error("Get personalized error:", error);
    res.status(500).json({ error: "Failed to get personalized questions" });
  }
};

// ─────────────────────────────────────────────
// GET /api/questions/patterns  — learned patterns for a country
// ─────────────────────────────────────────────
exports.getPatterns = async (req, res) => {
  try {
    const country = resolveCountry(req);
    const patterns = await getTopPatterns(req.db, country, 20);
    res.json({ country, patterns });
  } catch (error) {
    console.error("Get patterns error:", error);
    res.status(500).json({ error: "Failed to get patterns" });
  }
};

// ─────────────────────────────────────────────
// GET /api/questions/injection-stats  — admin: injection engine activity
// ─────────────────────────────────────────────
exports.getInjectionStatsEndpoint = async (req, res) => {
  try {
    const stats = await getInjectionStats(req.db);
    res.json(stats);
  } catch (error) {
    console.error("Get injection stats error:", error);
    res.status(500).json({ error: "Failed to get injection stats" });
  }
};

exports.deleteQuestion = async (req, res) => {
  try {
    const questionId = Number(req.params.id);
    const question = await softDeleteQuestion(req.db, questionId, req.userId, "admin_soft_delete");
    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    await logAdminAction(req, {
      action: "questions.soft_delete",
      entityType: "question",
      entityId: questionId,
    });

    res.json({ ok: true, question });
  } catch (error) {
    console.error("Delete question error:", error);
    res.status(500).json({ error: "Failed to delete question" });
  }
};

exports.restoreQuestion = async (req, res) => {
  try {
    const questionId = Number(req.params.id);
    const question = await restoreQuestionRecord(req.db, questionId);
    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    await logAdminAction(req, {
      action: "questions.restore",
      entityType: "question",
      entityId: questionId,
    });

    res.json({ ok: true, question });
  } catch (error) {
    console.error("Restore question error:", error);
    res.status(500).json({ error: "Failed to restore question" });
  }
};
