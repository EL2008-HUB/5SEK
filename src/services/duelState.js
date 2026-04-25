const VOTE_THRESHOLD = 20;
const DUEL_DURATION_HOURS = 24;

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getTotalVotes(duel = {}) {
  return safeNumber(duel.total_votes, safeNumber(duel.votes_a) + safeNumber(duel.votes_b));
}

function computeWinner(votesA, votesB) {
  if (votesA > votesB) return "A";
  if (votesB > votesA) return "B";
  return "tie";
}

function getDuelExpiresAt(createdAt = new Date()) {
  const baseDate = createdAt instanceof Date ? createdAt : new Date(createdAt);
  return new Date(baseDate.getTime() + DUEL_DURATION_HOURS * 60 * 60 * 1000).toISOString();
}

function isDuelExpired(duel, now = Date.now()) {
  if (!duel?.expires_at) return false;
  const expiresAt = new Date(duel.expires_at).getTime();
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt <= now;
}

function getRemainingSeconds(duel, now = Date.now()) {
  if (!duel?.expires_at) return null;
  const expiresAt = new Date(duel.expires_at).getTime();
  if (!Number.isFinite(expiresAt)) return null;
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

function shouldFinishDuel(duel, now = Date.now()) {
  if (!duel || duel.status === "finished") return false;
  return getTotalVotes(duel) >= VOTE_THRESHOLD || isDuelExpired(duel, now);
}

function applyVoteToDuel(duel, vote) {
  const votes_a = safeNumber(duel.votes_a) + (vote === "A" ? 1 : 0);
  const votes_b = safeNumber(duel.votes_b) + (vote === "B" ? 1 : 0);
  const total_votes = votes_a + votes_b;
  const status =
    duel.status === "active" && shouldFinishDuel({ ...duel, votes_a, votes_b, total_votes })
      ? "finished"
      : duel.status;

  return {
    ...duel,
    votes_a,
    votes_b,
    total_votes,
    status,
    winner: status === "finished" ? computeWinner(votes_a, votes_b) : duel.winner || null,
  };
}

module.exports = {
  DUEL_DURATION_HOURS,
  VOTE_THRESHOLD,
  applyVoteToDuel,
  computeWinner,
  getDuelExpiresAt,
  getRemainingSeconds,
  getTotalVotes,
  isDuelExpired,
  shouldFinishDuel,
};
