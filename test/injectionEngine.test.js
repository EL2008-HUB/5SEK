const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateQuestionsNeeded } = require("../src/services/injectionEngine");

test("calculateQuestionsNeeded never returns a negative value", () => {
  assert.equal(calculateQuestionsNeeded(25), 5);
  assert.equal(calculateQuestionsNeeded(44), 1);
  assert.equal(calculateQuestionsNeeded(60), 1);
});
