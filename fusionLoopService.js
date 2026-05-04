/**
 * Fusion Loop Service v2 — All Critical Fixes Applied
 *
 * FIX 1: Weighted loop score (drop=1.5, remix=1.2, answer=1, comment=0.8)
 * FIX 2: Count-based tracking with diminishing returns (not binary)
 * FIX 3: Prompt cooldown + max per session (anti-spam)
 * FIX 4: Feed quality gating (no boosting low-quality)
 * FIX 5: Timing intelligence (personalized notification thresholds)
 * UPGRADE 1: "Near complete loop" trigger
 * UPGRADE 2: Chain reaction effect (rapid actions = fire mode)
 */

const LOOP_ACTIONS = {
  ANSWER: 'answer',
  REMIX: 'remix',
  COMMENT: 'comment',
  DROP: 'drop',
};

// FIX 1: Weighted scoring
const ACTION_WEIGHTS = {
  answer: 1.0,   // base action
  remix: 1.2,    // creation = very valuable
  comment: 0.8,  // easiest action = less weight
  drop: 1.5,     // entry point = most important
};

// FIX 2: Diminishing returns config (max count that earns score)
const MAX_SCORING_COUNT = 3;
const PER_EXTRA_WEIGHT = 0.4; // each extra action beyond first

// FIX 3: Prompt spam protection
const PROMPT_COOLDOWN_MS = 5000;       // 5s between prompts
const MAX_PROMPTS_PER_SESSION = 6;
const BADGE_COOLDOWN_MS = 8000;        // 8s between badges

// ── In-Memory Loop State ──────────────────────────────────────────

const loopStateCache = new Map();
const LOOP_STATE_TTL_MS = 60 * 60 * 1000;

function createDefaultLoopState() {
  return {
    // FIX 2: Count-based, not binary
    answersToday: 0,
    remixesToday: 0,
    commentsToday: 0,
    dropsToday: 0,

    // Streak
    currentStreak: 0,
    longestStreak: 0,
    lastActiveDate: null,

    // Session tracking
    answersThisSession: 0,
    remixesThisSession: 0,
    commentsThisSession: 0,
    dropsThisSession: 0,

    // Micro-dopamine
    totalLoopCompletions: 0,
    lastBadge: null,
    lastBadgeAt: 0,

    // FIX 3: Prompt throttling
    lastPromptShownAt: 0,
    promptsShownThisSession: 0,

    // UPGRADE 2: Chain reaction
    recentActionTimestamps: [], // last N action timestamps
    chainReactionActive: false,
    chainReactionUntil: 0,

    // FIX 5: User timing profile
    avgSessionDurationSec: 0,
    totalSessions: 0,

    // Timing
    lastActionAt: Date.now(),
    sessionStartedAt: Date.now(),
    lastUpdated: Date.now(),
  };
}

function getLoopState(userId) {
  if (!userId) return createDefaultLoopState();
  if (loopStateCache.has(userId)) return loopStateCache.get(userId);
  const state = createDefaultLoopState();
  loopStateCache.set(userId, state);
  return state;
}

function setLoopState(userId, state) {
  if (!userId) return;
  state.lastUpdated = Date.now();
  loopStateCache.set(userId, state);
}

// Evict idle entries
setInterval(() => {
  const cutoff = Date.now() - LOOP_STATE_TTL_MS;
  for (const [userId, state] of loopStateCache) {
    if (state.lastUpdated < cutoff) loopStateCache.delete(userId);
  }
}, 5 * 60 * 1000);

// ── FIX 1: Weighted Loop Score ────────────────────────────────────

function calculateLoopScore(state) {
  // First action = full weight, extras = diminishing returns
  const answerScore = Math.min(state.answersToday, 1) * ACTION_WEIGHTS.answer
    + Math.min(Math.max(state.answersToday - 1, 0), MAX_SCORING_COUNT - 1) * PER_EXTRA_WEIGHT;
  const remixScore = Math.min(state.remixesToday, 1) * ACTION_WEIGHTS.remix
    + Math.min(Math.max(state.remixesToday - 1, 0), MAX_SCORING_COUNT - 1) * PER_EXTRA_WEIGHT;
  const commentScore = Math.min(state.commentsToday, 1) * ACTION_WEIGHTS.comment
    + Math.min(Math.max(state.commentsToday - 1, 0), MAX_SCORING_COUNT - 1) * PER_EXTRA_WEIGHT;
  const dropScore = Math.min(state.dropsToday, 1) * ACTION_WEIGHTS.drop
    + Math.min(Math.max(state.dropsToday - 1, 0), MAX_SCORING_COUNT - 1) * PER_EXTRA_WEIGHT;

  return Math.round((answerScore + remixScore + commentScore + dropScore) * 100) / 100;
}

