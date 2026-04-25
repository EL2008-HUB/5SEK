const { API_CONTRACT } = require("../services/contractService");

const VALID_ANSWER_TYPES = new Set(["video", "audio", "text", "reaction"]);
const VALID_PAYWALL_EVENTS = new Set([
  "paywall_shown",
  "paywall_clicked",
  "paywall_closed",
  "second_chance_shown",
  "second_chance_used",
  "second_chance_dismissed",
]);
const VALID_MODERATION_STATUSES = new Set(["resolved", "dismissed"]);
const VALID_DUEL_STATUSES = new Set(["active", "finished"]);
const VALID_ANALYTICS_EVENTS = new Set(["watch_progress", "skipped", "completed", "replayed"]);
const VALID_CLIENT_EVENTS = new Set(API_CONTRACT.client_events || []);
const REACTION_PREFIXES = ["😳", "😂", "🤯", "😎"];

function badRequest(res, error) {
  return res.status(400).json({ error });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value, { min = 1, max = Infinity } = {}) {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

function isPositiveInt(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isIsoCountryCode(value) {
  return typeof value === "string" && /^[A-Za-z]{2,10}$/.test(value.trim());
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeKeys(body) {
  if (!isPlainObject(body)) {
    return [];
  }

  return Object.keys(body);
}

function rejectUnknownFields(req, res, allowedFields) {
  const receivedKeys = normalizeKeys(req.body);
  const unknownField = receivedKeys.find((key) => !allowedFields.includes(key));
  if (unknownField) {
    return badRequest(res, `unexpected field: ${unknownField}`);
  }

  return null;
}

function validateOptionalMetadata(value) {
  return value === undefined || value === null || isPlainObject(value);
}

function validateRegister(req, res, next) {
  const unknown = rejectUnknownFields(req, res, [
    "username",
    "email",
    "password",
    "country",
    "age_group",
    "interests",
  ]);
  if (unknown) return unknown;

  const { username, email, password, country, age_group, interests } = req.body;

  if (!isNonEmptyString(username, { min: 3, max: 32 })) {
    return badRequest(res, "username must be between 3 and 32 characters");
  }

  if (!isNonEmptyString(email, { min: 5, max: 254 }) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
    return badRequest(res, "valid email required");
  }

  if (!isNonEmptyString(password, { min: 8, max: 128 })) {
    return badRequest(res, "password must be between 8 and 128 characters");
  }

  if (country !== undefined && !isIsoCountryCode(country)) {
    return badRequest(res, "country must be a valid country code");
  }

  if (age_group !== undefined && !isNonEmptyString(age_group, { min: 2, max: 32 })) {
    return badRequest(res, "age_group must be a non-empty string");
  }

  if (interests !== undefined) {
    if (!Array.isArray(interests) || interests.length > 20) {
      return badRequest(res, "interests must be an array with up to 20 items");
    }

    const invalidInterest = interests.find((entry) => !isNonEmptyString(entry, { min: 1, max: 64 }));
    if (invalidInterest !== undefined) {
      return badRequest(res, "interests entries must be non-empty strings");
    }
  }

  return next();
}

function validateLogin(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["email", "password"]);
  if (unknown) return unknown;

  const { email, password } = req.body;
  if (!isNonEmptyString(email, { min: 5, max: 254 }) || !isNonEmptyString(password, { min: 1, max: 128 })) {
    return badRequest(res, "email and password required");
  }

  return next();
}

function validateRefresh(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["refresh_token"]);
  if (unknown) return unknown;

  if (!isNonEmptyString(req.body.refresh_token, { min: 32, max: 256 })) {
    return badRequest(res, "refresh_token required");
  }

  return next();
}

function validateLogout(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["refresh_token"]);
  if (unknown) return unknown;

  if (req.body.refresh_token !== undefined && !isNonEmptyString(req.body.refresh_token, { min: 32, max: 256 })) {
    return badRequest(res, "refresh_token must be a non-empty string");
  }

  return next();
}

function validateCountryUpdate(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["country"]);
  if (unknown) return unknown;

  if (!isIsoCountryCode(req.body.country)) {
    return badRequest(res, "country must be a valid country code");
  }

  return next();
}

