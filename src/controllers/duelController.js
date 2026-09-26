const {
  DUEL_DURATION_HOURS,
  VOTE_THRESHOLD,
  computeWinner,
  getRemainingSeconds,
  getTotalVotes,
  shouldFinishDuel,
} = require("../services/duelState");
const { calculateDuelFeedScore } = require("../services/feedComposer");
const {
  applyActiveAnswerFilter,
  applyActiveUserFilter,
  getBlockedUserIds,
} = require("../services/safetyService");
const {
  cancelQueueEntry,
  closeExpiredDuels,
  createDuelPair,
  enqueueDuelRequest,
  findActiveDuelRow,
  findSmartOpponent,
  getUserDuelState,
  loadAnswerForDuel,
} = require("../services/duelService");

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function shape(duel) {
  if (!duel) return null;
  const votesA = safeNumber(duel.votes_a);
  const votesB = safeNumber(duel.votes_b);
  const totalVotes = getTotalVotes({ ...duel, votes_a: votesA, votes_b: votesB });
  const pctA = totalVotes > 0 ? Math.round((votesA / totalVotes) * 100) : 50;
  const pctB = totalVotes > 0 ? 100 - pctA : 50;
  const status = shouldFinishDuel({ ...duel, votes_a: votesA, votes_b: votesB, total_votes: totalVotes })
    ? "finished"
    : duel.status;
  const totalViews =
    safeNumber(duel.total_views, safeNumber(duel.answer_a_views) + safeNumber(duel.answer_b_views));

  return {
    ...duel,
    answer_a_id: duel.answer_a_id || null,
    answer_b_id: duel.answer_b_id || null,
    video_a_url: duel.video_a_url || null,
    video_b_url: duel.video_b_url || null,
    text_a: duel.text_a || null,
    text_b: duel.text_b || null,
    user_a_username: duel.user_a_username || "userA",
    user_b_username: duel.user_b_username || "userB",
    question_text: duel.question_text || "",
    votes_a: votesA,
    votes_b: votesB,
    total_votes: totalVotes,
    total_views: totalViews,
    pct_a: pctA,
    pct_b: pctB,
    leader: totalVotes > 0 ? computeWinner(votesA, votesB) : null,
    winner: status === "finished" ? duel.winner || computeWinner(votesA, votesB) : null,
    status,
    expires_at: duel.expires_at || null,
    remaining_seconds: status === "active" ? getRemainingSeconds(duel) : 0,
    duel_duration_hours: DUEL_DURATION_HOURS,
    vote_threshold: VOTE_THRESHOLD,
  };
}

function normalizeCreatePayload(body = {}) {
  return {
    question_id: body.question_id ?? body.questionId,
    answer_a_id: body.answer_a_id ?? body.answerA ?? body.answerAId,
    user_b_id: body.user_b_id ?? body.userB ?? body.userBId,
    answer_b_id: body.answer_b_id ?? body.answerB ?? body.answerBId,
    video_a_url: body.video_a_url ?? body.videoA,
    video_b_url: body.video_b_url ?? body.videoB,
  };
}

function normalizeAutoPayload(body = {}) {
  return {
    question_id: body.question_id ?? body.questionId,
    answer_id: body.answer_id ?? body.answerId,
    video_a_url: body.video_a_url ?? body.videoA,
  };
}

function normalizeVotePayload(body = {}) {
  return {
    vote: typeof body.vote === "string" ? body.vote.toUpperCase() : body.vote,
  };
}

function duelBaseQuery(db) {
  return db("duels")
    .leftJoin("users as ua", "duels.user_a_id", "ua.id")
    .leftJoin("users as ub", "duels.user_b_id", "ub.id")
    .leftJoin("questions", "duels.question_id", "questions.id")
    .leftJoin("answers as aa", "duels.answer_a_id", "aa.id")
    .leftJoin("answers as ab", "duels.answer_b_id", "ab.id")
    .whereNotNull("ua.id")
    .whereNotNull("ub.id")
    .whereNotNull("questions.id")
    .whereNull("ua.deleted_at")
    .whereNull("ub.deleted_at")
    .whereNull("questions.deleted_at")
    .where("ua.is_blocked", false)
    .where("ub.is_blocked", false)
    .where((query) => {
      query.whereNull("duels.answer_a_id").orWhere((subquery) => {
        subquery.whereNotNull("aa.id").whereNull("aa.deleted_at").where("aa.is_hidden", false);
      });
    })
    .where((query) => {
      query.whereNull("duels.answer_b_id").orWhere((subquery) => {
        subquery.whereNotNull("ab.id").whereNull("ab.deleted_at").where("ab.is_hidden", false);
      });
    })
    .select(
      "duels.*",
      "ua.username as user_a_username",
      "ub.username as user_b_username",
      "questions.text as question_text",
      "aa.views as answer_a_views",
      "ab.views as answer_b_views",
      "aa.text_content as text_a",
      "ab.text_content as text_b",
      "aa.answer_type as answer_type_a",
      "ab.answer_type as answer_type_b"
    );
}

