const { incrementCountryStat } = require("../services/viralScoring");
const {
  rankAnswerFeed,
  applyFusionAdaptation,
} = require("../services/feedComposer");
const { hydrateAnswerRow, normalizeAnswerPayload } = require("../services/answerContent");
const { getEffectiveAnswerLimit } = require("../services/usageLimits");
const { evaluateAnswerModeration } = require("../services/moderationService");
const { inferStorageFromUrl } = require("../services/uploadService");
const { adjustUserTrustScore } = require("../services/trustScoreService");
const { kpiService } = require("../services/kpiService");
const { isActiveDrop, recordDropAnswer } = require("../services/dropService");
const { recordLoopAction, LOOP_ACTIONS, loadLoopState, persistLoopState } = require("../services/fusionLoopService");
const {
  applyActiveAnswerFilter,
  applyActiveQuestionFilter,
  applyActiveUserFilter,
  getBlockedUserIds,
} = require("../services/safetyService");
const {
  getOrComputePreferences,
  personalizeAndRerankFeed,
  invalidatePreferences,
} = require("../services/personalizationService");
const {
  decodeCursor,
  sliceFeedFromCursor,
  injectTrending,
  feedCache,
  getCandidatePoolSize,
  applySessionAwareness,
  applyFirstVideoBoost,
  applyColdStartMix,
  enforceDiversity,
  applyMicroReranking,
  applyAttentionScoring,
  capStackedBoosts,
  applyViralDecay,
} = require("../services/infiniteFeedService");
const { getFeedContext, loadState } = require("../services/behaviorStateEngine");
const { injectTrendingIntoFeed, computeForYouScore } = require("../services/globalTrending");
const { injectExploration, applyQualityScoring, applyCreatorBoost, injectControlledRandomness, clampFeedScores } = require("../services/contentDiscovery");
const {
  getOrCreateEmbedding,
  applyEmbeddingRanking,
  updateEmbedding,
  getOrCreateSession,
  recordSessionProgress,
  recordSessionSkip,
  resetSessionSkips,
  markAsSeen,
  getSeenIds,
} = require("../services/embeddingService");

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

function seededRange(seedParts, min, max) {
  const seed = seedParts.reduce((acc, value) => acc + Number(value || 0) * 31, 17);
  return min + (Math.abs(seed) % (max - min + 1));
}

async function buildCreatorActivation(db, answer, questionId, userId) {
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recentResult = await db("answers")
    .where("question_id", questionId)
    .where("created_at", ">=", tenMinAgo)
    .count("id as count")
    .first();

  const recentAnswers = Math.max(0, (parseInt(recentResult?.count, 10) || 0) - 1);
  const feedSlots = seededRange([answer.id, questionId, userId], 12, 28);

  return {
    reach_label: `Entering ${feedSlots} fresh feed slots now`,
    live_label:
      recentAnswers > 0
        ? `${recentAnswers} ${recentAnswers === 1 ? "person is" : "people are"} answering this now`
        : "First reactions can land any moment",
    cta_label: "Watch the first reactions",
  };
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

    // Smart cache invalidation: only invalidate this country's feeds
    feedCache.invalidateCountry(country);

    // 🔥 Drop tracking: if this answer is during an active drop, record participation
    const isDrop = isActiveDrop(question_id);
    if (isDrop) {
      recordDropAnswer(req.db, question_id, user_id, answer.id).catch(() => {});
    }

    // 🔥 FUSION LOOP: Record answer action (+ drop if applicable)
    let fusionResult = null;
    try {
      await loadLoopState(req.db, user_id);
      fusionResult = recordLoopAction(user_id, LOOP_ACTIONS.ANSWER);
      if (isDrop) {
        fusionResult = recordLoopAction(user_id, LOOP_ACTIONS.DROP);
      }
      persistLoopState(req.db, user_id).catch(() => {});
    } catch (_) {}

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
    const creatorActivation = await buildCreatorActivation(req.db, answer, question_id, user_id);

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
      },
      creator_activation: creatorActivation,
      fusion_loop: fusionResult,
    });

    // 🔥 HAPI 3: Boost new answer for 15 min (fire-and-forget)
    try {
      await req.db("answer_metrics").insert({
        answer_id: answer.id,
        views_24h: 0,
        completes_24h: 0,
        skips_24h: 0,
        likes_24h: 0,
        shares_24h: 0,
        replays_24h: 0,
        avg_watch_time: 0,
        total_watch_time: 0,
        completion_rate: 0,
        skip_rate: 0,
        engagement_score: Math.round((8 + Math.random() * 6) * 10) / 10, // 8-14 range for organic feel
      }).onConflict("answer_id").ignore();
    } catch (_) {}
  } catch (error) {
    console.error("Create answer error:", error);
    res.status(500).json({ error: "Failed to create answer" });
  }
};

