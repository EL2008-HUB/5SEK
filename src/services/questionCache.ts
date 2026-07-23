import { storage } from "./storage";

const CACHE_PREFIX = "@5sek_daily_question_v1:";
const TTL_MS = 24 * 60 * 60 * 1000;

export type DailyQuestionCache = {
  savedAt: number;
  country: string;
  question: unknown;
  trendingBadge?: string | null;
  isHot?: boolean;
};

export function dailyQuestionCacheKey(country: string) {
  return `${CACHE_PREFIX}${(country || "GLOBAL").toUpperCase()}`;
}

export async function saveDailyQuestionCache(
  country: string,
  payload: Omit<DailyQuestionCache, "savedAt" | "country">
): Promise<void> {
  const body: DailyQuestionCache = {
    savedAt: Date.now(),
    country: (country || "GLOBAL").toUpperCase(),
    question: payload.question,
    trendingBadge: payload.trendingBadge ?? null,
    isHot: payload.isHot ?? false,
  };

  try {
    await storage.setItem(dailyQuestionCacheKey(country), JSON.stringify(body));
  } catch (_) {}
}

export async function loadDailyQuestionCache(
  country: string
): Promise<DailyQuestionCache | null> {
  try {
    const raw = await storage.getItem(dailyQuestionCacheKey(country));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyQuestionCache;
    if (!parsed?.question || !parsed.savedAt) return null;
    if (Date.now() - parsed.savedAt > TTL_MS) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}
