const { moderatePublicContent } = require("./aiService");

const SUSPICIOUS_TERMS = [
  "http://",
  "https://",
  "telegram",
  "whatsapp",
  "cashapp",
  "onlyfans",
  "free money",
  "dm me",
  "link in bio",
  "spam",
  "fake",
  "scam",
  "click here",
  "subscribe",
  "promo",
  "xxx",
];

const SEXUAL_TERMS = [
  "nude",
  "nudes",
  "sex",
  "sexual",
  "porn",
  "nsfw",
  "escort",
];

const ABUSIVE_TERMS = [
  "kill yourself",
  "self harm",
  "nazi",
  "rape",
  "terrorist",
  "faggot",
  "retard",
];

function pushUnique(target, value) {
  if (value && !target.includes(value)) {
    target.push(value);
  }
}

function normalizeText(value) {
  return String(value || "").trim();
}

function buildModerationResult({
  action = "approve",
  reasons = [],
  labels = [],
  abuseScore = 0,
} = {}) {
  return {
    moderation_status: action === "approve" ? "approved" : "flagged",
    moderation_reason: reasons.join(";") || null,
    moderation_labels: [...new Set(labels)],
    abuse_score: abuseScore,
    requires_human_review: action !== "approve",
    shouldHide: action === "hide",
  };
}

function scoreTextHeuristics(text) {
  const normalized = normalizeText(text);
  const lower = normalized.toLowerCase();
  const reasons = [];
  const labels = [];
  let action = "approve";
  let abuseScore = 0;

  if (!normalized) {
    reasons.push("empty_text");
    labels.push("empty");
    abuseScore += 10;
    action = "flag";
  }

  const matchedSpamTerms = SUSPICIOUS_TERMS.filter((term) => lower.includes(term));
  if (matchedSpamTerms.length > 0) {
    reasons.push(`spam_terms:${matchedSpamTerms.join(",")}`);
    labels.push("spam");
    abuseScore += 35;
    action = action === "hide" ? "hide" : "flag";
  }

  const matchedSexualTerms = SEXUAL_TERMS.filter((term) => lower.includes(term));
  if (matchedSexualTerms.length > 0) {
    reasons.push(`sexual_terms:${matchedSexualTerms.join(",")}`);
    labels.push("sexual");
    abuseScore += 70;
    action = "hide";
  }

  const matchedAbusiveTerms = ABUSIVE_TERMS.filter((term) => lower.includes(term));
  if (matchedAbusiveTerms.length > 0) {
    reasons.push(`abusive_terms:${matchedAbusiveTerms.join(",")}`);
    labels.push("abuse");
    abuseScore += 70;
    action = "hide";
  }

  if (normalized.length > 180) {
    reasons.push("too_long");
    labels.push("verbose");
    abuseScore += 10;
    action = action === "approve" ? "flag" : action;
  }

  const upperChars = normalized.replace(/[^A-Z]/g, "").length;
  if (upperChars >= 16 && upperChars >= Math.ceil(normalized.length * 0.55)) {
    reasons.push("excessive_caps");
    labels.push("caps");
    abuseScore += 15;
    action = action === "approve" ? "flag" : action;
  }

  if (/(.)\1{7,}/.test(lower)) {
    reasons.push("repeated_characters");
    labels.push("spam");
    abuseScore += 15;
    action = action === "approve" ? "flag" : action;
  }

  if (/\b(\w+)(?:\s+\1){3,}\b/.test(lower)) {
    reasons.push("repeated_words");
    labels.push("spam");
    abuseScore += 20;
    action = action === "approve" ? "flag" : action;
  }

  return {
    action,
    reasons,
    labels,
    abuseScore,
  };
}

function scoreResponseTiming(responseTime) {
  const parsed = Number(responseTime);
  if (!Number.isFinite(parsed)) {
    return { action: "approve", reasons: [], labels: [], abuseScore: 0 };
  }

  if (parsed < 0.5) {
    return {
      action: "flag",
      reasons: ["suspicious_response_time"],
      labels: ["timing"],
      abuseScore: 15,
    };
  }

  return { action: "approve", reasons: [], labels: [], abuseScore: 0 };
}

function mergeSignals(...signals) {
  const merged = {
    action: "approve",
    reasons: [],
    labels: [],
    abuseScore: 0,
  };

  signals.forEach((signal) => {
    if (!signal) return;

    signal.reasons?.forEach((reason) => pushUnique(merged.reasons, reason));
    signal.labels?.forEach((label) => pushUnique(merged.labels, label));
    merged.abuseScore += Number(signal.abuseScore || 0);

    if (signal.action === "hide") {
      merged.action = "hide";
    } else if (signal.action === "flag" && merged.action === "approve") {
      merged.action = "flag";
    }
  });

  return merged;
}

