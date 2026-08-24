/**
 * Notification Intelligence — Growth Engine
 *
 * Not just "send push" — but WHEN, WHAT, and WHO to notify.
 *
 * TRIGGER TYPES:
 *   1. Content trending → "Your question is blowing up 🔥"
 *   2. New answers → "3 new answers waiting 👀"
 *   3. Return hook → "You've been away, here's what's hot"
 *   4. Social proof → "Someone shared your answer"
 *   5. Streak → "You're on a 3-day streak 🔥"
 *
 * TIMING:
 *   - Best hour = user's last active hour
 *   - Rate limit: max 3 notifs per day
 *   - Cool-down: min 4h between notifs
 */

// ─────────────────────────────────────────────
// NOTIFICATION QUEUE
// ─────────────────────────────────────────────

const notifQueue = []; // { userId, type, message, scheduledAt, sent }
const userNotifState = new Map(); // userId → { lastSentAt, countToday, lastActiveHour, streak }

// ─────────────────────────────────────────────
// TIMING INTELLIGENCE
// ─────────────────────────────────────────────

function updateUserTiming(userId) {
  if (!userId) return;
  const now = new Date();
  let state = userNotifState.get(userId);

  if (!state) {
    state = { lastSentAt: 0, countToday: 0, lastActiveHour: now.getHours(), streak: 0, lastActiveDate: null };
    userNotifState.set(userId, state);
  }

  state.lastActiveHour = now.getHours();

  // Streak tracking
  const today = now.toISOString().slice(0, 10);
  if (state.lastActiveDate !== today) {
    const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    state.streak = state.lastActiveDate === yesterday ? state.streak + 1 : 1;
    state.lastActiveDate = today;

    // Reset daily counter
    state.countToday = 0;
  }
}

function getBestSendHour(userId) {
  const state = userNotifState.get(userId);
  return state ? state.lastActiveHour : 19; // default: 7 PM
}

// ─────────────────────────────────────────────
// RATE LIMITING
// ─────────────────────────────────────────────

const MAX_DAILY_NOTIFS = 3;
const MIN_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

function canSendNotif(userId) {
  const state = userNotifState.get(userId);
  if (!state) return true;

  if (state.countToday >= MAX_DAILY_NOTIFS) return false;
  if (Date.now() - state.lastSentAt < MIN_COOLDOWN_MS) return false;

  return true;
}

function markSent(userId) {
  let state = userNotifState.get(userId);
  if (!state) {
    state = { lastSentAt: 0, countToday: 0, lastActiveHour: 19, streak: 0, lastActiveDate: null };
    userNotifState.set(userId, state);
  }
  state.lastSentAt = Date.now();
  state.countToday++;
}

// ─────────────────────────────────────────────
// NOTIFICATION TEMPLATES
// ─────────────────────────────────────────────

const TEMPLATES = {
  trending_question: {
    title: "🔥 Your question is blowing up!",
    body: (data) => `${data.views || "People"} viewed your question — check who answered!`,
    priority: 1,
  },
  new_answers: {
    title: "👀 New answers waiting",
    body: (data) => `${data.count || "Several"} new answers to your question`,
    priority: 2,
  },
  return_hook: {
    title: "🎯 Here's what you missed",
    body: () => "New trending content just dropped — your feed is updated",
    priority: 3,
  },
  social_proof: {
    title: "🚀 Someone shared your answer!",
    body: (data) => `Your answer is spreading — ${data.shares || "people"} shared it`,
    priority: 1,
  },
  streak: {
    title: "🔥 You're on fire!",
    body: (data) => `${data.streak}-day streak! Don't break it`,
    priority: 2,
  },
  miss_you: {
    title: "😳 We miss you!",
    body: () => "New questions are waiting for your take",
    priority: 4,
  },
};

// ─────────────────────────────────────────────
// TRIGGER FUNCTIONS
// ─────────────────────────────────────────────

function triggerNotification(userId, templateKey, data = {}) {
  if (!userId) return null;
  if (!canSendNotif(userId)) return null;

  const template = TEMPLATES[templateKey];
  if (!template) return null;

  const notif = {
    userId,
    type: templateKey,
    title: template.title,
    body: template.body(data),
    priority: template.priority,
    scheduledAt: Date.now(),
    data,
    sent: false,
  };

  notifQueue.push(notif);
  return notif;
}

// ─────────────────────────────────────────────
// SMART TRIGGERS (call from event pipeline)
// ─────────────────────────────────────────────

function evaluateTriggers(userId, eventType, metadata = {}) {
  if (!userId) return;

  updateUserTiming(userId);

  // Trending question trigger
  if (eventType === "view" && metadata.entity_type === "question") {
    const views = metadata.total_views || 0;
    if (views > 50 && metadata.is_owner) {
      triggerNotification(userId, "trending_question", { views });
    }
  }

  // New answers trigger
  if (eventType === "record_post" && metadata.question_owner_id) {
    // Notify the question owner
    const answerCount = metadata.answer_count || 1;
    if (answerCount >= 3) {
      triggerNotification(metadata.question_owner_id, "new_answers", { count: answerCount });
    }
  }

  // Social proof trigger
  if (eventType === "share" && metadata.content_owner_id) {
    triggerNotification(metadata.content_owner_id, "social_proof", { shares: metadata.total_shares || 1 });
  }

  // Streak notification (on session start)
  if (eventType === "session_return" || eventType === "feed_open") {
    const state = userNotifState.get(userId);
    if (state && state.streak >= 3 && state.streak % 3 === 0) {
      triggerNotification(userId, "streak", { streak: state.streak });
    }
  }
}

// ─────────────────────────────────────────────
// CHECK INACTIVE USERS (call from cron)
// ─────────────────────────────────────────────

function checkInactiveUsers(behaviorStates) {
  const triggers = [];
  const now = Date.now();

  for (const [userId, state] of behaviorStates) {
    const hoursAway = (now - (state.lastActive || now)) / (1000 * 60 * 60);

    if (hoursAway > 24 && hoursAway < 72) {
      const notif = triggerNotification(userId, "return_hook");
      if (notif) triggers.push(notif);
    }

    if (hoursAway >= 72) {
      const notif = triggerNotification(userId, "miss_you");
      if (notif) triggers.push(notif);
    }
  }

  return triggers;
}

// ─────────────────────────────────────────────
// PROCESS QUEUE (call periodically or on demand)
// ─────────────────────────────────────────────

function processQueue() {
  const toSend = [];

  while (notifQueue.length > 0) {
    const notif = notifQueue.shift();

    if (!canSendNotif(notif.userId)) continue;

    // TODO: integrate with push service (Expo/Firebase)
    // For now, log and mark sent
    notif.sent = true;
    notif.sentAt = Date.now();
    markSent(notif.userId);
    toSend.push(notif);
  }

  return toSend;
}

// ─────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────

function getNotifStats() {
  return {
    queueSize: notifQueue.length,
    usersTracked: userNotifState.size,
    streakLeaders: [...userNotifState.entries()]
      .filter(([, s]) => s.streak >= 3)
      .sort((a, b) => b[1].streak - a[1].streak)
      .slice(0, 10)
      .map(([id, s]) => ({ userId: id, streak: s.streak, lastActiveHour: s.lastActiveHour })),
  };
}

module.exports = {
  triggerNotification,
  evaluateTriggers,
  checkInactiveUsers,
  processQueue,
  updateUserTiming,
  getBestSendHour,
  canSendNotif,
  getNotifStats,
  TEMPLATES,
};
