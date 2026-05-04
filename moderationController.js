const {
  createUserBlock,
  listUserBlocks,
  removeUserBlock,
  restoreAnswer,
  restoreUser,
  setUserBlocked,
  softDeleteAnswer,
  softDeleteUser,
} = require("../services/safetyService");
const { evaluateAnswerModeration } = require("../services/moderationService");
const { adjustUserTrustScore } = require("../services/trustScoreService");

const REPORT_HIDE_THRESHOLD = Number(process.env.MODERATION_REPORT_HIDE_THRESHOLD || 3);

function parseMetadata(row) {
  if (!row || !row.metadata || typeof row.metadata !== "string") return row;
  try {
    return { ...row, metadata: JSON.parse(row.metadata) };
  } catch (_) {
    return row;
  }
}

async function getUniqueAnswerReportCount(db, answerId) {
  const rows = await db("moderation_reports")
    .where({
      entity_type: "answer",
      entity_id: answerId,
    })
    .whereNotNull("reporter_user_id")
    .select("reporter_user_id");

  return new Set(rows.map((row) => Number(row.reporter_user_id)).filter(Boolean)).size;
}

async function applyAnswerReportThreshold(db, answer) {
  const reportCount = await getUniqueAnswerReportCount(db, answer.id);
  const nextUpdate = {
    report_count: reportCount,
    last_reported_at: new Date().toISOString(),
  };

  let autoHidden = false;
  const moderationReasons = String(answer.moderation_reason || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (reportCount >= REPORT_HIDE_THRESHOLD) {
    autoHidden = true;
    nextUpdate.is_hidden = true;
    nextUpdate.requires_human_review = true;
    nextUpdate.moderation_status = "flagged";
    nextUpdate.abuse_score = Math.max(Number(answer.abuse_score || 0), 60);
    if (!moderationReasons.includes("report_threshold_reached")) {
      moderationReasons.push("report_threshold_reached");
    }
  }

  nextUpdate.moderation_reason = moderationReasons.join(";") || answer.moderation_reason || null;

  const [updatedAnswer] = await db("answers")
    .where({ id: answer.id })
    .update(nextUpdate)
    .returning("*");

  if (autoHidden && answer.moderation_status !== "flagged" && !answer.is_hidden) {
    await adjustUserTrustScore(db, answer.user_id, -10);
  }

  return {
    answer: updatedAnswer || { ...answer, ...nextUpdate },
    reportCount,
    autoHidden,
  };
}

exports.checkAnswer = async (req, res) => {
  try {
    const answerType = String(req.body.answer_type || "text").toLowerCase();
    const content = typeof req.body.content === "string" ? req.body.content : null;
    const responseTime = req.body.response_time;
    const videoUrl =
      typeof req.body.video_url === "string" && req.body.video_url.trim()
        ? req.body.video_url.trim()
        : answerType === "video" || answerType === "audio"
          ? "http://localhost/moderation-preview"
          : null;

    const moderation = await evaluateAnswerModeration(req.db, {
      user_id: req.userId,
      answer_type: answerType,
      text_content: content,
      response_time: responseTime,
      video_url: videoUrl,
    });

    res.json({
      decision: moderation.shouldHide || moderation.moderation_status === "flagged" ? "REJECT" : "ALLOW",
      moderation,
    });
  } catch (error) {
    console.error("Check moderation error:", error);
    res.status(500).json({ error: "Failed to check moderation" });
  }
};

exports.reportAnswer = async (req, res) => {
  try {
    const answerId = Number(req.params.id);
    const reporterUserId = req.userId;
    const { reason, details } = req.body;

    if (!answerId || !reason) {
      return res.status(400).json({ error: "reason required" });
    }

    const answer = await req.db("answers").where({ id: answerId }).first();
    if (!answer) {
      return res.status(404).json({ error: "answer_not_found" });
    }

    if (Number(answer.user_id) === Number(reporterUserId)) {
      return res.status(400).json({ error: "cannot_report_own_answer" });
    }

    const existingReport = await req.db("moderation_reports")
      .where({
        entity_type: "answer",
        entity_id: answerId,
        reporter_user_id: reporterUserId,
      })
      .first();

    if (existingReport) {
      const reportCount = await getUniqueAnswerReportCount(req.db, answerId);
      return res.json({
        ...existingReport,
        duplicate: true,
        report_count: reportCount,
        auto_hidden: Boolean(answer.is_hidden),
      });
    }

    const [report] = await req.db("moderation_reports")
      .insert({
        entity_type: "answer",
        entity_id: answerId,
        reporter_user_id: reporterUserId,
        reason,
        details: details || null,
        status: "pending",
      })
      .returning("*");

    const reportState = await applyAnswerReportThreshold(req.db, answer);

    res.status(201).json({
      ...report,
      report_count: reportState.reportCount,
      auto_hidden: reportState.autoHidden,
    });
  } catch (error) {
    console.error("Report answer error:", error);
    res.status(500).json({ error: "Failed to create report" });
  }
};

exports.reportUser = async (req, res) => {
  try {
    const targetUserId = Number(req.params.id);
    const reporterUserId = req.userId;
    const { reason, details } = req.body;

    if (!targetUserId || !reason) {
      return res.status(400).json({ error: "reason required" });
    }

    if (targetUserId === reporterUserId) {
      return res.status(400).json({ error: "cannot_report_self" });
    }

    const targetUser = await req.db("users").where({ id: targetUserId }).first();
    if (!targetUser || targetUser.deleted_at) {
      return res.status(404).json({ error: "user_not_found" });
    }

    const existingReport = await req.db("moderation_reports")
      .where({
        entity_type: "user",
        entity_id: targetUserId,
        reporter_user_id: reporterUserId,
      })
      .first();

    if (existingReport) {
      return res.json({
        ...existingReport,
        duplicate: true,
      });
    }

    const [report] = await req.db("moderation_reports")
      .insert({
        entity_type: "user",
        entity_id: targetUserId,
        reporter_user_id: reporterUserId,
        reason,
        details: details || null,
        status: "pending",
      })
      .returning("*");

    res.status(201).json(report);
  } catch (error) {
    console.error("Report user error:", error);
    res.status(500).json({ error: "Failed to create report" });
  }
};

exports.blockUser = async (req, res) => {
  try {
    const targetUserId = Number(req.params.id);
    const actorUserId = req.userId;

    const targetUser = await req.db("users").where({ id: targetUserId }).first();
    if (!targetUser || targetUser.deleted_at) {
      return res.status(404).json({ error: "user_not_found" });
    }

    await createUserBlock(req.db, actorUserId, targetUserId);
    res.status(201).json({ ok: true });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    console.error("Block user error:", error);
    res.status(500).json({ error: "Failed to block user" });
  }
};

exports.unblockUser = async (req, res) => {
  try {
    const targetUserId = Number(req.params.id);
    await removeUserBlock(req.db, req.userId, targetUserId);
    res.json({ ok: true });
  } catch (error) {
    console.error("Unblock user error:", error);
    res.status(500).json({ error: "Failed to unblock user" });
  }
};

exports.getMyBlocks = async (req, res) => {
  try {
    const blocks = await listUserBlocks(req.db, req.userId);
    res.json(blocks);
  } catch (error) {
    console.error("Get blocks error:", error);
    res.status(500).json({ error: "Failed to get blocks" });
  }
};

exports.getQueue = async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "pending";
    const rows = await req.db("moderation_reports")
      .leftJoin("users as reporter", "moderation_reports.reporter_user_id", "reporter.id")
      .leftJoin("answers", function joinAnswers() {
        this.on("moderation_reports.entity_type", "=", req.db.raw("?", ["answer"]))
          .andOn("moderation_reports.entity_id", "=", "answers.id");
      })
      .leftJoin("users as answer_owner", "answers.user_id", "answer_owner.id")
      .leftJoin("users as reported_user", function joinUsers() {
        this.on("moderation_reports.entity_type", "=", req.db.raw("?", ["user"]))
          .andOn("moderation_reports.entity_id", "=", "reported_user.id");
      })
      .leftJoin("questions", "answers.question_id", "questions.id")
      .where("moderation_reports.status", status)
      .select(
        "moderation_reports.*",
        "reporter.username as reporter_username",
        "answers.answer_type",
        "answers.text_content",
        "answers.video_url",
        "answers.is_hidden",
        "answers.abuse_score",
        "answers.requires_human_review",
        "answers.moderation_labels",
        "answer_owner.username as answer_username",
        "reported_user.username as reported_username",
        "reported_user.is_blocked as reported_user_is_blocked",
        "reported_user.deleted_at as reported_user_deleted_at",
        "questions.text as question_text"
      )
      .orderBy("moderation_reports.created_at", "asc");

    res.json(rows.map(parseMetadata));
  } catch (error) {
    console.error("Get moderation queue error:", error);
    res.status(500).json({ error: "Failed to get moderation queue" });
  }
};