async function getDuelById(db, id) {
  return duelBaseQuery(db).where("duels.id", id).first();
}

async function getUserVote(db, duelId, userId) {
  if (!userId) return null;

  const voteRow = await db("duel_votes")
    .where({ duel_id: duelId, user_id: userId })
    .first();

  return voteRow?.vote || null;
}

async function resolveAnswer(db, {
  answerId = null,
  userId,
  questionId,
  videoUrl = null,
}) {
  const query = db("answers as a")
    .join("users as u", "a.user_id", "u.id")
    .select("a.id", "a.user_id", "a.question_id", "a.video_url", "a.answer_type", "a.text_content", "u.username")
    .where("a.question_id", questionId)
    .where("a.user_id", userId)
    .orderBy("a.created_at", "desc");

  applyActiveAnswerFilter(query, "a");
  applyActiveUserFilter(query, "u");

  if (answerId) {
    query.where("a.id", answerId);
  } else if (videoUrl) {
    query.where("a.video_url", videoUrl);
  }

  return query.first();
}

async function findActiveDuelForUser(db, userId) {
  const row = await findActiveDuelRow(db, userId);
  if (!row) return null;
  const full = await getDuelById(db, row.id);
  return full ? shape(full) : null;
}

/** Maintenance must never break a user request. */
async function safeCloseExpired(db, limit) {
  try {
    await closeExpiredDuels(db, { limit });
  } catch (error) {
    console.warn("closeExpiredDuels skipped:", error.message);
  }
}

async function safeBlockedIds(db, userId) {
  try {
    return await getBlockedUserIds(db, userId);
  } catch (error) {
    console.warn("getBlockedUserIds skipped:", error.message);
    return [];
  }
}

async function ensureNoActiveDuel(db, userId) {
  const existing = await findActiveDuelForUser(db, userId);
  if (existing) {
    const error = new Error("active_duel_exists");
    error.statusCode = 409;
    error.payload = {
      error: "active_duel_exists",
      duel: existing,
    };
    throw error;
  }
}

async function respondCreated(req, res, duelId) {
  const duel = await getDuelById(req.db, duelId);
  res.status(201).json(shape(duel));
}

function handleDuelError(res, error, label) {
  if (error.statusCode) {
    return res.status(error.statusCode).json(error.payload);
  }
  console.error(`${label}:`, error);
  return res.status(500).json({ error: "duel_unavailable", message: "Duels are temporarily unavailable. Try again." });
}

exports.create = async (req, res) => {
  try {
    const payload = normalizeCreatePayload(req.body);
    const question_id = Number(payload.question_id);
    const user_a_id = req.userId;
    const user_b_id = Number(payload.user_b_id);

    await safeCloseExpired(req.db, 50);

    if (!question_id || !user_a_id || !user_b_id) {
      return res.status(400).json({
        error: "question_id and user_b_id required",
      });
    }

    if (Number(user_a_id) === Number(user_b_id)) {
      return res.status(400).json({ error: "cannot_duel_yourself" });
    }

    const blockedUserIds = await safeBlockedIds(req.db, user_a_id);
    if (blockedUserIds.includes(user_b_id)) {
      return res.status(404).json({ error: "opponent_not_found" });
    }

    const question = await req.db("questions").where({ id: question_id }).whereNull("deleted_at").first();
    if (!question) {
      return res.status(404).json({ error: "question_not_found" });
    }

    const [answerA, answerB] = await Promise.all([
      resolveAnswer(req.db, {
        answerId: payload.answer_a_id,
        userId: user_a_id,
        questionId: question_id,
        videoUrl: payload.video_a_url,
      }),
      resolveAnswer(req.db, {
        answerId: payload.answer_b_id,
        userId: user_b_id,
        questionId: question_id,
        videoUrl: payload.video_b_url,
      }),
    ]);

    if (!answerA) {
      return res.status(404).json({ error: "answer_not_found" });
    }

    if (!answerB) {
      return res.status(404).json({ error: "opponent_answer_not_found" });
    }

    await ensureNoActiveDuel(req.db, user_a_id);

    const duelId = await createDuelPair(req.db, { questionId: question_id, answerA, answerB });
    return respondCreated(req, res, duelId);
  } catch (error) {
    return handleDuelError(res, error, "Create duel error");
  }
};

