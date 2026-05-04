/**
 * Share Video Service v2 — Viral Growth Machine
 *
 * FEATURES:
 *   1. GET /api/share/:answerId — returns share data + overlay config
 *   2. POST /api/share/video — generate share video (FFmpeg)
 *   3. POST /api/share/:answerId/track — granular share event tracking
 *   4. GET /api/share/top — top 30 shareable questions
 *   5. GET /api/share/:answerId/stats — creator dopamine stats (views/answers/shares)
 *
 * VIDEO TEMPLATE (STANDARD):
 *   [0–1s]  "Answer this in 5 seconds"
 *   [1–4s]  Question (BIG TEXT)
 *   [4–7s]  Real answer (imperfect)
 *   [7–9s]  CTA: "Open 5SEK and answer"
 *
 * OVERLAY (always visible):
 *   👀 Can you answer this?
 *   ⏱ 5 seconds only
 *   📲 5SEK
 */

const { getTopShareableQuestions } = require("./questionQuality");

// ─────────────────────────────────────────────
// 1. GET /api/share/:answerId — Build share video data
// ─────────────────────────────────────────────

async function getShareData(req, res) {
  try {
    const answerId = parseInt(req.params.answerId);
    if (!answerId) return res.status(400).json({ error: "Invalid answer ID" });

    // Get answer + question
    const answer = await req.db("answers")
      .leftJoin("questions", "answers.question_id", "questions.id")
      .leftJoin("users", "answers.user_id", "users.id")
      .select(
        "answers.id",
        "answers.video_url",
        "answers.audio_url",
        "answers.text_answer",
        "answers.text_content",
        "answers.duration",
        "answers.user_id",
        "answers.question_id",
        "questions.text as question_text",
        "questions.category",
        "questions.country",
        "users.display_name",
        "users.username"
      )
      .where("answers.id", answerId)
      .first();

    if (!answer) return res.status(404).json({ error: "Answer not found" });

    // Build share data
    const shareData = {
      answerId: answer.id,
      videoUrl: answer.video_url || answer.audio_url,
      duration: answer.duration || 5,

      // Question overlay
      question: answer.question_text || "Can you answer this?",
      category: answer.category || "general",

      // Creator info
      creator: {
        name: answer.display_name || answer.username || "Anonymous",
        id: answer.user_id,
      },

      // Share overlay config — VIDEO TEMPLATE
      overlay: {
        // Hook phase (0-1s)
        hook: {
          text: "Answer this in 5 seconds",
          fontSize: 32,
          position: "top",
          background: "rgba(0,0,0,0.8)",
          durationMs: 1000,
        },
        // Question phase (1-4s) — BIG TEXT
        question: {
          text: answer.question_text || "Can you answer this?",
          fontSize: 48,
          position: "center",
          background: "rgba(0,0,0,0.7)",
          durationMs: 3000,
        },
        // Answer phase (4-7s)
        answer: {
          videoUrl: answer.video_url || answer.audio_url,
          durationMs: 3000,
        },
        // CTA phase (7-9s)
        cta: {
          text: "Open 5SEK and answer 👇",
          subtext: "I had 5 seconds. Your turn.",
          fontSize: 36,
          position: "bottom",
          background: "rgba(0,0,0,0.85)",
          durationMs: 2000,
        },
        // Persistent overlay (always visible)
        persistent: {
          topLeft: "👀 Can you answer this?",
          topRight: "⏱ 5 seconds only",
          bottomRight: "📲 5SEK",
        },
        // Watermark (always visible)
        watermark: {
          text: "@5sek.app",
          fontSize: 18,
          position: "top-right",
          opacity: 0.7,
        },
      },

      // Deep link for caption
      deepLink: `https://5sek.app/a/${answer.id}`,
      appLink: `five-second://answer/${answer.id}`,
      shareCaption: `I had 5 seconds. Your turn.\n👉 5sek.app/a/${answer.id}\n\n#5sek #5secondanswer #quiz`,

      // Platform-specific captions
      captions: {
        tiktok: `${answer.question_text || "Can you do better?"} ⏱ I had 5 seconds. Your turn. #5sek #fyp #quiz`,
        instagram: `${answer.question_text || "Can you answer this?"}\n\n⏱ You have 5 seconds!\nI had 5 seconds. Your turn.\n🔗 Link in bio\n\n#5sek #5secondanswer #reels`,
        whatsapp: `🎯 ${answer.question_text || "Try this!"}\n\nI had 5 seconds. Your turn.\n⏱ Answer in 5 seconds: 5sek.app/a/${answer.id}`,
        generic: `${answer.question_text || "Can you answer this?"} ⏱ 5sek.app/a/${answer.id}`,
      },
    };

    // Track share initiation
    try {
      const { ingestEvent } = require("./globalTrending");
      ingestEvent({
        event_type: "share",
        entity_type: "answer",
        entity_id: answerId,
        user_id: req.userId || null,
      });
    } catch (_) {}

    // Update creator stats (real_shares++)
    _updateCreatorStat(req.db, answerId, answer.user_id, "real_shares").catch(() => {});

    res.json(shareData);
  } catch (error) {
    console.error("Share data error:", error);
    res.status(500).json({ error: "Failed to generate share data" });
  }
}

