const fs = require("fs");
const path = require("path");
const { cloudinary, deleteVideo, hasCloudinary } = require("./uploadService");

async function cleanupHiddenMedia(db, {
  olderThanDays = Number(process.env.MEDIA_CLEANUP_DAYS || 7),
} = {}) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

  const rows = await db("answers")
    .where("is_hidden", true)
    .where("created_at", "<=", cutoff)
    .whereNotNull("video_url")
    .select("id", "video_url", "storage_provider", "storage_public_id");

  let cleaned = 0;
  for (const row of rows) {
    try {
      if (row.storage_provider === "cloudinary" && row.storage_public_id) {
        await deleteVideo(row.storage_public_id);
      }

      if (row.storage_provider === "local" && String(row.video_url).includes("/uploads/videos/")) {
        const fileName = String(row.video_url).split("/uploads/videos/")[1];
        if (fileName) {
          const filePath = path.join(__dirname, "../../uploads/videos", fileName);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      }

      await db("answers").where({ id: row.id }).update({
        video_url: null,
        storage_public_id: null,
      });
      cleaned += 1;
    } catch (error) {
      console.error(`Failed cleanup for answer ${row.id}:`, error.message);
    }
  }

  return {
    scanned: rows.length,
    cleaned,
  };
}

async function cleanupOrphanedSignedUploads(db, {
  olderThanHours = Number(process.env.ORPHAN_UPLOAD_CLEANUP_HOURS || 24),
} = {}) {
  if (!hasCloudinary || !cloudinary.api) {
    return {
      scanned: 0,
      deleted: 0,
      skipped: true,
    };
  }

  const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;
  const resources = await cloudinary.api.resources_by_tag("pending-answer", {
    resource_type: "video",
    max_results: 100,
  });

  let scanned = 0;
  let deleted = 0;
  for (const resource of resources.resources || []) {
    scanned += 1;
    const createdAt = resource.created_at ? new Date(resource.created_at).getTime() : Date.now();
    if (!Number.isFinite(createdAt) || createdAt > cutoff) {
      continue;
    }

    const existing = await db("answers")
      .where({ storage_public_id: resource.public_id })
      .first();
    if (existing) {
      continue;
    }

    await deleteVideo(resource.public_id);
    deleted += 1;
  }

  return { scanned, deleted };
}

async function cleanupStaleRateLimits(db, {
  olderThanDays = Number(process.env.RATE_LIMIT_RETENTION_DAYS || 7),
} = {}) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

  const deleted = await db("request_rate_limits")
    .where("updated_at", "<", cutoff)
    .del();

  return {
    deleted: Number(deleted || 0),
    cutoff,
  };
}

module.exports = {
  cleanupHiddenMedia,
  cleanupOrphanedSignedUploads,
  cleanupStaleRateLimits,
};
