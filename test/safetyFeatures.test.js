const test = require("node:test");
const assert = require("node:assert/strict");

const authController = require("../src/controllers/authController");
const moderationController = require("../src/controllers/moderationController");

function matches(row, criteria) {
  return Object.entries(criteria).every(([key, value]) => row[key] === value);
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

function createModerationDb({ answers = [], reports = [], users = [] } = {}) {
  const answerRows = answers;
  const reportRows = reports;
  const userRows = users;

  function tableRows(tableName) {
    if (tableName === "answers") return answerRows;
    if (tableName === "moderation_reports") return reportRows;
    if (tableName === "users") return userRows;
    throw new Error(`Unexpected table ${tableName}`);
  }

  function project(row, columns) {
    if (!columns?.length) return { ...row };
    return columns.reduce((acc, column) => {
      acc[column] = row[column];
      return acc;
    }, {});
  }

  return function db(tableName) {
    return {
      where(criteria) {
        const rows = tableRows(tableName).filter((row) => matches(row, criteria));

        return {
          async first() {
            return rows[0] ? { ...rows[0] } : undefined;
          },
          whereNotNull(column) {
            const filtered = rows.filter((row) => row[column] !== null && row[column] !== undefined);
            return {
              async select(...columns) {
                return filtered.map((row) => project(row, columns));
              },
            };
          },
          async select(...columns) {
            return rows.map((row) => project(row, columns));
          },
          update(payload) {
            rows.forEach((row) => Object.assign(row, payload));
            return {
              async returning() {
                return rows.map((row) => ({ ...row }));
              },
            };
          },
        };
      },
      insert(payload) {
        const entries = Array.isArray(payload) ? payload : [payload];
        const inserted = entries.map((entry, index) => {
          const next = { id: reportRows.length + index + 1, ...entry };
          reportRows.push(next);
          return { ...next };
        });

        return {
          async returning() {
            return inserted;
          },
        };
      },
    };
  };
}

test("moderationController.reportUser rejects self-reporting", async () => {
  const req = {
    params: { id: "7" },
    body: { reason: "abuse" },
    userId: 7,
    db() {
      throw new Error("db should not be used for self-report validation");
    },
  };
  const res = createRes();

  await moderationController.reportUser(req, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "cannot_report_self" });
});

test("authController.deleteMe soft-deletes the authenticated user", async () => {
  let updatedPayload = null;
  const req = {
    userId: 12,
    db(tableName) {
      if (tableName === "users") {
        return {
          where(criteria) {
            assert.deepEqual(criteria, { id: 12 });
            return {
              update(payload) {
                updatedPayload = payload;
                return {
                  async returning() {
                    return [{ id: 12 }];
                  },
                };
              },
            };
          },
        };
      }

      if (tableName === "auth_refresh_tokens") {
        return {
          where(criteria) {
            assert.deepEqual(criteria, { user_id: 12 });
            return {
              whereNull() {
                return {
                  async update() {
                    return 1;
                  },
                };
              },
            };
          },
        };
      }

      if (tableName === "push_tokens") {
        return {
          where(criteria) {
            assert.deepEqual(criteria, { user_id: 12, status: "active" });
            return {
              whereNull() {
                return {
                  async update() {
                    return 0;
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${tableName}`);
    },
  };
  req.db.fn = {
    now() {
      return "2026-04-21T00:00:00.000Z";
    },
  };
  const res = createRes();

  await authController.deleteMe(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(updatedPayload.delete_reason, "self_delete");
  assert.equal(updatedPayload.is_blocked, true);
});

test("moderationController.reportAnswer ignores duplicate reports from the same user", async () => {
  const req = {
    params: { id: "15" },
    body: { reason: "spam" },
    userId: 99,
    db: createModerationDb({
      answers: [{ id: 15, user_id: 7, is_hidden: false, moderation_status: "approved" }],
      reports: [
        {
          id: 1,
          entity_type: "answer",
          entity_id: 15,
          reporter_user_id: 99,
          reason: "spam",
          status: "pending",
        },
      ],
    }),
  };
  const res = createRes();

  await moderationController.reportAnswer(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.duplicate, true);
  assert.equal(res.body.report_count, 1);
});

test("moderationController.reportAnswer auto-hides after three unique reports", async () => {
  const users = [{ id: 7, trust_score: 100 }];
  const answers = [
    {
      id: 15,
      user_id: 7,
      is_hidden: false,
      moderation_status: "approved",
      moderation_reason: null,
      abuse_score: 0,
      requires_human_review: false,
    },
  ];
  const reports = [
    {
      id: 1,
      entity_type: "answer",
      entity_id: 15,
      reporter_user_id: 21,
      reason: "spam",
      status: "pending",
    },
    {
      id: 2,
      entity_type: "answer",
      entity_id: 15,
      reporter_user_id: 22,
      reason: "spam",
      status: "pending",
    },
  ];

  const req = {
    params: { id: "15" },
    body: { reason: "spam" },
    userId: 23,
    db: createModerationDb({ answers, reports, users }),
  };
  const res = createRes();

  await moderationController.reportAnswer(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.report_count, 3);
  assert.equal(res.body.auto_hidden, true);
  assert.equal(answers[0].is_hidden, true);
  assert.equal(answers[0].moderation_status, "flagged");
  assert.match(String(answers[0].moderation_reason), /report_threshold_reached/);
  assert.equal(users[0].trust_score, 90);
});
