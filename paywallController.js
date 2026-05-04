// Paywall tracking & bonus answers controller

const { getBonusAnswersToday } = require("../services/usageLimits");
const { logAdminAction } = require("../services/adminAuditService");
const { kpiService } = require("../services/kpiService");

// Helper: normalize date to YYYY-MM-DD string (handles Date objects, strings, null)
function toDateStr(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split("T")[0];
  if (typeof val === "string") return val.split("T")[0];
  return null;
}

// Track paywall events (shown, clicked, closed, second_chance_used)
exports.trackEvent = async (req, res) => {
  try {
    const { event_type, metadata } = req.body;
    const actorUserId = req.userId;

    if (!event_type) {
      return res.status(400).json({ error: "event_type required" });
    }

    const validEvents = [
      "paywall_shown",
      "paywall_clicked",
      "paywall_closed",
      "second_chance_shown",
      "second_chance_used",
      "second_chance_dismissed",
    ];

    if (!validEvents.includes(event_type)) {
      return res.status(400).json({ error: `Invalid event_type. Must be one of: ${validEvents.join(", ")}` });
    }

    await req.db("paywall_events").insert({
      user_id: actorUserId,
      event_type,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });

    if (actorUserId) {
      try {
        if (!req.db?.schema || typeof req.db.schema.hasTable !== "function") {
          throw new Error("kpi_schema_unavailable");
        }

        const hasPaywallAnalytics = await req.db.schema.hasTable("paywall_analytics");
        if (!hasPaywallAnalytics) {
          throw new Error("paywall_analytics_missing");
        }

        const normalizedEventType = String(event_type)
          .replace(/^paywall_/, "")
          .replace(/^second_chance_/, "second_chance_");
        await kpiService.trackPaywallEvent(
          req.db,
          actorUserId,
          normalizedEventType,
          metadata?.trigger || metadata?.source || "unknown",
          metadata || {}
        );
      } catch (kpiError) {
        if (!["kpi_schema_unavailable", "paywall_analytics_missing"].includes(String(kpiError?.message || ""))) {
          console.error("Paywall KPI tracking error:", kpiError);
        }
      }
    }

    // Log for analytics
    console.log(`📊 [PAYWALL] ${event_type}`, metadata || "");

    res.json({ ok: true });
  } catch (error) {
    console.error("Track paywall event error:", error);
    res.status(500).json({ error: "Failed to track event" });
  }
};

// Grant a bonus answer (second chance)
exports.grantBonusAnswer = async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    if (req.userRole !== "admin" && req.userId !== userId) {
      return res.status(403).json({ error: "forbidden" });
    }

    const user = await req.db("users").where({ id: userId }).first();
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Already premium? No need for bonus
    if (user.is_premium) {
      return res.json({ ok: true, message: "User is premium, no bonus needed" });
    }

    const today = new Date().toISOString().split("T")[0];

    // Reset bonus counter if it's a new day
    const currentBonus = getBonusAnswersToday(user, today);

    // Max 2 bonus answers per day
    if (currentBonus >= 2) {
      return res.status(403).json({
        error: "max_bonus_reached",
        message: "You've already used your bonus answers today",
      });
    }

    // Grant the bonus
    await req.db("users").where({ id: userId }).update({
      bonus_answers_today: currentBonus + 1,
      bonus_answers_date: today,
    });

    // Track the event
    await req.db("paywall_events").insert({
      user_id: userId,
      event_type: "second_chance_used",
      metadata: JSON.stringify({ bonus_number: currentBonus + 1 }),
    });

    console.log(`🎬 [BONUS] User ${userId} earned bonus answer #${currentBonus + 1}`);

    res.json({
      ok: true,
      bonus_granted: 1,
      total_bonus_today: currentBonus + 1,
      max_bonus: 2,
    });
  } catch (error) {
    console.error("Grant bonus answer error:", error);
    res.status(500).json({ error: "Failed to grant bonus answer" });
  }
};

// Get paywall stats (for analytics dashboard)
exports.getStats = async (req, res) => {
  try {
    const stats = {};

    // Last 24h event counts
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const eventCounts = await req.db("paywall_events")
      .select("event_type")
      .count("id as count")
      .where("created_at", ">=", oneDayAgo)
      .groupBy("event_type");

    eventCounts.forEach((row) => {
      stats[row.event_type] = parseInt(row.count);
    });

    // Conversion rate: clicked / shown
    const shown = stats.paywall_shown || 0;
    const clicked = stats.paywall_clicked || 0;
    stats.conversion_rate = shown > 0 ? ((clicked / shown) * 100).toFixed(1) + "%" : "0%";

    // Second chance usage
    stats.second_chance_rate =
      (stats.second_chance_shown || 0) > 0
        ? (
            ((stats.second_chance_used || 0) / stats.second_chance_shown) *
            100
          ).toFixed(1) + "%"
        : "0%";

    await logAdminAction(req, {
      action: "paywall.view_stats",
      entityType: "paywall",
      metadata: {
        window: "24h",
        event_types: Object.keys(stats).filter((key) => key !== "conversion_rate" && key !== "second_chance_rate"),
      },
    });

    res.json(stats);
  } catch (error) {
    console.error("Get paywall stats error:", error);
    res.status(500).json({ error: "Failed to get paywall stats" });
  }
};
