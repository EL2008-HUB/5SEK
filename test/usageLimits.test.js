const test = require("node:test");
const assert = require("node:assert/strict");
const { getEffectiveAnswerLimit } = require("../src/services/usageLimits");

test("getEffectiveAnswerLimit adds bonus answers for non-premium users", () => {
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