async function getUserAbuseProfile(db, userId) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [recentAnswers, recentFlags, recentReports] = await Promise.all([
    db("answers")
      .where({ user_id: userId })
      .where("created_at", ">=", dayAgo)
      .count("id as count")
      .first(),
    db("answers")
      .where({ user_id: userId })
      .where("created_at", ">=", dayAgo)
      .where((query) => {
        query.where("moderation_status", "flagged").orWhere("is_hidden", true);
      })
      .count("id as count")
      .first(),
    db("moderation_reports as mr")
      .join("answers as a", function joinAnswers() {
        this.on("mr.entity_type", "=", db.raw("?", ["answer"]))
          .andOn("mr.entity_id", "=", "a.id");
      })
      .where("a.user_id", userId)
      .where("mr.created_at", ">=", dayAgo)
      .count("mr.id as count")
      .first(),
  ]);

  return {
    recent_answers: Number(recentAnswers?.count || 0),
    recent_flags: Number(recentFlags?.count || 0),
    recent_reports: Number(recentReports?.count || 0),
  };
}

async function detectSpamBurst(db, userId) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await db("answers")
    .where({ user_id: userId })
    .where("created_at", ">=", oneHourAgo)
    .count("id as count")
    .first();

  return Number(recent?.count || 0) >= 12;
}

async function evaluateMediaModeration(db, payload, abuseProfile = null) {
  const reasons = [];
  const labels = ["media"];
  let action = "approve";
  let abuseScore = 0;
  const profile = abuseProfile || await getUserAbuseProfile(db, payload.user_id);

  if (!payload.video_url) {
    reasons.push("missing_media_url");
    labels.push("invalid_media");
    abuseScore += 20;
    action = "flag";
  }

  const videoUrl = String(payload.video_url || "");
  if (videoUrl && !videoUrl.startsWith("https://") && !videoUrl.startsWith("http://localhost")) {
    reasons.push("non_https_media");
    labels.push("invalid_media");
    abuseScore += 25;
    action = "flag";
  }

  if (process.env.NODE_ENV === "production" && !videoUrl.includes("res.cloudinary.com")) {
    reasons.push("non_production_storage");
    labels.push("storage_policy");
    abuseScore += 35;
    action = "hide";
  }

  if (profile.recent_flags >= 3 || profile.recent_reports >= 5) {
    reasons.push("repeat_offender_media");
    labels.push("abuse_history");
    abuseScore += 35;
    action = action === "hide" ? "hide" : "flag";
  }

  return {
    action,
    reasons,
    labels,
    abuseScore,
  };
}

async function evaluateAiTextModeration(payload) {
  const normalizedText = normalizeText(payload.text_content);
  if (!normalizedText) {
    return null;
  }

  try {
    const result = await moderatePublicContent({
      content: normalizedText,
      answerType: payload.answer_type,
      responseTime: payload.response_time,
    });

    if (result === "REJECT") {
      return {
        action: "flag",
        reasons: ["ai_reject"],
        labels: ["ai_review"],
        abuseScore: 35,
      };
    }
  } catch (_) {
    return null;
  }

  return null;
}

async function evaluateAnswerModeration(db, payload) {
  const answerType = String(payload.answer_type || "video");
  const timingSignal = scoreResponseTiming(payload.response_time);

  if (await detectSpamBurst(db, payload.user_id)) {
    return buildModerationResult({
      ...mergeSignals(timingSignal, {
        action: "flag",
        reasons: ["answer_burst_rate_limit"],
        labels: ["burst_activity"],
        abuseScore: 30,
      }),
    });
  }

  const abuseProfile = await getUserAbuseProfile(db, payload.user_id);

  if (["text", "reaction"].includes(answerType)) {
    const heuristic = scoreTextHeuristics(payload.text_content);
    const aiSignal = await evaluateAiTextModeration(payload);
    const combined = mergeSignals(timingSignal, heuristic, aiSignal);

    if (abuseProfile.recent_flags >= 3 || abuseProfile.recent_reports >= 5) {
      pushUnique(combined.reasons, "repeat_offender_text");
      pushUnique(combined.labels, "abuse_history");
      combined.abuseScore += 25;
      combined.action = combined.action === "hide" ? "hide" : "flag";
    }

    return buildModerationResult(combined);
  }

  const mediaHeuristic = await evaluateMediaModeration(db, payload, abuseProfile);
  return buildModerationResult(mergeSignals(timingSignal, mediaHeuristic));
}

module.exports = {
  evaluateAnswerModeration,
};
