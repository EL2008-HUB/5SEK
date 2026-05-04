/**
 * Pattern Extractor — learns WHY questions work
 *
 * Analyses top-performing questions and extracts structural patterns:
 *   - format (A vs B, direct, "what if", personal)
 *   - length (short < 6 words, medium 6-9, long 10+)
 *   - tone (funny, provocative, emotional, logical)
 *   - topic (personal, opinion, imagination, food, money, funny)
 *   - language features (contains "or", starts with "what", etc.)
 *
 * These patterns are stored in question_patterns and fed to AI prompts.
 */

// ─────────────────────────────────────────────
// Pattern detection rules
// ─────────────────────────────────────────────

function extractPatterns(questionText) {
  const text = questionText.toLowerCase().trim();
  const words = text.split(/\s+/);
  const patterns = [];

  // ── FORMAT patterns ────────────────────────
  if (
    text.includes(" or ") ||
    text.includes(" ose ") ||
    text.includes(" oder ") ||
    text.includes(" o ") ||
    text.includes(" mı ") ||
    text.includes(" mi ")
  ) {
    patterns.push({ type: "format", value: "a_vs_b" });
  }

  if (text.startsWith("what if") || text.startsWith("nëse") || text.startsWith("wenn")) {
    patterns.push({ type: "format", value: "what_if" });
  }

  if (
    text.startsWith("who") ||
    text.startsWith("kush") ||
    text.startsWith("kë") ||
    text.startsWith("wer")
  ) {
    patterns.push({ type: "format", value: "who_question" });
  }

  if (
    text.includes("you") ||
    text.includes("ti ") ||
    text.includes("your") ||
    text.includes("yt ") ||
    text.includes("tënd") ||
    text.includes("du ") ||
    text.includes("dein")
  ) {
    patterns.push({ type: "format", value: "direct_personal" });
  }

  if (text.includes("never") || text.includes("kurrë") || text.includes("nie")) {
    patterns.push({ type: "format", value: "never_ever" });
  }

  // ── LENGTH patterns ────────────────────────
  if (words.length <= 5) {
    patterns.push({ type: "length", value: "ultra_short" });
  } else if (words.length <= 8) {
    patterns.push({ type: "length", value: "short" });
  } else if (words.length <= 12) {
    patterns.push({ type: "length", value: "medium" });
  } else {
    patterns.push({ type: "length", value: "long" });
  }

  // ── TONE patterns ─────────────────────────
  if (
    text.includes("embarrass") ||
    text.includes("worst") ||
    text.includes("dumb") ||
    text.includes("stupid") ||
    text.includes("çudit") ||
    text.includes("urren") ||
    text.includes("zhgënjy")
  ) {
    patterns.push({ type: "tone", value: "provocative" });
  }

  if (
    text.includes("?!") ||
    text.includes("🔥") ||
    text.includes("million") ||
    text.includes("milion") ||
    text.includes("forever") ||
    text.includes("përgjithmonë")
  ) {
    patterns.push({ type: "tone", value: "high_stakes" });
  }

  if (
    text.includes("secret") ||
    text.includes("fsheht") ||
    text.includes("geheim") ||
    text.includes("segreto")
  ) {
    patterns.push({ type: "tone", value: "secretive" });
  }

  // ── TOPIC patterns ────────────────────────
  const topicKeywords = {
    money: ["money", "million", "euro", "dollar", "para", "milion", "geld"],
    food: ["pizza", "burger", "eat", "food", "meal", "pasta", "ushqim", "essen"],
    relationship: ["love", "date", "relationship", "dashuri", "liebe", "partner"],
    family: ["mom", "dad", "parent", "nënë", "baba", "mutter", "vater", "anne"],
    career: ["job", "work", "career", "punë", "karriere", "arbeit"],
    travel: ["travel", "country", "udhëto", "vend", "reisen"],
    superpower: ["superpower", "power", "super", "fuqi"],
  };

  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some((kw) => text.includes(kw))) {
      patterns.push({ type: "topic", value: topic });
    }
  }

  return patterns;
}

// ─────────────────────────────────────────────
// Analyse and store patterns from top questions
// ─────────────────────────────────────────────

/**
 * Run pattern analysis on all questions with scores.
 * Updates question_patterns table with aggregated pattern stats.
 * @param {import('knex').Knex} db
 */
