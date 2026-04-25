function startOfDayIso(day) {
  const base = day ? new Date(`${day}T00:00:00.000Z`) : new Date();
  base.setUTCHours(0, 0, 0, 0);
  return base.toISOString();
}

function nextDayIso(day) {
  const next = new Date(startOfDayIso(day));
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function formatDay(day) {
  return startOfDayIso(day).slice(0, 10);
}

async function upsertDailyRollup(db, { day, scope, rollupKey, entityId = null, country = null, metrics }) {
  const [row] = await db("analytics_daily_rollups")
    .insert({
      day,
      scope,
      rollup_key: rollupKey,
      entity_id: entityId,
      country,
      metrics,
    })
    .onConflict("rollup_key")
    .merge({
      metrics,
      updated_at: db.fn.now(),
    })
    .returning("*");

  return row;
}

async function aggregateDailyAnalytics(db, { day } = {}) {
  const normalizedDay = formatDay(day);
  const fromIso = startOfDayIso(normalizedDay);
  const toIso = nextDayIso(normalizedDay);

  const overall = await db("answers")
    .where("created_at", ">=", fromIso)
    .where("created_at", "<", toIso)
    .sum("watch_time_total as watch_time_total")
    .sum("completion_count as completion_count")
    .sum("skip_count as skip_count")
    .sum("replay_count as replay_count")
    .count("id as answer_count")
    .first();

  const answerCount = Number(overall?.answer_count || 0);
  const completionCount = Number(overall?.completion_count || 0);
  const skipCount = Number(overall?.skip_count || 0);
  const replayCount = Number(overall?.replay_count || 0);
  const watchTimeTotal = Number(overall?.watch_time_total || 0);
  const engagementDenominator = completionCount + skipCount;

  await upsertDailyRollup(db, {
    day: normalizedDay,
    scope: "answers_overall",
    rollupKey: `answers_overall:${normalizedDay}`,
    metrics: {
      answer_count: answerCount,
      watch_time_total: watchTimeTotal,
      completion_count: completionCount,
      skip_count: skipCount,
      replay_count: replayCount,
      completion_rate: engagementDenominator > 0 ? Number((completionCount / engagementDenominator).toFixed(4)) : 0,
      skip_rate: engagementDenominator > 0 ? Number((skipCount / engagementDenominator).toFixed(4)) : 0,
      replay_rate: answerCount > 0 ? Number((replayCount / answerCount).toFixed(4)) : 0,
      avg_watch_time: answerCount > 0 ? Number((watchTimeTotal / answerCount).toFixed(4)) : 0,
    },
  });

  const perCountry = await db("answers")
    .join("users", "answers.user_id", "users.id")
    .where("answers.created_at", ">=", fromIso)
    .where("answers.created_at", "<", toIso)
    .groupBy("users.country")
    .select("users.country")
    .sum("answers.watch_time_total as watch_time_total")
    .sum("answers.completion_count as completion_count")
    .sum("answers.skip_count as skip_count")
    .sum("answers.replay_count as replay_count")
    .count("answers.id as answer_count");

  for (const row of perCountry) {
    const country = row.country || "GLOBAL";
    const countryAnswerCount = Number(row.answer_count || 0);
    const countryCompletionCount = Number(row.completion_count || 0);
    const countrySkipCount = Number(row.skip_count || 0);
    const countryReplayCount = Number(row.replay_count || 0);
    const countryWatchTime = Number(row.watch_time_total || 0);
    const countryDenominator = countryCompletionCount + countrySkipCount;

    await upsertDailyRollup(db, {
      day: normalizedDay,
      scope: "answers_country",
      rollupKey: `answers_country:${country}:${normalizedDay}`,
      country,
      metrics: {
        answer_count: countryAnswerCount,
        watch_time_total: countryWatchTime,
        completion_count: countryCompletionCount,
        skip_count: countrySkipCount,
        replay_count: countryReplayCount,
        completion_rate:
          countryDenominator > 0 ? Number((countryCompletionCount / countryDenominator).toFixed(4)) : 0,
        skip_rate: countryDenominator > 0 ? Number((countrySkipCount / countryDenominator).toFixed(4)) : 0,
        replay_rate: countryAnswerCount > 0 ? Number((countryReplayCount / countryAnswerCount).toFixed(4)) : 0,
        avg_watch_time: countryAnswerCount > 0 ? Number((countryWatchTime / countryAnswerCount).toFixed(4)) : 0,
      },
    });
  }

  return {
    day: normalizedDay,
    overall: answerCount,
    countries_processed: perCountry.length,
  };
}

module.exports = {
  aggregateDailyAnalytics,
};
