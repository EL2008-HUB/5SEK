const { generateQuestion, generateQuestions, getSupportedCountries } = require("./aiService");
const { analyseAllPatterns } = require("./patternExtractor");
const { aggregateDailyAnalytics } = require("./analyticsAggregationService");
const {
  cleanupHiddenMedia,
  cleanupOrphanedSignedUploads,
  cleanupStaleRateLimits,
} = require("./cleanupService");
const { createDatabaseBackoffController } = require("./dbResilience");
const { handlePushDeliveryJob } = require("./pushNotificationService");

const JOB_TYPES = {
  AI_GENERATE_DAILY_QUESTION: "ai_generate_daily_question",
  AI_GENERATE_QUESTIONS_BULK: "ai_generate_questions_bulk",
  PATTERN_EXTRACTION: "pattern_extraction",
  MEDIA_CLEANUP: "media_cleanup",
  RATE_LIMIT_CLEANUP: "rate_limit_cleanup",
  ANALYTICS_AGGREGATION: "analytics_aggregation",
  PUSH_NOTIFICATION_DELIVERY: "push_notification_delivery",
};

function safeParseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

async function queueBackgroundJob(db, {
  jobType,
  payload = null,
  runAt = null,
  maxAttempts = 5,
  dedupeKey = null,
}) {
  const insertPayload = {
    job_type: jobType,
    payload,
    run_at: runAt || db.fn.now(),
    max_attempts: maxAttempts,
    dedupe_key: dedupeKey,
  };

  let row = null;
  if (dedupeKey) {
    const inserted = await db("background_jobs")
      .insert(insertPayload)
      .onConflict("dedupe_key")
      .ignore()
      .returning("*");
    row = inserted[0] || null;
    if (!row) {
      row = await db("background_jobs").where({ dedupe_key: dedupeKey }).first();
    }
  } else {
    [row] = await db("background_jobs")
      .insert(insertPayload)
      .returning("*");
  }

  return row;
}

async function getBackgroundJob(db, id) {
  const row = await db("background_jobs").where({ id }).first();
  if (!row) return null;
  return {
    ...row,
    payload: safeParseJson(row.payload),
    result: safeParseJson(row.result),
  };
}

async function handleAIDailyQuestionJob(db, payload = {}) {
  const country = String(payload.country || "GLOBAL").toUpperCase();
  const today = new Date().toISOString().slice(0, 10);

  const existing = await db("questions")
    .where({ is_daily: true, active_date: today, country })
    .first();
  if (existing) {
    return {
      source: "cache",
      question_id: existing.id,
      country,
    };
  }

  const text = await generateQuestion(db, payload.preferredCategory || null, country);
  if (!text) {
    throw new Error("ai_not_configured");
  }

  await db("questions")
    .where({ active_date: today, country })
    .update({ is_daily: false, active_date: null });

  const [question] = await db("questions")
    .insert({
      text,
      is_daily: true,
      active_date: today,
      country,
      category: payload.preferredCategory || "general",
      source: "ai",
    })
    .returning("*");

  return {
    source: "ai",
    question_id: question.id,
    country,
  };
}

async function handleAIBulkQuestionsJob(db, payload = {}) {
  const country = String(payload.country || "GLOBAL").toUpperCase();
  const count = Math.min(Math.max(Number(payload.count || 5), 1), 20);
  const questions = await generateQuestions(count, db, payload.preferredCategory || null, country);
  if (!questions.length) {
    throw new Error("ai_not_configured");
  }

  const inserted = await db("questions")
    .insert(
      questions.map((text) => ({
        text,
        country,
        source: "ai",
        category: payload.preferredCategory || "general",
      }))
    )
    .returning(["id", "text", "country", "created_at"]);

  return {
    generated: inserted.length,
    question_ids: inserted.map((row) => row.id),
    country,
  };
}

async function runJobHandler(db, job) {
  const payload = safeParseJson(job.payload) || {};

  switch (job.job_type) {
    case JOB_TYPES.AI_GENERATE_DAILY_QUESTION:
      return handleAIDailyQuestionJob(db, payload);
    case JOB_TYPES.AI_GENERATE_QUESTIONS_BULK:
      return handleAIBulkQuestionsJob(db, payload);
    case JOB_TYPES.PATTERN_EXTRACTION:
      await analyseAllPatterns(db);
      return { ok: true };
    case JOB_TYPES.MEDIA_CLEANUP: {
      const hiddenMedia = await cleanupHiddenMedia(db, payload);
      const orphaned = await cleanupOrphanedSignedUploads(db, payload);
      return { hidden_media: hiddenMedia, orphaned_uploads: orphaned };
    }
    case JOB_TYPES.RATE_LIMIT_CLEANUP:
      return cleanupStaleRateLimits(db, payload);
    case JOB_TYPES.ANALYTICS_AGGREGATION:
      return aggregateDailyAnalytics(db, payload);
    case JOB_TYPES.PUSH_NOTIFICATION_DELIVERY:
      return handlePushDeliveryJob(db, job, payload);
    default:
      throw new Error(`unknown_job_type:${job.job_type}`);
  }
}

