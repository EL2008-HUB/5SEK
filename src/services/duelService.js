const { VOTE_THRESHOLD, getDuelExpiresAt } = require("./duelState");
const {
  applyActiveAnswerFilter,
  applyActiveUserFilter,
  getBlockedUserIds,
} = require("./safetyService");
const { isDatabaseConnectivityError } = require("./dbResilience");

const LOCK_NAMESPACE = 5150; // "5SEK" duel lock class for pg_advisory_xact_lock
const QUEUE_TTL_HOURS = Number(process.env.DUEL_QUEUE_TTL_HOURS || 48);
const QUEUE_MAX_ATTEMPTS = Number(process.env.DUEL_QUEUE_MAX_ATTEMPTS || 500);

function duelError(statusCode, code, extra = {}) {
  const error = new Error(code);
  error.statusCode = statusCode;
  error.payload = { error: code, ...extra };
  return error;
}

function pickRandom(rows = []) {
  if (!rows.length) return null;
  return rows[Math.floor(Math.random() * rows.length)];
}

function nowIso() {
  return new Date().toISOString();
}

function queueExpiresAt() {
  return new Date(Date.now() + QUEUE_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

async function withRetry(fn, { attempts = 3, baseDelayMs = 120 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retryable =
        isDatabaseConnectivityError(error) ||
        error?.code === "40001" || // serialization failure
        error?.code === "40P01"; // deadlock
      if (!retryable || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
  throw lastError;
}

function winnerSql(db) {
  return db.raw(`
    CASE
      WHEN COALESCE(votes_a, 0) > COALESCE(votes_b, 0) THEN 'A'
      WHEN COALESCE(votes_b, 0) > COALESCE(votes_a, 0) THEN 'B'
      ELSE 'tie'
    END
  `);
}

async function closeExpiredDuels(db, {
  now = nowIso(),
  limit = 200,
} = {}) {
  const duelIds = await db("duels")
    .where("status", "active")
    .andWhere((query) => {
      query
        .where("expires_at", "<=", now)
        .orWhereRaw("(COALESCE(votes_a, 0) + COALESCE(votes_b, 0)) >= ?", [VOTE_THRESHOLD]);
    })
    .orderBy("expires_at", "asc")
    .limit(limit)
    .pluck("id");

  if (!duelIds.length) {
    return 0;
  }

  await db("duels")
    .whereIn("id", duelIds)
    .update({
      status: "finished",
      winner: winnerSql(db),
      finished_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

  return duelIds.length;
}

/**
 * Active duel for a user, ignoring duels whose answers/users were removed
 * (those never surface in the feed, so they must not block new duels).
 */
async function findActiveDuelRow(db, userId) {
  return db("duels")
    .leftJoin("answers as aa", "duels.answer_a_id", "aa.id")
    .leftJoin("answers as ab", "duels.answer_b_id", "ab.id")
    .leftJoin("users as ua", "duels.user_a_id", "ua.id")
    .leftJoin("users as ub", "duels.user_b_id", "ub.id")
    .where("duels.status", "active")
    .andWhere((query) => {
      query.where("duels.user_a_id", userId).orWhere("duels.user_b_id", userId);
    })
    .andWhere((query) => {
      query.whereNull("duels.expires_at").orWhere("duels.expires_at", ">", db.raw("CURRENT_TIMESTAMP"));
    })
    .andWhereRaw("(COALESCE(duels.votes_a, 0) + COALESCE(duels.votes_b, 0)) < ?", [VOTE_THRESHOLD])
    .whereNotNull("ua.id")
    .whereNotNull("ub.id")
    .whereNull("ua.deleted_at")
    .whereNull("ub.deleted_at")
    .andWhere((query) => {
      query.whereNull("duels.answer_a_id").orWhere((sub) => {
        sub.whereNotNull("aa.id").whereNull("aa.deleted_at").where("aa.is_hidden", false);
      });
    })
    .andWhere((query) => {
      query.whereNull("duels.answer_b_id").orWhere((sub) => {
        sub.whereNotNull("ab.id").whereNull("ab.deleted_at").where("ab.is_hidden", false);
      });
    })
    .select("duels.id", "duels.user_a_id", "duels.user_b_id", "duels.question_id")
    .orderBy("duels.created_at", "desc")
    .first();
}

async function loadAnswerForDuel(db, answerId) {
  const query = db("answers as a")
    .join("users as u", "a.user_id", "u.id")
    .select("a.id", "a.user_id", "a.question_id", "a.video_url", "a.answer_type", "a.text_content", "u.username")
    .where("a.id", answerId);
  applyActiveAnswerFilter(query, "a");
  applyActiveUserFilter(query, "u");
  return query.first();
}

async function findSmartOpponent(db, {
  questionId,
  userId,
  blockedUserIds = [],
}) {
  const query = db("answers as a")
    .join("users as u", "a.user_id", "u.id")
    .select(
      "a.id",
      "a.user_id",
      "a.question_id",
      "a.video_url",
      "a.answer_type",
      "a.text_content",
      "u.username",
      db.raw(`
        (
          COALESCE(a.likes, 0) * 2 +
          COALESCE(a.shares, 0) * 3 +
          COALESCE(a.views, 0) +
          COALESCE(a.completion_count, 0) * 5 +
          COALESCE(a.replay_count, 0) * 4 +
          COALESCE(a.watch_time_total, 0) * 0.75 +
          GREATEST(0, 18 - EXTRACT(EPOCH FROM (NOW() - a.created_at)) / 3600) * 1.5
        ) AS candidate_score
      `)
    )
    .where("a.question_id", questionId)
    .whereNot("a.user_id", userId)
    .whereNotExists(function whereActiveDuel() {
      this.select(1)
        .from("duels")
        .where("status", "active")
        .andWhere((subquery) => {
          subquery
            .whereRaw("duels.user_a_id = a.user_id")
            .orWhereRaw("duels.user_b_id = a.user_id");
        })
        .andWhere((subquery) => {
          subquery.whereNull("duels.expires_at").orWhere("duels.expires_at", ">", db.raw("CURRENT_TIMESTAMP"));
        })
        .andWhereRaw("(COALESCE(duels.votes_a, 0) + COALESCE(duels.votes_b, 0)) < ?", [VOTE_THRESHOLD]);
    })
    .orderBy("candidate_score", "desc")
    .orderBy("a.created_at", "desc")
    .limit(10);

  applyActiveAnswerFilter(query, "a");
  applyActiveUserFilter(query, "u");

  if (blockedUserIds.length > 0) {
    query.whereNotIn("a.user_id", blockedUserIds);
  }

  const candidates = await query;
  return pickRandom(candidates);
}

/**
 * Race-safe duel creation. Both users are locked with a transaction-scoped
 * advisory lock, active duels are re-checked under the lock, and the partial
 * unique index on (question, pair) is the last line of defense.
 *
 * Returns the duel id. Throws duelError(409, "active_duel_exists") when busy.
 */
async function createDuelPair(db, { questionId, answerA, answerB }) {
  const userA = Number(answerA.user_id);
  const userB = Number(answerB.user_id);

  if (!userA || !userB || userA === userB) {
    throw duelError(400, "cannot_duel_yourself");
  }

  return withRetry(() =>
    db.transaction(async (trx) => {
      const lockOrder = [userA, userB].sort((a, b) => a - b);
      for (const id of lockOrder) {
        await trx.raw("SELECT pg_advisory_xact_lock(?, ?)", [LOCK_NAMESPACE, id]);
      }

      const busyA = await findActiveDuelRow(trx, userA);
      if (busyA) {
        throw duelError(409, "active_duel_exists", { duel_id: busyA.id, busy_user_id: userA });
      }
      const busyB = await findActiveDuelRow(trx, userB);
      if (busyB) {
        throw duelError(409, "opponent_busy", { duel_id: busyB.id, busy_user_id: userB });
      }

      try {
        const [inserted] = await trx("duels")
          .insert({
            question_id: questionId,
            user_a_id: userA,
            user_b_id: userB,
            answer_a_id: answerA.id,
            answer_b_id: answerB.id,
            video_a_url: answerA.video_url || null,
            video_b_url: answerB.video_url || null,
            expires_at: getDuelExpiresAt(),
            updated_at: nowIso(),
          })
          .returning("id");

        return inserted.id || inserted;
      } catch (error) {
        if (error.code === "23505") {
          const existing = await trx("duels")
            .where({ question_id: questionId, status: "active" })
            .andWhere((query) => {
              query
                .where({ user_a_id: userA, user_b_id: userB })
                .orWhere({ user_a_id: userB, user_b_id: userA });
            })
            .first();
          if (existing) return existing.id;
        }
        throw error;
      }
    })
  );
}

async function enqueueDuelRequest(db, { userId, questionId, answerId }) {
  const existing = await db("duel_queue")
    .where({ user_id: userId, question_id: questionId, status: "waiting" })
    .first();

  if (existing) {
    await db("duel_queue")
      .where({ id: existing.id })
      .update({ answer_id: answerId, expires_at: queueExpiresAt(), updated_at: nowIso() });
    return { ...existing, answer_id: answerId, expires_at: queueExpiresAt() };
  }

  try {
    const [row] = await db("duel_queue")
      .insert({
        user_id: userId,
        question_id: questionId,
        answer_id: answerId,
        status: "waiting",
        expires_at: queueExpiresAt(),
      })
      .returning("*");
    return row;
  } catch (error) {
    if (error.code === "23505") {
      return db("duel_queue").where({ user_id: userId, question_id: questionId, status: "waiting" }).first();
    }
    throw error;
  }
}

async function markQueueEntry(db, id, status, extra = {}) {
  await db("duel_queue")
    .where({ id })
    .update({ status, updated_at: nowIso(), ...extra });
}

async function cancelQueueEntry(db, { id, userId }) {
  const entry = await db("duel_queue").where({ id, user_id: userId }).first();
  if (!entry) return null;
  if (entry.status === "waiting") {
    await markQueueEntry(db, id, "cancelled");
  }
  return { ...entry, status: entry.status === "waiting" ? "cancelled" : entry.status };
}

/**
 * Called right after an answer is published: if someone is waiting on that
 * question, open the duel immediately. Never throws (best effort).
 */
async function matchQueueForAnswer(db, answer) {
  if (!answer?.id || !answer.question_id || !answer.user_id) return null;
  if (answer.is_hidden || answer.deleted_at) return null;

  try {
    const waiting = await db("duel_queue")
      .where({ question_id: answer.question_id, status: "waiting" })
      .whereNot("user_id", answer.user_id)
      .andWhere((query) => {
        query.whereNull("expires_at").orWhere("expires_at", ">", db.raw("CURRENT_TIMESTAMP"));
      })
      .orderBy("created_at", "asc")
      .limit(10);

    if (!waiting.length) return null;

    const blocked = new Set(await getBlockedUserIds(db, answer.user_id));
    const answerB = await loadAnswerForDuel(db, answer.id);
    if (!answerB) return null;

    for (const entry of waiting) {
      if (blocked.has(Number(entry.user_id))) continue;

      const answerA = entry.answer_id ? await loadAnswerForDuel(db, entry.answer_id) : null;
      if (!answerA) {
        await markQueueEntry(db, entry.id, "cancelled");
        continue;
      }

      try {
        const duelId = await createDuelPair(db, {
          questionId: answer.question_id,
          answerA,
          answerB,
        });
        await markQueueEntry(db, entry.id, "matched", { duel_id: duelId, matched_at: nowIso() });
        return { duel_id: duelId, queue_id: entry.id, opponent_user_id: entry.user_id };
      } catch (error) {
        if (error.payload?.error === "active_duel_exists" && Number(error.payload.busy_user_id) === Number(entry.user_id)) {
          // waiting user already got a duel elsewhere; keep the entry, it will be reconsidered later
          continue;
        }
        if (error.payload?.error === "opponent_busy") {
          // the new answerer already has a duel, nothing else to match here
          return null;
        }
        if (error.statusCode) continue;
        throw error;
      }
    }
  } catch (error) {
    console.error("matchQueueForAnswer failed:", error.message);
  }

  return null;
}

async function expireDuelQueue(db) {
  return db("duel_queue")
    .where("status", "waiting")
    .andWhere((query) => {
      query
        .where("expires_at", "<=", db.raw("CURRENT_TIMESTAMP"))
        .orWhere("attempts", ">=", QUEUE_MAX_ATTEMPTS);
    })
    .update({ status: "expired", updated_at: nowIso() });
}

/**
 * Background pass: try to find opponents for everyone still waiting.
 */
async function processDuelQueue(db, { limit = 50 } = {}) {
  const waiting = await db("duel_queue")
    .where("status", "waiting")
    .andWhere((query) => {
      query.whereNull("expires_at").orWhere("expires_at", ">", db.raw("CURRENT_TIMESTAMP"));
    })
    .orderBy("created_at", "asc")
    .limit(limit);

  let matched = 0;

  for (const entry of waiting) {
    try {
      const answerA = entry.answer_id ? await loadAnswerForDuel(db, entry.answer_id) : null;
      if (!answerA) {
        await markQueueEntry(db, entry.id, "cancelled");
        continue;
      }

      if (await findActiveDuelRow(db, entry.user_id)) {
        // user is already dueling; keep waiting entry for later
        await db("duel_queue").where({ id: entry.id }).increment("attempts", 1);
        continue;
      }

      const blockedUserIds = await getBlockedUserIds(db, entry.user_id);
      const opponent = await findSmartOpponent(db, {
        questionId: entry.question_id,
        userId: entry.user_id,
        blockedUserIds,
      });

      if (!opponent) {
        await db("duel_queue").where({ id: entry.id }).increment("attempts", 1);
        continue;
      }

      const duelId = await createDuelPair(db, {
        questionId: entry.question_id,
        answerA,
        answerB: opponent,
      });
      await markQueueEntry(db, entry.id, "matched", { duel_id: duelId, matched_at: nowIso() });
      matched += 1;
    } catch (error) {
      if (error.statusCode) {
        await db("duel_queue").where({ id: entry.id }).increment("attempts", 1).catch(() => {});
        continue;
      }
      throw error;
    }
  }

  return matched;
}

async function getUserDuelState(db, userId) {
  const [active, queue] = await Promise.all([
    findActiveDuelRow(db, userId),
    db("duel_queue as q")
      .leftJoin("questions", "q.question_id", "questions.id")
      .where("q.user_id", userId)
      .where("q.status", "waiting")
      .andWhere((query) => {
        query.whereNull("q.expires_at").orWhere("q.expires_at", ">", db.raw("CURRENT_TIMESTAMP"));
      })
      .select("q.*", "questions.text as question_text")
      .orderBy("q.created_at", "desc"),
  ]);

  return { active_duel_id: active?.id || null, queue };
}

/**
 * One maintenance tick: close finished/expired duels, expire stale queue
 * entries, then try to match waiting users. Each step is isolated so a
 * failure in one never blocks the others.
 */
async function runDuelMaintenance(db, { logger = console } = {}) {
  const result = { closed: 0, expired: 0, matched: 0, errors: [] };

  try {
    result.closed = await closeExpiredDuels(db);
  } catch (error) {
    result.errors.push(`close:${error.message}`);
    if (isDatabaseConnectivityError(error)) throw error;
    logger.error("Duel close step failed:", error);
  }

  try {
    result.expired = await expireDuelQueue(db);
  } catch (error) {
    result.errors.push(`expire:${error.message}`);
    if (isDatabaseConnectivityError(error)) throw error;
    logger.error("Duel queue expire step failed:", error);
  }

  try {
    result.matched = await processDuelQueue(db);
  } catch (error) {
    result.errors.push(`match:${error.message}`);
    if (isDatabaseConnectivityError(error)) throw error;
    logger.error("Duel queue match step failed:", error);
  }

  return result;
}

module.exports = {
  LOCK_NAMESPACE,
  cancelQueueEntry,
  closeExpiredDuels,
  createDuelPair,
  duelError,
  enqueueDuelRequest,
  expireDuelQueue,
  findActiveDuelRow,
  findSmartOpponent,
  getUserDuelState,
  loadAnswerForDuel,
  matchQueueForAnswer,
  processDuelQueue,
  runDuelMaintenance,
  withRetry,
};
