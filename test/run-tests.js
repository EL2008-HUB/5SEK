const assert = require("node:assert/strict");
const { calculateDuelFeedScore, rankAnswerFeed } = require("../src/services/feedComposer");
const { getEffectiveAnswerLimit } = require("../src/services/usageLimits");
const {
  applyVoteToDuel,
  computeWinner,
  shouldFinishDuel,
  VOTE_THRESHOLD,
} = require("../src/services/duelState");
const questionController = require("../src/controllers/questionController");

function matches(row, criteria) {
  return Object.entries(criteria).every(([key, value]) => row[key] === value);
}

function createQuestionDb(questions) {
  return function db(tableName) {
    assert.equal(tableName, "questions");

    return {
      where(criteria) {
        return {
          async first() {
            return questions.find((row) => matches(row, criteria));
          },
          update(updateData) {
            const affected = questions.filter((row) => matches(row, criteria));
            affected.forEach((row) => Object.assign(row, updateData));

            return {
              async returning() {
                return affected.map((row) => ({ ...row }));
              },
            };
          },
        };
      },
    };
  };
}

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main() {
  await run("answer feed ranking", async () => {
    const rows = [
      {
        id: 1,
        question_id: 10,
        category: "funny",
        response_time: 4.5,
        likes: 2,
        shares: 0,
        views: 10,
        watch_time_total: 4,
        completion_count: 1,
        skip_count: 3,
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        question_id: 11,
        category: "general",
        response_time: 1.4,
        likes: 1,
        shares: 2,
        views: 20,
        watch_time_total: 21,
        completion_count: 5,
        skip_count: 1,
        created_at: new Date().toISOString(),
      },
      {
        id: 3,
        question_id: 12,
        category: "personal",
        response_time: 3.6,
        likes: 0,
        shares: 0,
        views: 6,
        watch_time_total: 6,
        completion_count: 1,
        skip_count: 1,
        created_at: new Date().toISOString(),
      },
    ];

    const ranked = rankAnswerFeed(rows, {
      todayCounts: { 10: 3, 11: 9, 12: 4 },
      recentCounts: { 10: 0, 11: 4, 12: 1 },
      hourlyCounts: { 10: 1, 11: 10, 12: 1 },
    });

    const fastAnswer = ranked.find((row) => row.id === 2);
    const funnyAnswer = ranked.find((row) => row.id === 1);

    assert.equal(fastAnswer.feed_bucket, "fast");
    assert.ok(fastAnswer.feed_score > funnyAnswer.feed_score);
    assert.notEqual(ranked[0].feed_bucket, ranked[1].feed_bucket);
  });

  await run("daily question country reset", async () => {
    const questions = [
      { id: 1, country: "AL", active_date: "2026-04-20", is_daily: true },
      { id: 2, country: "US", active_date: "2026-04-20", is_daily: true },
      { id: 3, country: "AL", active_date: null, is_daily: false },
    ];

    const req = {
      body: { question_id: 3, date: "2026-04-20" },
      db: createQuestionDb(questions),
    };
    const res = createRes();

    await questionController.setDaily(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(questions.find((row) => row.id === 1).is_daily, false);
    assert.equal(questions.find((row) => row.id === 2).is_daily, true);
    assert.equal(questions.find((row) => row.id === 3).is_daily, true);
  });

  await run("duel finishes at threshold", async () => {
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

  await run("expired duel closes even below threshold", async () => {
    const shouldClose = shouldFinishDuel({
      status: "active",
      votes_a: 1,
      votes_b: 1,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });

    assert.equal(shouldClose, true);
  });

  await run("duel feed ranking boosts active duels", async () => {
    const activeScore = calculateDuelFeedScore({
      status: "active",
      total_votes: 10,
      total_views: 60,
      pct_a: 51,
      created_at: new Date().toISOString(),
    });
    const finishedScore = calculateDuelFeedScore({
      status: "finished",
      total_votes: 4,
      total_views: 15,
      pct_a: 70,
      created_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });

    assert.ok(activeScore > finishedScore);
  });

  await run("paywall limit includes bonus answers", async () => {
    const result = getEffectiveAnswerLimit(
      {
        is_premium: false,
        bonus_answers_today: 2,
        bonus_answers_date: "2026-04-20",
      },
      "2026-04-20"
    );

    assert.equal(result.limit, 7);
    assert.equal(result.bonusUsed, 2);
    assert.equal(result.baseLimit, 5);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