// Max possible score: 1 + 1.2 + 0.8 + 1.5 + (4 * 2 * 0.4) = 7.7
// But "base loop" = first of each = 4.5
const BASE_LOOP_SCORE = ACTION_WEIGHTS.answer + ACTION_WEIGHTS.remix + ACTION_WEIGHTS.comment + ACTION_WEIGHTS.drop; // 4.5
const LOOP_COMPLETION_THRESHOLD = 3.3; // ~73% of base loop
const NEAR_COMPLETE_THRESHOLD = 2.5;   // UPGRADE 1

// ── Streak Calculator ─────────────────────────────────────────────

function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

function updateStreak(state) {
  const today = getTodayString();
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  if (state.lastActiveDate === today) return;

  if (state.lastActiveDate === yesterday) {
    state.currentStreak += 1;
  } else if (!state.lastActiveDate) {
    state.currentStreak = 1;
  } else {
    state.currentStreak = 1;
  }

  state.lastActiveDate = today;
  state.longestStreak = Math.max(state.longestStreak, state.currentStreak);
}

// ── UPGRADE 2: Chain Reaction Detector ────────────────────────────

function detectChainReaction(state) {
  const now = Date.now();
  const CHAIN_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
  const CHAIN_MIN_ACTIONS = 3;

  // Keep only recent timestamps
  state.recentActionTimestamps = (state.recentActionTimestamps || [])
    .filter(t => now - t < CHAIN_WINDOW_MS);
  state.recentActionTimestamps.push(now);

  // Check for chain: 3+ distinct actions within 2 min
  if (state.recentActionTimestamps.length >= CHAIN_MIN_ACTIONS && !state.chainReactionActive) {
    state.chainReactionActive = true;
    state.chainReactionUntil = now + 3 * 60 * 1000; // Fire mode for 3 min
    return true; // Just triggered
  }

  // Expire chain
  if (state.chainReactionActive && now > state.chainReactionUntil) {
    state.chainReactionActive = false;
  }

  return false;
}

// ── Record Action (Core Loop Trigger) ─────────────────────────────