function validateProfileUpdate(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["age_group", "interests", "country"]);
  if (unknown) return unknown;

  const { age_group, interests, country } = req.body;

  if (age_group !== undefined && !isNonEmptyString(age_group, { min: 2, max: 32 })) {
    return badRequest(res, "age_group must be a non-empty string");
  }

  if (country !== undefined && !isIsoCountryCode(country)) {
    return badRequest(res, "country must be a valid country code");
  }

  if (interests !== undefined) {
    if (!Array.isArray(interests) || interests.length > 20) {
      return badRequest(res, "interests must be an array with up to 20 items");
    }

    const invalidInterest = interests.find((entry) => !isNonEmptyString(entry, { min: 1, max: 64 }));
    if (invalidInterest !== undefined) {
      return badRequest(res, "interests entries must be non-empty strings");
    }
  }

  if (age_group === undefined && interests === undefined && country === undefined) {
    return badRequest(res, "No fields to update");
  }

  return next();
}

function validateAnswerCreate(req, res, next) {
  const unknown = rejectUnknownFields(req, res, [
    "question_id",
    "response_time",
    "answer_type",
    "text_content",
    "video_url",
    "country",
  ]);
  if (unknown) return unknown;

  const { question_id, answer_type, text_content, video_url, response_time } = req.body;
  if (!isPositiveInt(question_id)) {
    return badRequest(res, "question_id must be a positive integer");
  }

  if (answer_type !== undefined && !VALID_ANSWER_TYPES.has(String(answer_type).toLowerCase())) {
    return badRequest(res, "invalid answer_type");
  }

  if (
    response_time !== undefined &&
    (!Number.isFinite(Number(response_time)) || Number(response_time) < 0 || Number(response_time) > 300)
  ) {
    return badRequest(res, "response_time must be between 0 and 300 seconds");
  }

  if (req.body.country !== undefined && !isIsoCountryCode(req.body.country)) {
    return badRequest(res, "country must be a valid country code");
  }

  const normalizedType = String(answer_type || "").toLowerCase();
  const inferredType = normalizedType || (
    isNonEmptyString(text_content, { min: 1, max: 500 })
      ? REACTION_PREFIXES.some((entry) => text_content.trim().startsWith(entry))
        ? "reaction"
        : "text"
      : "video"
  );
  if (["text", "reaction"].includes(inferredType)) {
    if (!isNonEmptyString(text_content, { min: 1, max: 500 })) {
      return badRequest(res, "text_content required for text or reaction answers");
    }

    if (inferredType === "reaction") {
      const normalizedText = text_content.trim();
      if (!REACTION_PREFIXES.some((entry) => normalizedText.startsWith(entry))) {
        return badRequest(res, "reaction answers must start with a supported reaction");
      }
    }

    if (video_url !== undefined && video_url !== null && String(video_url).trim() !== "") {
      return badRequest(res, "video_url is not allowed for text or reaction answers");
    }
  }

  if (["video", "audio"].includes(inferredType)) {
    if (!isNonEmptyString(video_url, { min: 1, max: 4096 })) {
      return badRequest(res, "video_url required for media answers");
    }
  }

  return next();
}

function validateAnswerUpload(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["question_id", "response_time", "answer_type"]);
  if (unknown) return unknown;

  const { question_id, answer_type, response_time } = req.body;
  if (!isPositiveInt(question_id)) {
    return badRequest(res, "question_id must be a positive integer");
  }

  if (answer_type !== undefined && !["video", "audio"].includes(String(answer_type).toLowerCase())) {
    return badRequest(res, "upload answer_type must be video or audio");
  }

  if (
    response_time !== undefined &&
    (!Number.isFinite(Number(response_time)) || Number(response_time) < 0 || Number(response_time) > 300)
  ) {
    return badRequest(res, "response_time must be between 0 and 300 seconds");
  }

  return next();
}

