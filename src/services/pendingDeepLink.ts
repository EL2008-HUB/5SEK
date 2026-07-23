import { storage } from "./storage";
import { isAllowedDeepLink } from "./deepLinks";

const STORAGE_KEY = "@5sek_pending_deep_link";

/**
 * Stash a deep link that arrived before the user could navigate
 * (cold start on Auth / FirstSession, or URL while gated).
 */
export async function stashPendingDeepLink(url: string) {
  if (!url || !isAllowedDeepLink(url)) return;
  await storage.setItem(STORAGE_KEY, url);
}

export async function peekPendingDeepLink(): Promise<string | null> {
  return storage.getItem(STORAGE_KEY);
}

export async function consumePendingDeepLink(): Promise<string | null> {
  const url = await storage.getItem(STORAGE_KEY);
  if (!url) return null;
  await storage.removeItem(STORAGE_KEY);
  return isAllowedDeepLink(url) ? url : null;
}

export type DeepLinkTarget =
  | { type: "deep_answer"; answerId: number }
  | { type: "tab"; screen: "Home" | "Trending" | "Record" | "Feed" | "Profile"; answerId?: number }
  | { type: "remix"; parentAnswerId: number }
  | { type: "question"; questionId: number };

/**
 * Map five-second:// / https://5sek.app URLs to a navigation target.
 */
export function parseDeepLinkTarget(url: string): DeepLinkTarget | null {
  try {
    const parsed = new URL(url);
    const hostPath =
      parsed.protocol === "five-second:"
        ? `${parsed.hostname}${parsed.pathname}`.replace(/\/+$/, "")
        : parsed.pathname.replace(/\/+$/, "");

    const path = hostPath.replace(/^\//, "");
    const segments = path.split("/").filter(Boolean);

    if (segments[0] === "answer" && segments[1]) {
      const answerId = Number(segments[1]);
      if (!Number.isNaN(answerId)) return { type: "deep_answer", answerId };
    }

    if (segments[0] === "a" && segments[1]) {
      const answerId = Number(segments[1]);
      if (!Number.isNaN(answerId)) return { type: "deep_answer", answerId };
    }

    if (segments[0] === "remix" && segments[1]) {
      const parentAnswerId = Number(segments[1]);
      if (!Number.isNaN(parentAnswerId)) return { type: "remix", parentAnswerId };
    }

    if (segments[0] === "question" || segments[0] === "q") {
      const questionId = Number(segments[1]);
      if (!Number.isNaN(questionId)) return { type: "question", questionId };
    }

    const tabMap: Record<string, "Home" | "Trending" | "Record" | "Feed" | "Profile"> = {
      home: "Home",
      trending: "Trending",
      record: "Record",
      feed: "Feed",
      profile: "Profile",
    };

    if (segments[0] && tabMap[segments[0]]) {
      const answerParam = parsed.searchParams.get("answer");
      const answerId = answerParam ? Number(answerParam) : undefined;
      return {
        type: "tab",
        screen: tabMap[segments[0]],
        answerId: answerId && !Number.isNaN(answerId) ? answerId : undefined,
      };
    }

    // https://5sek.app/feed?answer=123 with empty path segment quirks
    if (!segments[0] || segments[0] === "") {
      const answerParam = parsed.searchParams.get("answer");
      if (answerParam) {
        const answerId = Number(answerParam);
        if (!Number.isNaN(answerId)) return { type: "tab", screen: "Feed", answerId };
      }
    }

    return null;
  } catch (_) {
    return null;
  }
}
