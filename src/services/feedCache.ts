import { storage } from "./storage";

const CACHE_PREFIX = "@5sek_feed_cache_v1:";
const MAX_CACHED_ITEMS = 24;
const TTL_MS = 24 * 60 * 60 * 1000;

export type FeedCachePayload = {
  savedAt: number;
  feedMode: "local" | "global";
  country: string;
  items: unknown[];
};

export function feedCacheKey(feedMode: "local" | "global", country: string) {
  return `${CACHE_PREFIX}${feedMode}:${(country || "GLOBAL").toUpperCase()}`;
}

export async function saveFeedCache(
  feedMode: "local" | "global",
  country: string,
  items: unknown[]
): Promise<void> {
  const payload: FeedCachePayload = {
    savedAt: Date.now(),
    feedMode,
    country: (country || "GLOBAL").toUpperCase(),
    items: items.slice(0, MAX_CACHED_ITEMS),
  };

  try {
    await storage.setItem(feedCacheKey(feedMode, country), JSON.stringify(payload));
  } catch (_) {
    // Cache is best-effort — never break the feed for storage failures.
  }
}

export async function loadFeedCache(
  feedMode: "local" | "global",
  country: string
): Promise<FeedCachePayload | null> {
  try {
    const raw = await storage.getItem(feedCacheKey(feedMode, country));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as FeedCachePayload;
    if (!parsed || !Array.isArray(parsed.items) || !parsed.savedAt) return null;
    if (Date.now() - parsed.savedAt > TTL_MS) return null;
    if (parsed.items.length === 0) return null;

    return parsed;
  } catch (_) {
    return null;
  }
}
