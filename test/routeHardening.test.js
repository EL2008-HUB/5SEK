const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const { createApp } = require("../src/app");

function matches(row, criteria) {
  return Object.entries(criteria).every(([key, value]) => row[key] === value);
}

function createMockDb(initialState = {}) {
  const state = {
    users: initialState.users || [],
    paywallEvents: initialState.paywallEvents || [],
    requestRateLimits: new Map(),
  };

  function db(tableName) {
    if (tableName === "users") {
      return {
        where(...args) {
          const criteria =
            typeof args[0] === "string"
              ? { [args[0]]: args[1] }
              : args[0];
          const rows = state.users.filter((row) => matches(row, criteria));
          return {
            select() {
              return this;
            },
            async first() {
              return rows[0] || null;
            },
          };
        },
      };
    }

    if (tableName === "request_rate_limits") {
      return {
        insert(row) {
          const key = `${row.scope}|${row.actor_key}|${row.window_start}`;
          const nextCount = (state.requestRateLimits.get(key) || 0) + 1;
          state.requestRateLimits.set(key, nextCount);

          return {
            onConflict() {
              return this;
            },
            merge() {
              return this;
            },
            async returning() {
              return [{ count: nextCount, window_start: row.window_start }];
            },
          };
        },
      };
    }

    if (tableName === "paywall_events") {
      return {
        async insert(row) {
          state.paywallEvents.push(row);
        },
      };
    }

    throw new Error(`Unhandled table in test db: ${tableName}`);
  }

  db.raw = async () => ({ rows: [{ 1: 1 }] });
  db.fn = { now: () => new Date().toISOString() };

  return { db, state };
}

function createToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET);
}

async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    return await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("admin routes use DB-backed RBAC instead of trusting token role", async () => {
  const { db } = createMockDb({
    users: [
      { id: 1, username: "eve", email: "eve@example.com", country: "US", role: "user" },
    ],
  });
  const app = createApp({ db });
  const token = createToken({ id: 1, username: "eve", country: "US", role: "admin" });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/questions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "Should not be created" }),
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "admin_required" });
  });
});

test("paywall route ignores spoofed user_id body field when authenticated", async () => {
  const { db, state } = createMockDb({
    users: [
      { id: 5, username: "mia", email: "mia@example.com", country: "AL", role: "user" },
    ],
  });
  const app = createApp({ db });
  const token = createToken({ id: 5, username: "mia", country: "AL", role: "user" });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/paywall/track`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        user_id: 999,
        event_type: "paywall_shown",
        metadata: { trigger: "test" },
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "unexpected field: user_id" });
    assert.equal(state.paywallEvents.length, 0);
  });
});

test("answers daily usage route enforces ownership instead of auth presence only", async () => {
  const { db } = createMockDb({
    users: [
      { id: 5, username: "nora", email: "nora@example.com", country: "US", role: "user" },
    ],
  });
  const app = createApp({ db });
  const token = createToken({ id: 5, username: "nora", country: "US", role: "user" });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/answers/daily-usage/99`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "forbidden" });
  });
});

test("admin routes require an authenticated admin instead of failing with missing req.userId", async () => {
  const { db } = createMockDb({
    users: [
      { id: 8, username: "mira", email: "mira@example.com", country: "US", role: "user", is_admin: false },
    ],
  });
  const app = createApp({ db });
  const token = createToken({ id: 8, username: "mira", country: "US", role: "user" });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/stats/realtime`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "forbidden" });
  });
});

test("legal export route requires authentication", async () => {
  const { db } = createMockDb();
  const app = createApp({ db });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/legal/export-data`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ exportType: "full" }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "No token provided" });
  });
});

test("push registration rejects spoofed user_id field", async () => {
  const { db } = createMockDb({
    users: [
      { id: 6, username: "lina", email: "lina@example.com", country: "AL", role: "user" },
    ],
  });
  const app = createApp({ db });
  const token = createToken({ id: 6, username: "lina", country: "AL", role: "user" });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/push/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        user_id: 999,
        token: "ExponentPushToken[test-token-1234567890]",
        platform: "android",
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "unexpected field: user_id" });
  });
});

test("API routes return 503 while startup is incomplete", async () => {
  const { db } = createMockDb();
  const app = createApp({
    db,
    startupState: {
      phase: "running_migrations",
      ready: false,
      startedAt: "2026-04-24T00:00:00.000Z",
      readyAt: null,
      error: null,
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/questions`);

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "5");
    assert.deepEqual(await response.json(), {
      error: "service_starting",
      retry_after_seconds: 5,
      startup: {
        phase: "running_migrations",
        ready: false,
        started_at: "2026-04-24T00:00:00.000Z",
        ready_at: null,
        error: null,
      },
    });
  });
});

test("health endpoint stays available during startup", async () => {
  const { db } = createMockDb();
  const app = createApp({
    db,
    startupState: {
      phase: "running_migrations",
      ready: false,
      startedAt: "2026-04-24T00:00:00.000Z",
      readyAt: null,
      error: null,
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, "starting");
    assert.equal(payload.app, "5SEK API");
    assert.equal(payload.env, "development");
    assert.equal(typeof payload.api_version, "string");
    assert.ok(payload.api_version.length > 0);
    assert.equal(payload.detected_country, "GLOBAL");
    assert.deepEqual(payload.startup, {
      phase: "running_migrations",
      ready: false,
      started_at: "2026-04-24T00:00:00.000Z",
      ready_at: null,
      error: null,
    });
    assert.match(payload.timestamp, /^.+Z$/);
  });
});
