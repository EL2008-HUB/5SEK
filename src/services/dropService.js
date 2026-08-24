/**
 * Drop Service — Live Question Drops Engine
 *
 * Manages scheduled question drops with live participation tracking.
 * Drops create urgency + concurrent engagement → retention gold.
 */

const DROP_WINDOW_MINUTES = 5; // How long a drop stays active after start
const MAX_UPCOMING_DROPS = 5;   // Max upcoming drops to show
const FAKED_PARTICIPANT_RANGE = [25, 60]; // 🔥 FIX 4: Higher floor so drops NEVER look dead
const FIXED_DROP_HOURS = [12, 18, 21]; // 🔥 FIX 3: Fixed schedule — builds habit

// ── In-Memory Active Drops State ──
const activeDrops = new Map(); // questionId → { startedAt, participants: Set, answerCount }

/**
 * Check for due drops and activate them.
 * Called by the background job worker on interval.
 *
 * @param {object} db - Knex instance
 * @returns {number} Number of drops activated
 */
async function processDueDrops(db) {
  const now = new Date();
  const oneMinAgo = new Date(now.getTime() - 60 * 1000);

  // Find drops that should be active now
  const dueDrops = await db("questions")
    .where("is_drop", true)
    .where("drop_status", "pending")
    .where("scheduled_drop_time", "<=", now.toISOString())
    .where("scheduled_drop_time", ">=", oneMinAgo.toISOString())
    .whereNull("deleted_at")
    .select("id", "text", "scheduled_drop_time", "category", "country");

  let activated = 0;

  for (const drop of dueDrops) {
    await activateDrop(db, drop.id);
    activated++;
  }

  // Also expire old active drops
  await expireOldDrops(db);

  return activated;
}

/**
 * Activate a drop — mark it active and set up in-memory state.
 *
 * @param {object} db - Knex instance
 * @param {number} questionId
 */
async function activateDrop(db, questionId) {
  await db("questions")
    .where({ id: questionId })
    .update({
      drop_status: "active",
    });

  activeDrops.set(questionId, {
    startedAt: Date.now(),
    participants: new Set(),
    answerCount: 0,
  });
}

/**
 * Expire drops that have been active for longer than DROP_WINDOW_MINUTES.
 *
 * @param {object} db - Knex instance
 */
async function expireOldDrops(db) {
  const expiryThreshold = new Date(Date.now() - DROP_WINDOW_MINUTES * 60 * 1000);

  // DB: mark expired
  await db("questions")
    .where("is_drop", true)
    .where("drop_status", "active")
    .where("scheduled_drop_time", "<", expiryThreshold.toISOString())
    .update({ drop_status: "completed" });

  // In-memory: clean up expired
  for (const [questionId, state] of activeDrops) {
    const elapsed = Date.now() - state.startedAt;
    if (elapsed > DROP_WINDOW_MINUTES * 60 * 1000) {
      activeDrops.delete(questionId);
    }
  }
}

/**
 * Get the currently active drop (if any).
 *
 * @param {object} db - Knex instance
 * @param {string} country - Optional country filter
 * @returns {object|null} Active drop data
 */
async function getActiveDrop(db, country) {
  // Check in-memory first
  let activeDrop = null;

  for (const [questionId, state] of activeDrops) {
    const elapsed = Date.now() - state.startedAt;
    if (elapsed < DROP_WINDOW_MINUTES * 60 * 1000) {
      activeDrop = { questionId, state };
      break;
    }
  }

  // Fallback to DB
  if (!activeDrop) {
    const query = db("questions")
      .where("is_drop", true)
      .where("drop_status", "active")
      .whereNull("deleted_at")
      .orderBy("scheduled_drop_time", "desc")
      .first();

    if (country && country !== "GLOBAL") {
      query.whereIn("country", [country, "GLOBAL"]);
    }

    const dbDrop = await query;
    if (!dbDrop) return null;

    // Hydrate in-memory state
    if (!activeDrops.has(dbDrop.id)) {
      activeDrops.set(dbDrop.id, {
        startedAt: new Date(dbDrop.scheduled_drop_time).getTime(),
        participants: new Set(),
        answerCount: 0,
      });
    }

    activeDrop = {
      questionId: dbDrop.id,
      state: activeDrops.get(dbDrop.id),
    };
  }

  // Get question data
  const question = await db("questions")
    .where({ id: activeDrop.questionId })
    .first();

  if (!question) return null;

  const elapsed = Date.now() - activeDrop.state.startedAt;
  const remainingMs = Math.max(0, DROP_WINDOW_MINUTES * 60 * 1000 - elapsed);
  const realParticipants = activeDrop.state.participants.size;
  const fakeBoost = Math.floor(
    Math.random() * (FAKED_PARTICIPANT_RANGE[1] - FAKED_PARTICIPANT_RANGE[0] + 1) + FAKED_PARTICIPANT_RANGE[0]
  );

  return {
    id: question.id,
    question_text: question.text,
    category: question.category || "general",
    country: question.country || "GLOBAL",
    started_at: new Date(activeDrop.state.startedAt).toISOString(),
    remaining_seconds: Math.ceil(remainingMs / 1000),
    is_active: remainingMs > 0,
    participants: {
      display_count: realParticipants + fakeBoost,
      real_count: realParticipants,
      answer_count: activeDrop.state.answerCount,
    },
  };
}

