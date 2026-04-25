const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDatabaseBackoffController,
  isDatabaseConnectivityError,
} = require("../src/services/dbResilience");

test("isDatabaseConnectivityError matches transient network and pool failures", () => {
  assert.equal(
    isDatabaseConnectivityError({
      code: "ETIMEDOUT",
      message: "connect ETIMEDOUT 34.241.16.247:6543",
    }),
    true
  );
  assert.equal(
    isDatabaseConnectivityError({
      name: "KnexTimeoutError",
      message: "Knex: Timeout acquiring a connection. The pool is probably full.",
    }),
    true
  );
  assert.equal(
    isDatabaseConnectivityError({
      code: "EINVAL",
      message: "some unrelated validation error",
    }),
    false
  );
});

test("createDatabaseBackoffController applies exponential cooldown and resets after success", () => {
  let now = 1000;
  const warnings = [];
  const controller = createDatabaseBackoffController({
    label: "Test worker",
    baseDelayMs: 1000,
    maxDelayMs: 4000,
    now: () => now,
    logger: {
      warn(message, meta) {
        warnings.push({ message, meta });
      },
    },
  });

  assert.equal(controller.shouldRun(), true);
  assert.equal(
    controller.onError({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND db.example.com" }),
    true
  );
  assert.equal(controller.shouldRun(), false);
  assert.equal(controller.getBlockedMs(), 1000);

  now += 1000;
  assert.equal(controller.shouldRun(), true);
  controller.onError({ code: "ETIMEDOUT", message: "connect ETIMEDOUT 1.2.3.4:5432" });
  assert.equal(controller.getBlockedMs(), 2000);

  now += 2000;
  controller.onSuccess();
  assert.equal(controller.shouldRun(), true);
  assert.equal(controller.getBlockedMs(), 0);
  assert.equal(warnings.length, 2);
});
