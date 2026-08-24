/**
 * Remix Controller — Remix Chain API endpoints
 *
 * POST /api/answers/:id/remix  — Create a remix
 * GET  /api/answers/:id/chain  — Get full remix chain
 * GET  /api/answers/:id/remixes — Get remix count + can-remix status
 */

const { hydrateAnswerRow, normalizeAnswerPayload } = require("../services/answerContent");
const { evaluateAnswerModeration } = require("../services/moderationService");
const { inferStorageFromUrl } = require("../services/uploadService");
const { createRemix, getRemixChain, getRemixCount, canRemix } = require("../services/remixService");
const { feedCache } = require("../services/infiniteFeedService");
const { incrementCountryStat } = require("../services/viralScoring");
const { kpiService } = require("../services/kpiService");
const { recordLoopAction, LOOP_ACTIONS, loadLoopState, persistLoopState } = require("../services/fusionLoopService");

function resolveCountry(req) {
  if (req.query?.country) return req.query.country.toUpperCase();
  if (req.body?.country) return req.body.country.toUpperCase();
  if (req.detectedCountry) return req.detectedCountry;
  return "GLOBAL";
}

/**
 * POST /api/answers/:id/remix
 * Body: { video_url, answer_type, text_content, response_time }
 */
exports.createRemix = async (req, res) => {
  try {
    const parentAnswerId = Number(req.params.id);
    const userId = req.userId;
    const country = resolveCountry(req);

    if (!parentAnswerId || !userId) {
      return res.status(400).json({ error: "Invalid request" });
    }

    // Check if user can remix
    const { canRemix: allowed, reason } = await canRemix(req.db, parentAnswerId, userId);
    if (!allowed) {
      const statusMap = {
        parent_not_found: 404,
        self_remix: 400,
        already_remixed: 409,
        max_depth_reached: 400,
      };
      return res.status(statusMap[reason] || 400).json({ error: reason });
    }

    // Normalize answer payload
    let normalizedAnswer;
    try {
      normalizedAnswer = normalizeAnswerPayload(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message || "Invalid answer payload" });
    }

    // Get parent answer for question_id
    const parent = await req.db("answers")
      .where({ id: parentAnswerId })
      .whereNull("deleted_at")
      .first();

    if (!parent) {
      return res.status(404).json({ error: "Parent answer not found" });
    }

    // Moderation check
    const storage = inferStorageFromUrl(normalizedAnswer.video_url);
    const moderation = await evaluateAnswerModeration(req.db, {
      ...normalizedAnswer,
      user_id: userId,
    });

    const answerData = {
      question_id: parent.question_id,
      answer_type: normalizedAnswer.answer_type,
      text_content: normalizedAnswer.text_content,
      video_url: normalizedAnswer.video_url,
      storage_provider: req.body.storage_provider || storage.storage_provider,
      storage_public_id: req.body.storage_public_id || storage.storage_public_id,
      moderation_status: moderation.moderation_status,
      moderation_reason: moderation.moderation_reason,
      moderation_labels: moderation.moderation_labels || null,
      abuse_score: moderation.abuse_score || 0,
      requires_human_review: Boolean(moderation.requires_human_review),
      is_hidden: Boolean(moderation.shouldHide),
    };

    if (req.body.response_time !== undefined && req.body.response_time !== null) {
      answerData.response_time = parseFloat(req.body.response_time);
    }

    // Create remix
    const remix = await createRemix(req.db, {
      parentAnswerId,
      userId,
      answerData,
    });

    // Track KPI
    await kpiService.trackAnswerFunnel(req.db, userId, parent.question_id, "published", {
      isRemix: true,
      parentAnswerId,
      chainDepth: remix.chain_depth,
    }).catch(() => {});

    // Update stats
    await incrementCountryStat(req.db, parent.question_id, "answers_count", country).catch(() => {});

    // Invalidate feed cache
    feedCache.invalidateCountry(country);

    // Create initial metrics row
    try {
      await req.db("answer_metrics").insert({
        answer_id: remix.id,
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
        engagement_score: Math.round((10 + Math.random() * 8) * 10) / 10, // Slight boost for remixes
      }).onConflict("answer_id").ignore();
    } catch (_) {}

    // 🔥 FUSION LOOP: Record remix action
    let fusionResult = null;
    try {
      await loadLoopState(req.db, userId);
      fusionResult = recordLoopAction(userId, LOOP_ACTIONS.REMIX);
      persistLoopState(req.db, userId).catch(() => {});
    } catch (_) {}

    const remixCount = await getRemixCount(req.db, parentAnswerId);

    res.status(201).json({
      ...hydrateAnswerRow(remix),
      is_remix: true,
      parent_answer_id: parentAnswerId,
      chain_depth: remix.chain_depth,
      parent_remix_count: remixCount,
      message: "Remix created successfully 🔥",
      fusion_loop: fusionResult,
    });
  } catch (error) {
    if (error.code === "parent_not_found") {
      return res.status(404).json({ error: "Parent answer not found" });
    }
    if (error.code === "self_remix") {
      return res.status(400).json({ error: "Cannot remix your own answer" });
    }
    console.error("Create remix error:", error);
    res.status(500).json({ error: "Failed to create remix" });
  }
};

/**
 * GET /api/answers/:id/chain
 * Returns the full remix chain for an answer.
 */
exports.getChain = async (req, res) => {
  try {
    const answerId = Number(req.params.id);
    if (!answerId) {
      return res.status(400).json({ error: "Invalid answer ID" });
    }

    const chain = await getRemixChain(req.db, answerId);
    if (!chain) {
      return res.status(404).json({ error: "Answer not found" });
    }

    res.json(chain);
  } catch (error) {
    console.error("Get chain error:", error);
    res.status(500).json({ error: "Failed to get remix chain" });
  }
};

/**
 * GET /api/answers/:id/remixes
 * Returns remix count and whether the user can remix.
 */
exports.getRemixInfo = async (req, res) => {
  try {
    const answerId = Number(req.params.id);
    if (!answerId) {
      return res.status(400).json({ error: "Invalid answer ID" });
    }

    const count = await getRemixCount(req.db, answerId);
    const userId = req.userId || null;

    let canRemixResult = { canRemix: false, reason: "not_authenticated" };
    if (userId) {
      canRemixResult = await canRemix(req.db, answerId, userId);
    }

    res.json({
      answer_id: answerId,
      remix_count: count,
      can_remix: canRemixResult.canRemix,
      reason: canRemixResult.reason || null,
      social_label: count > 0 ? `${count} ${count === 1 ? "person" : "people"} remixed this 👀` : null,
    });
  } catch (error) {
    console.error("Get remix info error:", error);
    res.status(500).json({ error: "Failed to get remix info" });
  }
};