/**
 * Get the next upcoming drop (for countdown display).
 *
 * @param {object} db - Knex instance
 * @param {string} country
 * @returns {object|null}
 */
async function getNextDrop(db, country) {
  const now = new Date();

  const query = db("questions")
    .where("is_drop", true)
    .where("drop_status", "pending")
    .where("scheduled_drop_time", ">", now.toISOString())
    .whereNull("deleted_at")
    .orderBy("scheduled_drop_time", "asc")
    .first();

  if (country && country !== "GLOBAL") {
    query.whereIn("country", [country, "GLOBAL"]);
  }

  const nextDrop = await query;
  if (!nextDrop) return null;

  const timeUntilMs = new Date(nextDrop.scheduled_drop_time).getTime() - now.getTime();

  return {
    id: nextDrop.id,
    question_text: nextDrop.text,
    category: nextDrop.category || "general",
    scheduled_at: nextDrop.scheduled_drop_time,
    seconds_until: Math.ceil(timeUntilMs / 1000),
  };
}

/**
 * Join a drop — track user participation.
 *
 * @param {object} db - Knex instance
 * @param {number} questionId
 * @param {number} userId
 * @returns {object} Join result
 */
async function joinDrop(db, questionId, userId) {
  // Verify drop is active
  const question = await db("questions")
    .where({ id: questionId, is_drop: true })
    .whereIn("drop_status", ["active"])
    .whereNull("deleted_at")
    .first();

  if (!question) {
    throw Object.assign(new Error("Drop not active"), { code: "drop_not_active" });
  }

  // Track in DB
  await db("drop_participants")
    .insert({
      question_id: questionId,
      user_id: userId,
    })
    .onConflict(["question_id", "user_id"])
    .ignore();

  // Track in-memory
  const state = activeDrops.get(questionId);
  if (state) {
    state.participants.add(userId);
  }

  const realCount = state ? state.participants.size : 1;
  const fakeBoost = Math.floor(
    Math.random() * (FAKED_PARTICIPANT_RANGE[1] - FAKED_PARTICIPANT_RANGE[0] + 1) + FAKED_PARTICIPANT_RANGE[0]
  );

  return {
    joined: true,
    question_id: questionId,
    display_participants: realCount + fakeBoost,
  };
}

/**
 * Record that a user answered during a drop.
 *
 * @param {object} db - Knex instance
 * @param {number} questionId
 * @param {number} userId
 * @param {number} answerId
 */
async function recordDropAnswer(db, questionId, userId, answerId) {
  await db("drop_participants")
    .where({ question_id: questionId, user_id: userId })
    .update({ answer_id: answerId, answered_at: db.fn.now() });

  const state = activeDrops.get(questionId);
  if (state) {
    state.answerCount++;
  }
}

/**
 * Leave a drop (optional).
 *
 * @param {object} db - Knex instance
 * @param {number} questionId
 * @param {number} userId
 */
async function leaveDrop(db, questionId, userId) {
  await db("drop_participants")
    .where({ question_id: questionId, user_id: userId })
    .whereNull("answered_at")
    .delete();

  const state = activeDrops.get(questionId);
  if (state) {
    state.participants.delete(userId);
  }
}

/**
 * Schedule a new drop.
 *
 * @param {object} db - Knex instance
 * @param {number} questionId - Existing question to use for drop
 * @param {string} dropTime - ISO timestamp for when drop should activate
 * @returns {object} Updated question
 */
async function scheduleDrop(db, questionId, dropTime) {
  const question = await db("questions")
    .where({ id: questionId })
    .whereNull("deleted_at")
    .first();

  if (!question) {
    throw Object.assign(new Error("Question not found"), { code: "question_not_found" });
  }

  const [updated] = await db("questions")
    .where({ id: questionId })
    .update({
      is_drop: true,
      drop_status: "pending",
      scheduled_drop_time: new Date(dropTime).toISOString(),
    })
    .returning("*");

  return updated;
}

