const test = require("node:test");
const assert = require("node:assert/strict");

const pushController = require("../src/controllers/pushController");

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

test("pushController.register stores token against authenticated user only", async () => {
  let inserted = null;
  const req = {
    userId: 42,
    body: {
      user_id: 999,
      token: "ExponentPushToken[test-token-1234567890]",
      platform: "android",
      device_id: "device-1",
      app_version: "1.0.0",
      project_id: "project-1",
    },
    db(tableName) {
      assert.equal(tableName, "push_tokens");
      return {
        insert(payload) {
          inserted = payload;
          return {
            onConflict() {
              return this;
            },
            merge() {
              return this;
            },
            async returning() {
              return [{ id: 7, ...inserted, last_seen_at: "2026-04-21T00:00:00.000Z" }];
            },
          };
        },
        fn: {
          now() {
            return "2026-04-21T00:00:00.000Z";
          },
        },
      };
    },
  };
  req.db.fn = {
    now() {
      return "2026-04-21T00:00:00.000Z";
    },
  };

  const res = createRes();
  await pushController.register(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(inserted.user_id, 42);
  assert.equal(inserted.platform, "android");
  assert.equal(res.body.ok, true);
});
