const DEFAULT_TRUST_SCORE = 100;
const MIN_TRUST_SCORE = 0;
const MAX_TRUST_SCORE = 200;

function clampTrustScore(value) {
  return Math.max(MIN_TRUST_SCORE, Math.min(MAX_TRUST_SCORE, Math.round(Number(value) || 0)));
}

async function adjustUserTrustScore(db, userId, delta) {
  if (!userId || !Number.isFinite(Number(delta)) || Number(delta) === 0) {
    return null;
  }

  const user = await db("users").where({ id: userId }).first();
  if (!user || user.deleted_at) {
    return null;
  }

  const nextTrustScore = clampTrustScore((user.trust_score ?? DEFAULT_TRUST_SCORE) + Number(delta));

  const [updatedUser] = await db("users")
    .where({ id: userId })
    .update({ trust_score: nextTrustScore })
    .returning("*");

  return updatedUser || null;
}

module.exports = {
  DEFAULT_TRUST_SCORE,
  MAX_TRUST_SCORE,
  MIN_TRUST_SCORE,
  adjustUserTrustScore,
  clampTrustScore,
};