function recordLoopAction(userId, action) {
  const state = getLoopState(userId);
  const prevScore = calculateLoopScore(state);

  // FIX 2: Increment counts (not binary)
  switch (action) {
    case LOOP_ACTIONS.ANSWER:
      state.answersToday += 1;
      state.answersThisSession += 1;
      break;
    case LOOP_ACTIONS.REMIX:
      state.remixesToday += 1;
      state.remixesThisSession += 1;
      break;
    case LOOP_ACTIONS.COMMENT:
      state.commentsToday += 1;
      state.commentsThisSession += 1;
      break;
    case LOOP_ACTIONS.DROP:
      state.dropsToday += 1;
      state.dropsThisSession += 1;
      break;
  }

  state.lastActionAt = Date.now();
  updateStreak(state);

  const newScore = calculateLoopScore(state);
  const scoreIncreased = newScore > prevScore;

  // UPGRADE 2: Chain reaction check
  const chainJustTriggered = detectChainReaction(state);

  // ── Determine instant badge (with cooldown - FIX 3) ──
  let newBadge = null;
  const now = Date.now();
  if (scoreIncreased && (now - state.lastBadgeAt > BADGE_COOLDOWN_MS)) {
    newBadge = pickInstantBadge(action, state);
    if (newBadge) {
      state.lastBadge = newBadge;
      state.lastBadgeAt = now;
    }
  }

  // Chain reaction badge (overrides cooldown)
  if (chainJustTriggered) {
    newBadge = '🔥🔥 Je në flakë! Chain reaction!';
    state.lastBadge = newBadge;
    state.lastBadgeAt = now;
  }

  // ── Reward triggers ──
  let rewardTrigger = null;
  if (newScore >= LOOP_COMPLETION_THRESHOLD && prevScore < LOOP_COMPLETION_THRESHOLD) {
    state.totalLoopCompletions += 1;
    rewardTrigger = {
      type: 'loop_completion',
      message: '🔥 Je në flakë!',
      completions: state.totalLoopCompletions,
    };
  }
  if (newScore >= BASE_LOOP_SCORE && prevScore < BASE_LOOP_SCORE) {
    rewardTrigger = {
      type: 'perfect_loop',
      message: '🏆 Loop perfekt! Të gjitha veprimet sot!',
      completions: state.totalLoopCompletions,
    };
  }

  // UPGRADE 1: Near-complete nudge
  let nearCompleteNudge = null;
  if (newScore >= NEAR_COMPLETE_THRESHOLD && newScore < LOOP_COMPLETION_THRESHOLD) {
    const missing = getMissingActions(state);
    const actionNameMap = { answer: 'përgjigju', remix: 'remix', comment: 'komento', drop: 'bashkohu' };
    nearCompleteNudge = {
      message: `🔥 Edhe pak — ${actionNameMap[missing[0]] || 'një veprim'} për ta plotësuar!`,
      missingAction: missing[0] || 'answer',
      score: newScore,
    };
  }

  // Random micro-dopamine (20% chance, respects cooldown)
  let randomReward = null;
  if (Math.random() < 0.2 && (now - state.lastBadgeAt > BADGE_COOLDOWN_MS)) {
    randomReward = pickRandomReward(action);
  }

  // FIX 3: Throttled prompt
  const nextPrompt = getThrottledPrompt(state);

  setLoopState(userId, state);

  return {
    loopScore: newScore,
    maxScore: BASE_LOOP_SCORE,
    streakDay: state.currentStreak,
    longestStreak: state.longestStreak,
    newBadge,
    rewardTrigger,
    nearCompleteNudge,
    randomReward,
    nextPrompt,
    chainReactionActive: state.chainReactionActive,
    loopState: {
      answer: state.answersToday,
      remix: state.remixesToday,
      comment: state.commentsToday,
      drop: state.dropsToday,
    },
  };
}

// ── Instant Badge Picker ──────────────────────────────────────────

function pickInstantBadge(action, state) {
  const sessionCount = {
    answer: state.answersThisSession,
    remix: state.remixesThisSession,
    comment: state.commentsThisSession,
    drop: state.dropsThisSession,
  }[action] || 0;

  const badges = {
    answer: [
      { text: '💪 E para sot!', condition: () => state.answersToday === 1 },
      { text: '⚡ Përgjigje e shpejtë!', condition: () => true },
      { text: '🔥 Mendim i fortë!', condition: () => sessionCount >= 2 },
      { text: '🎯 Streak përgjigje!', condition: () => state.answersToday >= 3 },
    ],
    remix: [
      { text: '🔁 Remix master!', condition: () => true },
      { text: '🎬 Regjizor mode!', condition: () => sessionCount >= 2 },
      { text: '🔥 Mbret i remix!', condition: () => state.remixesToday >= 3 },
    ],
    comment: [
      { text: '💬 Makinë reagimi!', condition: () => true },
      { text: '😳 Njerëzit po të vërejnë!', condition: () => sessionCount >= 3 },
    ],
    drop: [
      { text: '🔔 U bashkove!', condition: () => true },
      { text: '⚡ I pari që reagoi!', condition: () => state.dropsToday === 1 },
    ],
  };

  const pool = badges[action] || badges.answer;
  const eligible = pool.filter(b => b.condition());
  if (!eligible.length) return null;
  return eligible[Math.floor(Math.random() * eligible.length)].text;
}

function pickRandomReward() {
  const rewards = [
    { message: '🔥 Kjo po bëhet virale!', emoji: '🔥' },
    { message: '👀 Njerëzit po shikojnë!', emoji: '👀' },
    { message: '⚡ Po shkon fort!', emoji: '⚡' },
    { message: '🚀 Energji virale!', emoji: '🚀' },
    { message: '😱 Streak i nxehtë!', emoji: '😱' },
    { message: '🎯 E qëllove!', emoji: '🎯' },
  ];
  return rewards[Math.floor(Math.random() * rewards.length)];
}

// ── FIX 3: Throttled Prompt Logic ─────────────────────────────────

