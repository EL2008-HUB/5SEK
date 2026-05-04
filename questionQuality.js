/**
 * Question Quality System
 *
 * Lightweight content scoring for cold-start question selection. This is not a
 * feed ranker. It gives new questions a content-quality prior until real
 * engagement data takes over.
 *
 * questionScore = emotional_trigger + relatability + curiosity_gap
 */

const EMOTIONAL_TERMS = [
  "remember",
  "memory",
  "moment",
  "never",
  "forever",
  "secret",
  "regret",
  "miss",
  "hurt",
  "betray",
  "trust",
  "embarrass",
  "proud",
  "afraid",
  "fear",
  "love",
  "hate",
  "last",
  "first",
  "forget",
  "kujton",
  "kujtim",
  "moment",
  "kurre",
  "sekret",
  "pend",
  "mungon",
  "frike",
  "turp",
  "krenar",
  "zhgenj",
  "besim",
  "dashur",
  "pisman",
  "hayat",
  "ask",
  "unut",
  "geheim",
  "vertrauen",
  "vergiss",
  "rimpiang",
  "segreto",
  "fiducia",
];

const RELATABLE_TERMS = [
  "you",
  "your",
  "friend",
  "family",
  "school",
  "teacher",
  "song",
  "music",
  "kid",
  "child",
  "parent",
  "dating",
  "text",
  "message",
  "social media",
  "ti",
  "ty",
  "yt",
  "jote",
  "tend",
  "shok",
  "shoq",
  "famil",
  "shkoll",
  "mesues",
  "kenge",
  "muzik",
  "prind",
  "mesazh",
  "gjenerat",
  "du",
  "dein",
  "freund",
  "familie",
  "schule",
  "lehrer",
  "lied",
  "anne",
  "baba",
  "arkadas",
  "okul",
  "canzone",
  "famiglia",
  "amico",
];

const CURIOSITY_TERMS = [
  "what",
  "which",
  "who",
  "if",
  "why",
  "how",
  "one",
  "biggest",
  "worst",
  "best",
  "first",
  "last",
  "only",
  "would",
  "could",
  "cfare",
  "cili",
  "cila",
  "kush",
  "nese",
  "pse",
  "si",
  "vetem",
  "me i",
  "me e",
  "was",
  "welche",
  "wer",
  "wenn",
  "warum",
  "hangi",
  "neden",
  "cosa",
  "quale",
  "chi",
  "se",
];

const GENERIC_PHRASES = [
  "do you like",
  "do u like",
  "a ke qejf",
  "te pelqen",
  "yes or no",
  "po apo jo",
  "what is your favorite",
  "cili eshte i preferuari",
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ß/g, "ss")
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function countMatches(text, terms) {
  return terms.reduce((count, term) => (text.includes(term) ? count + 1 : count), 0);
}

function getWordCount(text) {
  return normalizeText(text).split(/[^a-z0-9]+/i).filter(Boolean).length;
}

function scoreQuestionQuality(text) {
  const normalized = normalizeText(text);
  const wordCount = getWordCount(normalized);
  const hasQuestionMark = normalized.includes("?");
  const emotionalMatches = countMatches(normalized, EMOTIONAL_TERMS);
  const relatableMatches = countMatches(normalized, RELATABLE_TERMS);
  const curiosityMatches = countMatches(normalized, CURIOSITY_TERMS);
  const genericMatches = countMatches(normalized, GENERIC_PHRASES);

  const hasPersonalMemory =
    normalized.includes("moment") ||
    normalized.includes("memory") ||
    normalized.includes("kujt") ||
    normalized.includes("kenge") ||
    normalized.includes("song");
  const hasVulnerability =
    normalized.includes("secret") ||
    normalized.includes("sekret") ||
    normalized.includes("regret") ||
    normalized.includes("pend") ||
    normalized.includes("frike") ||
    normalized.includes("afraid");
  const hasSpecificConstraint =
    /\b(5|one|1|nje|vetem|only|last|first|kurre|never|today|sot)\b/.test(normalized);
  const hasOpenQuestion = /^(what|which|who|why|how|if|cfare|cili|cila|kush|pse|si|nese|was|wer|wenn|hangi|cosa|quale|chi)\b/.test(normalized);

  const emotionalTrigger = clamp(
    emotionalMatches * 6 +
      (hasPersonalMemory ? 8 : 0) +
      (hasVulnerability ? 8 : 0) +
      (normalized.includes("never") || normalized.includes("kurre") ? 5 : 0),
    0,
    35
  );

  const relatability = clamp(
    relatableMatches * 4 +
      (/\b(you|your|ti|ty|yt|du|dein)\b/.test(normalized) ? 8 : 0) +
      (wordCount >= 5 && wordCount <= 14 ? 8 : 0) +
      (hasQuestionMark ? 4 : 0),
    0,
    30
  );

  const curiosityGap = clamp(
    curiosityMatches * 4 +
      (hasOpenQuestion ? 7 : 0) +
      (hasSpecificConstraint ? 7 : 0) +
      (normalized.includes("would") || normalized.includes("do doje") ? 4 : 0),
    0,
    35
  );

  let frictionPenalty = 0;
  if (!hasQuestionMark) frictionPenalty += 8;
  if (wordCount < 4) frictionPenalty += 8;
  if (wordCount > 18) frictionPenalty += Math.min(18, (wordCount - 18) * 2);
  if (genericMatches > 0) frictionPenalty += 18;
  if ((normalized.match(/\?/g) || []).length > 1) frictionPenalty += 6;

  const questionScore = clamp(emotionalTrigger + relatability + curiosityGap, 0, 100);
  const adjustedScore = clamp(questionScore - frictionPenalty, 0, 100);
  const performancePrior = Math.round((adjustedScore / 3) * 10) / 10;

  return {
    emotional_trigger: emotionalTrigger,
    relatability,
    curiosity_gap: curiosityGap,
    questionScore,
    friction_penalty: frictionPenalty,
    adjustedScore,
    performance_prior: performancePrior,
    band:
      adjustedScore >= 80
        ? "elite"
        : adjustedScore >= 65
        ? "strong"
        : adjustedScore >= 45
        ? "usable"
        : "weak",
  };
}

