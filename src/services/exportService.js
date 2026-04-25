const fs = require("fs/promises");
const path = require("path");
const { cloudinary, hasCloudinary, assertProductionStorageAvailable } = require("./uploadService");

const EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EXPORT_DIR = path.join(__dirname, "../../exports");

async function tableExists(db, tableName) {
  return db.schema.hasTable(tableName);
}

async function fetchOptionalRows(db, tableName, queryBuilder) {
  if (!(await tableExists(db, tableName))) {
    return [];
  }

  return queryBuilder(db(tableName));
}

async function buildUserExportPayload(db, userId, exportType = "full") {
  const [user] = await fetchOptionalRows(db, "users", (query) =>
    query
      .where("id", userId)
      .select(
        "id",
        "username",
        "email",
        "country",
        "age_group",
        "interests",
        "role",
        "is_premium",
        "subscription_status",
        "created_at"
      )
  );

  if (!user) {
    const error = new Error("user_not_found");
    error.statusCode = 404;
    throw error;
  }

  if (user.interests && typeof user.interests === "string") {
    try {
      user.interests = JSON.parse(user.interests);
    } catch (_) {}
  }

  const includeAnswers = exportType === "full" || exportType === "answers_only";
  const includeAccount = exportType === "full" || exportType === "account_only";

  const [answers, answerEvents, reports, paywallEvents, clientEvents, payments, supportTickets, refunds, consents] =
    await Promise.all([
      includeAnswers
        ? fetchOptionalRows(db, "answers", (query) => query.where("user_id", userId).orderBy("created_at", "desc"))
        : [],
      includeAnswers
        ? fetchOptionalRows(db, "answer_events", (query) => query.where("user_id", userId).orderBy("created_at", "desc"))
        : [],
      fetchOptionalRows(db, "moderation_reports", (query) =>
        query.where("reporter_user_id", userId).orderBy("created_at", "desc")
      ),
      fetchOptionalRows(db, "paywall_events", (query) => query.where("user_id", userId).orderBy("created_at", "desc")),
      fetchOptionalRows(db, "client_events", (query) => query.where("user_id", userId).orderBy("created_at", "desc")),
      fetchOptionalRows(db, "payment_events", (query) => query.orderBy("processed_at", "desc")),
      fetchOptionalRows(db, "support_tickets", (query) => query.where("user_id", userId).orderBy("created_at", "desc")),
      fetchOptionalRows(db, "refund_requests", (query) => query.where("user_id", userId).orderBy("created_at", "desc")),
      includeAccount
        ? fetchOptionalRows(db, "user_consents", (query) => query.where("user_id", userId).limit(1))
        : [],
    ]);

  return {
    user: includeAccount ? user : null,
    answers,
    answer_events: answerEvents,
    moderation_reports: reports,
    paywall_events: paywallEvents,
    client_events: clientEvents,
    payment_events: payments.filter((row) => {
      const payload = parsePayload(row?.payload);
      const customerId = payload?.customer || payload?.data?.object?.customer;
      const metadataUserId = Number(payload?.metadata?.user_id || payload?.data?.object?.metadata?.user_id || 0);
      if (user.stripe_customer_id) {
        return customerId === user.stripe_customer_id || metadataUserId === Number(user.id);
      }
      return metadataUserId === Number(user.id);
    }).map((row) => ({
      ...row,
      payload: parsePayload(row.payload),
    })),
    support_tickets: supportTickets,
    refund_requests: refunds,
    consents: consents[0] || null,
    exported_at: new Date().toISOString(),
  };
}

async function ensureExportDir() {
  await fs.mkdir(EXPORT_DIR, { recursive: true });
}

function buildDownloadUrl(requestId) {
  return `/api/legal/export-data/${requestId}/download`;
}

function buildCloudinaryExportPublicId(userId, requestId) {
  return `5sek-exports/user_${userId}/request_${requestId}`;
}

function buildCloudinaryExportRef(userId, requestId) {
  return `cloudinary://${buildCloudinaryExportPublicId(userId, requestId)}`;
}

function isCloudinaryExportRef(value) {
  return typeof value === "string" && value.startsWith("cloudinary://");
}

function parseCloudinaryExportRef(value) {
  return isCloudinaryExportRef(value) ? value.replace("cloudinary://", "") : null;
}

async function uploadExportToCloudinary(payload, { userId, requestId }) {
  assertProductionStorageAvailable();
  if (!hasCloudinary) {
    return null;
  }

  await ensureExportDir();
  const filePath = getExportFilePath(requestId);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");

  try {
    await cloudinary.uploader.upload(filePath, {
      resource_type: "raw",
      type: "authenticated",
      public_id: buildCloudinaryExportPublicId(userId, requestId),
      use_filename: false,
      unique_filename: false,
      overwrite: true,
      invalidate: true,
      filename_override: `5sek-export-${requestId}.json`,
      tags: ["5sek-export", "user-export"],
    });
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }

  return buildCloudinaryExportRef(userId, requestId);
}

function buildSignedCloudinaryDownloadUrl(exportRef, expiresAt) {
  const publicId = parseCloudinaryExportRef(exportRef);
  if (!publicId) {
    return null;
  }

  return cloudinary.utils.private_download_url(publicId, "json", {
    resource_type: "raw",
    type: "authenticated",
    expires_at: Math.floor(new Date(expiresAt).getTime() / 1000),
    attachment: true,
  });
}

async function processExportRequest(db, requestId) {
  const request = await db("data_export_requests").where("id", requestId).first();
  if (!request) {
    return null;
  }

  try {
    await db("data_export_requests")
      .where("id", requestId)
      .update({
        status: "processing",
        updated_at: new Date(),
      });

    const payload = await buildUserExportPayload(db, request.user_id, request.export_type);
    const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);
    let storageRef = buildDownloadUrl(requestId);

    if (hasCloudinary) {
      storageRef = await uploadExportToCloudinary(payload, {
        userId: request.user_id,
        requestId,
      });
    } else {
      await ensureExportDir();
      const filePath = getExportFilePath(requestId);
      await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
    }

    await db("data_export_requests")
      .where("id", requestId)
      .update({
        status: "ready",
        download_url: storageRef,
        processed_at: new Date(),
        expires_at: expiresAt,
        updated_at: new Date(),
      });

    return {
      requestId,
      downloadUrl: buildDownloadUrl(requestId),
      expiresAt: expiresAt.toISOString(),
    };
  } catch (error) {
    await db("data_export_requests")
      .where("id", requestId)
      .update({
        status: "expired",
        updated_at: new Date(),
      });
    throw error;
  }
}

function getExportFilePath(requestId) {
  return path.join(EXPORT_DIR, `export-${requestId}.json`);
}

function parsePayload(value) {
  if (!value || typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return value;
  }
}

module.exports = {
  EXPORT_TTL_MS,
  buildCloudinaryExportRef,
  buildDownloadUrl,
  buildSignedCloudinaryDownloadUrl,
  buildUserExportPayload,
  getExportFilePath,
  isCloudinaryExportRef,
  parseCloudinaryExportRef,
  processExportRequest,
  tableExists,
};
