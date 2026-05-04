const { getAssignments } = require("../services/experimentService");
const { kpiService } = require("../services/kpiService");

exports.trackClientEvent = async (req, res) => {
  try {
    const { event_type, screen, metadata } = req.body;

    if (!event_type) {
      return res.status(400).json({ error: "event_type required" });
    }

    await req.db("client_events").insert({
      user_id: req.userId || null,
      event_type,
      screen: screen || null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });

    const questionId = Number(metadata?.question_id || 0);
    if (req.userId && questionId > 0) {
      if (event_type === "answer_start") {
        await kpiService.trackAnswerFunnel(req.db, req.userId, questionId, "started", {
          sessionId: metadata?.session_id || null,
        });
      }

      if (event_type === "answer_complete") {
        await kpiService.trackAnswerFunnel(req.db, req.userId, questionId, "recorded", {
          sessionId: metadata?.session_id || null,
        });
      }
    }

    const sessionId = typeof metadata?.session_id === "string" ? metadata.session_id : null;
    if (req.userId && sessionId) {
      if (event_type === "app_open" || event_type === "app_resume") {
        await kpiService.startSession(req.db, req.userId, sessionId, req.userCountry || req.detectedCountry || "GLOBAL");
      }

      if (event_type === "app_backgrounded") {
        await kpiService.endSession(req.db, sessionId, {
          screensViewed: Number(metadata?.screens_viewed || 0),
          answersCreated: Number(metadata?.answers_created || 0),
          feedItemsViewed: Number(metadata?.feed_items_viewed || 0),
          duelsParticipated: Number(metadata?.duels_participated || 0),
          featuresUsed: Array.isArray(metadata?.features_used) ? metadata.features_used : [],
        });
      }

      if (event_type === "feed_swipe") {
        await kpiService.updateSessionMetrics(req.db, sessionId, {
          feedItemsViewed: 1,
        });
      }

      if (event_type === "duel_vote") {
        await kpiService.updateSessionMetrics(req.db, sessionId, {
          duelsParticipated: 1,
        });
      }

      if (event_type === "answer_complete") {
        await kpiService.updateSessionMetrics(req.db, sessionId, {
          answersCreated: 1,
        });
      }
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("Track client event error:", error);
    res.status(500).json({ error: "Failed to track client event" });
  }
};

exports.getExperimentAssignments = async (req, res) => {
  try {
    const assignments = await getAssignments(req.db, req.userId);
    res.json({ assignments });
  } catch (error) {
    console.error("Get experiment assignments error:", error);
    res.status(500).json({ error: "Failed to get experiments" });
  }
};

exports.getDashboard = async (req, res) => {
  try {
    const now = new Date();
    const yesterdayStart = new Date(now);
    yesterdayStart.setDate(now.getDate() - 1);
    yesterdayStart.setHours(0, 0, 0, 0);

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(todayStart.getDate() + 1);

    const newUsersYesterday = Number(
      (
        await req.db("users")
          .where("created_at", ">=", yesterdayStart.toISOString())
          .where("created_at", "<", todayStart.toISOString())
          .count("id as count")
          .first()
      )?.count || 0
    );

    const retainedUsersRows = await req.db("users")
      .join("client_events", "users.id", "client_events.user_id")
      .where("users.created_at", ">=", yesterdayStart.toISOString())
      .where("users.created_at", "<", todayStart.toISOString())
      .where("client_events.created_at", ">=", todayStart.toISOString())
      .where("client_events.created_at", "<", tomorrowStart.toISOString())
      .groupBy("users.id")
      .select("users.id");

    const retainedUsers = retainedUsersRows.length;

    const answerMetrics = await req.db("answers")
      .where("created_at", ">=", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .sum("watch_time_total as watch_time_total")
      .sum("completion_count as completion_count")
      .sum("skip_count as skip_count")
      .sum("replay_count as replay_count")
      .count("id as answer_count")
      .first();

    const paywallByVariantRows = await req.db("experiment_assignments as ea")
      .leftJoin("paywall_events as pe", "ea.user_id", "pe.user_id")
      .where("ea.experiment_key", "paywall_v2")
      .groupBy("ea.variant")
      .select("ea.variant")
      .countDistinct({ users: "ea.user_id" })
      .sum(req.db.raw("CASE WHEN pe.event_type = 'paywall_shown' THEN 1 ELSE 0 END as shown"))
      .sum(req.db.raw("CASE WHEN pe.event_type = 'paywall_clicked' THEN 1 ELSE 0 END as clicked"));

    const feedByVariantRows = await req.db("experiment_assignments as ea")
      .leftJoin("answer_events as ae", "ea.user_id", "ae.user_id")
      .where("ea.experiment_key", "feed_ranker_v2")
      .groupBy("ea.variant")
      .select("ea.variant")
      .sum(req.db.raw("CASE WHEN ae.event_type = 'completed' THEN 1 ELSE 0 END as completed"))
      .sum(req.db.raw("CASE WHEN ae.event_type = 'skipped' THEN 1 ELSE 0 END as skipped"))
      .sum("ae.watch_time as watch_time_total");

    const completionCount = Number(answerMetrics?.completion_count || 0);
    const skipCount = Number(answerMetrics?.skip_count || 0);
    const replayCount = Number(answerMetrics?.replay_count || 0);
    const engagementCount = completionCount + skipCount;

    res.json({
      retention: {
        new_users_yesterday: newUsersYesterday,
        retained_users_day_1: retainedUsers,
        day_1_rate: newUsersYesterday > 0 ? Number(((retainedUsers / newUsersYesterday) * 100).toFixed(1)) : 0,
      },
      feed_health: {
        answers_7d: Number(answerMetrics?.answer_count || 0),
        watch_time_total_7d: Number(answerMetrics?.watch_time_total || 0),
        completion_rate: engagementCount > 0 ? Number(((completionCount / engagementCount) * 100).toFixed(1)) : 0,
        skip_rate: engagementCount > 0 ? Number(((skipCount / engagementCount) * 100).toFixed(1)) : 0,
        replay_rate: Number(answerMetrics?.answer_count || 0) > 0
          ? Number(((replayCount / Number(answerMetrics.answer_count || 0)) * 100).toFixed(1))
          : 0,
      },
      experiments: {
        paywall: paywallByVariantRows.map((row) => ({
          variant: row.variant,
          users: Number(row.users || 0),
          shown: Number(row.shown || 0),
          clicked: Number(row.clicked || 0),
          conversion_rate:
            Number(row.shown || 0) > 0
              ? Number(((Number(row.clicked || 0) / Number(row.shown || 0)) * 100).toFixed(1))
              : 0,
        })),
        feed: feedByVariantRows.map((row) => {
          const completed = Number(row.completed || 0);
          const skipped = Number(row.skipped || 0);
          const total = completed + skipped;

          return {
            variant: row.variant,
            completion_rate: total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0,
            skip_rate: total > 0 ? Number(((skipped / total) * 100).toFixed(1)) : 0,
            watch_time_total: Number(row.watch_time_total || 0),
          };
        }),
      },
    });
  } catch (error) {
    console.error("Get analytics dashboard error:", error);
    res.status(500).json({ error: "Failed to get dashboard" });
  }
};
