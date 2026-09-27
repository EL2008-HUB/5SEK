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

import Constants from "expo-constants";

function resolveWebBaseUrl() {
  const configured = String((Constants.expoConfig?.extra as any)?.webUrl || process.env.EXPO_PUBLIC_WEB_URL || "").trim();
  return (configured || "https://5sek.app").replace(/\/+$/, "");
}

export const WEB_APP_BASE_URL = resolveWebBaseUrl();

function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return null;
  }
}

const ALLOWED_HTTPS_HOSTS = new Set(
  ["5sek.app", "www.5sek.app", "app.5sek.app", hostOf(WEB_APP_BASE_URL)].filter(Boolean) as string[]
);

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

// ── Challenge deep links (answering starts a duel against the sharer) ──

export function buildChallengeShareUrl(answerId: number) {
  return `${WEB_APP_BASE_URL}/c/${answerId}`;
}

// ── Duel deep links ──

export function buildDuelShareUrl(duelId: number) {
  return `${WEB_APP_BASE_URL}/d/${duelId}`;
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
      return `${questionText} ⏱ Pata 5 sekonda. Radha jote. #5sek #fyp #quiz`;
    case "instagram":
      return `${questionText}\n\n⏱ Ke 5 sekonda!\nPata 5 sekonda. Radha jote.\n🔗 Linku në bio\n\n#5sek #5sekonda #reels`;
    case "whatsapp":
      return `🎯 ${questionText}\n\nPata 5 sekonda. Radha jote.\n⏱ Përgjigju këtu: ${url}`;
    default:
      return `Pata 5 sekonda. Radha jote.\n👉 ${url}\n\n#5sek #5sekonda #quiz`;
  }
}
