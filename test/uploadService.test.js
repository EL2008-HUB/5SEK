const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const uploadServicePath = path.resolve(__dirname, "../src/services/uploadService.js");

function loadFreshUploadService(envUpdates) {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  };

  Object.entries(envUpdates).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });

  delete require.cache[uploadServicePath];
  const service = require(uploadServicePath);

  return {
    service,
    restore() {
      Object.entries(previous).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      delete require.cache[uploadServicePath];
    },
  };
}

test("createSignedUploadPayload rejects production local fallback", () => {
  const fresh = loadFreshUploadService({
    NODE_ENV: "production",
    CLOUDINARY_CLOUD_NAME: undefined,
    CLOUDINARY_API_KEY: undefined,
    CLOUDINARY_API_SECRET: undefined,
  });

  try {
    assert.throws(() => fresh.service.createSignedUploadPayload({ userId: 1 }), {
      code: "production_storage_unavailable",
    });
  } finally {
    fresh.restore();
  }
});