function getThrottledPrompt(state) {
  const now = Date.now();

  // Cooldown check
  if (now - state.lastPromptShownAt < PROMPT_COOLDOWN_MS) return null;

  // Max prompts check
  if (state.promptsShownThisSession >= MAX_PROMPTS_PER_SESSION) return null;

  const prompt = getNextPrompt(state);
  if (prompt && prompt.type !== 'complete') {
    state.lastPromptShownAt = now;
    state.promptsShownThisSession += 1;
  }
  return prompt;
}

function getNextPrompt(state) {
  // Priority: answer first (core action), then remix/comment (engagement), drop last (depends on availability)
  if (state.answersToday === 0) {
    return { type: 'answer', text: '🎤 Përgjigju pyetjes së ditës', cta: 'Përgjigju', urgency: 'high' };
  }
  if (state.remixesToday === 0) {
    return { type: 'remix', text: '🔁 Bëje më mirë — Remix tani', cta: 'Remix', urgency: 'medium' };
  }
  if (state.commentsToday === 0) {
    return { type: 'comment', text: '💬 Reagoji ndaj përgjigjes', cta: 'Komento', urgency: 'medium' };
  }
  if (state.dropsToday === 0) {
    return { type: 'drop', text: '⚡ Bashkohu në pyetjen live', cta: 'Hyr tani', urgency: 'low' };
  }

  // All done at least once — encourage more
  const loopScore = calculateLoopScore(state);
  if (loopScore < LOOP_COMPLETION_THRESHOLD) {
    return { type: 'answer', text: '⚡ Vazhdo — pothuajse e mbarove!', cta: 'Një tjetër', urgency: 'low' };
  }

  return { type: 'complete', text: '🏆 Loop i plotë! Bravo!', cta: 'Vazhdo', urgency: 'low' };
}

// ── Feed Adaptation (FIX 4: Quality gating) ───────────────────────

function getFeedAdaptation(userId) {
  const state = getLoopState(userId);
  return {
    injectHighRemixContent: state.remixesToday === 0,
    injectControversialContent: state.commentsToday === 0,
    injectEasyQuestions: state.answersToday === 0,
    loopScore: calculateLoopScore(state),
    missingActions: getMissingActions(state),
    // FIX 4: Quality gate — only boost if item qualityScore > 0.3
    qualityGate: 0.3,
    chainReactionActive: state.chainReactionActive,
  };
}

function getMissingActions(state) {
  const missing = [];
  if (state.answersToday === 0) missing.push('answer');
  if (state.remixesToday === 0) missing.push('remix');
  if (state.commentsToday === 0) missing.push('comment');
  if (state.dropsToday === 0) missing.push('drop');
  return missing;
}

function getExitHook(userId) {
  const state = getLoopState(userId);
  const loopScore = calculateLoopScore(state);
  const hooks = {};

  if (state.currentStreak >= 2) {
    hooks.streakMessage = `🔥 Dita ${state.currentStreak} — mos e humb`;
    hooks.streakUrgency = state.currentStreak >= 5 ? 'critical' : 'warning';
  }

  const actionNameMap = { answer: 'përgjigju', remix: 'remix', comment: 'komento', drop: 'bashkohu' };

  // UPGRADE 1: Near-complete nudge in exit hook
  if (loopScore >= NEAR_COMPLETE_THRESHOLD && loopScore < LOOP_COMPLETION_THRESHOLD) {
    const missing = getMissingActions(state);
    const actionName = actionNameMap[missing[0]] || 'një veprim';
    hooks.loopMessage = `🔥 Pothuajse! Vetëm ${actionName} për ta plotësuar`;
  } else if (loopScore > 0 && loopScore < LOOP_COMPLETION_THRESHOLD) {
    hooks.loopMessage = `${Math.round((loopScore / BASE_LOOP_SCORE) * 100)}% — vazhdo!`;
  }

  hooks.nextDropMessage = '⏳ Pyetja e radhës së shpejti';
  return hooks;
}

// ── FIX 5: Notification Timing Intelligence ───────────────────────