exports.createAuto = async (req, res) => {
  try {
    const payload = normalizeAutoPayload(req.body);
    const question_id = Number(payload.question_id);
    const user_a_id = req.userId;

    await safeCloseExpired(req.db, 50);

    if (!question_id || !user_a_id) {
      return res.status(400).json({
        error: "question_id required",
      });
    }

    const question = await req.db("questions").where({ id: question_id }).whereNull("deleted_at").first();
    if (!question) {
      return res.status(404).json({ error: "question_not_found" });
    }

    const answerA = await resolveAnswer(req.db, {
      answerId: payload.answer_id,
      userId: user_a_id,
      questionId: question_id,
      videoUrl: payload.video_a_url,
    });

    if (!answerA) {
      return res.status(404).json({ error: "answer_not_found" });
    }

    await ensureNoActiveDuel(req.db, user_a_id);
    const blockedUserIds = await safeBlockedIds(req.db, user_a_id);

    // Try a few candidates: another request may grab the same opponent first.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const opponent = await findSmartOpponent(req.db, {
        questionId: question_id,
        userId: user_a_id,
        blockedUserIds,
      });

      if (!opponent) break;

      try {
        const duelId = await createDuelPair(req.db, { questionId: question_id, answerA, answerB: opponent });
        return respondCreated(req, res, duelId);
      } catch (error) {
        if (error.payload?.error === "opponent_busy") continue;
        throw error;
      }
    }

    // No opponent right now: wait in the queue, auto-matched when someone answers.
    const queue = await enqueueDuelRequest(req.db, {
      userId: user_a_id,
      questionId: question_id,
      answerId: answerA.id,
    });

    return res.status(202).json({
      status: "queued",
      error: "no_opponent",
      message: "No opponent yet. You are in the queue; the duel opens automatically when someone answers.",
      queue: {
        id: queue.id,
        question_id: queue.question_id,
        answer_id: queue.answer_id,
        expires_at: queue.expires_at,
        created_at: queue.created_at,
      },
    });
  } catch (error) {
    return handleDuelError(res, error, "Create auto duel error");
  }
};

exports.challenge = async (req, res) => {
  try {
    const opponentAnswerId = Number(req.body.answer_id || req.body.answerId || req.body.opponent_answer_id);
    const userId = req.userId;
    await safeCloseExpired(req.db, 50);

    const opponentAnswer = await loadAnswerForDuel(req.db, opponentAnswerId);
    if (!opponentAnswer) {
      return res.status(404).json({ error: "answer_not_found" });
    }
    if (Number(opponentAnswer.user_id) === Number(userId)) {
      return res.status(400).json({ error: "cannot_duel_yourself" });
    }

    const blockedUserIds = await safeBlockedIds(req.db, userId);
    if (blockedUserIds.includes(Number(opponentAnswer.user_id))) {
      return res.status(404).json({ error: "opponent_not_found" });
    }

    const myAnswer = await resolveAnswer(req.db, {
      userId,
      questionId: opponentAnswer.question_id,
    });

    if (!myAnswer) {
      return res.status(409).json({
        error: "need_own_answer",
        question_id: opponentAnswer.question_id,
        opponent_answer_id: opponentAnswerId,
        message: "Answer this question first, then the duel starts.",
      });
    }

    await ensureNoActiveDuel(req.db, userId);

    try {
      const duelId = await createDuelPair(req.db, {
        questionId: opponentAnswer.question_id,
        answerA: myAnswer,
        answerB: opponentAnswer,
      });
      return respondCreated(req, res, duelId);
    } catch (error) {
      if (error.payload?.error !== "opponent_busy") throw error;

      // Opponent is mid-duel: fall back to auto-match / queue so the user still gets a duel.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const fallback = await findSmartOpponent(req.db, {
          questionId: opponentAnswer.question_id,
          userId,
          blockedUserIds,
        });
        if (!fallback) break;
        try {
          const duelId = await createDuelPair(req.db, {
            questionId: opponentAnswer.question_id,
            answerA: myAnswer,
            answerB: fallback,
          });
          return respondCreated(req, res, duelId);
        } catch (fallbackError) {
          if (fallbackError.payload?.error === "opponent_busy") continue;
          throw fallbackError;
        }
      }

      const queue = await enqueueDuelRequest(req.db, {
        userId,
        questionId: opponentAnswer.question_id,
        answerId: myAnswer.id,
      });

      return res.status(202).json({
        status: "queued",
        error: "opponent_busy",
        message: "That player is already in a duel. You are queued and will be matched automatically.",
        queue: {
          id: queue.id,
          question_id: queue.question_id,
          answer_id: queue.answer_id,
          expires_at: queue.expires_at,
        },
      });
    }
  } catch (error) {
    return handleDuelError(res, error, "Challenge duel error");
  }
};

