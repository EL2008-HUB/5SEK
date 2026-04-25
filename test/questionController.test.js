const test = require("node:test");
const assert = require("node:assert/strict");
const questionController = require("../src/controllers/questionController");

function matches(row, criteria) {
  return Object.entries(criteria).every(([key, value]) => row[key] === value);
}

function createQuestionDb(questions) {
  return function db(tableName) {
    assert.equal(tableName, "questions");

    return {
      where(criteria) {
        return {
          async first() {
            return questions.find((row) => matches(row, criteria));
          },
          update(updateData) {
            const affected = questions.filter((row) => matches(row, criteria));
            affected.forEach((row) => Object.assign(row, updateData));

            return {
              async returning() {
                return affected.map((row) => ({ ...row }));
              },
            };
          },
        };
      },
    };
  };
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

test("setDaily only clears existing daily question in the selected country", async () => {
  const questions = [
    { id: 1, country: "AL", active_date: "2026-04-20", is_daily: true },
    { id: 2, country: "US", active_date: "2026-04-20", is_daily: true },
    { id: 3, country: "AL", active_date: null, is_daily: false },
  ];

  const req = {
    body: { question_id: 3, date: "2026-04-20" },
    db: createQuestionDb(questions),
  };
  const res = createRes();

  await questionController.setDaily(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(questions.find((row) => row.id === 1).is_daily, false);
  assert.equal(questions.find((row) => row.id === 2).is_daily, true);
  assert.equal(questions.find((row) => row.id === 3).is_daily, true);
});
