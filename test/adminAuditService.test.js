const test = require("node:test");
const assert = require("node:assert/strict");

const { logAdminAction } = require("../src/services/adminAuditService");

test("logAdminAction writes audit records with request context", async () => {
  let inserted = null;
  const req = {
    userId: 42,
    ip: "127.0.0.1",
    headers: {
      "user-agent": "unit-test",
    },
    db(tableName) {
      assert.equal(tableName, "admin_audit_logs");
      return {
        insert(row) {
          inserted = row;
          return {
            async returning() {
              return [{ id: 1, ...row }];
            },
          };
        },
      };
    },
  };

  const row = await logAdminAction(req, {
    action: "questions.set_daily",
    entityType: "question",
    entityId: 9,
    metadata: { target_date: "2026-04-21" },
  });

  assert.equal(inserted.admin_user_id, 42);
  assert.equal(inserted.action, "questions.set_daily");
  assert.equal(inserted.entity_type, "question");
  assert.equal(inserted.entity_id, 9);
  assert.deepEqual(inserted.metadata, { target_date: "2026-04-21" });
  assert.equal(inserted.user_agent, "unit-test");
  assert.equal(row.id, 1);
});
