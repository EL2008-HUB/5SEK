const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_CHUNK_SIZE = 100;

function chunk(array, size) {
  const chunks = [];
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }
  return chunks;
}

function isExpoPushToken(token) {
  return typeof token === "string" && /^(Expo|Exponent)PushToken\[[^\]]+\]$/.test(token.trim());
}

function sanitizePushToken(token) {
  return String(token || "").trim();
}

function getExpoHeaders() {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (process.env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  }

  return headers;
}

async function registerPushToken(db, {
  userId,
  token,
  platform,
  deviceId = null,
  projectId = null,
  appVersion = null,
}) {
  const normalizedToken = sanitizePushToken(token);
  if (!isExpoPushToken(normalizedToken)) {
    throw new Error("invalid_push_token");
  }

  const insertPayload = {
    user_id: userId,
    provider: "expo",
    token: normalizedToken,
    platform,
    device_id: deviceId,
    project_id: projectId,
    app_version: appVersion,
    status: "active",
    revoked_at: null,
    last_seen_at: db.fn.now(),
    updated_at: db.fn.now(),
  };

  const rows = await db("push_tokens")
    .insert(insertPayload)
    .onConflict("token")
    .merge(insertPayload)
    .returning("*");

  return rows[0] || null;
}

async function unregisterPushToken(db, { userId, token }) {
  const normalizedToken = sanitizePushToken(token);
  if (!normalizedToken) {
    return 0;
  }

  return db("push_tokens")
    .where({ user_id: userId, token: normalizedToken })
    .whereNull("revoked_at")
    .update({
      status: "revoked",
      revoked_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
}

async function revokeUserPushTokens(db, userId) {
  return db("push_tokens")
    .where({ user_id: userId, status: "active" })
    .whereNull("revoked_at")
    .update({
      status: "revoked",
      revoked_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
}

async function listUserPushTokens(db, userId) {
  return db("push_tokens")
    .where({ user_id: userId })
    .orderBy("last_seen_at", "desc");
}

async function queuePushDelivery(db, {
  userIds,
  title,
  body,
  data = null,
  dedupeKey = null,
}) {
  const { queueBackgroundJob, JOB_TYPES } = require("./backgroundJobService");
  const normalizedUserIds = [...new Set((userIds || []).map((value) => Number(value)).filter((value) => value > 0))];
  return queueBackgroundJob(db, {
    jobType: JOB_TYPES.PUSH_NOTIFICATION_DELIVERY,
    payload: {
      user_ids: normalizedUserIds,
      title,
      body,
      data: data || null,
    },
    dedupeKey,
  });
}

async function fetchActivePushTokens(db, userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return [];
  }

  return db("push_tokens as pt")
    .join("users as u", "u.id", "pt.user_id")
    .whereIn("pt.user_id", userIds)
    .where("pt.status", "active")
    .whereNull("pt.revoked_at")
    .whereNull("u.deleted_at")
    .where((builder) => builder.whereNull("u.is_blocked").orWhere("u.is_blocked", false))
    .select("pt.id", "pt.user_id", "pt.token", "pt.platform", "pt.provider");
}

async function markPushTokenRevoked(db, tokenId) {
  await db("push_tokens")
    .where({ id: tokenId })
    .update({
      status: "revoked",
      revoked_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
}

async function handlePushDeliveryJob(db, job, payload = {}) {
  const title = String(payload.title || "").trim();
  const body = String(payload.body || "").trim();
  const data = payload.data && typeof payload.data === "object" ? payload.data : null;
  const userIds = Array.isArray(payload.user_ids) ? payload.user_ids.map((entry) => Number(entry)).filter(Boolean) : [];

  const tokens = await fetchActivePushTokens(db, userIds);
  if (!tokens.length) {
    return {
      requested_users: userIds.length,
      tokens_found: 0,
      sent: 0,
      failed: 0,
      skipped: "no_tokens",
    };
  }

  let sent = 0;
  let failed = 0;
  const deliveries = [];

  for (const batch of chunk(tokens, EXPO_CHUNK_SIZE)) {
    const messages = batch.map((entry) => ({
      to: entry.token,
      title,
      body,
      data: data || undefined,
      sound: "default",
    }));

    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: getExpoHeaders(),
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const errorMessage = `expo_push_http_${response.status}`;
      failed += batch.length;
      deliveries.push(...batch.map((entry) => ({
        background_job_id: job.id,
        user_id: entry.user_id,
        push_token_id: entry.id,
        provider: entry.provider,
        status: "failed",
        title,
        body,
        data,
        error_code: errorMessage,
        error_message: errorMessage,
      })));
      continue;
    }

    const payloadResponse = await response.json();
    const results = Array.isArray(payloadResponse?.data) ? payloadResponse.data : [];

    batch.forEach((entry, index) => {
      const result = results[index] || {};
      const ticketStatus = result.status === "ok" ? "sent" : "failed";
      const errorCode = result.details?.error || result.error || null;
      const errorMessage = result.message || null;

      if (ticketStatus === "sent") {
        sent += 1;
      } else {
        failed += 1;
      }

      deliveries.push({
        background_job_id: job.id,
        user_id: entry.user_id,
        push_token_id: entry.id,
        provider: entry.provider,
        status: ticketStatus,
        ticket_id: result.id || null,
        title,
        body,
        data,
        error_code: errorCode,
        error_message: errorMessage,
        delivered_at: ticketStatus === "sent" ? db.fn.now() : null,
      });

      if (errorCode === "DeviceNotRegistered") {
        markPushTokenRevoked(db, entry.id).catch((error) => {
          console.error("Failed to revoke stale push token:", error);
        });
      }
    });
  }

  if (deliveries.length) {
    await db("push_deliveries").insert(deliveries);
  }

  return {
    requested_users: userIds.length,
    tokens_found: tokens.length,
    sent,
    failed,
  };
}

module.exports = {
  handlePushDeliveryJob,
  isExpoPushToken,
  listUserPushTokens,
  queuePushDelivery,
  registerPushToken,
  revokeUserPushTokens,
  unregisterPushToken,
};