// ─────────────────────────────────────────────
// 2. POST /api/share/video — Generate share video
// ─────────────────────────────────────────────

async function generateShareVideo(req, res) {
  try {
    const { question, answerVideoUrl, answerId } = req.body;

    if (!question || !answerId) {
      return res.status(400).json({ error: "question and answerId required" });
    }

    // Store video generation request
    try {
      await req.db("share_videos").insert({
        answer_id: answerId,
        user_id: req.userId || null,
        video_url: answerVideoUrl || null,
        status: "pending",
        question_text: question,
        overlay_config: JSON.stringify({
          hook: "Answer this in 5 seconds",
          question: question,
          cta: "Open 5SEK and answer 👇",
          persistent: {
            topLeft: "👀 Can you answer this?",
            topRight: "⏱ 5 seconds only",
            bottomRight: "📲 5SEK",
          },
        }),
      });
    } catch (_) {}

    // Return overlay config for client-side rendering
    // (FFmpeg server-side generation is opt-in for scale)
    res.json({
      ok: true,
      answerId,
      status: "client_render",
      overlayConfig: {
        // Phase 1: Hook (0-1s)
        phases: [
          {
            start: 0,
            end: 1,
            text: "Answer this in 5 seconds",
            fontSize: 32,
            position: "center",
            textColor: "#FFFFFF",
            bgColor: "rgba(0,0,0,0.85)",
          },
          {
            start: 1,
            end: 4,
            text: question,
            fontSize: 48,
            position: "center",
            textColor: "#FFFFFF",
            bgColor: "rgba(0,0,0,0.7)",
          },
          {
            start: 4,
            end: 7,
            type: "video",
            videoUrl: answerVideoUrl,
          },
          {
            start: 7,
            end: 9,
            text: "Open 5SEK and answer 👇",
            subtext: "I had 5 seconds. Your turn.",
            fontSize: 36,
            position: "bottom",
            textColor: "#FFFFFF",
            bgColor: "rgba(255,51,102,0.9)",
          },
        ],
        // Always-visible overlays
        persistent: [
          { text: "👀 Can you answer this?", position: "top-left", fontSize: 14 },
          { text: "⏱ 5 seconds only", position: "top-right", fontSize: 14 },
          { text: "📲 5SEK", position: "bottom-right", fontSize: 16 },
        ],
      },
      deepLink: `https://5sek.app/a/${answerId}`,
      caption: `I had 5 seconds. Your turn.\n👉 5sek.app/a/${answerId}`,
    });
  } catch (error) {
    console.error("Generate share video error:", error);
    res.status(500).json({ error: "Failed to generate share video" });
  }
}

// ─────────────────────────────────────────────
// 3. POST /api/share/:answerId/track — Granular share tracking
// ─────────────────────────────────────────────

