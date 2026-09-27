const test = require("node:test");
const assert = require("node:assert/strict");
const shareLanding = require("../src/services/shareLanding");

function fakeReq({ id = "7", db } = {}) {
  return {
    params: { id },
    path: `/a/${id}`,
    protocol: "https",
    headers: {},
    get: () => "5sek.app",
    db,
  };
}

function fakeRes() {
  const res = { headers: {}, body: null, contentType: null, statusCode: 200 };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  res.type = (t) => {
    res.contentType = t;
    return res;
  };
  res.send = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

function queryReturning(row) {
  const builder = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "first") return async () => row;
        if (prop === "then") return undefined;
        return () => builder;
      },
    }
  );
  return () => builder;
}

test("escapeHtml neutralises markup", () => {
  const { escapeHtml } = shareLanding._internals;
  assert.equal(escapeHtml(`<script>"x"&'y'</script>`), "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
});

test("answer landing falls back to a generic page when the db fails", async () => {
  const db = () => {
    throw new Error("db down");
  };
  const res = fakeRes();
  await shareLanding.answerLanding(fakeReq({ db }), res);
  assert.equal(res.contentType, "html");
  assert.match(res.body, /<title>5SEK/);
  assert.match(res.body, /five-second:\/\/home/);
});

test("invalid ids render the fallback without touching the db", async () => {
  let touched = false;
  const db = () => {
    touched = true;
    throw new Error("should not query");
  };
  const res = fakeRes();
  await shareLanding.duelLanding(fakeReq({ id: "abc", db }), res);
  assert.equal(touched, false);
  assert.match(res.body, /og:title/);
});

test("challenge landing escapes user content and deep-links to the challenge", async () => {
  const db = queryReturning({
    id: 7,
    answer_type: "text",
    video_url: null,
    text_content: `<img src=x onerror=alert(1)>`,
    response_time: 2.4,
    question_id: 3,
    username: "arta",
    role: "user",
    question_text: `Cili "super-fuqi" do zgjidhje?`,
  });
  const res = fakeRes();
  await shareLanding.challengeLanding(fakeReq({ db }), res);
  assert.ok(!res.body.includes("<img src=x"));
  assert.match(res.body, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(res.body, /@arta te sfidoi/);
  assert.match(res.body, /five-second:\/\/c\/7/);
  assert.match(res.body, /og:url" content="https:\/\/5sek\.app\/c\/7"/);
});
