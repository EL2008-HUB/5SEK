/**
 * Public share landing pages for https://5sek.app links.
 *
 *   /a/:answerId  – an answer
 *   /c/:answerId  – "beat me" challenge: answering starts a duel against the sharer
 *   /q/:questionId – a question
 *   /d/:duelId    – a duel with live score
 *
 * Every page carries Open Graph / Twitter tags so WhatsApp, Instagram and Messenger
 * render a rich preview, plus an "open in app" deep link. Pages never error out:
 * missing or removed content falls back to a generic invite page.
 */

const APP_SCHEME = "five-second://";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function publicBaseUrl(req) {
  const configured = process.env.PUBLIC_WEB_URL || process.env.SHARE_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
}

function storeLinks() {
  return {
    ios: process.env.APP_STORE_URL || null,
    android: process.env.PLAY_STORE_URL || null,
  };
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function renderPage({ req, path, title, description, kicker, heading, bodyHtml, deepLink, ctaLabel }) {
  const base = publicBaseUrl(req);
  const url = `${base}${path}`;
  const stores = storeLinks();
  const storeButtons = [
    stores.ios ? `<a class="store" href="${escapeHtml(stores.ios)}">App Store</a>` : "",
    stores.android ? `<a class="store" href="${escapeHtml(stores.android)}">Google Play</a>` : "",
  ].join("");

  return `<!DOCTYPE html>
<html lang="sq">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="5SEK">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="theme-color" content="#050508">
<link rel="canonical" href="${escapeHtml(url)}">
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    background:radial-gradient(circle at 80% -10%,rgba(255,45,106,.35),transparent 45%),
      radial-gradient(circle at 0% 110%,rgba(139,92,255,.3),transparent 45%),#050508;color:#fff;
    display:flex;align-items:center;justify-content:center;padding:24px}
  .card{width:100%;max-width:440px;background:rgba(12,12,20,.85);border:1px solid rgba(255,255,255,.1);
    border-radius:28px;padding:26px}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:18px}
  .logo{width:40px;height:40px;border-radius:13px;background:linear-gradient(135deg,#FF2D6A,#8B5CFF);
    display:flex;align-items:center;justify-content:center;font-weight:900;font-size:20px}
  .brand b{font-size:20px;letter-spacing:2px}
  .kicker{color:#FF2D6A;font-size:12px;font-weight:900;letter-spacing:2px;text-transform:uppercase}
  h1{font-size:26px;line-height:1.2;margin:8px 0 16px}
  .answer{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:18px;
    padding:16px;font-size:18px;font-weight:700;line-height:1.4;margin-bottom:14px}
  .by{color:rgba(255,255,255,.6);font-size:13px;font-weight:700;margin-bottom:14px}
  video{width:100%;border-radius:18px;background:#000;margin-bottom:14px;max-height:420px}
  .duel{display:flex;gap:10px;margin-bottom:12px}
  .side{flex:1;background:rgba(255,255,255,.06);border-radius:16px;padding:12px;border:1px solid rgba(255,255,255,.1)}
  .side .n{font-weight:900;font-size:14px}.side .p{font-size:26px;font-weight:900;margin-top:4px}
  .side.a .p{color:#FF2D6A}.side.b .p{color:#8B5CFF}
  .side .t{color:rgba(255,255,255,.75);font-size:13px;margin-top:6px;line-height:1.35}
  .bar{display:flex;height:10px;border-radius:99px;overflow:hidden;background:rgba(255,255,255,.1);margin-bottom:14px}
  .bar i{display:block;height:100%}
  .cta{display:block;text-align:center;text-decoration:none;color:#fff;font-weight:900;font-size:17px;
    padding:16px;border-radius:18px;background:linear-gradient(135deg,#FF2D6A,#FF6B6B);margin-top:6px}
  .hint{color:rgba(255,255,255,.5);font-size:12px;text-align:center;margin-top:12px;line-height:1.5}
  .stores{display:flex;gap:10px;margin-top:12px}
  .store{flex:1;text-align:center;text-decoration:none;color:#3DFFC8;font-weight:800;font-size:14px;padding:12px;
    border-radius:14px;border:1px solid rgba(61,255,200,.45)}
</style>
</head>
<body>
<main class="card">
  <div class="brand"><div class="logo">5</div><b>5SEK</b></div>
  <div class="kicker">${escapeHtml(kicker)}</div>
  <h1>${escapeHtml(heading)}</h1>
  ${bodyHtml}
  <a class="cta" href="${escapeHtml(deepLink)}">${escapeHtml(ctaLabel)}</a>
  ${storeButtons ? `<div class="stores">${storeButtons}</div>` : ""}
  <p class="hint">5 sekonda per t'u pergjigjur. Pa llogari – hyn si vizitor me nje prekje.</p>
</main>
</body>
</html>`;
}

async function loadAnswer(db, id) {
  return db("answers")
    .leftJoin("users", "answers.user_id", "users.id")
    .leftJoin("questions", "answers.question_id", "questions.id")
    .where("answers.id", id)
    .whereNull("answers.deleted_at")
    .where((q) => q.whereNull("answers.is_hidden").orWhere("answers.is_hidden", false))
    .whereNull("users.deleted_at")
    .select(
      "answers.id",
      "answers.answer_type",
      "answers.video_url",
      "answers.text_content",
      "answers.response_time",
      "answers.question_id",
      "users.username",
      "users.role",
      "questions.text as question_text"
    )
    .first();
}

function displayName(row) {
  if (!row?.username) return "dikush";
  return row.role === "guest" ? "nje vizitor" : `@${row.username}`;
}

function answerBody(answer) {
  const parts = [];
  if (isHttpUrl(answer.video_url) && (answer.answer_type === "video" || answer.answer_type === "audio" || !answer.answer_type)) {
    parts.push(`<video src="${escapeHtml(answer.video_url)}" controls playsinline preload="metadata"></video>`);
  }
  if (answer.text_content) {
    parts.push(`<div class="answer">${escapeHtml(truncate(answer.text_content, 400))}</div>`);
  }
  const speed = Number(answer.response_time);
  const speedText = Number.isFinite(speed) && speed > 0 && speed <= 60 ? ` · ${speed.toFixed(1)}s` : "";
  parts.push(`<div class="by">${escapeHtml(displayName(answer))}${escapeHtml(speedText)}</div>`);
  return parts.join("\n");
}

function fallbackPage(req, path) {
  return renderPage({
    req,
    path,
    title: "5SEK – 5 sekonda. Nje pergjigje.",
    description: "Pergjigju pyetjes se dites ne 5 sekonda, sfido shoket ne duel dhe hyr ne renditje.",
    kicker: "5SEK",
    heading: "Ke 5 sekonda. Cfare thua?",
    bodyHtml: "",
    deepLink: `${APP_SCHEME}home`,
    ctaLabel: "Hap 5SEK",
  });
}

async function renderAnswerPage(req, { challenge }) {
  const id = parseId(req.params.id);
  const path = `/${challenge ? "c" : "a"}/${req.params.id}`;
  if (!id) return fallbackPage(req, path);
  const answer = await loadAnswer(req.db, id);
  if (!answer) return fallbackPage(req, path);

  const who = displayName(answer);
  const question = truncate(answer.question_text || "Pergjigju ne 5 sekonda", 140);
  return renderPage({
    req,
    path,
    title: challenge ? `${who} te sfidoi ne 5SEK ⚔️` : `${who} u pergjigj ne 5 sekonda`,
    description: challenge
      ? `"${question}" – Pergjigju ne 5 sekonda dhe fillon dueli 1v1.`
      : `"${question}" – A mund te pergjigjesh ti ne 5 sekonda?`,
    kicker: challenge ? "Sfide duel" : "Pergjigje",
    heading: question,
    bodyHtml: answerBody(answer),
    deepLink: `${APP_SCHEME}${challenge ? "c" : "a"}/${answer.id}`,
    ctaLabel: challenge ? "Pranoj sfiden ⚔️" : "Pergjigju ne 5 sekonda",
  });
}

async function renderQuestionPage(req) {
  const id = parseId(req.params.id);
  const path = `/q/${req.params.id}`;
  if (!id) return fallbackPage(req, path);
  const question = await req.db("questions").where({ id }).whereNull("deleted_at").select("id", "text").first();
  if (!question) return fallbackPage(req, path);

  let count = 0;
  try {
    const row = await req.db("answers").where({ question_id: id }).whereNull("deleted_at").count("id as c").first();
    count = Number(row?.c) || 0;
  } catch (_) {}

  const text = truncate(question.text, 160);
  return renderPage({
    req,
    path,
    title: `"${truncate(question.text, 80)}" – 5 sekonda`,
    description: count > 0 ? `${count} njerez jane pergjigjur. Radha jote – ke 5 sekonda.` : "Behu i pari qe pergjigjet. Ke 5 sekonda.",
    kicker: "Pyetja",
    heading: text,
    bodyHtml: count > 0 ? `<div class="by">${count} pergjigje deri tani</div>` : "",
    deepLink: `${APP_SCHEME}q/${question.id}`,
    ctaLabel: "Pergjigju ne 5 sekonda",
  });
}

async function renderDuelPage(req) {
  const id = parseId(req.params.id);
  const path = `/d/${req.params.id}`;
  if (!id) return fallbackPage(req, path);
  const duel = await req.db("duels")
    .leftJoin("users as ua", "duels.user_a_id", "ua.id")
    .leftJoin("users as ub", "duels.user_b_id", "ub.id")
    .leftJoin("questions", "duels.question_id", "questions.id")
    .leftJoin("answers as aa", "duels.answer_a_id", "aa.id")
    .leftJoin("answers as ab", "duels.answer_b_id", "ab.id")
    .where("duels.id", id)
    .select(
      "duels.id",
      "duels.status",
      "duels.winner",
      "duels.votes_a",
      "duels.votes_b",
      "ua.username as user_a",
      "ua.role as role_a",
      "ub.username as user_b",
      "ub.role as role_b",
      "questions.text as question_text",
      "aa.text_content as text_a",
      "ab.text_content as text_b"
    )
    .first();
  if (!duel) return fallbackPage(req, path);

  const votesA = Number(duel.votes_a) || 0;
  const votesB = Number(duel.votes_b) || 0;
  const total = votesA + votesB;
  const pctA = total > 0 ? Math.round((votesA / total) * 100) : 50;
  const pctB = 100 - pctA;
  const nameA = displayName({ username: duel.user_a, role: duel.role_a });
  const nameB = displayName({ username: duel.user_b, role: duel.role_b });
  const finished = duel.status === "finished";
  const winnerName = duel.winner === "A" ? nameA : duel.winner === "B" ? nameB : null;

  const side = (cls, name, pct, text) => `<div class="side ${cls}"><div class="n">${escapeHtml(name)}</div>
    <div class="p">${pct}%</div>${text ? `<div class="t">${escapeHtml(truncate(text, 140))}</div>` : ""}</div>`;

  return renderPage({
    req,
    path,
    title: finished
      ? `${winnerName ? `${winnerName} fitoi` : "Barazim"} – duel ne 5SEK`
      : `${nameA} vs ${nameB} – voto kush fiton ⚔️`,
    description: `"${truncate(duel.question_text, 100)}" · ${total} vota${finished ? " · mbaroi" : " · live"}`,
    kicker: finished ? "Duel · mbaroi" : "Duel 1v1 live",
    heading: truncate(duel.question_text || "Duel", 160),
    bodyHtml: `<div class="duel">${side("a", nameA, pctA, duel.text_a)}${side("b", nameB, pctB, duel.text_b)}</div>
      <div class="bar"><i style="width:${pctA}%;background:#FF2D6A"></i><i style="width:${pctB}%;background:#8B5CFF"></i></div>
      <div class="by">${total} vota${winnerName ? ` · fitoi ${escapeHtml(winnerName)}` : ""}</div>`,
    deepLink: `${APP_SCHEME}d/${duel.id}`,
    ctaLabel: finished ? "Shiko duelin ne 5SEK" : "Voto ne 5SEK",
  });
}

function handler(render) {
  return async (req, res) => {
    let html;
    try {
      html = await render(req);
    } catch (error) {
      console.warn("share landing fallback:", error.message);
      html = fallbackPage(req, req.path);
    }
    res.setHeader("Cache-Control", "public, max-age=60");
    res.type("html").send(html);
  };
}

module.exports = {
  answerLanding: handler((req) => renderAnswerPage(req, { challenge: false })),
  challengeLanding: handler((req) => renderAnswerPage(req, { challenge: true })),
  questionLanding: handler(renderQuestionPage),
  duelLanding: handler(renderDuelPage),
  inviteLanding: handler(async (req) => fallbackPage(req, req.path)),
  _internals: { escapeHtml, truncate, parseId },
};