function trackShareEvent(req, res) {
  const answerId = parseInt(req.params.answerId);
  const { platform, event: eventType } = req.body;

  // Valid events: share_export, share_open, answer_from_share, share_click, share_complete, share_cancel
  const validEvents = [
    "share_export",
    "share_open",
    "answer_from_share",
    "share_click",
    "share_complete",
    "share_cancel",
  ];
  if (!validEvents.includes(eventType)) {
    return res.status(400).json({ error: "Invalid event type" });
  }

  // Store in share_events table (fire-and-forget)
  try {
    req.db("share_events")
      .insert({
        answer_id: answerId,
        user_id: req.userId || null,
        event_type: eventType,
        platform: platform || "unknown",
        session_id: req.body.session_id || null,
        metadata: req.body.metadata ? JSON.stringify(req.body.metadata) : null,
      })
      .catch(() => {});
  } catch (_) {}

  // Ingest into trending
  try {
    const { ingestEvent } = require("./globalTrending");
    if (eventType === "share_complete" || eventType === "share_export") {
      ingestEvent({
        event_type: "share_clicked",
        entity_type: "answer",
        entity_id: answerId,
        user_id: req.userId || null,
        metadata: JSON.stringify({ platform: platform || "unknown", event: eventType }),
      });
    }
    if (eventType === "share_open") {
      ingestEvent({
        event_type: "view",
        entity_type: "answer",
        entity_id: answerId,
        user_id: req.userId || null,
        metadata: JSON.stringify({ source: "share_link" }),
      });
    }
  } catch (_) {}

  res.json({ ok: true, event: eventType, platform });
}

// ─────────────────────────────────────────────
// 4. GET /api/share/top — Top 30 shareable questions
// ─────────────────────────────────────────────

async function getTopShareable(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const questions = await getTopShareableQuestions(req.db, limit);

    // Enrich with share overlay config for each
    const enriched = questions.map((q) => ({
      ...q,
      share_config: {
        caption: `${q.text} ⏱ #5sek #fyp #quiz`,
        hook: "Answer this in 5 seconds",
        cta: "Open 5SEK and answer 👇",
        deepLink: `https://5sek.app/q/${q.id}`,
      },
    }));

    res.json({
      questions: enriched,
      total: enriched.length,
      usage: "Use these questions for TikTok/Instagram/WhatsApp share videos",
    });
  } catch (error) {
    console.error("Top shareable error:", error);
    res.status(500).json({ error: "Failed to get shareable questions" });
  }
}

// ─────────────────────────────────────────────
// 5. GET /api/share/:answerId/stats — Creator Dopamine Stats
// ─────────────────────────────────────────────

async function getCreatorStats(req, res) {
  try {
    const answerId = parseInt(req.params.answerId);
    if (!answerId) return res.status(400).json({ error: "Invalid answer ID" });

    // Get or create creator stats
    let stats = null;
    try {
      stats = await req.db("creator_stats").where("answer_id", answerId).first();
    } catch (_) {}

    // Fallback: compute from raw data
    if (!stats) {
      const answer = await req.db("answers").where("id", answerId).first();
      if (!answer) return res.status(404).json({ error: "Answer not found" });

      const realViews = answer.views || 0;
      const realShares = answer.shares || 0;
      const realLikes = answer.likes || 0;

      // Count real answers to same question
      let realAnswers = 0;
      try {
        const result = await req.db("answers")
          .where("question_id", answer.question_id)
          .where("id", "!=", answerId)
          .count("id as count")
          .first();
        realAnswers = parseInt(result?.count) || 0;
      } catch (_) {}

      stats = {
        answer_id: answerId,
        user_id: answer.user_id,
        real_views: realViews,
        real_answers: realAnswers,
        real_shares: realShares,
        real_likes: realLikes,
      };
    }

    // 🔥 CREATOR DOPAMINE: Fake → Real hybrid
    // views = realViews + random(5–15) (seeded, not truly random)
    // answers = realAnswers + random(1–3)
    const seed = answerId * 7919; // prime-based deterministic "random"
    const viewBoost = 5 + (seed % 11);       // 5–15
    const answerBoost = 1 + (seed % 3);       // 1–3

    const displayViews = stats.real_views + viewBoost;
    const displayAnswers = stats.real_answers + answerBoost;

    // Dynamic label generation
    const viewLabel = displayViews > 0
      ? `${displayViews} people saw your answer 👀`
      : "Your answer is live! 🚀";

    const answerLabel = displayAnswers > 0
      ? `${displayAnswers} are answering right now 🔥`
      : "Be the first wave 🌊";

    const shareLabel = stats.real_shares > 0
      ? `Shared ${stats.real_shares} times 📤`
      : null;

    res.json({
      answerId,
      stats: {
        views: displayViews,
        answers: displayAnswers,
        shares: stats.real_shares,
        likes: stats.real_likes,
      },
      labels: {
        views: viewLabel,
        answers: answerLabel,
        shares: shareLabel,
      },
      // Motivation tier
      tier: displayViews >= 50 ? "viral" : displayViews >= 20 ? "rising" : "fresh",
      motivation: _getMotivationMessage(displayViews, displayAnswers, stats.real_shares),
    });
  } catch (error) {
    console.error("Creator stats error:", error);
    res.status(500).json({ error: "Failed to get creator stats" });
  }
}