function validateAnswerEngagement(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["watch_time", "session_id", "event_type", "metadata"]);
  if (unknown) return unknown;

  if (!VALID_ANALYTICS_EVENTS.has(String(req.body.event_type || ""))) {
    return badRequest(res, "invalid analytics payload");
  }

  if (
    req.body.watch_time !== undefined &&
    (!Number.isFinite(Number(req.body.watch_time)) || Number(req.body.watch_time) < 0 || Number(req.body.watch_time) > 300)
  ) {
    return badRequest(res, "watch_time must be between 0 and 300 seconds");
  }

  if (req.body.session_id !== undefined && !isNonEmptyString(req.body.session_id, { min: 1, max: 128 })) {
    return badRequest(res, "session_id must be a non-empty string");
  }

  if (!validateOptionalMetadata(req.body.metadata)) {
    return badRequest(res, "metadata must be an object");
  }

  return next();
}

function validateDuelCreate(req, res, next) {
  const unknown = rejectUnknownFields(req, res, [
    "question_id",
    "questionId",
    "answer_a_id",
    "answerA",
    "answerAId",
    "user_b_id",
    "userB",
    "userBId",
    "answer_b_id",
    "answerB",
    "answerBId",
    "video_a_url",
    "videoA",
    "video_b_url",
    "videoB",
  ]);
  if (unknown) return unknown;

  const {
    question_id,
    questionId,
    answer_a_id,
    answerA,
    answerAId,
    user_b_id,
    userB,
    userBId,
    answer_b_id,
    answerB,
    answerBId,
    video_a_url,
    videoA,
    video_b_url,
    videoB,
  } = req.body;
  const resolvedQuestionId = question_id ?? questionId;
  const resolvedAnswerA = answer_a_id ?? answerA ?? answerAId;
  const resolvedUserB = user_b_id ?? userB ?? userBId;
  const resolvedAnswerB = answer_b_id ?? answerB ?? answerBId;
  const resolvedVideoA = video_a_url ?? videoA;
  const resolvedVideoB = video_b_url ?? videoB;

  if (!isPositiveInt(resolvedQuestionId)) {
    return badRequest(res, "question_id must be a positive integer");
  }

  if (!isPositiveInt(resolvedUserB)) {
    return badRequest(res, "user_b_id must be a positive integer");
  }

  if (resolvedAnswerA !== undefined && !isPositiveInt(resolvedAnswerA)) {
    return badRequest(res, "answer_a_id must be a positive integer");
  }

  if (resolvedAnswerB !== undefined && !isPositiveInt(resolvedAnswerB)) {
    return badRequest(res, "answer_b_id must be a positive integer");
  }

  if (
    resolvedAnswerA === undefined &&
    !isNonEmptyString(resolvedVideoA, { min: 1, max: 4096 })
  ) {
    return badRequest(res, "answer_a_id or video_a_url required");
  }

  if (
    resolvedAnswerB === undefined &&
    !isNonEmptyString(resolvedVideoB, { min: 1, max: 4096 })
  ) {
    return badRequest(res, "answer_b_id or video_b_url required");
  }

  return next();
}

function validateDuelAuto(req, res, next) {
  const unknown = rejectUnknownFields(req, res, [
    "question_id",
    "questionId",
    "answer_id",
    "answerId",
    "video_a_url",
    "videoA",
  ]);
  if (unknown) return unknown;

  const { question_id, questionId, answer_id, answerId, video_a_url, videoA } = req.body;
  const resolvedQuestionId = question_id ?? questionId;
  const resolvedAnswerId = answer_id ?? answerId;
  const resolvedVideoA = video_a_url ?? videoA;

  if (!isPositiveInt(resolvedQuestionId)) {
    return badRequest(res, "question_id must be a positive integer");
  }

  if (resolvedAnswerId !== undefined && !isPositiveInt(resolvedAnswerId)) {
    return badRequest(res, "answer_id must be a positive integer");
  }

  if (
    resolvedAnswerId === undefined &&
    !isNonEmptyString(resolvedVideoA, { min: 1, max: 4096 })
  ) {
    return badRequest(res, "answer_id or video_a_url required");
  }

  return next();
}

