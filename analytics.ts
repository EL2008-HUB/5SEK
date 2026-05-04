import { analyticsApi } from "./api";
import { ClientEventType } from "../contracts/api";

type EventPayload = {
  event_type: ClientEventType;
  screen?: string;
  metadata?: Record<string, unknown>;
};

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
let currentSessionId = "";
let sessionStartedAt = 0;
let lastActivityAt = 0;

function createSessionId() {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function ensureSession() {
  const now = Date.now();
  if (!currentSessionId || !sessionStartedAt || now - lastActivityAt > SESSION_TIMEOUT_MS) {
    currentSessionId = createSessionId();
    sessionStartedAt = now;
  }

  lastActivityAt = now;
  return {
    sessionId: currentSessionId,
    sessionStartedAt,
  };
}

async function track(event: EventPayload) {
  try {
    const session = ensureSession();
    await analyticsApi.trackEvent({
      ...event,
      metadata: {
        ...(event.metadata || {}),
        session_id: session.sessionId,
        session_started_at: new Date(session.sessionStartedAt).toISOString(),
      },
    });
  } catch (_) {}
}

export const analytics = {
  track,
  appOpen: () => track({ event_type: "app_open", screen: "app" }),
  appResume: () => track({ event_type: "app_resume", screen: "app" }),
  appBackgrounded: (metadata?: Record<string, unknown>) =>
    track({ event_type: "app_backgrounded", screen: "app", metadata }),
  sessionRecoveryFailed: (metadata?: Record<string, unknown>) =>
    track({ event_type: "session_recovery_failed", screen: "auth", metadata }),
  answerStart: (screen: string, metadata?: Record<string, unknown>) =>
    track({ event_type: "answer_start", screen, metadata }),
  answerComplete: (screen: string, metadata?: Record<string, unknown>) =>
    track({ event_type: "answer_complete", screen, metadata }),
  feedOpen: () => track({ event_type: "feed_open", screen: "feed" }),
  feedSwipe: (metadata?: Record<string, unknown>) =>
    track({ event_type: "feed_swipe", screen: "feed", metadata }),
  duelVote: (metadata?: Record<string, unknown>) =>
    track({ event_type: "duel_vote", screen: "feed", metadata }),
  pushRegistered: (metadata?: Record<string, unknown>) =>
    track({ event_type: "push_registered", screen: "app", metadata }),
  pushOpen: (metadata?: Record<string, unknown>) =>
    track({ event_type: "push_open", screen: "app", metadata }),
  pushPermissionDenied: (metadata?: Record<string, unknown>) =>
    track({ event_type: "push_permission_denied", screen: "app", metadata }),
  paywallShown: (screen: string, metadata?: Record<string, unknown>) =>
    track({ event_type: "paywall_shown", screen, metadata }),
  paywallClicked: (screen: string, metadata?: Record<string, unknown>) =>
    track({ event_type: "paywall_clicked", screen, metadata }),
  paywallClosed: (screen: string, metadata?: Record<string, unknown>) =>
    track({ event_type: "paywall_closed", screen, metadata }),
  shareOpened: (screen: string, metadata?: Record<string, unknown>) =>
    track({ event_type: "share_opened", screen, metadata }),
  shareCompleted: (screen: string, metadata?: Record<string, unknown>) =>
    track({ event_type: "share_completed", screen, metadata }),
  uploadRetry: (screen: string, metadata?: Record<string, unknown>) =>
    track({ event_type: "upload_retry", screen, metadata }),
  uploadCompleted: (screen: string, metadata?: Record<string, unknown>) =>
    track({ event_type: "upload_completed", screen, metadata }),
  uploadFailed: (screen: string, metadata?: Record<string, unknown>) =>
    track({ event_type: "upload_failed", screen, metadata }),
};