// Get all answers (feed) - cursor-based infinite scroll v4
exports.getFeed = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
    const cursorParam = req.query.cursor || null;
    const country = resolveCountry(req);
    const experimentVariant = String(req.query.experiment_variant || "retention_boost");
    const userId = req.userId || null;

    // ── 1. Try GLOBAL cache (shared across all users) ──
    let globalRankedFeed = feedCache.get(country);

    if (!globalRankedFeed) {
      // ── 2. Build candidate pool (DYNAMIC size) ──────
      let userProfile = null;
      if (userId) {
        try {
          const embedding = await getOrCreateEmbedding(req.db, userId);
          userProfile = embedding;
        } catch (_) {}
      }
      const candidateLimit = getCandidatePoolSize(userProfile);
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
          "questions.interest_tags",
          "questions.answers_count as question_answers_count",
          "questions.performance_score",
          "country_stats.score as country_score",
          "global_stats.score as global_score",
          "answers.parent_answer_id",
          "answers.chain_depth",
          "answers.is_remix"
        )
        .orderBy("answers.created_at", "desc")
        .limit(candidateLimit);

      applyActiveAnswerFilter(query, "answers");
      applyActiveUserFilter(query, "users");
      applyActiveQuestionFilter(query, "questions");

      if (country && country !== "GLOBAL") {
        query = query.whereIn("questions.country", [country, "GLOBAL"]);
      }

      if (blockedUserIds.length > 0) {
        query = query.whereNotIn("users.id", blockedUserIds);
      }

      const answers = await query;

      // ── 3. Compute engagement counters ────────────────
      const questionIds = [...new Set(answers.map((a) => Number(a.question_id)))];
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const [todayCounts, recentCounts, hourlyCounts] = await Promise.all([
        getQuestionCountsSince(req.db, questionIds, todayStart.toISOString()),
        getQuestionCountsSince(req.db, questionIds, tenMinAgo),
        getQuestionCountsSince(req.db, questionIds, oneHourAgo),
      ]);

      // ── 4. Rank (quality score — no personalization) ──
      globalRankedFeed = rankAnswerFeed(
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

      // 🚀 UPGRADE 3: Apply attention scoring (watch_time / video_length)
      globalRankedFeed = applyAttentionScoring(globalRankedFeed);

      // ── 5. Inject trending (probabilistic) ──────────
      try {
        const { getHotQuestions } = require("../services/injectionEngine");
        const trending = await getHotQuestions(req.db, country);
        if (trending && trending.length > 0) {
          const trendingItems = trending.slice(0, 3).map((q) => ({
            id: `trending_${q.id}`,
            question_id: q.id,
            question_text: q.text,
            question_country: q.country,
            category: q.category,
            feed_score: (q.performance_score || 0) * 0.8,
            is_trending_question: true,
            created_at: q.created_at,
          }));
          globalRankedFeed = injectTrending(globalRankedFeed, trendingItems);
        }
      } catch (_) {}

      // FIX 5: Cap stacked boost+trending weights
      globalRankedFeed = capStackedBoosts(globalRankedFeed);

      // ── 6. Enforce diversity (no 3 same category in a row) ──
      globalRankedFeed = enforceDiversity(globalRankedFeed);

      // ── 7. Cache the GLOBAL ranked feed ─────────────
      feedCache.set(country, globalRankedFeed);
    }

    // ── 8. RUNTIME PERSONALIZATION (per-user, not cached) ──
    // FIX 2: Work on a shallow copy, personalize lightly
    let personalizedFeed = [...globalRankedFeed];

    // Decode cursor early — needed for session logic
    const cursor = decodeCursor(cursorParam);
    let session = null;
    let behaviorCtx = { scrollSpeed: 0, sessionSwipes: 0, skipRate: 0, dwellTime: 0, engagementScore: 0, topicAffinity: {} };

    if (userId) {
      // 🔥 v3: Load pre-computed behavior state (hot cache → DB fallback)
      try {
        let ctx = getFeedContext(userId);
        if (ctx.engagementScore === 0 && ctx.scrollSpeed === 0) {
          // Cold start: try loading from DB
          await loadState(req.db, userId);
          ctx = getFeedContext(userId);
        }
        behaviorCtx = ctx;
      } catch (_) {}

      // Get/create session for skip tracking + duration
      try {
        session = await getOrCreateSession(req.db, userId, cursor?.sessionId || null);
      } catch (_) {}

      // Personalize via preference profile
      try {
        const prefs = await getOrComputePreferences(req.db, userId);
        if (prefs) {
          personalizedFeed = personalizeAndRerankFeed(personalizedFeed, prefs, country);
        }
      } catch (prefErr) {
        console.log(`⚠️ Personalization skipped for user ${userId}: ${prefErr.message}`);
      }

      // Embedding ranking (cosine similarity)
      try {
        const embedding = await getOrCreateEmbedding(req.db, userId);
        if (embedding && embedding.total_interactions >= 3) {
          personalizedFeed = applyEmbeddingRanking(personalizedFeed, embedding, {
            sessionDepth: session?.items_seen || 0,
          });

          // FIX 4: Session-aware skip detection (rate-based, not count-based)
          const sessionDurationSec = session?.started_at
            ? Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000)
            : 0;

          personalizedFeed = applySessionAwareness(personalizedFeed, {
            recent_skips: session?.recent_skips || 0,
            items_seen: session?.items_seen || 0,
            session_duration_sec: sessionDurationSec,
            // 🔥 v3: Read from pre-computed behavior state (not computed here)
            avg_swipe_speed: behaviorCtx.scrollSpeed,
            scroll_depth: behaviorCtx.sessionSwipes,
          });
        } else if (!embedding || embedding.total_interactions < 3) {
          // COLD START: new user with no data → diverse mix
          personalizedFeed = applyColdStartMix(personalizedFeed);
        }
      } catch (_) {}

      // FIX 3: First video boost ONLY on true first load (no cursor + new session)
      const isFirstLoad = !cursorParam && (!session || (session.items_seen || 0) === 0);
      personalizedFeed = applyFirstVideoBoost(personalizedFeed, isFirstLoad);
    } else {
      // Anonymous user → cold start mix + first video boost
      personalizedFeed = applyColdStartMix(personalizedFeed);
      personalizedFeed = applyFirstVideoBoost(personalizedFeed, !cursorParam);
    }

    // 🔥 v3: Apply viral decay scoring (TikTok-style log + decay)
    personalizedFeed = applyViralDecay(personalizedFeed);

    // 📊 Content Quality Score: stops clickbait, rewards watch completion + replays
    personalizedFeed = applyQualityScoring(personalizedFeed);

    // 🎬 Creator Level Boost: good creators rise faster
    personalizedFeed = applyCreatorBoost(personalizedFeed);

    // 🌍 Global Trending: behavior-driven injection (skipRate → more, dwell → less)
    const feedCountry = req.query.country || req.headers["x-user-country"] || null;
    personalizedFeed = injectTrendingIntoFeed(personalizedFeed, 5, feedCountry, behaviorCtx);

    // 🧠 For You Score: globalScore × 0.4 + userAffinity × 0.4 + sessionScore × 0.2
    personalizedFeed = personalizedFeed.map(item => ({
      ...item,
      for_you_score: computeForYouScore(item, behaviorCtx),
      feed_score: (item.feed_score || 0) + computeForYouScore(item, behaviorCtx),
    })).sort((a, b) => (b.feed_score || 0) - (a.feed_score || 0));

    // 🔍 Exploration: inject new/low-exposure content (cold start ×3, low exposure ×2)
    personalizedFeed = injectExploration(personalizedFeed, globalRankedFeed, 3);

    // 🎲 FIX 1: Controlled randomness (10% chaos = freshness)
    personalizedFeed = injectControlledRandomness(personalizedFeed);

    // 🚀 UPGRADE 2: Micro-reranking (slight shuffle in top 5)
    personalizedFeed = applyMicroReranking(personalizedFeed);

    // 🔥 FUSION LOOP: Adapt feed based on missing loop actions
    if (userId) {
      personalizedFeed = applyFusionAdaptation(personalizedFeed, userId);
    }

    // ⚠️ FIX 4: Score clamping fail-safe (0-1000)
    personalizedFeed = clampFeedScores(personalizedFeed);

    // ── 9. Keyset cursor slicing ─────────────────────
    // FIX 1: seenIds only loaded for first page (cursor handles dedup after that)
    const seenIds = (userId && !cursorParam) ? await getSeenIds(req.db, userId) : new Set();
    const result = sliceFeedFromCursor(personalizedFeed, cursor, limit, seenIds);

    // Mark returned items as seen (server-side, fire-and-forget)
    if (userId && result.items.length > 0) {
      const numericIds = result.items.map((i) => i.id).filter((id) => typeof id === "number");
      markAsSeen(req.db, userId, numericIds).catch(() => {});
      recordSessionProgress(req.db, userId, result.sessionId, result.items.length).catch(() => {});
    }

    // ── 10. Backward compat: support ?page= for old clients
    if (!cursorParam && req.query.page) {
      const page = parseInt(req.query.page) || 1;
      const offset = (page - 1) * limit;
      return res.json(personalizedFeed.slice(offset, offset + limit));
    }

    res.json({
      items: result.items,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
      meta: {
        total_candidates: result.totalCandidates,
        page_size: result.items.length,
        country,
        cache_version: feedCache.getVersion(country),
      },
    });
  } catch (error) {
    console.error("Get feed error:", error);
    res.status(500).json({ error: "Failed to get answers" });
  }
};


