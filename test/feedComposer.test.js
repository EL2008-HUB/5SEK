const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateDuelFeedScore, rankAnswerFeed } = require("../src/services/feedComposer");

test("rankAnswerFeed prioritizes high-hook answers and mixes buckets", () => {
  const rows = [
    {
      id: 1,
      question_id: 10,
      category: "funny",
      response_time: 4.5,
      likes: 2,
      shares: 0,
      views: 10,
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

  assert.equal(ranked[0].feed_bucket, "funny");
  assert.equal(fastAnswer.feed_bucket, "fast");
  assert.ok(fastAnswer.feed_score > funnyAnswer.feed_score);
  assert.equal(ranked[0].feed_bucket === ranked[1].feed_bucket, false);
});

test("calculateDuelFeedScore favors active recent duels with votes", () => {
  const activeHotDuel = calculateDuelFeedScore({
    status: "active",
    total_votes: 12,
    total_views: 80,
    pct_a: 52,
    created_at: new Date().toISOString(),
  });

  const staleFinishedDuel = calculateDuelFeedScore({
    status: "finished",
    total_votes: 3,
    total_views: 20,
    pct_a: 80,
    created_at: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString(),
  });

  assert.ok(activeHotDuel > staleFinishedDuel);
});

test("rankAnswerFeed penalizes flagged answers and lightly boosts trusted users", () => {
  const ranked = rankAnswerFeed(
    [
      {
        id: 1,
        question_id: 20,
        category: "funny",
        response_time: 2.1,
        likes: 4,
        shares: 1,
        views: 18,
        watch_time_total: 16,
        completion_count: 4,
        skip_count: 1,
        created_at: new Date().toISOString(),
        trust_score: 180,
        abuse_score: 0,
        report_count: 0,
        moderation_status: "approved",
        requires_human_review: false,
      },
      {
        id: 2,
        question_id: 21,
        category: "funny",
        response_time: 2.1,
        likes: 4,
        shares: 1,
        views: 18,
        watch_time_total: 16,
        completion_count: 4,
        skip_count: 1,
        created_at: new Date().toISOString(),
        trust_score: 100,
        abuse_score: 45,
        report_count: 3,
        moderation_status: "flagged",
        requires_human_review: true,
      },
    ],
    {
      todayCounts: { 20: 5, 21: 5 },
      recentCounts: { 20: 2, 21: 2 },
      hourlyCounts: { 20: 1, 21: 1 },
    }
  );

  const trusted = ranked.find((row) => row.id === 1);
  const flagged = ranked.find((row) => row.id === 2);

  assert.ok(trusted.feed_score > flagged.feed_score);
});