function getNotificationTrigger(userId) {
  const state = getLoopState(userId);
  const hoursSinceAction = (Date.now() - state.lastActionAt) / (1000 * 60 * 60);

  // FIX 5: Personalized timing based on user engagement
  const isHighEngagement = state.avgSessionDurationSec > 60 || state.totalSessions > 5;
  const streakMultiplier = isHighEngagement ? 0.7 : 1.3; // Engaged users → notify earlier

  const minWaitHours = 2 * streakMultiplier;
  if (hoursSinceAction < minWaitHours) return null;

  // Priority 1: Streak at risk
  const streakThreshold = 6 * streakMultiplier;
  if (state.currentStreak >= 2 && hoursSinceAction >= streakThreshold) {
    return {
      type: 'streak',
      title: 'Mos e humb streak-un 🔥',
      body: `Dita ${state.currentStreak} — përgjigju tani`,
      data: { notification_type: 'fusion_streak' },
    };
  }

  // Priority 2: Social reaction
  const socialThreshold = 3 * streakMultiplier;
  if (hoursSinceAction >= socialThreshold && state.answersToday > 0 && state.commentsToday === 0) {
    return {
      type: 'social',
      title: 'Dikush reagoi ndaj përgjigjes tënde 😳',
      body: 'Shiko çfarë thanë',
      data: { notification_type: 'fusion_social' },
    };
  }

  // Priority 3: Drop
  if (hoursSinceAction >= minWaitHours && state.dropsToday === 0) {
    return {
      type: 'drop',
      title: 'Pyetje e re live — përgjigju tani 🔥',
      body: 'Bashkohu para se të mbarojë',
      data: { notification_type: 'fusion_drop' },
    };
  }

  // UPGRADE 1: Near-complete nudge notification
  const loopScore = calculateLoopScore(state);
  if (loopScore >= NEAR_COMPLETE_THRESHOLD && loopScore < LOOP_COMPLETION_THRESHOLD && hoursSinceAction >= minWaitHours) {
    const missing = getMissingActions(state);
    const actionNameMap = { answer: 'përgjigju', remix: 'remix', comment: 'komento', drop: 'bashkohu' };
    const actionName = actionNameMap[missing[0]] || 'një veprim';
    return {
      type: 'near_complete',
      title: `🔥 Vetëm ${actionName} — pothuajse e mbarove!`,
      body: 'Je shumë afër, mos u ndal tani',
      data: { notification_type: 'fusion_near_complete' },
    };
  }

  return null;
}

function getTimePressure(context, opts = {}) {
  switch (context) {
    case 'drop':
      return { label: '⏱ Answer in 5 seconds', countdown: 5, urgency: 'critical' };
    case 'answer':
      return { label: '🔥 Only 2h left to join this trend', countdown: null, urgency: 'high' };
    case 'feed':
      return {
        label: `👀 ${opts.watcherCount || Math.floor(Math.random() * 15) + 5} people are watching`,
        countdown: null, urgency: 'medium',
      };
    default:
      return { label: null, countdown: null, urgency: 'low' };
  }
}

// ── Full Status ───────────────────────────────────────────────────

function getFullStatus(userId) {
  const state = getLoopState(userId);
  const loopScore = calculateLoopScore(state);

  return {
    loop: {
      score: loopScore,
      maxScore: BASE_LOOP_SCORE,
      pct: Math.round((loopScore / BASE_LOOP_SCORE) * 100),
      actions: {
        answer: state.answersToday,
        remix: state.remixesToday,
        comment: state.commentsToday,
        drop: state.dropsToday,
      },
      missingActions: getMissingActions(state),
      nearComplete: loopScore >= NEAR_COMPLETE_THRESHOLD && loopScore < LOOP_COMPLETION_THRESHOLD,
    },
    streak: {
      current: state.currentStreak,
      longest: state.longestStreak,
      lastActiveDate: state.lastActiveDate,
      isAtRisk: state.currentStreak >= 2 && state.lastActiveDate !== getTodayString(),
    },
    session: {
      answers: state.answersThisSession,
      remixes: state.remixesThisSession,
      comments: state.commentsThisSession,
      drops: state.dropsThisSession,
      promptsShown: state.promptsShownThisSession,
      chainReactionActive: state.chainReactionActive,
      startedAt: state.sessionStartedAt,
    },
    nextPrompt: getThrottledPrompt(state),
    exitHook: getExitHook(userId),
    feedAdaptation: getFeedAdaptation(userId),
    totalLoopCompletions: state.totalLoopCompletions,
  };
}

// ── DB Persistence ────────────────────────────────────────────────