// ─────────────────────────────────────────────
// 6. KPI Tracking helpers
// ─────────────────────────────────────────────

async function getShareKPIs(req, res) {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let kpis = {
      open_rate: 0,
      answer_rate: 0,
      share_rate: 0,
      total_exports: 0,
      total_opens: 0,
      total_answers_from_share: 0,
    };

    try {
      const hasTable = await req.db.schema.hasTable("share_events");
      if (hasTable) {
        const [exports, opens, answersFromShare] = await Promise.all([
          req.db("share_events")
            .where("event_type", "share_export")
            .where("created_at", ">=", oneDayAgo)
            .count("id as count")
            .first(),
          req.db("share_events")
            .where("event_type", "share_open")
            .where("created_at", ">=", oneDayAgo)
            .count("id as count")
            .first(),
          req.db("share_events")
            .where("event_type", "answer_from_share")
            .where("created_at", ">=", oneDayAgo)
            .count("id as count")
            .first(),
        ]);

        const totalExports = parseInt(exports?.count) || 0;
        const totalOpens = parseInt(opens?.count) || 0;
        const totalAnswers = parseInt(answersFromShare?.count) || 0;

        kpis = {
          open_rate: totalExports > 0 ? Math.round((totalOpens / totalExports) * 100) / 100 : 0,
          answer_rate: totalOpens > 0 ? Math.round((totalAnswers / totalOpens) * 100) / 100 : 0,
          share_rate: totalExports > 0 ? Math.round(totalExports * 100) / 100 : 0,
          total_exports: totalExports,
          total_opens: totalOpens,
          total_answers_from_share: totalAnswers,
        };
      }
    } catch (_) {}

    res.json({ period: "24h", kpis });
  } catch (error) {
    console.error("Share KPIs error:", error);
    res.status(500).json({ error: "Failed to get share KPIs" });
  }
}

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

function _getMotivationMessage(views, answers, shares) {
  if (shares >= 5) return "Your answer is spreading! Keep posting 🚀";
  if (views >= 50) return "50+ views! You're on fire 🔥";
  if (answers >= 5) return "People are answering because of you 💪";
  if (views >= 20) return "Your answer is gaining traction! 📈";
  if (views >= 10) return "People are watching! Post another? 👀";
  return "Your answer is live! First reactions incoming 🎬";
}

async function _updateCreatorStat(db, answerId, userId, field) {
  try {
    const hasTable = await db.schema.hasTable("creator_stats");
    if (!hasTable) return;

    const existing = await db("creator_stats").where("answer_id", answerId).first();
    if (existing) {
      await db("creator_stats")
        .where("answer_id", answerId)
        .increment(field, 1)
        .update({ last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    } else {
      await db("creator_stats").insert({
        answer_id: answerId,
        user_id: userId,
        [field]: 1,
        last_activity_at: new Date().toISOString(),
      });
    }
  } catch (_) {}
}

module.exports = {
  getShareData,
  generateShareVideo,
  trackShareEvent,
  getTopShareable,
  getCreatorStats,
  getShareKPIs,
  _updateCreatorStat,
};
