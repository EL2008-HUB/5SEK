const { buildDeliveryUrl } = require("./uploadService");

const VALID_ANSWER_TYPES = new Set(["video", "audio", "text", "reaction"]);
const REACTION_PREFIXES = ["😳", "😂", "🤯", "😎"];

function decodeTextUrl(videoUrl) {
  if (typeof videoUrl !== "string" || !videoUrl.startsWith("text://")) {
    return null;
  }

  try {
    return decodeURIComponent(videoUrl.slice("text://".length));
  } catch (_) {
    return videoUrl.slice("text://".length);
  }
}

function inferAnswerType(payload = {}) {
  const explicitType = String(payload.answer_type || "").toLowerCase();
  if (VALID_ANSWER_TYPES.has(explicitType)) {
    return explicitType;
  }

  const candidateText =
    typeof payload.text_content === "string" && payload.text_content.trim()
      ? payload.text_content.trim()
      : decodeTextUrl(payload.video_url);

  if (candidateText && REACTION_PREFIXES.some((entry) => candidateText.startsWith(entry))) {
    return "reaction";
  }

  if (typeof payload.text_content === "string" && payload.text_content.trim()) {
    return "text";
  }

  if (typeof payload.video_url === "string" && payload.video_url.startsWith("text://")) {
    return "text";
  }

  return "video";
}

function normalizeAnswerPayload(payload = {}) {
  const answer_type = inferAnswerType(payload);
  const decodedText = decodeTextUrl(payload.video_url);
  const text_content =
    typeof payload.text_content === "string" && payload.text_content.trim()
      ? payload.text_content.trim()
      : decodedText;

  let video_url = typeof payload.video_url === "string" && payload.video_url.trim()
    ? payload.video_url.trim()
    : null;

  if (answer_type === "text" || answer_type === "reaction") {
    video_url = null;
    if (!text_content) {
      throw new Error("text_content required for text or reaction answers");
    }
  }

  if ((answer_type === "video" || answer_type === "audio") && !video_url) {
    throw new Error("video_url required for media answers");
  }

  return {
    answer_type,
    text_content: text_content || null,
    video_url,
  };
}

function hydrateAnswerRow(row = {}) {
  const answer_type = inferAnswerType(row);
  const decodedText = row.text_content || decodeTextUrl(row.video_url);

  return {
    ...row,
    video_url: row.video_url ? buildDeliveryUrl(row.video_url) : row.video_url,
    answer_type,
    text_content:
      answer_type === "text" || answer_type === "reaction" ? decodedText || null : row.text_content || null,
  };
}

function canUseAsDuelSource(answer = {}) {
  const hydrated = hydrateAnswerRow(answer);
  return hydrated.answer_type === "video" && typeof hydrated.video_url === "string" && hydrated.video_url.length > 0;
}

module.exports = {
  VALID_ANSWER_TYPES,
  canUseAsDuelSource,
  hydrateAnswerRow,
  inferAnswerType,
  normalizeAnswerPayload,
  REACTION_PREFIXES,
};
