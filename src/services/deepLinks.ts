/**
 * Deep Links v2 — Aggressive Growth Loop
 *
 * FLOW:
 *   TikTok/Instagram video → click link → DeepAnswerScreen
 *   → "Can you answer this?" → Answer → Feed
 *
 * LINKS:
 *   App: five-second://answer/123
 *   Web: https://5sek.app/a/123
 */

export const WEB_APP_BASE_URL = "https://5sek.app";

const ALLOWED_HTTPS_HOSTS = new Set(["5sek.app", "www.5sek.app", "app.5sek.app"]);

export function isAllowedDeepLink(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "five-second:") return true;
    return parsed.protocol === "https:" && ALLOWED_HTTPS_HOSTS.has(parsed.hostname.toLowerCase());
  } catch (_) {
    return false;
  }
}

// ── Answer deep links ──

export function buildAnswerDeepLink(answerId: number) {
  return `five-second://answer/${answerId}`;
}

export function buildAnswerShareUrl(answerId: number) {
  return `${WEB_APP_BASE_URL}/a/${answerId}`;
}

// ── Feed deep links ──

export function buildFeedDeepLink(answerId?: number | null) {
  if (answerId) {
    return `five-second://feed?answer=${answerId}`;
  }
  return "five-second://feed";
}

export function buildFeedShareUrl(answerId?: number | null) {
  if (answerId) {
    return `${WEB_APP_BASE_URL}/feed?answer=${answerId}`;
  }
  return `${WEB_APP_BASE_URL}/feed`;
}

// ── Question deep links ──

export function buildQuestionDeepLink(questionId: number) {
  return `five-second://question/${questionId}`;
}

export function buildQuestionShareUrl(questionId: number) {
  return `${WEB_APP_BASE_URL}/q/${questionId}`;
}

// ── Share captions with deep link ──

export function buildShareCaption(
  questionText: string,
  answerId: number,
  platform: "tiktok" | "instagram" | "whatsapp" | "generic" = "generic"
): string {
  const url = buildAnswerShareUrl(answerId);

  switch (platform) {
    case "tiktok":
      return `${questionText} ⏱ I had 5 seconds. Your turn. #5sek #fyp #quiz`;
    case "instagram":
      return `${questionText}\n\n⏱ You have 5 seconds!\nI had 5 seconds. Your turn.\n🔗 Link in bio\n\n#5sek #5secondanswer #reels`;
    case "whatsapp":
      return `🎯 ${questionText}\n\nI had 5 seconds. Your turn.\n⏱ Answer in 5 seconds: ${url}`;
    default:
      return `I had 5 seconds. Your turn.\n👉 ${url}\n\n#5sek #5secondanswer #quiz`;
  }
}
