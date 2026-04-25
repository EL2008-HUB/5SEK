const cloudinary = require("cloudinary").v2;
const path = require("path");
const crypto = require("crypto");

const isProduction = process.env.NODE_ENV === "production";
const hasCloudinary =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_CLOUD_NAME !== "your_cloud_name" &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

if (hasCloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log("Cloudinary configured");
} else if (isProduction) {
  console.error("Cloudinary is required in production; local uploads are disabled");
} else {
  console.warn("Cloudinary not configured; development uploads will use local /uploads fallback");
}

function buildDeliveryUrl(url) {
  if (!url) return url;
  if (process.env.MEDIA_CDN_BASE_URL) {
    try {
      const parsed = new URL(url);
      return `${String(process.env.MEDIA_CDN_BASE_URL).replace(/\/$/, "")}${parsed.pathname}${parsed.search}`;
    } catch (_) {
      return url;
    }
  }

  return url;
}

function assertProductionStorageAvailable() {
  if (isProduction && !hasCloudinary) {
    const error = new Error("production_storage_unavailable");
    error.code = "production_storage_unavailable";
    throw error;
  }
}

function buildCloudinaryPublicId(userId) {
  return `user_${userId || "anonymous"}/${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function buildCloudinarySignature(parameters) {
  const signaturePayload = Object.entries(parameters)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return crypto
    .createHash("sha1")
    .update(`${signaturePayload}${process.env.CLOUDINARY_API_SECRET}`)
    .digest("hex");
}

async function uploadVideo(filePath, originalName, { userId = null } = {}) {
  assertProductionStorageAvailable();

  if (hasCloudinary) {
    try {
      const resourceType = path.extname(originalName || "").toLowerCase() === ".mp3" ? "video" : "video";
      const publicId = buildCloudinaryPublicId(userId);
      const result = await cloudinary.uploader.upload(filePath, {
        resource_type: resourceType,
        folder: "5sek-answers",
        public_id: publicId,
        tags: ["5sek-answer", "server-upload"],
        overwrite: false,
        transformation: [
          { width: 720, crop: "limit" },
          { duration: "5" },
        ],
      });
      return { url: buildDeliveryUrl(result.secure_url), public_id: result.public_id };
    } catch (error) {
      console.error("Cloudinary upload error:", error);
      throw new Error("Video upload failed");
    }
  }

  const fs = require("fs");
  const videosDir = path.join(__dirname, "../../uploads/videos");
  if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

  const ext = originalName ? path.extname(originalName) : ".mp4";
  const filename = `${Date.now()}${ext}`;
  const dest = path.join(videosDir, filename);

  fs.renameSync(filePath, dest);

  const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return {
    url: buildDeliveryUrl(`${baseUrl}/uploads/videos/${filename}`),
    public_id: filename,
  };
}

async function deleteVideo(publicId) {
  if (!hasCloudinary || !publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "video", invalidate: true });
  } catch (error) {
    console.error("Cloudinary delete error:", error);
  }
}

function inferStorageFromUrl(url) {
  if (!url) {
    return {
      storage_provider: "app",
      storage_public_id: null,
    };
  }

  if (String(url).includes("res.cloudinary.com")) {
    const uploadMarker = "/upload/";
    const markerIndex = url.indexOf(uploadMarker);
    if (markerIndex !== -1) {
      const tail = url.slice(markerIndex + uploadMarker.length);
      const normalized = tail.replace(/^v\d+\//, "");
      const withoutExtension = normalized.replace(/\.[^./?]+$/, "");
      return {
        storage_provider: "cloudinary",
        storage_public_id: withoutExtension,
      };
    }

    return {
      storage_provider: "cloudinary",
      storage_public_id: null,
    };
  }

  return {
    storage_provider: String(url).includes("/uploads/") ? "local" : "app",
    storage_public_id: null,
  };
}

function createSignedUploadPayload({ userId = null, answerType = "video" } = {}) {
  assertProductionStorageAvailable();
  if (!hasCloudinary) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "5sek-answers";
  const public_id = buildCloudinaryPublicId(userId);
  const tags = ["5sek-answer", "pending-answer", answerType === "audio" ? "audio-answer" : "video-answer"].join(",");
  const context = [`app=5sek`, `user_id=${userId || "anonymous"}`, `answer_type=${answerType}`].join("|");
  const eager = "q_auto:good";
  const resource_type = "video";
  const parameters = {
    context,
    eager,
    folder,
    public_id,
    tags,
    timestamp,
  };
  const signature = buildCloudinarySignature(parameters);

  return {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    folder,
    public_id,
    tags,
    context,
    eager,
    resource_type,
    timestamp,
    signature,
  };
}

module.exports = {
  assertProductionStorageAvailable,
  cloudinary,
  createSignedUploadPayload,
  deleteVideo,
  buildDeliveryUrl,
  hasCloudinary,
  inferStorageFromUrl,
  isProduction,
  uploadVideo,
};
