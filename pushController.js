const { logAdminAction } = require("../services/adminAuditService");
const {
  listUserPushTokens,
  queuePushDelivery,
  registerPushToken,
  unregisterPushToken,
} = require("../services/pushNotificationService");

exports.register = async (req, res) => {
  try {
    const row = await registerPushToken(req.db, {
      userId: req.userId,
      token: req.body.token,
      platform: String(req.body.platform).toLowerCase(),
      deviceId: req.body.device_id || null,
      projectId: req.body.project_id || null,
      appVersion: req.body.app_version || null,
    });

    res.status(201).json({
      ok: true,
      push_token: row
        ? {
            id: row.id,
            platform: row.platform,
            last_seen_at: row.last_seen_at,
            status: row.status,
          }
        : null,
    });
  } catch (error) {
    if (error.message === "invalid_push_token") {
      return res.status(400).json({ error: "invalid_push_token" });
    }

    console.error("Register push token error:", error);
    res.status(500).json({ error: "Failed to register push token" });
  }
};

exports.unregister = async (req, res) => {
  try {
    const revoked = await unregisterPushToken(req.db, {
      userId: req.userId,
      token: req.body.token,
    });

    res.json({ ok: true, revoked });
  } catch (error) {
    console.error("Unregister push token error:", error);
    res.status(500).json({ error: "Failed to unregister push token" });
  }
};

exports.listMine = async (req, res) => {
  try {
    const rows = await listUserPushTokens(req.db, req.userId);
    res.json({
      tokens: rows.map((row) => ({
        id: row.id,
        platform: row.platform,
        status: row.status,
        last_seen_at: row.last_seen_at,
        created_at: row.created_at,
      })),
    });
  } catch (error) {
    console.error("List push tokens error:", error);
    res.status(500).json({ error: "Failed to list push tokens" });
  }
};

exports.sendTest = async (req, res) => {
  try {
    const job = await queuePushDelivery(req.db, {
      userIds: [req.userId],
      title: req.body.title,
      body: req.body.body,
      data: {
        ...(req.body.metadata || {}),
        deeplink: req.body.deeplink || "five-second://feed",
      },
      dedupeKey: null,
    });

    res.status(202).json({
      ok: true,
      job_id: job?.id || null,
      queued_for_user_id: req.userId,
    });
  } catch (error) {
    console.error("Send push test error:", error);
    res.status(500).json({ error: "Failed to queue push notification" });
  }
};

exports.adminSendTest = async (req, res) => {
  try {
    const targetUserIds = Array.isArray(req.body.user_ids)
      ? req.body.user_ids.map((entry) => Number(entry)).filter((entry) => entry > 0)
      : [];

    if (!targetUserIds.length) {
      return res.status(400).json({ error: "user_ids required" });
    }

    const job = await queuePushDelivery(req.db, {
      userIds: targetUserIds,
      title: req.body.title,
      body: req.body.body,
      data: {
        ...(req.body.metadata || {}),
        deeplink: req.body.deeplink || "five-second://feed",
      },
      dedupeKey: null,
    });

    await logAdminAction(req, {
      action: "push:test_send",
      entityType: "user",
      metadata: {
        user_ids: targetUserIds,
        job_id: job?.id || null,
      },
    });

    res.status(202).json({ ok: true, job_id: job?.id || null, recipients: targetUserIds.length });
  } catch (error) {
    console.error("Admin push send error:", error);
    res.status(500).json({ error: "Failed to queue push notification" });
  }
};