function parseDuelId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

exports.vote = async (req, res) => {
  try {
    const id = parseDuelId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid_duel_id" });
    }
    const normalizedVote = normalizeVotePayload(req.body);
    const user_id = req.userId;
    const vote = normalizedVote.vote;

    if (!user_id || !["A", "B"].includes(vote)) {
      return res.status(400).json({ error: "vote ('A' or 'B') required" });
    }

    const outcome = await req.db.transaction(async (trx) => {
      const duel = await trx("duels").where({ id }).forUpdate().first();
      if (!duel) return { code: "duel_not_found" };

      if (Number(user_id) === Number(duel.user_a_id) || Number(user_id) === Number(duel.user_b_id)) {
        return { code: "cannot_vote_own_duel" };
      }

      if (shouldFinishDuel(duel)) {
        await trx("duels")
          .where({ id })
          .update({
            status: "finished",
            winner: duel.winner || computeWinner(safeNumber(duel.votes_a), safeNumber(duel.votes_b)),
            finished_at: duel.finished_at || trx.fn.now(),
            updated_at: trx.fn.now(),
          });
        return { code: "duel_finished" };
      }

      const existingVote = await trx("duel_votes").where({ duel_id: id, user_id }).first();
      if (existingVote) {
        return { code: "already_voted", your_vote: existingVote.vote };
      }

      try {
        await trx("duel_votes").insert({ duel_id: id, user_id, vote });
      } catch (insertError) {
        if (insertError.code === "23505") {
          const raced = await trx("duel_votes").where({ duel_id: id, user_id }).first();
          return { code: "already_voted", your_vote: raced?.vote || vote };
        }
        throw insertError;
      }

      const votesA = safeNumber(duel.votes_a) + (vote === "A" ? 1 : 0);
      const votesB = safeNumber(duel.votes_b) + (vote === "B" ? 1 : 0);
      const finished = votesA + votesB >= VOTE_THRESHOLD;

      await trx("duels")
        .where({ id })
        .update({
          votes_a: votesA,
          votes_b: votesB,
          updated_at: trx.fn.now(),
          ...(finished
            ? {
                status: "finished",
                winner: computeWinner(votesA, votesB),
                finished_at: trx.fn.now(),
              }
            : {}),
        });

      return { code: "ok", your_vote: vote };
    });

    if (outcome.code === "duel_not_found") {
      return res.status(404).json({ error: "duel_not_found" });
    }

    const fullDuel = await getDuelById(req.db, id);
    const shaped = shape(fullDuel);

    if (outcome.code === "cannot_vote_own_duel") {
      return res.status(403).json({ error: "cannot_vote_own_duel", duel: shaped });
    }
    if (outcome.code === "duel_finished") {
      return res.status(400).json({ error: "duel_finished", duel: shaped });
    }
    if (outcome.code === "already_voted") {
      return res.status(409).json({ error: "already_voted", duel: shaped, your_vote: outcome.your_vote });
    }

    res.json({ ok: true, duel: shaped, your_vote: outcome.your_vote });
  } catch (error) {
    return handleDuelError(res, error, "Vote duel error");
  }
};

exports.getById = async (req, res) => {
  try {
    const id = parseDuelId(req.params.id);
    if (!id) {
      return res.status(404).json({ error: "duel_not_found" });
    }
    const userId = req.userId || null;

    await safeCloseExpired(req.db, 50);

    const duel = await getDuelById(req.db, id);
    if (!duel) {
      return res.status(404).json({ error: "duel_not_found" });
    }

    const yourVote = await getUserVote(req.db, id, userId);
    res.json({ ...shape(duel), your_vote: yourVote });
  } catch (error) {
    return handleDuelError(res, error, "Get duel error");
  }
};

