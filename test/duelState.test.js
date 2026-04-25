const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyVoteToDuel,
  computeWinner,
  getDuelExpiresAt,
  shouldFinishDuel,
  VOTE_THRESHOLD,
} = require("../src/services/duelState");

test("applyVoteToDuel finishes the duel when threshold is reached", () => {
  const updated = applyVoteToDuel(
    {
      id: 5,
      status: "active",
      votes_a: VOTE_THRESHOLD - 1,
      votes_b: 0,
      winner: null,
    },
    "A"
  );

  assert.equal(updated.status, "finished");
  assert.equal(updated.winner, "A");
  assert.equal(updated.total_votes, VOTE_THRESHOLD);
  assert.equal(computeWinner(updated.votes_a, updated.votes_b), "A");
});

test("shouldFinishDuel closes an expired duel even with low votes", () => {
  const duel = {
    status: "active",
    votes_a: 2,
    votes_b: 1,
    expires_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  };

  assert.equal(shouldFinishDuel(duel), true);
});

test("getDuelExpiresAt sets a 24 hour duel window", () => {
  const createdAt = "2026-04-22T10:00:00.000Z";
  const expiresAt = new Date(getDuelExpiresAt(createdAt)).toISOString();

  assert.equal(expiresAt, "2026-04-23T10:00:00.000Z");
});
