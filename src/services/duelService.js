const { VOTE_THRESHOLD } = require("./duelState");

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
  now = new Date().toISOString(),
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

module.exports = {
  closeExpiredDuels,
};