exports.resolveReport = async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    const { status, action, metadata } = req.body;

    if (!reportId || !["resolved", "dismissed"].includes(String(status || ""))) {
      return res.status(400).json({ error: "valid status required" });
    }

    const [report] = await req.db("moderation_reports")
      .where({ id: reportId })
      .update({
        status,
        reviewed_by_user_id: req.userId,
        reviewed_at: new Date().toISOString(),
      })
      .returning("*");

    if (!report) {
      return res.status(404).json({ error: "report_not_found" });
    }

    if (report.entity_type === "answer" && report.entity_id) {
      if (action === "hide_answer") {
        await req.db("answers").where({ id: report.entity_id }).update({ is_hidden: true });
      }

      if (action === "soft_delete_answer") {
        await softDeleteAnswer(req.db, report.entity_id, req.userId, "moderation_soft_delete");
      }

      if (action === "restore_answer") {
        await restoreAnswer(req.db, report.entity_id);
      }
    }

    if (report.entity_type === "user" && report.entity_id) {
      if (action === "block_user") {
        await setUserBlocked(req.db, report.entity_id, true, "moderation_block");
      }

      if (action === "unblock_user") {
        await setUserBlocked(req.db, report.entity_id, false, null);
      }

      if (action === "soft_delete_user") {
        await softDeleteUser(req.db, report.entity_id, req.userId, "moderation_soft_delete");
      }

      if (action === "restore_user") {
        await restoreUser(req.db, report.entity_id);
      }
    }

    await req.db("moderation_actions").insert({
      report_id: reportId,
      admin_user_id: req.userId,
      action: action || status,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });

    res.json(parseMetadata(report));
  } catch (error) {
    console.error("Resolve moderation report error:", error);
    res.status(500).json({ error: "Failed to resolve report" });
  }
};