/**
 * Apply drop boost to feed score.
 * Answers from drops get 1.5x boost.
 *
 * @param {number} score - Current feed score
 * @param {boolean} fromDrop - Whether this answer came from a drop
 * @returns {number}
 */
function applyDropBoost(score, fromDrop = false) {
  if (!fromDrop) return score;
  return score * 1.5;
}

/**
 * Check if a question is a currently active drop.
 *
 * @param {number} questionId
 * @returns {boolean}
 */
function isActiveDrop(questionId) {
  const state = activeDrops.get(questionId);
  if (!state) return false;
  const elapsed = Date.now() - state.startedAt;
  return elapsed < DROP_WINDOW_MINUTES * 60 * 1000;
}

/**
 * Get drop stats for admin/analytics.
 *
 * @param {object} db - Knex instance
 * @param {number} questionId
 * @returns {object}
 */
async function getDropStats(db, questionId) {
  const participants = await db("drop_participants")
    .where({ question_id: questionId })
    .count("id as total")
    .first();

  const answered = await db("drop_participants")
    .where({ question_id: questionId })
    .whereNotNull("answered_at")
    .count("id as total")
    .first();

  return {
    total_joined: parseInt(participants?.total, 10) || 0,
    total_answered: parseInt(answered?.total, 10) || 0,
    conversion_rate:
      participants?.total > 0
        ? Math.round((parseInt(answered?.total, 10) / parseInt(participants?.total, 10)) * 100) / 100
        : 0,
    in_memory_active: activeDrops.has(questionId),
  };
}

/**
 * 🔥 FIX 3: Auto-schedule drops at fixed times (12:00, 18:00, 21:00).
 * Call this daily from the background job worker.
 *
 * @param {object} db - Knex instance
 * @param {string} country - Target country
 * @returns {number} Number of drops scheduled
 */
async function autoScheduleFixedDrops(db, country = "GLOBAL") {
  const today = new Date();
  const dateStr = today.toISOString().split("T")[0];
  let scheduled = 0;

  for (const hour of FIXED_DROP_HOURS) {
    const dropTime = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:00:00Z`);

    // Skip if in the past
    if (dropTime.getTime() <= Date.now()) continue;

    // Check if already scheduled for this slot
    const existing = await db("questions")
      .where("is_drop", true)
      .where("scheduled_drop_time", dropTime.toISOString())
      .first();

    if (existing) continue;

    // Pick a random unscheduled question for this drop
    const question = await db("questions")
      .where(function () {
        this.where("country", country).orWhere("country", "GLOBAL");
      })
      .where("is_drop", false)
      .whereNull("deleted_at")
      .orderByRaw("RANDOM()")
      .first();

    if (!question) continue;

    await db("questions")
      .where({ id: question.id })
      .update({
        is_drop: true,
        drop_status: "pending",
        scheduled_drop_time: dropTime.toISOString(),
      });

    scheduled++;
  }

  return scheduled;
}

/**
 * 🔥 UPGRADE 2: Get drop replay — answers from a completed drop.
 * "See how others answered" → drives feed loop.
 *
 * @param {object} db - Knex instance
 * @param {number} questionId - The drop question ID
 * @param {number} limit - Max answers to return
 * @returns {object}
 */
async function getDropReplay(db, questionId, limit = 10) {
  const question = await db("questions")
    .where({ id: questionId, is_drop: true })
    .first();

  if (!question) return null;

  const answers = await db("answers")
    .leftJoin("users", "answers.user_id", "users.id")
    .where("answers.question_id", questionId)
    .whereNull("answers.deleted_at")
    .select(
      "answers.id",
      "answers.video_url",
      "answers.answer_type",
      "answers.text_content",
      "answers.response_time",
      "answers.likes",
      "answers.views",
      "answers.created_at",
      "users.username"
    )
    .orderBy("answers.likes", "desc")
    .limit(limit);

  const totalParticipants = await db("drop_participants")
    .where({ question_id: questionId })
    .count("id as total")
    .first();

  return {
    question_id: questionId,
    question_text: question.text,
    drop_status: question.drop_status,
    answers,
    total_participants: parseInt(totalParticipants?.total, 10) || 0,
    replay_label: `${answers.length} answers from this drop`,
  };
}

module.exports = {
  DROP_WINDOW_MINUTES,
  FIXED_DROP_HOURS,
  processDueDrops,
  activateDrop,
  expireOldDrops,
  getActiveDrop,
  getNextDrop,
  joinDrop,
  recordDropAnswer,
  leaveDrop,
  scheduleDrop,
  applyDropBoost,
  isActiveDrop,
  getDropStats,
  autoScheduleFixedDrops,
  getDropReplay,
};
