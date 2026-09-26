const test = require("node:test");
const assert = require("node:assert/strict");
const {
  duelError,
  matchQueueForAnswer,
  withRetry,
} = require("../src/services/duelService");

test("withRetry retries transient database failures and then succeeds", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) {
        const error = new Error("connection terminated unexpectedly");
        error.code = "ECONNRESET";
        throw error;
      }
      return "ok";
    },
    { attempts: 3, baseDelayMs: 1 }
  );

  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withRetry does not retry business errors", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw duelError(409, "active_duel_exists");
      },
      { attempts: 3, baseDelayMs: 1 }
    ),
    (error) => error.statusCode === 409 && error.payload.error === "active_duel_exists"
  );
  assert.equal(calls, 1);
});

test("duelError carries status and payload for the controller", () => {
  const error = duelError(202, "queued", { queue_id: 7 });
  assert.equal(error.statusCode, 202);
  assert.deepEqual(error.payload, { error: "queued", queue_id: 7 });
});

test("matchQueueForAnswer ignores hidden or incomplete answers without touching the db", async () => {
  const db = () => {
    throw new Error("db should not be queried");
  };

  assert.equal(await matchQueueForAnswer(db, null), null);
  assert.equal(await matchQueueForAnswer(db, { id: 1, question_id: 2 }), null);
  assert.equal(
    await matchQueueForAnswer(db, { id: 1, question_id: 2, user_id: 3, is_hidden: true }),
    null
  );
});