function validateDuelVote(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["vote"]);
  if (unknown) return unknown;

  const vote = String(req.body.vote || "").toUpperCase();
  if (!["A", "B"].includes(vote)) {
    return badRequest(res, "vote must be 'A' or 'B'");
  }

  return next();
}

function validatePaywallEvent(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["event_type", "metadata"]);
  if (unknown) return unknown;

  if (!isNonEmptyString(req.body.event_type) || !VALID_PAYWALL_EVENTS.has(String(req.body.event_type))) {
    return badRequest(res, "invalid event_type");
  }

  if (!validateOptionalMetadata(req.body.metadata)) {
    return badRequest(res, "metadata must be an object");
  }

  return next();
}

function validateQuestionCreate(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["text", "category", "country"]);
  if (unknown) return unknown;

  if (!isNonEmptyString(req.body.text, { min: 5, max: 280 })) {
    return badRequest(res, "Question text is required");
  }

  if (req.body.category !== undefined && !isNonEmptyString(req.body.category, { min: 2, max: 64 })) {
    return badRequest(res, "category must be a non-empty string");
  }

  if (req.body.country !== undefined && !isIsoCountryCode(req.body.country)) {
    return badRequest(res, "country must be a valid country code");
  }

  return next();
}

function validateSetDaily(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["question_id", "date"]);
  if (unknown) return unknown;

  if (!isPositiveInt(req.body.question_id)) {
    return badRequest(res, "question_id must be a positive integer");
  }

  if (req.body.date !== undefined && !isIsoDate(req.body.date)) {
    return badRequest(res, "date must be YYYY-MM-DD");
  }

  return next();
}

function validateRecalculate(req, res, next) {
  if (!isPlainObject(req.body) || Object.keys(req.body).length === 0) {
    return next();
  }

  return badRequest(res, "recalculate does not accept a request body");
}

function validateCrossCountryCheck(req, res, next) {
  if (req.query.threshold !== undefined && (!isPositiveInt(req.query.threshold) || Number(req.query.threshold) > 10000)) {
    return badRequest(res, "threshold must be a positive integer");
  }

  return next();
}

function validateModerationReport(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["reason", "details"]);
  if (unknown) return unknown;

  if (!isNonEmptyString(req.body.reason, { min: 2, max: 64 })) {
    return badRequest(res, "reason required");
  }

  if (req.body.details !== undefined && !isNonEmptyString(req.body.details, { min: 1, max: 500 })) {
    return badRequest(res, "details must be a non-empty string");
  }

  return next();
}

function validateModerationCheck(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["content", "answer_type", "response_time", "video_url"]);
  if (unknown) return unknown;

  if (req.body.answer_type !== undefined && !VALID_ANSWER_TYPES.has(String(req.body.answer_type).toLowerCase())) {
    return badRequest(res, "invalid answer_type");
  }

  if (
    req.body.response_time !== undefined &&
    (!Number.isFinite(Number(req.body.response_time)) || Number(req.body.response_time) < 0 || Number(req.body.response_time) > 300)
  ) {
    return badRequest(res, "response_time must be between 0 and 300 seconds");
  }

  if (req.body.content !== undefined && !isNonEmptyString(req.body.content, { min: 1, max: 500 })) {
    return badRequest(res, "content must be a non-empty string");
  }

  if (req.body.video_url !== undefined && !isNonEmptyString(req.body.video_url, { min: 1, max: 4096 })) {
    return badRequest(res, "video_url must be a non-empty string");
  }

  return next();
}

function validateResolveReport(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["status", "action", "metadata"]);
  if (unknown) return unknown;

  if (!VALID_MODERATION_STATUSES.has(String(req.body.status || ""))) {
    return badRequest(res, "valid status required");
  }

  if (req.body.action !== undefined && !isNonEmptyString(req.body.action, { min: 2, max: 64 })) {
    return badRequest(res, "action must be a non-empty string");
  }

  if (!validateOptionalMetadata(req.body.metadata)) {
    return badRequest(res, "metadata must be an object");
  }

  return next();
}

function validateDuelFeedQuery(req, res, next) {
  if (req.query.status !== undefined && !VALID_DUEL_STATUSES.has(String(req.query.status))) {
    return badRequest(res, "status must be 'active' or 'finished'");
  }

  return next();
}

