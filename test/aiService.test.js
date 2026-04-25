const test = require("node:test");
const assert = require("node:assert/strict");

const AI_SERVICE_PATH = require.resolve("../src/services/aiService");

test("OpenRouter auth failure is cached and stops repeated model fallbacks", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = global.fetch;
  let callCount = 0;

  try {
    process.env.OPENROUTER_API_KEY = "test-key";
    delete require.cache[AI_SERVICE_PATH];

    global.fetch = async () => {
      callCount += 1;
      return {
        status: 401,
        ok: false,
        async text() {
          return "unauthorized";
        },
      };
    };

    const aiService = require("../src/services/aiService");

    await assert.rejects(
      aiService.generateQuestions(2, null, null, "IT"),
      /OpenRouter authentication failed \(401\)/
    );
    assert.equal(callCount, 1);

    await assert.rejects(
      aiService.generateQuestions(2, null, null, "AL"),
      /OpenRouter authentication failed \(401\)/
    );
    assert.equal(callCount, 1);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = previousKey;
    }
    delete require.cache[AI_SERVICE_PATH];
  }
});