function getQuestionQualityPrior(text) {
  return scoreQuestionQuality(text).performance_prior;
}

function withQuestionQuality(row) {
  const performanceScore =
    row.performance_score === undefined || row.performance_score === null
      ? getQuestionQualityPrior(row.text)
      : row.performance_score;

  return {
    ...row,
    performance_score: performanceScore,
  };
}

function rankQuestionTexts(texts) {
  return texts
    .map((text) => ({
      text,
      quality: scoreQuestionQuality(text),
    }))
    .sort((a, b) => b.quality.adjustedScore - a.quality.adjustedScore);
}

// ─────────────────────────────────────────────
// 🔥 FEED INTEGRATION: Question quality → feed score
// ─────────────────────────────────────────────

/**
 * Returns a 0–1 normalized score for feed ranking.
 * Used as: finalScore += questionScore * 2
 *
 * @param {string} text
 * @returns {number} 0–1
 */
function scoreForFeed(text) {
  const q = scoreQuestionQuality(text);
  // Normalize emotional (0.4) + relatable (0.3) + curiosity (0.3)
  const emotionalNorm = clamp(q.emotional_trigger / 35, 0, 1);
  const relatableNorm = clamp(q.relatability / 30, 0, 1);
  const curiosityNorm = clamp(q.curiosity_gap / 35, 0, 1);
  return emotionalNorm * 0.4 + relatableNorm * 0.3 + curiosityNorm * 0.3;
}

/**
 * Returns a boost multiplier for exploration.
 * If questionScore > 0.6 → boost ×2.
 *
 * @param {string} text
 * @returns {number} multiplier (1 or 2)
 */
function scoreForExploration(text) {
  const score = scoreForFeed(text);
  return score > 0.6 ? 2 : 1;
}

/**
 * Get the top N questions ranked by shareability.
 * "Shareable" = high curiosity + high emotional + concise.
 *
 * @param {object} db - knex instance
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function getTopShareableQuestions(db, limit = 30) {
  const questions = await db("questions")
    .whereNull("deleted_at")
    .select("id", "text", "category", "country", "performance_score")
    .orderBy("performance_score", "desc")
    .limit(200);

  return questions
    .map((q) => {
      const quality = scoreQuestionQuality(q.text);
      const feedScore = scoreForFeed(q.text);
      // Shareable = high quality + good length (5-12 words) + has question mark
      const wordCount = getWordCount(q.text);
      const lengthBonus = wordCount >= 5 && wordCount <= 12 ? 0.15 : 0;
      const shareScore = feedScore + lengthBonus;
      return {
        ...q,
        quality,
        feed_score: feedScore,
        share_score: shareScore,
        exploration_boost: scoreForExploration(q.text),
      };
    })
    .sort((a, b) => b.share_score - a.share_score)
    .slice(0, limit);
}

module.exports = {
  scoreQuestionQuality,
  getQuestionQualityPrior,
  withQuestionQuality,
  rankQuestionTexts,
  scoreForFeed,
  scoreForExploration,
  getTopShareableQuestions,
};
