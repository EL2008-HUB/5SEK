/**
 * AI Service — OpenRouter Integration
 *
 * Uses OpenRouter API to generate viral questions with country-specific
 * cultural profiles and pattern-aware prompts.
 */
const { getTopPatterns, formatPatternsForPrompt } = require("./patternExtractor");

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

// Fallback chain — if one model is rate-limited, try the next
const AI_MODELS = [
  "google/gemma-4-31b-it:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "openai/gpt-oss-120b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
];
let aiAuthFailed = false;
let aiAuthFailureMessage = null;

if (!OPENROUTER_API_KEY) {
  console.warn("⚠️  OPENROUTER_API_KEY not set — AI question generation will be disabled");
} else {
  console.log("✅ OpenRouter AI configured (models: " + AI_MODELS.length + " fallbacks)");
}

// ─────────────────────────────────────────────
// OpenRouter API call helper with model fallback
// ─────────────────────────────────────────────

async function callOpenRouter(prompt) {
  if (!OPENROUTER_API_KEY) return null;
  if (aiAuthFailed) {
    throw new Error(aiAuthFailureMessage || "OpenRouter authentication failed");
  }

  for (const model of AI_MODELS) {
    try {
      const response = await fetch(OPENROUTER_BASE_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://5sek.app",
          "X-Title": "5SEK",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.9,
          max_tokens: 500,
        }),
      });

      if (response.status === 429) {
        console.log(`   ⏳ ${model} rate-limited, trying next...`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        await response.text();
        aiAuthFailed = true;
        aiAuthFailureMessage = `OpenRouter authentication failed (${response.status})`;
        console.log(`   auth error on ${model} (${response.status}) - disabling AI calls until restart`);
        throw new Error(aiAuthFailureMessage);
      }
      if (!response.ok) {
        await response.text();
        console.log(`   ⚠️ ${model} error (${response.status}), trying next...`);
        continue;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim() || null;
      if (content) {
        console.log(`   ✅ AI generated via ${model}`);
        return content;
      }
    } catch (err) {
      if (aiAuthFailed) {
        throw err;
      }
      console.log(`   ⚠️ ${model} failed: ${err.message}`);
      continue;
    }
  }

  throw new Error("All AI models failed or rate-limited");
}

async function moderatePublicContent({
  content,
  answerType = "text",
  responseTime = null,
} = {}) {
  const normalizedContent = String(content || "").trim();
  if (!normalizedContent || !OPENROUTER_API_KEY) {
    return null;
  }

  const prompt = `Is this user response acceptable for a public 5-second social app?

Answer type: ${String(answerType || "text")}
Response time seconds: ${responseTime == null ? "unknown" : Number(responseTime)}
User response:
"""${normalizedContent}"""

Rules:
- No hate speech
- No sexual content
- No spam or nonsense
- Must be a real answer

Answer ONLY:
ALLOW or REJECT`;

  const result = await callOpenRouter(prompt);
  if (!result) {
    return null;
  }

  const normalizedResult = result.trim().toUpperCase();
  if (normalizedResult.includes("REJECT")) return "REJECT";
  if (normalizedResult.includes("ALLOW")) return "ALLOW";
  return null;
}

// ─────────────────────────────────────────────
// Country culture hints — used to bias AI prompts
// ─────────────────────────────────────────────
const COUNTRY_CULTURE = {
  AL: {
    name: "Albania",
    style: "personal, direct, slightly provocative, emotional, gossip-style",
    language: "Albanian (Shqip)",
    examples: [
      "Kë urren pa arsye?",
      "Çfarë do të bëje nëse do të ishe i padukshëm për 1 ditë?",
      "Cili është mendimi yt më i çuditshëm?",
      "Kush të ka zhgënjyer më shumë në jetë?",
      "Çfarë nuk do ta falesje kurrë?",
      "Pizza apo byrek — vetëm njërin mund ta hash?",
      "Çfarë do bëje me 1 milion euro tash?",
      "Cili është sekreti yt më i madh?",
    ],
  },
  US: {
    name: "United States",
    style: "funny, opinion-based, pop culture, meme-worthy",
    language: "English",
    examples: [
      "iPhone or Android — pick one forever?",
      "What's your most unpopular opinion?",
      "What would your last meal on Earth be?",
    ],
  },
  DE: {
    name: "Germany",
    style: "logical, opinion-based, serious but engaging, thought-provoking",
    language: "German (Deutsch)",
    examples: [
      "Was würdest du mit einer Million Euro machen?",
      "Welche Regel würdest du abschaffen?",
      "Was ist dein größtes Geheimnis?",
    ],
  },
  XK: {
    name: "Kosovo",
    style: "personal, direct, slightly provocative, emotional, gossip-style",
    language: "Albanian (Shqip)",
    examples: [
      "Kush të ka lënë përshtypje më shumë në jetë?",
      "Çfarë do bëje me 10 mijë euro tash?",
      "Cili mësues i shkollës të ka lënë përshtypje?",
      "Çka nuk e pelqen te gjenerata e re?",
      "Ku do të jetoje nëse larg Kosovës?",
      "Kë do e thirrshe nëse ke vetem 1 telefonatë?",
    ],
  },
  UK: {
    name: "United Kingdom",
    style: "witty, dry humor, self-deprecating, sarcastic",
    language: "English",
    examples: [
      "Tea or coffee — you can only have one?",
      "What's the most British thing you've ever done?",
      "What would you do if you were PM for a day?",
    ],
  },
  TR: {
    name: "Turkey",
    style: "emotional, family-oriented, passionate, direct",
    language: "Turkish (Türkçe)",
    examples: [
      "Hayatta en çok neyi pişman oldun?",
      "Annenle baban seni anlamiyor mu?",
      "Eğer bir süper gücün olsaydı ne olurdu?",
    ],
  },
  IT: {
    name: "Italy",
    style: "passionate, food-related, family, dramatic",
    language: "Italian (Italiano)",
    examples: [
      "Pizza o pasta — puoi mangiare solo uno per sempre?",
      "Qual è il tuo segreto più grande?",
      "Cosa faresti con un milione di euro?",
    ],
  },
  GLOBAL: {
    name: "Global",
    style: "universal, relatable, instantly answerable",
    language: "English",
    examples: [
      "What would you do with $1 million right now?",
      "If you could master one skill instantly, what?",
      "What's your most embarrassing moment?",
    ],
  },
};