// FIX 5: Deep link — GET /api/answers/:id
exports.getById = async (req, res) => {
  try {
    const answerId = Number(req.params.id);
    if (!answerId) return res.status(400).json({ error: "Invalid answer ID" });

    const answer = await req.db("answers")
      .leftJoin("users", "answers.user_id", "users.id")
      .leftJoin("questions", "answers.question_id", "questions.id")
      .where("answers.id", answerId)
      .whereNull("answers.deleted_at")
      .select(
        "answers.*",
        "users.username",
        "users.display_name",
        "questions.text as question_text",
        "questions.category as question_category"
      )
      .first();

    if (!answer) {
      return res.status(404).json({ error: "Answer not found" });
    }

    if (answer.is_hidden || answer.moderation_status === "rejected") {
      return res.status(404).json({ error: "Answer not available" });
    }

    // Get metrics if available
    let metrics = null;
    try {
      metrics = await req.db("answer_metrics").where("answer_id", answerId).first();
    } catch (_) {}

    res.json({
      ...hydrateAnswerRow(answer),
      username: answer.username || "Anonymous",
      display_name: answer.display_name || answer.username || "Anonymous",
      question_text: answer.question_text || "",
      question_category: answer.question_category || null,
      metrics: metrics ? {
        views: metrics.views_24h,
        likes: metrics.likes_24h,
        completion_rate: metrics.completion_rate,
        engagement_score: metrics.engagement_score,
      } : null,
      deep_link: true,
    });
  } catch (error) {
    console.error("Get answer by ID error:", error);
    res.status(500).json({ error: "Failed to get answer" });
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

    // Smart cache: bump score in-place instead of full invalidation
    feedCache.bumpScore(parseInt(id), "likes");

    // Update embedding: like = strong positive signal
    if (req.userId) {
      updateEmbedding(req.db, req.userId, answer, "like").catch(() => {});
    }

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

    // Smart cache: bump score in-place
    feedCache.bumpScore(parseInt(id), "shares");

    // Update embedding: share = strongest positive signal
    if (req.userId) {
      updateEmbedding(req.db, req.userId, answer, "share").catch(() => {});
    }

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

    // Real-time feedback loop: update embedding + invalidate preferences
    if (req.userId) {
      invalidatePreferences(req.db, req.userId).catch(() => {});
      // Map event types to embedding signals
      const signalMap = { completed: "completed", skipped: "skip", replayed: "replayed", watch_progress: "view" };
      const signal = signalMap[eventType];
      if (signal) {
        updateEmbedding(req.db, req.userId, answer, signal).catch(() => {});
      }

      // Session-aware skip tracking
      if (sessionId) {
        if (eventType === "skipped") {
          recordSessionSkip(req.db, req.userId, sessionId).catch(() => {});
        } else if (["completed", "replayed"].includes(eventType)) {
          // User found something engaging — reset skip counter
          resetSessionSkips(req.db, req.userId, sessionId).catch(() => {});
        }
      }
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("Track answer engagement error:", error);
    res.status(500).json({ error: "Failed to track answer engagement" });
  }
};