async function analyseAllPatterns(db) {
  const questions = await db("questions")
    .where("performance_score", ">", 0)
    .select("id", "text", "performance_score", "country", "category");

  // Aggregate: pattern → { totalScore, count, countries }
  const patternAgg = {};

  for (const q of questions) {
    const patterns = extractPatterns(q.text);
    const country = q.country || "GLOBAL";

    for (const p of patterns) {
      const key = `${p.type}:${p.value}:${country}`;
      if (!patternAgg[key]) {
        patternAgg[key] = {
          type: p.type,
          value: p.value,
          country,
          totalScore: 0,
          count: 0,
        };
      }
      patternAgg[key].totalScore += q.performance_score;
      patternAgg[key].count += 1;
    }
  }

  // Upsert into question_patterns
  for (const agg of Object.values(patternAgg)) {
    const avgScore = Math.round((agg.totalScore / agg.count) * 10) / 10;
    // Success rate = fraction of questions with this pattern that score above median
    const medianScore = questions.length > 0
      ? questions.sort((a, b) => a.performance_score - b.performance_score)[
          Math.floor(questions.length / 2)
        ].performance_score
      : 0;

    const successfulCount = questions.filter((q) => {
      const qPatterns = extractPatterns(q.text);
      return (
        qPatterns.some((p) => p.type === agg.type && p.value === agg.value) &&
        q.performance_score > medianScore &&
        (q.country === agg.country || agg.country === "GLOBAL")
      );
    }).length;

    const successRate =
      agg.count > 0 ? Math.round((successfulCount / agg.count) * 100) / 100 : 0;

    const existing = await db("question_patterns")
      .where({
        pattern_type: agg.type,
        pattern_value: agg.value,
        country: agg.country,
      })
      .first();

    if (existing) {
      await db("question_patterns")
        .where({ id: existing.id })
        .update({
          avg_score: avgScore,
          sample_count: agg.count,
          success_rate: successRate,
          updated_at: db.fn.now(),
        });
    } else {
      await db("question_patterns").insert({
        pattern_type: agg.type,
        pattern_value: agg.value,
        country: agg.country,
        avg_score: avgScore,
        sample_count: agg.count,
        success_rate: successRate,
      });
    }
  }

  console.log(
    `🧠 Analysed ${questions.length} questions → ${Object.keys(patternAgg).length} patterns`
  );
}

/**
 * Get top-performing patterns for a country.
 * Used by AI prompt builder to guide generation.
 * @param {import('knex').Knex} db
 * @param {string} country
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function getTopPatterns(db, country = "GLOBAL", limit = 10) {
  return db("question_patterns")
    .whereIn("country", [country, "GLOBAL"])
    .where("sample_count", ">=", 2) // need at least 2 data points
    .orderBy("success_rate", "desc")
    .orderBy("avg_score", "desc")
    .limit(limit)
    .select("*");
}

/**
 * Format patterns into a human-readable string for AI prompts.
 * @param {Array} patterns
 * @returns {string}
 */
function formatPatternsForPrompt(patterns) {
  if (!patterns.length) return "";

  const PATTERN_LABELS = {
    "format:a_vs_b": "A vs B choice format (e.g. 'Pizza or Burger?')",
    "format:what_if": "Hypothetical 'What if...' scenario",
    "format:who_question": "Direct 'Who...' question",
    "format:direct_personal": "Second-person direct address ('you/your')",
    "format:never_ever": "'Never/ever' dramatic framing",
    "length:ultra_short": "Ultra-short (≤5 words)",
    "length:short": "Short (6-8 words)",
    "length:medium": "Medium length (9-12 words)",
    "tone:provocative": "Provocative/edgy tone",
    "tone:high_stakes": "High-stakes dramatic framing",
    "tone:secretive": "Secretive/confession tone",
    "topic:money": "Money/wealth topic",
    "topic:food": "Food-related topic",
    "topic:relationship": "Relationship/love topic",
    "topic:family": "Family topic",
    "topic:superpower": "Superpower/fantasy topic",
  };

  const lines = patterns.map((p) => {
    const key = `${p.pattern_type}:${p.pattern_value}`;
    const label = PATTERN_LABELS[key] || `${p.pattern_type}: ${p.pattern_value}`;
    const pct = Math.round(p.success_rate * 100);
    return `- ${label} (${pct}% success, avg score: ${p.avg_score})`;
  });

  return `\nTop-performing patterns in this market:\n${lines.join("\n")}`;
}

module.exports = {
  extractPatterns,
  analyseAllPatterns,
  getTopPatterns,
  formatPatternsForPrompt,
};