function validateClientEvent(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["event_type", "screen", "metadata"]);
  if (unknown) return unknown;

  if (!VALID_CLIENT_EVENTS.has(String(req.body.event_type || ""))) {
    return badRequest(res, "invalid event_type");
  }

  if (req.body.screen !== undefined && !isNonEmptyString(req.body.screen, { min: 2, max: 64 })) {
    return badRequest(res, "screen must be a non-empty string");
  }

  if (!validateOptionalMetadata(req.body.metadata)) {
    return badRequest(res, "metadata must be an object");
  }

  return next();
}

function validatePushRegister(req, res, next) {
  const unknown = rejectUnknownFields(req, res, [
    "token",
    "platform",
    "device_id",
    "project_id",
    "app_version",
  ]);
  if (unknown) return unknown;

  if (!isNonEmptyString(req.body.token, { min: 16, max: 255 })) {
    return badRequest(res, "token required");
  }

  if (!["ios", "android"].includes(String(req.body.platform || "").toLowerCase())) {
    return badRequest(res, "platform must be ios or android");
  }

  if (req.body.device_id !== undefined && !isNonEmptyString(req.body.device_id, { min: 1, max: 128 })) {
    return badRequest(res, "device_id must be a non-empty string");
  }

  if (req.body.project_id !== undefined && !isNonEmptyString(req.body.project_id, { min: 6, max: 128 })) {
    return badRequest(res, "project_id must be a non-empty string");
  }

  if (req.body.app_version !== undefined && !isNonEmptyString(req.body.app_version, { min: 1, max: 64 })) {
    return badRequest(res, "app_version must be a non-empty string");
  }

  return next();
}

function validatePushUnregister(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["token"]);
  if (unknown) return unknown;

  if (!isNonEmptyString(req.body.token, { min: 16, max: 255 })) {
    return badRequest(res, "token required");
  }

  return next();
}

function validatePushTest(req, res, next) {
  const unknown = rejectUnknownFields(req, res, ["title", "body", "deeplink", "metadata"]);
  if (unknown) return unknown;

  if (!isNonEmptyString(req.body.title, { min: 2, max: 160 })) {
    return badRequest(res, "title required");
  }

  if (!isNonEmptyString(req.body.body, { min: 2, max: 512 })) {
    return badRequest(res, "body required");
  }

  if (req.body.deeplink !== undefined && !isNonEmptyString(req.body.deeplink, { min: 8, max: 255 })) {
    return badRequest(res, "deeplink must be a non-empty string");
  }

  if (!validateOptionalMetadata(req.body.metadata)) {
    return badRequest(res, "metadata must be an object");
  }

  return next();
}

function validateEmptyBody(req, res, next) {
  if (!isPlainObject(req.body) || Object.keys(req.body).length === 0) {
    return next();
  }

  return badRequest(res, "request body is not allowed");
}

function ensureSelfOrAdmin(paramKey = "userId") {
  return (req, res, next) => {
    const targetUserId = Number(req.params[paramKey]);
    if (!targetUserId) {
      return res.status(400).json({ error: "invalid_user_id" });
    }

    if (req.userRole === "admin" || Number(req.userId) === targetUserId) {
      return next();
    }

    return res.status(403).json({ error: "forbidden" });
  };
}

module.exports = {
  ensureSelfOrAdmin,
  validateAnswerCreate,
  validateAnswerEngagement,
  validateAnswerUpload,
  validateClientEvent,
  validateCountryUpdate,
  validateCrossCountryCheck,
  validateDuelAuto,
  validateDuelCreate,
  validateDuelFeedQuery,
  validateDuelVote,
  validateEmptyBody,
  validateLogin,
  validateLogout,
  validateModerationCheck,
  validateModerationReport,
  validatePaywallEvent,
  validateProfileUpdate,
  validatePushRegister,
  validatePushTest,
  validatePushUnregister,
  validateQuestionCreate,
  validateRecalculate,
  validateRefresh,
  validateRegister,
  validateResolveReport,
  validateSetDaily,
};