async function processDueJobs(db, {
  limit = Number(process.env.JOB_PROCESSING_BATCH_SIZE || 5),
  workerName = process.env.JOB_WORKER_NAME || `pid-${process.pid}`,
} = {}) {
  const nowIso = new Date().toISOString();
  const candidates = await db("background_jobs")
    .where("status", "queued")
    .where("run_at", "<=", nowIso)
    .orderBy("run_at", "asc")
    .limit(limit);

  let processed = 0;
  for (const candidate of candidates) {
    const claimed = await db("background_jobs")
      .where({ id: candidate.id, status: "queued" })
      .update({
        status: "running",
        locked_at: nowIso,
        locked_by: workerName,
        updated_at: db.fn.now(),
      })
      .returning("*");

    const job = claimed[0];
    if (!job) {
      continue;
    }

    try {
      const result = await runJobHandler(db, job);
      await db("background_jobs")
        .where({ id: job.id })
        .update({
          status: "completed",
          result,
          attempts: Number(job.attempts || 0) + 1,
          completed_at: db.fn.now(),
          updated_at: db.fn.now(),
        });
    } catch (error) {
      const attempts = Number(job.attempts || 0) + 1;
      const nextStatus = attempts >= Number(job.max_attempts || 5) ? "failed" : "queued";
      await db("background_jobs")
        .where({ id: job.id })
        .update({
          status: nextStatus,
          attempts,
          last_error: error.message,
          locked_at: null,
          locked_by: null,
          updated_at: db.fn.now(),
        });
      console.error(`Background job ${job.id} failed:`, error);
    }

    processed += 1;
  }

  return processed;
}

async function ensureRecurringJobs(db) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const hourKey = now.toISOString().slice(0, 13);
  const sixHourBucket = `${day}:${String(Math.floor(now.getUTCHours() / 6)).padStart(2, "0")}`;

  await queueBackgroundJob(db, {
    jobType: JOB_TYPES.ANALYTICS_AGGREGATION,
    payload: { day },
    dedupeKey: `analytics:${hourKey}`,
  });

  await queueBackgroundJob(db, {
    jobType: JOB_TYPES.PATTERN_EXTRACTION,
    dedupeKey: `patterns:${sixHourBucket}`,
  });

  await queueBackgroundJob(db, {
    jobType: JOB_TYPES.MEDIA_CLEANUP,
    dedupeKey: `cleanup:${day}`,
  });

  await queueBackgroundJob(db, {
    jobType: JOB_TYPES.RATE_LIMIT_CLEANUP,
    dedupeKey: `rate-limit-cleanup:${day}`,
  });
}

function startBackgroundJobWorker(db, {
  pollMs = Number(process.env.JOB_POLL_MS || 15000),
  scheduleMs = Number(process.env.JOB_SCHEDULE_MS || 300000),
  setIntervalFn = setInterval,
} = {}) {
  const backoff = createDatabaseBackoffController({
    label: "Background job worker",
  });
  let processing = false;
  let scheduling = false;

  const runProcessTick = async (contextLabel) => {
    if (processing) {
      return;
    }

    if (!backoff.shouldRun()) {
      return;
    }

    processing = true;
    try {
      await processDueJobs(db);
      backoff.onSuccess();
    } catch (error) {
      if (!backoff.onError(error)) {
        console.error(`${contextLabel} failed:`, error);
      }
    } finally {
      processing = false;
    }
  };

  const runScheduleTick = async (contextLabel) => {
    if (scheduling) {
      return;
    }

    if (!backoff.shouldRun()) {
      return;
    }

    scheduling = true;
    try {
      await ensureRecurringJobs(db);
      backoff.onSuccess();
    } catch (error) {
      if (!backoff.onError(error)) {
        console.error(`${contextLabel} failed:`, error);
      }
    } finally {
      scheduling = false;
    }
  };

  const boot = async () => {
    await runScheduleTick("Background job boot scheduling");
    await runProcessTick("Background job boot processing");
  };

  boot().catch((error) => {
    console.error("Background job boot failed:", error);
  });

  const processInterval = setIntervalFn(() => {
    runProcessTick("Background job processing").catch((error) => {
      console.error("Background job processing failed:", error);
    });
  }, pollMs);

  const scheduleInterval = setIntervalFn(() => {
    runScheduleTick("Recurring job scheduling").catch((error) => {
      console.error("Recurring job scheduling failed:", error);
    });
  }, scheduleMs);

  return {
    stop() {
      clearInterval(processInterval);
      clearInterval(scheduleInterval);
    },
  };
}

function getDefaultAICountries() {
  return getSupportedCountries().map((entry) => entry.code).filter((code) => code !== "GLOBAL");
}

module.exports = {
  JOB_TYPES,
  getBackgroundJob,
  getDefaultAICountries,
  processDueJobs,
  queueBackgroundJob,
  ensureRecurringJobs,
  startBackgroundJobWorker,
};