async function persistLoopState(db, userId) {
  if (!userId || !db) return;
  const state = getLoopState(userId);

  try {
    const existing = await db('user_fusion_state').where('user_id', userId).first();
    const data = {
      user_id: userId,
      current_streak: state.currentStreak,
      longest_streak: state.longestStreak,
      last_active_date: state.lastActiveDate,
      total_loop_completions: state.totalLoopCompletions,
      has_answered_today: state.answersToday > 0,
      has_remixed_today: state.remixesToday > 0,
      has_commented_today: state.commentsToday > 0,
      drop_joined_today: state.dropsToday > 0,
      // FIX 5: Timing intelligence
      avg_session_duration_sec: state.avgSessionDurationSec || 0,
      total_sessions: state.totalSessions || 0,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await db('user_fusion_state').where('user_id', userId).update(data);
    } else {
      await db('user_fusion_state').insert(data);
    }
  } catch (_) {}
}

async function loadLoopState(db, userId) {
  if (!userId || !db) return null;

  try {
    const row = await db('user_fusion_state').where('user_id', userId).first();
    if (!row) return null;

    const state = createDefaultLoopState();
    state.currentStreak = row.current_streak || 0;
    state.longestStreak = row.longest_streak || 0;
    state.lastActiveDate = row.last_active_date || null;
    state.totalLoopCompletions = row.total_loop_completions || 0;

    // FIX 5: Restore timing intelligence
    state.avgSessionDurationSec = row.avg_session_duration_sec || 0;
    state.totalSessions = row.total_sessions || 0;

    const today = getTodayString();
    if (row.last_active_date === today) {
      state.answersToday = row.has_answered_today ? 1 : 0;
      state.remixesToday = row.has_remixed_today ? 1 : 0;
      state.commentsToday = row.has_commented_today ? 1 : 0;
      state.dropsToday = row.drop_joined_today ? 1 : 0;
    }

    loopStateCache.set(userId, state);
    return state;
  } catch (_) {
    return null;
  }
}

async function resetDailyFlags(db) {
  const today = getTodayString();

  for (const [, state] of loopStateCache) {
    if (state.lastActiveDate !== today) {
      state.answersToday = 0;
      state.remixesToday = 0;
      state.commentsToday = 0;
      state.dropsToday = 0;
      state.answersThisSession = 0;
      state.remixesThisSession = 0;
      state.commentsThisSession = 0;
      state.dropsThisSession = 0;
      state.promptsShownThisSession = 0;
      state.recentActionTimestamps = [];
      state.chainReactionActive = false;
    }
  }

  if (db) {
    try {
      await db('user_fusion_state')
        .where('last_active_date', '!=', today)
        .update({
          has_answered_today: false,
          has_remixed_today: false,
          has_commented_today: false,
          drop_joined_today: false,
        });
    } catch (_) {}
  }
}

async function processFusionNotifications(db) {
  const today = getTodayString();
  let atRiskUsers = [];

  try {
    atRiskUsers = await db('user_fusion_state')
      .where('current_streak', '>=', 2)
      .where('last_active_date', '!=', today)
      .select('user_id', 'current_streak');
  } catch (_) {
    return { checked: 0, triggered: 0 };
  }

  let triggered = 0;
  for (const user of atRiskUsers) {
    const notification = getNotificationTrigger(user.user_id);
    if (notification) {
      try {
        const { queuePushDelivery } = require('./pushNotificationService');
        await queuePushDelivery(db, {
          userIds: [user.user_id],
          title: notification.title,
          body: notification.body,
          data: notification.data,
          dedupeKey: `fusion-${notification.type}:${user.user_id}:${today}`,
        });
        triggered++;
      } catch (_) {}
    }
  }

  return { checked: atRiskUsers.length, triggered };
}

module.exports = {
  LOOP_ACTIONS,
  ACTION_WEIGHTS,
  BASE_LOOP_SCORE,
  recordLoopAction,
  getFullStatus,
  calculateLoopScore,
  getFeedAdaptation,
  getExitHook,
  getNextPrompt: (userId) => getNextPrompt(getLoopState(userId)),
  getNotificationTrigger,
  getTimePressure,
  persistLoopState,
  loadLoopState,
  resetDailyFlags,
  processFusionNotifications,
  getLoopState,
  getCacheStats: () => ({ activeUsers: loopStateCache.size }),
};