exports.getMine = async (req, res) => {
  try {
    const userId = req.userId;
    await safeCloseExpired(req.db, 50);

    const state = await getUserDuelState(req.db, userId);
    const active = state.active_duel_id ? await getDuelById(req.db, state.active_duel_id) : null;

    const recentRows = await duelBaseQuery(req.db)
      .where((query) => {
        query.where("duels.user_a_id", userId).orWhere("duels.user_b_id", userId);
      })
      .orderBy("duels.created_at", "desc")
      .limit(20);

    const recent = recentRows.map((row) => shape(row));
    const wins = recent.filter((duel) => {
      if (duel.status !== "finished" || !duel.winner || duel.winner === "tie") return false;
      const mySide = Number(duel.user_a_id) === Number(userId) ? "A" : "B";
      return duel.winner === mySide;
    }).length;

    res.json({
      active_duel: active ? shape(active) : null,
      queue: state.queue.map((entry) => ({
        id: entry.id,
        question_id: entry.question_id,
        question_text: entry.question_text || "",
        answer_id: entry.answer_id,
        created_at: entry.created_at,
        expires_at: entry.expires_at,
        status: entry.status,
      })),
      recent,
      stats: {
        total: recent.length,
        finished: recent.filter((duel) => duel.status === "finished").length,
        wins,
      },
    });
  } catch (error) {
    return handleDuelError(res, error, "Get my duels error");
  }
};

exports.cancelQueue = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "invalid_queue_id" });
    }

    const entry = await cancelQueueEntry(req.db, { id, userId: req.userId });
    if (!entry) {
      return res.status(404).json({ error: "queue_entry_not_found" });
    }

    res.json({ ok: true, queue: { id: entry.id, status: entry.status } });
  } catch (error) {
    return handleDuelError(res, error, "Cancel duel queue error");
  }
};

exports.getFeed = async (req, res) => {
  try {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 10, 50);
    const offset = (page - 1) * limit;
    const userId = req.userId || null;
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const candidateLimit = Math.min(Math.max((offset + limit) * 4, 20), 100);

    await safeCloseExpired(req.db, candidateLimit);

    let query = duelBaseQuery(req.db)
      .orderBy("duels.created_at", "desc")
      .limit(candidateLimit);

    if (status === "active" || status === "finished") {
      query = query.where("duels.status", status);
    }

    const blockedUserIds = await safeBlockedIds(req.db, userId);
    const rows = (await query).filter((row) => {
      if (blockedUserIds.includes(Number(row.user_a_id)) || blockedUserIds.includes(Number(row.user_b_id))) {
        return false;
      }

      return true;
    });

    let votedMap = {};
    if (userId && rows.length > 0) {
      try {
        const ids = rows.map((row) => row.id);
        const votes = await req.db("duel_votes")
          .whereIn("duel_id", ids)
          .where("user_id", userId);

        votes.forEach((voteRow) => {
          votedMap[voteRow.duel_id] = voteRow.vote;
        });
      } catch (voteError) {
        console.warn("duel votes lookup skipped:", voteError.message);
      }
    }

    const ranked = rows
      .map((row) => {
        const duel = { ...shape(row), your_vote: votedMap[row.id] || null };
        const hoursLeft = duel.remaining_seconds ? Math.max(1, Math.ceil(duel.remaining_seconds / 3600)) : 0;
        const feed_score = calculateDuelFeedScore(duel);
        const social_label =
          duel.status === "active"
            ? duel.total_votes >= 10
              ? `Hot duel · ${duel.total_votes}/${VOTE_THRESHOLD} votes · ${hoursLeft}h left`
              : duel.total_votes > 0
              ? `${duel.total_votes}/${VOTE_THRESHOLD} votes · ${hoursLeft}h left`
              : `Fresh duel · ${hoursLeft}h left`
            : duel.winner === "tie"
            ? `Finished tied with ${duel.total_votes} votes`
            : `Finished with ${duel.total_votes} votes`;

        return {
          ...duel,
          feed_score,
          social_label,
          is_pattern_break: true,
        };
      })
      .sort((a, b) => {
        if (b.feed_score !== a.feed_score) return b.feed_score - a.feed_score;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

    res.json(ranked.slice(offset, offset + limit));
  } catch (error) {
    console.error("Get duels feed error:", error);
    // Degrade gracefully: an empty duel list keeps the main feed alive.
    res.json([]);
  }
};
