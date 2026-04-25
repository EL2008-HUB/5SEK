const {
  DUEL_DURATION_HOURS,
  VOTE_THRESHOLD,
  computeWinner,
  getDuelExpiresAt,
  getRemainingSeconds,
  getTotalVotes,
  shouldFinishDuel,
} = require("../services/duelState");
const { calculateDuelFeedScore } = require("../services/feedComposer");
const {
  applyActiveAnswerFilter,
  applyActiveQuestionFilter,
  applyActiveUserFilter,
  getBlockedUserIds,
} = require("../services/safetyService");
const { closeExpiredDuels } = require("../services/duelService");

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pickRandom(rows = []) {
  if (!rows.length) return null;
  return rows[Math.floor(Math.random() * rows.length)];
}

function shape(duel) {
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
      "ab.views as answer_b_views"
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

async function resolveVideoAnswer(db, {
  answerId = null,
  userId,
  questionId,
  videoUrl = null,
}) {
  const query = db("answers as a")
    .join("users as u", "a.user_id", "u.id")
    .select("a.id", "a.user_id", "a.question_id", "a.video_url", "u.username")
    .where("a.question_id", questionId)
    .where("a.user_id", userId)
    .where("a.answer_type", "video")
    .whereNotNull("a.video_url")
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
    .where("a.answer_type", "video")
    .whereNotNull("a.video_url")
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

async function findActiveDuelForUser(db, userId) {
  const nowIso = new Date().toISOString();

  const activeDuel = await duelBaseQuery(db)
    .where("duels.status", "active")
    .andWhere((query) => {
      query.where("duels.user_a_id", userId).orWhere("duels.user_b_id", userId);
    })
    .andWhere((query) => {
      query.whereNull("duels.expires_at").orWhere("duels.expires_at", ">", nowIso);
    })
    .andWhereRaw("(COALESCE(duels.votes_a, 0) + COALESCE(duels.votes_b, 0)) < ?", [VOTE_THRESHOLD])
    .orderBy("duels.created_at", "desc")
    .first();

  return activeDuel ? shape(activeDuel) : null;
}

async function finishDuelIfNeeded(db, id) {
  let duel = await db("duels").where({ id }).first();
  if (!duel) return null;

  if (!shouldFinishDuel(duel)) {
    return duel;
  }

  await db("duels")
    .where({ id })
    .update({
      status: "finished",
      winner: computeWinner(duel.votes_a, duel.votes_b),
      finished_at: duel.finished_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

  duel = await db("duels").where({ id }).first();
  return duel;
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

exports.create = async (req, res) => {
  try {
    const payload = normalizeCreatePayload(req.body);
    const question_id = Number(payload.question_id);
    const user_a_id = req.userId;
    const user_b_id = Number(payload.user_b_id);

    await closeExpiredDuels(req.db, { limit: 50 });

    if (!question_id || !user_a_id || !user_b_id) {
      return res.status(400).json({
        error: "question_id and user_b_id required",
      });
    }

    if (Number(user_a_id) === Number(user_b_id)) {
      return res.status(400).json({ error: "cannot_duel_yourself" });
    }

    const blockedUserIds = await getBlockedUserIds(req.db, user_a_id);
    if (blockedUserIds.includes(user_b_id)) {
      return res.status(404).json({ error: "opponent_not_found" });
    }

    const question = await req.db("questions").where({ id: question_id }).whereNull("deleted_at").first();
    if (!question) {
      return res.status(404).json({ error: "question_not_found" });
    }

    const [answerA, answerB] = await Promise.all([
      resolveVideoAnswer(req.db, {
        answerId: payload.answer_a_id,
        userId: user_a_id,
        questionId: question_id,
        videoUrl: payload.video_a_url,
      }),
      resolveVideoAnswer(req.db, {
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
    await ensureNoActiveDuel(req.db, user_b_id);

    const [inserted] = await req.db("duels")
      .insert({
        question_id,
        user_a_id,
        user_b_id,
        answer_a_id: answerA.id,
        answer_b_id: answerB.id,
        video_a_url: answerA.video_url,
        video_b_url: answerB.video_url,
        expires_at: getDuelExpiresAt(),
        updated_at: new Date().toISOString(),
      })
      .returning("id");

    const duelId = inserted.id || inserted;
    const duel = await getDuelById(req.db, duelId);

    res.status(201).json(shape(duel));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json(error.payload);
    }

    console.error("Create duel error:", error);
    res.status(500).json({ error: "Failed to create duel" });
  }
};

exports.createAuto = async (req, res) => {
  try {
    const payload = normalizeAutoPayload(req.body);
    const question_id = Number(payload.question_id);
    const user_a_id = req.userId;

    await closeExpiredDuels(req.db, { limit: 50 });

    if (!question_id || !user_a_id) {
      return res.status(400).json({
        error: "question_id required",
      });
    }

    const question = await req.db("questions").where({ id: question_id }).whereNull("deleted_at").first();
    if (!question) {
      return res.status(404).json({ error: "question_not_found" });
    }

    const answerA = await resolveVideoAnswer(req.db, {
      answerId: payload.answer_id,
      userId: user_a_id,
      questionId: question_id,
      videoUrl: payload.video_a_url,
    });

    if (!answerA) {
      return res.status(404).json({ error: "answer_not_found" });
    }

    await ensureNoActiveDuel(req.db, user_a_id);
    const blockedUserIds = await getBlockedUserIds(req.db, user_a_id);
    const opponent = await findSmartOpponent(req.db, {
      questionId: question_id,
      userId: user_a_id,
      blockedUserIds,
    });

    if (!opponent) {
      return res.status(404).json({
        error: "no_opponent",
        message: "No opponent available for this question right now.",
      });
    }

    await ensureNoActiveDuel(req.db, opponent.user_id);

    const [inserted] = await req.db("duels")
      .insert({
        question_id,
        user_a_id,
        user_b_id: opponent.user_id,
        answer_a_id: answerA.id,
        answer_b_id: opponent.id,
        video_a_url: answerA.video_url,
        video_b_url: opponent.video_url,
        expires_at: getDuelExpiresAt(),
        updated_at: new Date().toISOString(),
      })
      .returning("id");

    const duelId = inserted.id || inserted;
    const duel = await getDuelById(req.db, duelId);

    res.status(201).json(shape(duel));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json(error.payload);
    }

    console.error("Create auto duel error:", error);
    res.status(500).json({ error: "Failed to create duel" });
  }
};

exports.vote = async (req, res) => {
  try {
    const { id } = req.params;
    const normalizedVote = normalizeVotePayload(req.body);
    const user_id = req.userId;
    const vote = normalizedVote.vote;

    await closeExpiredDuels(req.db, { limit: 100 });

    if (!user_id || !["A", "B"].includes(vote)) {
      return res.status(400).json({ error: "vote ('A' or 'B') required" });
    }

    let duel = await req.db("duels").where({ id }).first();
    if (!duel) {
      return res.status(404).json({ error: "duel_not_found" });
    }

    if (shouldFinishDuel(duel)) {
      await finishDuelIfNeeded(req.db, id);
      const fullDuel = await getDuelById(req.db, id);
      return res.status(400).json({ error: "duel_finished", duel: shape(fullDuel) });
    }

    if (Number(user_id) === Number(duel.user_a_id) || Number(user_id) === Number(duel.user_b_id)) {
      return res.status(403).json({ error: "cannot_vote_own_duel" });
    }

    const existingVote = await req.db("duel_votes")
      .where({ duel_id: id, user_id })
      .first();

    if (existingVote) {
      const fullDuel = await getDuelById(req.db, id);
      return res.status(409).json({ error: "already_voted", duel: shape(fullDuel) });
    }

    try {
      await req.db.transaction(async (trx) => {
        await trx("duel_votes").insert({ duel_id: id, user_id, vote });
        await trx("duels")
          .where({ id })
          .increment(vote === "A" ? "votes_a" : "votes_b", 1);
        await trx("duels")
          .where({ id })
          .update({ updated_at: trx.fn.now() });
      });
    } catch (transactionError) {
      if (transactionError.code === "23505") {
        const fullDuel = await getDuelById(req.db, id);
        return res.status(409).json({ error: "already_voted", duel: shape(fullDuel) });
      }
      throw transactionError;
    }

    duel = await finishDuelIfNeeded(req.db, id);
    const updatedDuel = await getDuelById(req.db, id);
    res.json({ ok: true, duel: shape(updatedDuel || duel), your_vote: vote });
  } catch (error) {
    console.error("Vote duel error:", error);
    res.status(500).json({ error: "Failed to vote" });
  }
};

exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId || null;

    await closeExpiredDuels(req.db, { limit: 50 });

    const duel = await getDuelById(req.db, id);
    if (!duel) {
      return res.status(404).json({ error: "duel_not_found" });
    }

    const yourVote = await getUserVote(req.db, id, userId);
    res.json({ ...shape(duel), your_vote: yourVote });
  } catch (error) {
    console.error("Get duel error:", error);
    res.status(500).json({ error: "Failed to get duel" });
  }
};

exports.getFeed = async (req, res) => {
  try {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const limit = Number.parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;
    const userId = req.userId || null;
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const candidateLimit = Math.min(Math.max((offset + limit) * 4, 20), 100);

    await closeExpiredDuels(req.db, { limit: candidateLimit });

    let query = duelBaseQuery(req.db)
      .orderBy("duels.created_at", "desc")
      .limit(candidateLimit);

    if (status === "active" || status === "finished") {
      query = query.where("duels.status", status);
    }

    const blockedUserIds = await getBlockedUserIds(req.db, userId);
    const rows = (await query).filter((row) => {
      if (blockedUserIds.includes(Number(row.user_a_id)) || blockedUserIds.includes(Number(row.user_b_id))) {
        return false;
      }

      return true;
    });

    let votedMap = {};
    if (userId && rows.length > 0) {
      const ids = rows.map((row) => row.id);
      const votes = await req.db("duel_votes")
        .whereIn("duel_id", ids)
        .where("user_id", userId);

      votes.forEach((voteRow) => {
        votedMap[voteRow.duel_id] = voteRow.vote;
      });
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
    res.status(500).json({ error: "Failed to get duels" });
  }
};
