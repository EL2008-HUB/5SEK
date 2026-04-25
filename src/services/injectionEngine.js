/**
 * Question Injection Engine
 *
 * Runs on a timer (every hour) and automatically keeps the question pool
 * fresh by:
 *
 *  1. AI generation — generates new country-specific questions using
 *     pattern-aware prompts
 *  2. Cross-country push — detects viral questions in one country and
 *     clones them to others
 *  3. Hot detection — marks questions as 🔥 if they spike fast
 *  4. Score recalculation — keeps all scores fresh
 *  5. Pattern analysis — learns what's working
 */

const { generateQuestions, isAIEnabled } = require("./aiService");
const {
  recalculateAllScores,
  checkCrossCountryPotential,
  getOrCreateCountryStat,
} = require("./viralScoring");
const { analyseAllPatterns, getTopPatterns, formatPatternsForPrompt } = require("./patternExtractor");

const ACTIVE_COUNTRIES = ["AL", "US", "DE", "XK", "UK", "TR", "IT"];
const MIN_QUESTIONS_PER_COUNTRY = 15;
const CROSS_COUNTRY_THRESHOLD = 80; // lower = more aggressive
const HOT_ANSWERS_THRESHOLD = 10;   // answers within timeframe to = hot
const HOT_TIME_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function calculateQuestionsNeeded(currentCount) {
  const targetPoolSize = MIN_QUESTIONS_PER_COUNTRY * 3;
  return Math.min(5, Math.max(1, targetPoolSize - currentCount));
}

/**
 * Run the full injection cycle.
 * @param {import('knex').Knex} db
 */