/**
 * Build a learning-aware, country-specific prompt using top-performing
 * questions from the DB for that country.
 */
async function buildSmartPrompt(db = null, preferredCategory = null, country = "GLOBAL") {
  const culture = COUNTRY_CULTURE[country] || COUNTRY_CULTURE.GLOBAL;
  let examples = [];
  let patternHints = "";

  if (db) {
    try {
      const query = db("questions")
        .where("performance_score", ">", 0)
        .where("country", country)  // ONLY this country's questions, not GLOBAL
        .orderBy("performance_score", "desc")
        .limit(10)
        .select("text", "category", "performance_score", "country");

      if (preferredCategory) {
        query.where("category", preferredCategory);
      }

      const topQuestions = await query;
      examples = topQuestions.map((q) => `- ${q.text}`);

      // 🧠 Get learned patterns for smarter generation
      try {
        const patterns = await getTopPatterns(db, country, 8);
        patternHints = formatPatternsForPrompt(patterns);
      } catch (_) {}
    } catch (_) {
      // DB not available — use culture defaults
    }
  }

  // If no DB examples, use culture-specific defaults
  if (examples.length === 0) {
    examples = culture.examples.map((ex) => `- ${ex}`);
  }

  const categoryHint = preferredCategory
    ? `\nBias toward the "${preferredCategory}" category since it performs best.`
    : "";

  return `You are generating questions for a viral video app in ${culture.name}.
Cultural style: ${culture.style}

⚠️ CRITICAL: You MUST write the question ONLY in ${culture.language}. 
Do NOT use English or any other language. The question MUST be in ${culture.language}.

These questions performed very well in ${culture.name}:
${examples.join("\n")}
${patternHints}

Generate ONE similar question that:
- Is maximum 10 words
- Is ONLY in ${culture.language} (NOT English)
- Is instantly answerable in 5 seconds (no thinking needed)
- Matches the cultural style: ${culture.style}
- Uses the top-performing patterns listed above
- Is provocative, personal, or creates debate
- Feels natural and relatable for people in ${culture.name}
- Sounds like something friends would ask each other
- No explanations, no numbering, no quotes — just the question${categoryHint}`;
}

/**
 * Generate a single short viral question, country-aware.
 */
async function generateQuestion(db = null, preferredCategory = null, country = "GLOBAL") {
  if (!OPENROUTER_API_KEY) return null;

  const prompt = await buildSmartPrompt(db, preferredCategory, country);
  const result = await callOpenRouter(prompt);
  if (!result) return null;

  return result.trim().replace(/^["']|["']$/g, "");
}

/**
 * Generate multiple unique questions for a specific country.
 */
async function generateQuestions(count = 5, db = null, preferredCategory = null, country = "GLOBAL") {
  if (!OPENROUTER_API_KEY) return [];

  const safeCount = Math.min(Math.max(1, count), 10);
  const culture = COUNTRY_CULTURE[country] || COUNTRY_CULTURE.GLOBAL;
  let examples = [];

  if (db) {
    try {
      const topQuestions = await db("questions")
        .where("performance_score", ">", 0)
        .whereIn("country", [country, "GLOBAL"])
        .orderBy("performance_score", "desc")
        .limit(10)
        .select("text");
      examples = topQuestions.map((q) => `- ${q.text}`);
    } catch (_) {}
  }

  if (examples.length === 0) {
    examples = culture.examples.map((ex) => `- ${ex}`);
  }

  const categoryHint = preferredCategory
    ? `\nBias toward the "${preferredCategory}" category.`
    : "";

  const prompt = `You are generating questions for users in ${culture.name}.
Cultural style: ${culture.style}
Language: ${culture.language}

Generate exactly ${safeCount} short viral questions for a social video app where users answer in 5 seconds.
Rules:
- Maximum 10 words each
- All in ${culture.language}
- Must be instantly answerable (no research needed)
- Match the cultural style: ${culture.style}
- Slightly provocative, funny, or thought-provoking
- Each question on its own line
- No numbering, no bullets, no quotes, no explanations
- All different topics${categoryHint}

These questions performed well in ${culture.name} — match their style:
${examples.join("\n")}`;

  const result = await callOpenRouter(prompt);
  if (!result) return [];

  return result
    .split("\n")
    .map((line) => line.trim().replace(/^["'\-\d\.]+\s*/, "").replace(/["']$/, ""))
    .filter((line) => line.length > 5 && line.includes("?"))
    .slice(0, safeCount);
}

/**
 * Get the list of supported country codes and their culture info.
 */
function getSupportedCountries() {
  return Object.entries(COUNTRY_CULTURE).map(([code, info]) => ({
    code,
    name: info.name,
    language: info.language,
    style: info.style,
  }));
}

function isAIEnabled() {
  return Boolean(OPENROUTER_API_KEY) && !aiAuthFailed;
}

module.exports = {
  moderatePublicContent,
  generateQuestion,
  generateQuestions,
  getSupportedCountries,
  isAIEnabled,
  COUNTRY_CULTURE,
};
