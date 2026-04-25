const test = require("node:test");
const assert = require("node:assert/strict");

const answerController = require("../src/controllers/answerController");
const paywallController = require("../src/controllers/paywallController");

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

test("paywallController.trackEvent uses authenticated user instead of spoofed body user_id", async () => {
  let insertedRow = null;
  const req = {
    body: {
      user_id: 999,
      event_type: "paywall_clicked",
      metadata: { source: "test" },
    },
    userId: 5,
    db(tableName) {
      assert.equal(tableName, "paywall_events");
      return {
        async insert(row) {
          insertedRow = row;
        },
      };
    },
  };
  const res = createRes();

  await paywallController.trackEvent(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(insertedRow.user_id, 5);
  assert.equal(insertedRow.event_type, "paywall_clicked");
});

test("answerController.getDailyUsage returns 404 when the authenticated user does not exist", async () => {
  const req = {
    params: { userId: "7" },
    userId: 7,
    userRole: "user",
    db(tableName) {
      assert.equal(tableName, "users");
      return {
        where(criteria) {
          assert.deepEqual(criteria, { id: 7 });
          return {
            async first() {
              return null;
            },
          };
        },
      };
    },
  };
  const res = createRes();

  await answerController.getDailyUsage(req, res);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "User not found" });
});