async function runInjectionCycle(db) {
  const startTime = Date.now();
  console.log("\n🔄 ═══════════════════════════════════════════");
  console.log("🔄 INJECTION ENGINE — Starting cycle");
  console.log("🔄 ═══════════════════════════════════════════\n");

  let totalInjected = 0;

  try {
    // ── STEP 1: Recalculate all scores ────────────
    console.log("📊 Step 1: Recalculating scores...");
    await recalculateAllScores(db);

    // ── STEP 2: Fast viral / hot detection ────────
    console.log("🔥 Step 2: Detecting hot questions...");
    const hotCount = await detectHotQuestions(db);
    console.log(`   → ${hotCount} questions marked as HOT`);

    // ── STEP 3: Pattern analysis ──────────────────
    console.log("🧠 Step 3: Analysing patterns...");
    await analyseAllPatterns(db);

    // ── STEP 4: AI question injection ─────────────
    // Only inject for MAX_COUNTRIES_PER_CYCLE countries per cycle
    // to avoid burning rate limits on free tier
    console.log("🤖 Step 4: AI question injection...");
    const MAX_COUNTRIES_PER_CYCLE = 2;
    const DELAY_BETWEEN_COUNTRIES_MS = 15000; // 15s between countries

    // Round-robin: pick next countries based on cycle count
    const cycleCount = await db("injection_log").where({ source: "cycle" }).count("id as c").first();
    const offset = (parseInt(cycleCount?.c) || 0) % ACTIVE_COUNTRIES.length;
    const countriesThisCycle = [];
    for (let i = 0; i < MAX_COUNTRIES_PER_CYCLE; i++) {
      countriesThisCycle.push(ACTIVE_COUNTRIES[(offset + i) % ACTIVE_COUNTRIES.length]);
    }
    console.log(`   📍 This cycle: ${countriesThisCycle.join(", ")} (round-robin)`);

    for (let i = 0; i < countriesThisCycle.length; i++) {
      if (i > 0) {
        console.log(`   ⏳ Waiting ${DELAY_BETWEEN_COUNTRIES_MS / 1000}s before next country...`);
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_COUNTRIES_MS));
      }
      const injected = await injectQuestionsForCountry(db, countriesThisCycle[i]);
      totalInjected += injected;
    }

    // ── STEP 5: Cross-country viral push ──────────
    console.log("🌍 Step 5: Cross-country viral push...");
    const crossPushed = await runCrossCountryPush(db);
    totalInjected += crossPushed;

    // ── STEP 6: Clean up expired hot flags ────────
    console.log("🧹 Step 6: Cleaning stale hot flags...");
    await cleanStaleHotFlags(db);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Injection cycle complete: ${totalInjected} new questions in ${elapsed}s`);

    // Log the cycle
    await db("injection_log").insert({
      source: "cycle",
      country: "ALL",
      questions_added: totalInjected,
      details: JSON.stringify({
        hot_detected: hotCount,
        cross_pushed: crossPushed,
        elapsed_seconds: parseFloat(elapsed),
      }),
    });
  } catch (error) {
    console.error("❌ Injection cycle error:", error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// 🔥 FAST VIRAL DETECTION (Early Spike)
// ─────────────────────────────────────────────

/**
 * Detect questions that are spiking — mark them as hot.
 * Criteria: 10+ answers in the last hour AND not already hot.
 * @param {import('knex').Knex} db
 * @returns {Promise<number>} count of newly hot questions
 */
async function detectHotQuestions(db) {
  const oneHourAgo = new Date(Date.now() - HOT_TIME_WINDOW_MS).toISOString();

  // Find questions with high recent answer velocity
  const spikingQuestions = await db("answers")
    .where("created_at", ">=", oneHourAgo)
    .groupBy("question_id")
    .havingRaw("COUNT(id) >= ?", [HOT_ANSWERS_THRESHOLD])
    .select("question_id")
    .count("id as recent_count");

  let hotCount = 0;

  for (const row of spikingQuestions) {
    const question = await db("questions")
      .where({ id: row.question_id })
      .first();

    if (question && !question.is_hot) {
      await db("questions")
        .where({ id: row.question_id })
        .update({
          is_hot: true,
          hot_detected_at: db.fn.now(),
        });
      hotCount++;
      console.log(
        `   🔥 HOT: "${question.text}" (${row.recent_count} answers in 1h)`
      );
    }
  }

  return hotCount;
}

/**
 * Clear hot flags older than 24 hours.
 * @param {import('knex').Knex} db
 */
async function cleanStaleHotFlags(db) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const cleaned = await db("questions")
    .where({ is_hot: true })
    .where("hot_detected_at", "<", oneDayAgo)
    .update({ is_hot: false, hot_detected_at: null });

  if (cleaned > 0) {
    console.log(`   🧹 Cleared ${cleaned} stale hot flags`);
  }
}

// ─────────────────────────────────────────────
// 🤖 AI QUESTION INJECTION
// ─────────────────────────────────────────────

/**
 * Check if a country needs more questions and generate them.
 * @param {import('knex').Knex} db
 * @param {string} country
 * @returns {Promise<number>} count of questions injected
 */
async function injectQuestionsForCountry(db, country) {
  if (!isAIEnabled()) {
    console.log(`   [${country}] AI disabled or auth failed, skipping injection`);
    return 0;
  }

  // Count existing questions for this country
  const countResult = await db("questions")
    .whereIn("country", [country, "GLOBAL"])
    .count("id as count")
    .first();

  const currentCount = parseInt(countResult.count) || 0;
  const targetPoolSize = MIN_QUESTIONS_PER_COUNTRY * 3;

  if (currentCount >= targetPoolSize) {
    // Enough questions, but still generate 1-2 to keep things fresh
    // Only if AI is available
    try {
      const questions = await generateQuestions(2, db, null, country);
      if (questions.length > 0) {
        // Get pattern insights for category assignment
        const patterns = await getTopPatterns(db, country, 5);
        const topPattern = patterns[0];

        const inserted = await db("questions")
          .insert(
            questions.map((text) => ({
              text,
              country,
              source: "ai",
              category: topPattern?.pattern_value || "general",
            }))
          )
          .returning("id");

        console.log(`   [${country}] +${inserted.length} fresh questions (pool: ${currentCount})`);
        return inserted.length;
      }
    } catch (_) {}
    return 0;
  }

  // Pool is low — generate more
  const needed = calculateQuestionsNeeded(currentCount);
  console.log(`   [${country}] Pool low (${currentCount}/${targetPoolSize}), generating ${needed}...`);

  try {
    const questions = await generateQuestions(needed, db, null, country);
    if (questions.length > 0) {
      const inserted = await db("questions")
        .insert(
          questions.map((text) => ({
            text,
            country,
            source: "ai",
          }))
        )
        .returning("id");

      await db("injection_log").insert({
        source: "ai",
        country,
        questions_added: inserted.length,
        details: JSON.stringify({ reason: "low_pool", pool_size: currentCount }),
      });

      console.log(`   [${country}] +${inserted.length} AI questions injected`);
      return inserted.length;
    }
  } catch (error) {
    console.error(`   [${country}] AI injection failed:`, error.message);
  }

  return 0;
}

// ─────────────────────────────────────────────
// 🌍 AGGRESSIVE CROSS-COUNTRY PUSH
// ─────────────────────────────────────────────

/**
 * Find questions that are viral in one country and push them to others.
 * @param {import('knex').Knex} db
 * @returns {Promise<number>}
 */
async function runCrossCountryPush(db) {
  let pushed = 0;

  // Find all questions with high scores in any country
  const hotStats = await db("question_stats")
    .where("score", ">", CROSS_COUNTRY_THRESHOLD)
    .where("country", "!=", "GLOBAL")
    .orderBy("score", "desc")
    .limit(20)
    .select("*");

  for (const stat of hotStats) {
    const question = await db("questions")
      .where({ id: stat.question_id })
      .first();

    if (!question) continue;

    // Find countries where this question doesn't have stats yet
    const existingCountries = await db("question_stats")
      .where({ question_id: stat.question_id })
      .pluck("country");

    const targetCountries = ACTIVE_COUNTRIES.filter(
      (c) => !existingCountries.includes(c) && c !== stat.country
    );

    if (targetCountries.length === 0) continue;

    // Push to up to 3 new countries
    const pushTo = targetCountries.slice(0, 3);

    for (const targetCountry of pushTo) {
      // Create stats row for the new country (so it appears in their feed)
      await getOrCreateCountryStat(db, stat.question_id, targetCountry);

      // If the question is country-specific (non-GLOBAL), clone it with GLOBAL tag
      // so it can be served in other countries
      if (question.country !== "GLOBAL" && question.country !== targetCountry) {
        // Just update the question to GLOBAL so it's available everywhere
        // (alternatively could clone — but GLOBAL is simpler)
        await db("questions")
          .where({ id: question.id })
          .update({ country: "GLOBAL" });
      }

      pushed++;
    }

    if (pushTo.length > 0) {
      console.log(
        `   🌍 "${question.text.substring(0, 40)}..." (score: ${stat.score} in ${stat.country}) → pushed to ${pushTo.join(", ")}`
      );

      await db("injection_log").insert({
        source: "cross_country",
        country: stat.country,
        questions_added: pushTo.length,
        details: JSON.stringify({
          question_id: stat.question_id,
          score: stat.score,
          from_country: stat.country,
          to_countries: pushTo,
        }),
      });
    }
  }

  return pushed;
}

// ─────────────────────────────────────────────
// 📊 Get injection stats (for admin dashboard)
// ─────────────────────────────────────────────

/**
 * Get recent injection activity.
 * @param {import('knex').Knex} db
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function getInjectionStats(db, limit = 20) {
  return db("injection_log")
    .orderBy("created_at", "desc")
    .limit(limit)
    .select("*");
}

/**
 * Get current hot questions.
 * @param {import('knex').Knex} db
 * @param {string|null} country
 * @returns {Promise<Array>}
 */
async function getHotQuestions(db, country = null) {
  let query = db("questions")
    .where({ is_hot: true })
    .orderBy("hot_detected_at", "desc")
    .select("*");

  if (country) {
    query = query.whereIn("country", [country, "GLOBAL"]);
  }

  return query;
}

module.exports = {
  calculateQuestionsNeeded,
  runInjectionCycle,
  detectHotQuestions,
  cleanStaleHotFlags,
  injectQuestionsForCountry,
  runCrossCountryPush,
  getInjectionStats,
  getHotQuestions,
};
