const test = require("node:test");
const assert = require("node:assert/strict");

const {
  JOB_TYPES,
  getBackgroundJob,
  queueBackgroundJob,
} = require("../src/services/backgroundJobService");

test("queueBackgroundJob inserts queued jobs and getBackgroundJob parses JSON payload/result", async () => {
  let inserted = null;
  const storedRow = {
    id: 7,
    job_type: JOB_TYPES.ANALYTICS_AGGREGATION,
    payload: JSON.stringify({ day: "2026-04-21" }),
    result: JSON.stringify({ ok: true }),
    status: "completed",
  };

  function db(tableName) {
    assert.equal(tableName, "background_jobs");
    return {
      insert(row) {
        inserted = row;
        return {
          async returning() {
            return [{ id: 3, status: "queued", ...row }];
          },
        };
      },
      where(criteria) {
        assert.deepEqual(criteria, { id: 7 });
        return {
          async first() {
            return storedRow;
          },
        };
      },
    };
  }

  db.fn = { now: () => "now()" };

  const queued = await queueBackgroundJob(db, {
    jobType: JOB_TYPES.ANALYTICS_AGGREGATION,
    payload: { day: "2026-04-21" },
  });
  const fetched = await getBackgroundJob(db, 7);

  assert.equal(inserted.job_type, JOB_TYPES.ANALYTICS_AGGREGATION);
  assert.deepEqual(inserted.payload, { day: "2026-04-21" });
  assert.equal(queued.status, "queued");
  assert.deepEqual(fetched.payload, { day: "2026-04-21" });
  assert.deepEqual(fetched.result, { ok: true });
});
