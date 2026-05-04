/**
 * Event Tracker v4 — KPI Intelligence
 *
 * v2 fixes: dedup, position, stable session, incremental watch, relative skip
 * v3 adds: growth signals, session behavior, return detection
 * v4 adds:
 *   - KPI signals (scroll depth ratio, session duration, creator tracking)
 *   - Exploration tagging (is_exploration, exploration_reason)
 *   - Creator distribution tracking (creator_id in metadata)
 *   - Auto scroll depth ratio (currentIndex / totalLoaded)
 */

import api from "./api";
import { AppState, AppStateStatus } from "react-native";

const FLUSH_INTERVAL_MS = 5000;
const MAX_BUFFER_SIZE = 50;
const WATCH_INTERVAL_MS = 2000; // FIX 4: send partial watch every 2s

type RawEvent = {
  id: string;
  type: string;
  entityType?: string;
  entityId?: number;
  watchTime?: number;
  duration?: number;
  position?: number;
  sessionId?: string;
  metadata?: Record<string, any>;
};

// ─── UUID generator (lightweight, no dependency) ───
let _counter = 0;
function uuid(): string {
  _counter++;
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rnd}-${_counter.toString(36)}`;
}

// ─── State ───
let buffer: RawEvent[] = [];
let sessionId: string = uuid();
let flushTimer: ReturnType<typeof setInterval> | null = null;
let sessionStartedAt: number = Date.now();
let totalSwipesInSession: number = 0;
let lastSwipeAt: number = 0;
let maxScrollDepth: number = 0;
let totalLoadedInSession: number = 0; // v4: for depth ratio
let seenCreators: Set<number> = new Set(); // v4: creator distribution

// FIX 4: Active watch trackers
const activeWatchers = new Map<number, {
  startedAt: number;
  lastReportedAt: number;
  duration: number;
  position: number;
  intervalId: ReturnType<typeof setInterval>;
}>();

function startFlushTimer() {
  if (flushTimer) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
}

function stopFlushTimer() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

async function flush() {
  if (buffer.length === 0) return;

  const batch = buffer.splice(0, MAX_BUFFER_SIZE);

  try {
    await api.post("/events", { events: batch }, {
      timeout: 5000,
    } as any);
  } catch (_) {
    // Fire-and-forget — never fail, never re-buffer
  }
}

function track(event: Omit<RawEvent, "id" | "sessionId">) {
  buffer.push({
    ...event,
    id: uuid(),           // FIX 1: unique event ID for dedup
    sessionId,            // FIX 3: stable session ID
  });

  if (buffer.length >= MAX_BUFFER_SIZE) {
    flush();
  }

  startFlushTimer();
}

// ─── FIX 4: App state handler (flush on background) ───
let _appStateListener: any = null;

function setupAppStateListener() {
  if (_appStateListener) return;

  _appStateListener = AppState.addEventListener("change", (nextState: AppStateStatus) => {
    if (nextState === "background" || nextState === "inactive") {
      // Flush all active watchers
      for (const [entityId] of activeWatchers) {
        stopWatching(entityId);
      }
      // Track scroll depth before leaving
      if (maxScrollDepth > 0) {
        track({
          type: "scroll_depth",
          metadata: {
            max_position: maxScrollDepth,
            swipes: totalSwipesInSession,
            session_duration: Math.round((Date.now() - sessionStartedAt) / 1000),
          },
        });
      }
      flush();
    } else if (nextState === "active") {
      // Detect session return
      const awayDuration = (Date.now() - sessionStartedAt) / 1000;
      if (awayDuration > 300) { // away > 5 min = new session
        track({
          type: "session_return",
          metadata: {
            away_seconds: Math.round(awayDuration),
            is_next_day: awayDuration > 86400,
          },
        });
        sessionStartedAt = Date.now();
        totalSwipesInSession = 0;
        maxScrollDepth = 0;
      }
    }
  });
}

// Auto-setup on import
try {
  setupAppStateListener();
} catch (_) {
  // Ignore — might not be in RN context
}

// ─────────────────────────────────────
// Public API
// ─────────────────────────────────────

function view(answerId: number, position?: number, meta?: { creator_id?: number; is_exploration?: boolean; category?: string }) {
  // v4: track creator distribution for KPI
  if (meta?.creator_id) seenCreators.add(meta.creator_id);
  if (position !== undefined) {
    maxScrollDepth = Math.max(maxScrollDepth, position);
  }

  track({
    type: "view",
    entityType: "answer",
    entityId: answerId,
    position,
    metadata: {
      creator_id: meta?.creator_id,
      is_exploration: meta?.is_exploration || false,
      category: meta?.category,
    },
  });
}

/**
 * FIX 4: Start watching — sends incremental watch events every 2s.
 * Call this when a video becomes visible.
 */
function startWatching(answerId: number, duration: number = 5, position?: number) {
  // Stop any existing watcher for this answer
  stopWatching(answerId);

  const now = Date.now();
  const intervalId = setInterval(() => {
    const watcher = activeWatchers.get(answerId);
    if (!watcher) return;

    const elapsed = (Date.now() - watcher.startedAt) / 1000;
    const sinceLast = (Date.now() - watcher.lastReportedAt) / 1000;

    // Send incremental watch
    track({
      type: "watch",
      entityType: "answer",
      entityId: answerId,
      watchTime: Math.round(sinceLast * 100) / 100,
      duration: watcher.duration,
      position: watcher.position,
      metadata: { total_elapsed: Math.round(elapsed * 100) / 100, incremental: true },
    });

    watcher.lastReportedAt = Date.now();
  }, WATCH_INTERVAL_MS);

  activeWatchers.set(answerId, {
    startedAt: now,
    lastReportedAt: now,
    duration,
    position: position ?? -1,
    intervalId,
  });
}

/**
 * FIX 4 + FIX 5: Stop watching — sends final watch + complete/skip (relative).
 * Call this when a video becomes invisible.
 */
function stopWatching(answerId: number) {
  const watcher = activeWatchers.get(answerId);
  if (!watcher) return;

  clearInterval(watcher.intervalId);
  activeWatchers.delete(answerId);

  const totalWatchTime = (Date.now() - watcher.startedAt) / 1000;
  const sinceLast = (Date.now() - watcher.lastReportedAt) / 1000;

  if (totalWatchTime < 0.2) return; // Too short to matter

  // Send remaining watch time since last incremental report
  if (sinceLast > 0.1) {
    track({
      type: "watch",
      entityType: "answer",
      entityId: answerId,
      watchTime: Math.round(sinceLast * 100) / 100,
      duration: watcher.duration,
      position: watcher.position,
      metadata: { total_elapsed: Math.round(totalWatchTime * 100) / 100, final: true },
    });
  }

  // FIX 5: Relative skip detection
  const watchRatio = watcher.duration > 0 ? totalWatchTime / watcher.duration : 0;

  if (watchRatio >= 0.9) {
    // Watched 90%+ → completed
    track({ type: "complete", entityType: "answer", entityId: answerId, position: watcher.position });
  } else if (watchRatio < 0.3) {
    // Watched less than 30% → skipped
    track({ type: "skip", entityType: "answer", entityId: answerId, position: watcher.position });
  }
  // 30-90% → just a partial watch, already tracked above
}

function like(answerId: number, position?: number, meta?: { creator_id?: number; is_exploration?: boolean; category?: string }) {
  track({
    type: "like",
    entityType: "answer",
    entityId: answerId,
    position,
    metadata: {
      creator_id: meta?.creator_id,
      is_exploration: meta?.is_exploration || false,
      category: meta?.category,
    },
  });
}

function share(answerId: number, position?: number, meta?: { creator_id?: number; category?: string }) {
  track({
    type: "share",
    entityType: "answer",
    entityId: answerId,
    position,
    metadata: { creator_id: meta?.creator_id, category: meta?.category },
  });
}

function replay(answerId: number, position?: number) {
  track({ type: "replay", entityType: "answer", entityId: answerId, position });
}

function swipe(answerId: number, direction: "up" | "down" = "up") {
  const now = Date.now();
  const swipeSpeed = lastSwipeAt > 0 ? (now - lastSwipeAt) / 1000 : 0;
  lastSwipeAt = now;
  totalSwipesInSession++;

  track({
    type: "swipe",
    entityType: "answer",
    entityId: answerId,
    metadata: {
      direction,
      swipe_speed: Math.round(swipeSpeed * 100) / 100,
      swipe_number: totalSwipesInSession,
    },
  });

  // Track max scroll depth
  // (position is tracked via view events, but we count swipes here)
  maxScrollDepth = Math.max(maxScrollDepth, totalSwipesInSession);
}

function feedOpen() {
  sessionStartedAt = Date.now();
  track({ type: "feed_open" });
}

function feedClose() {
  // Stop all active watchers
  for (const [entityId] of activeWatchers) {
    stopWatching(entityId);
  }

  const sessionDuration = Date.now() - sessionStartedAt;
  const depthRatio = totalLoadedInSession > 0 ? maxScrollDepth / totalLoadedInSession : 0;

  // v4: send KPI signals
  track({
    type: "scroll_depth",
    metadata: {
      depth: Math.round(depthRatio * 1000) / 1000,
      max_position: maxScrollDepth,
      total_loaded: totalLoadedInSession,
      swipes: totalSwipesInSession,
    },
  });

  track({
    type: "feed_close",
    metadata: {
      duration: sessionDuration,
      swipes: totalSwipesInSession,
      creators_seen: seenCreators.size,
      depth_ratio: Math.round(depthRatio * 1000) / 1000,
    },
  });

  flush();
}

function recordStart(questionId: number) {
  track({ type: "record_start", entityType: "question", entityId: questionId });
}

function recordPost(answerId: number, questionId: number) {
  track({
    type: "record_post",
    entityType: "answer",
    entityId: answerId,
    metadata: { question_id: questionId },
  });
}

/** Reset session on explicit call */
function newSession() {
  // Track first session completion if enough engagement
  if (totalSwipesInSession >= 3) {
    track({
      type: "first_session_complete",
      metadata: {
        swipes: totalSwipesInSession,
        duration: Math.round((Date.now() - sessionStartedAt) / 1000),
        max_depth: maxScrollDepth,
        creators_seen: seenCreators.size,
      },
    });
  }
  sessionId = uuid();
  sessionStartedAt = Date.now();
  totalSwipesInSession = 0;
  lastSwipeAt = 0;
  maxScrollDepth = 0;
  totalLoadedInSession = 0;
  seenCreators = new Set();
}

/** v4: Tell tracker how many items are loaded (for depth ratio) */
function updateLoadedCount(count: number) {
  totalLoadedInSession = Math.max(totalLoadedInSession, count);
}

// ── Growth Signals ──

function inviteSent(method: string = "share") {
  track({ type: "invite_sent", metadata: { method } });
}

function inviteAccepted(inviterId?: number) {
  track({ type: "invite_accepted", metadata: { inviter_id: inviterId } });
}

function shareClicked(answerId: number, platform?: string) {
  track({
    type: "share_clicked",
    entityType: "answer",
    entityId: answerId,
    metadata: { platform: platform || "unknown" },
  });
}

function scrollDepth(maxPosition: number) {
  track({
    type: "scroll_depth",
    metadata: {
      max_position: maxPosition,
      swipes: totalSwipesInSession,
      session_duration: Math.round((Date.now() - sessionStartedAt) / 1000),
    },
  });
}

// ── Share Tracking (Viral Loop) ──

function shareExport(answerId: number, platform?: string) {
  track({
    type: "share_export",
    entityType: "answer",
    entityId: answerId,
    metadata: { platform: platform || "unknown" },
  });
}

function shareOpen(answerId: number) {
  track({
    type: "share_open",
    entityType: "answer",
    entityId: answerId,
    metadata: { source: "deep_link" },
  });
}

function answerFromShare(answerId: number) {
  track({
    type: "answer_from_share",
    entityType: "answer",
    entityId: answerId,
    metadata: {
      session_duration: Math.round((Date.now() - sessionStartedAt) / 1000),
    },
  });
}

// ── Remix Chain Events ──

function remixCreated(answerId: number, parentId: number, depth: number) {
  track({
    type: "remix_created",
    entityType: "answer",
    entityId: answerId,
    metadata: { parentId, depth },
  });
}

function remixViewed(answerId: number, chainDepth: number) {
  track({
    type: "remix_viewed",
    entityType: "answer",
    entityId: answerId,
    metadata: { chain_depth: chainDepth },
  });
}

// ── Live Drop Events ──

function dropJoin(questionId: number) {
  track({
    type: "drop_join",
    entityType: "question",
    entityId: questionId,
  });
}

function dropAnswer(questionId: number, answerId: number) {
  track({
    type: "drop_answer",
    entityType: "question",
    entityId: questionId,
    metadata: { answer_id: answerId },
  });
}

function dropView(questionId: number) {
  track({
    type: "drop_view",
    entityType: "question",
    entityId: questionId,
  });
}

function getSessionId() {
  return sessionId;
}

function forceFlush() {
  flush();
}

function destroy() {
  for (const [entityId] of activeWatchers) {
    stopWatching(entityId);
  }
  flush();
  stopFlushTimer();
  if (_appStateListener) {
    _appStateListener.remove();
    _appStateListener = null;
  }
}

// ── Fusion Loop Events ──

function fusionAction(action: string, loopScore: number, streakDay: number) {
  track({
    type: "fusion_action",
    metadata: { action, loop_score: loopScore, streak_day: streakDay },
  });
}

function fusionBadge(badge: string, action: string) {
  track({
    type: "fusion_badge",
    metadata: { badge, action },
  });
}

function fusionLoopComplete(completions: number, streakDay: number) {
  track({
    type: "fusion_loop_complete",
    metadata: { completions, streak_day: streakDay },
  });
}

function fusionStreakMilestone(streakDay: number) {
  track({
    type: "fusion_streak_milestone",
    metadata: { streak_day: streakDay },
  });
}

export const eventTracker = {
  view,
  startWatching,
  stopWatching,
  like,
  share,
  replay,
  swipe,
  feedOpen,
  feedClose,
  recordStart,
  recordPost,
  newSession,
  getSessionId,
  forceFlush,
  destroy,
  // Growth signals
  inviteSent,
  inviteAccepted,
  shareClicked,
  scrollDepth,
  // Share tracking (viral loop)
  shareExport,
  shareOpen,
  answerFromShare,
  // Remix chain events
  remixCreated,
  remixViewed,
  // Live drop events
  dropJoin,
  dropAnswer,
  dropView,
  // v4: KPI helpers
  updateLoadedCount,
  // Fusion loop events
  fusionAction,
  fusionBadge,
  fusionLoopComplete,
  fusionStreakMilestone,
  // Session behavior
  getSessionBehavior: () => ({
    swipes: totalSwipesInSession,
    duration: Math.round((Date.now() - sessionStartedAt) / 1000),
    maxDepth: maxScrollDepth,
    totalLoaded: totalLoadedInSession,
    depthRatio: totalLoadedInSession > 0 ? Math.round((maxScrollDepth / totalLoadedInSession) * 1000) / 1000 : 0,
    creatorsSeenCount: seenCreators.size,
    avgSwipeSpeed: lastSwipeAt > 0 && totalSwipesInSession > 1
      ? Math.round(((Date.now() - sessionStartedAt) / 1000 / totalSwipesInSession) * 100) / 100
      : 0,
  }),
};
