const test = require("node:test");
const assert = require("node:assert/strict");

const AI_SERVICE_PATH = require.resolve("../src/services/aiService");

test("Groq auth failure is cached and stops repeated model fallbacks", async () => {
  const previousKey = process.env.GROQ_API_KEY;
  const previousFetch = global.fetch;
  let callCount = 0;
  const requestedUrls = [];

  try {
    process.env.GROQ_API_KEY = "dummy-groq-key-not-a-real-secret";
    delete require.cache[AI_SERVICE_PATH];

    global.fetch = async (url) => {
      callCount += 1;
      requestedUrls.push(String(url));
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
      /Groq authentication failed \(401\)/
    );
    assert.equal(callCount, 1);
    assert.match(requestedUrls[0], /^https:\/\/api\.groq\.com\//);

    // A 401 must disable AI instead of retrying every model in the fallback chain.
    assert.equal(aiService.isAIEnabled(), false);

    await assert.rejects(
      aiService.generateQuestions(2, null, null, "AL"),
      /Groq authentication failed \(401\)/
    );
    assert.equal(callCount, 1);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env.GROQ_API_KEY;
    } else {
      process.env.GROQ_API_KEY = previousKey;
    }
    delete require.cache[AI_SERVICE_PATH];
  }
});
