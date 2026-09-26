/**
 * Leaderboard: ranks users by points earned from answering, getting liked and winning duels.
 *
 * points = answers*5 + likes_received*2 + duel_wins*25 + duel_votes_received*1
 *
 * The top list is cached per period for a short window; the caller's own row is computed live
 * so a user always sees fresh personal progress.
 */
const POINTS = Object.freeze({ answer: 5, like: 2, win: 25, vote: 1 });
const PERIODS = Object.freeze({
  today: () => {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    return start;
  },
  week: () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  all: () => new Date(0),
});
const CACHE_TTL_MS = Number(process.env.LEADERBOARD_CACHE_MS || 45_000);
const TOP_LIMIT = 100;

const cache = new Map();

function resolvePeriod(raw) {
  const key = typeof raw === "string" ? raw.toLowerCase() : "week";
  return PERIODS[key] ? key : "week";
}

function aggregateQuery(db, since) {
  const sinceIso = since.toISOString();
  return db.raw(
    `
    WITH answer_stats AS (
      SELECT user_id,
             COUNT(*)::int AS answers,
             COALESCE(SUM(likes), 0)::int AS likes_received
      FROM answers
      WHERE deleted_at IS NULL
        AND COALESCE(is_hidden, false) = false
        AND created_at >= ?
      GROUP BY user_id
    ),
    duel_sides AS (
      SELECT user_a_id AS user_id,
             CASE WHEN winner = 'A' THEN 1 ELSE 0 END AS win,
             COALESCE(votes_a, 0) AS votes
      FROM duels
      WHERE status = 'finished' AND COALESCE(finished_at, updated_at, created_at) >= ?
      UNION ALL
      SELECT user_b_id,
             CASE WHEN winner = 'B' THEN 1 ELSE 0 END,
             COALESCE(votes_b, 0)
      FROM duels
      WHERE status = 'finished' AND COALESCE(finished_at, updated_at, created_at) >= ?
    ),
    duel_stats AS (
      SELECT user_id,
             COUNT(*)::int AS duels,
             SUM(win)::int AS wins,
             SUM(votes)::int AS votes_received
      FROM duel_sides
      GROUP BY user_id
    )
    SELECT u.id,
           u.username,
           u.country,
           u.role,
           COALESCE(a.answers, 0) AS answers,
           COALESCE(a.likes_received, 0) AS likes_received,
           COALESCE(d.duels, 0) AS duels,
           COALESCE(d.wins, 0) AS wins,
           COALESCE(d.votes_received, 0) AS votes_received,
           (COALESCE(a.answers, 0) * ? + COALESCE(a.likes_received, 0) * ? +
            COALESCE(d.wins, 0) * ? + COALESCE(d.votes_received, 0) * ?)::int AS points
    FROM users u
    LEFT JOIN answer_stats a ON a.user_id = u.id
    LEFT JOIN duel_stats d ON d.user_id = u.id
    WHERE u.deleted_at IS NULL
      AND COALESCE(u.is_blocked, false) = false
      AND (a.user_id IS NOT NULL OR d.user_id IS NOT NULL)
    `,
    [sinceIso, sinceIso, sinceIso, POINTS.answer, POINTS.like, POINTS.win, POINTS.vote]
  );
}

function badgeFor(row) {
  if (row.wins >= 3) return { key: "duelist", label: "Duelist" };
  if (row.likes_received >= 20) return { key: "loved", label: "I pelqyer" };
  if (row.answers >= 7) return { key: "streaker", label: "Aktiv" };
  if (row.votes_received >= 20) return { key: "crowd", label: "Publiku" };
  return null;
}

function shapeRow(row, rank) {
  return {
    rank,
    user_id: Number(row.id),
    username: row.username,
    country: row.country || "GLOBAL",
    is_guest: row.role === "guest",
    points: Number(row.points) || 0,
    breakdown: {
      answers: Number(row.answers) || 0,
      likes_received: Number(row.likes_received) || 0,
      duels: Number(row.duels) || 0,
      wins: Number(row.wins) || 0,
      votes_received: Number(row.votes_received) || 0,
    },
    badge: badgeFor(row),
  };
}

async function loadTop(db, period) {
  const cached = cache.get(period);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;

  const since = PERIODS[period]();
  const result = await db.raw(
    `SELECT * FROM (${aggregateQuery(db, since).toQuery()}) ranked ORDER BY points DESC, wins DESC, id ASC LIMIT ?`,
    [TOP_LIMIT]
  );
  const rows = (result.rows || []).map((row, index) => shapeRow(row, index + 1));
  cache.set(period, { at: Date.now(), rows });
  return rows;
}

async function loadMe(db, period, userId, top) {
  if (!userId) return null;
  const inTop = top.find((row) => row.user_id === Number(userId));
  if (inTop) return inTop;

  const since = PERIODS[period]();
  const base = aggregateQuery(db, since).toQuery();
  const mine = await db.raw(`SELECT * FROM (${base}) ranked WHERE id = ?`, [userId]);
  const row = mine.rows?.[0];
  if (!row) {
    const user = await db("users").where({ id: userId }).select("id", "username", "country", "role").first();
    if (!user) return null;
    return shapeRow({ ...user, answers: 0, likes_received: 0, duels: 0, wins: 0, votes_received: 0, points: 0 }, null);
  }
  const ahead = await db.raw(
    `SELECT COUNT(*)::int AS ahead FROM (${base}) ranked WHERE points > ? OR (points = ? AND wins > ?) OR (points = ? AND wins = ? AND id < ?)`,
    [row.points, row.points, row.wins, row.points, row.wins, userId]
  );
  return shapeRow(row, (ahead.rows?.[0]?.ahead || 0) + 1);
}

exports.getLeaderboard = async (req, res) => {
  const period = resolvePeriod(req.query.period);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), TOP_LIMIT);

  try {
    const top = await loadTop(req.db, period);
    const me = await loadMe(req.db, period, req.userId || null, top).catch(() => null);

    let next_rank = null;
    if (me && me.rank && me.rank > 1) {
      const above = top.find((row) => row.rank === me.rank - 1) || top[top.length - 1];
      if (above) {
        next_rank = { rank: above.rank, username: above.username, points_needed: Math.max(1, above.points - me.points + 1) };
      }
    }

    res.json({
      period,
      points: POINTS,
      generated_at: new Date().toISOString(),
      total_ranked: top.length,
      entries: top.slice(0, limit),
      me,
      next_rank,
    });
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(503).json({ error: "leaderboard_unavailable", period, entries: [], me: null });
  }
};

exports._internals = { resolvePeriod, shapeRow, badgeFor, POINTS, cache };
