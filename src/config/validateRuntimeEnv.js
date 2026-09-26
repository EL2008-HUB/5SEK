function parseList(value) {
  if (!value) return [];
  return String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
}
function missing(keys) { return keys.filter((key) => !process.env[key]); }
function isWeakJwtSecret(value) {
  const normalized = String(value || "");
  if (normalized.length < 32) return true;
  const lower = normalized.toLowerCase();
  return ["change_me","your_jwt_secret","jwt_secret","secret","password","release-check-secret","ci-test-secret"].some((entry) => lower.includes(entry));
}
function hasCloudinaryConfig() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}
function validateRuntimeEnv({ exitOnFailure = false } = {}) {
  const mode = process.env.NODE_ENV || "development";
  const appEnv = process.env.APP_ENV || mode;
  const hardFailures = missing(["JWT_SECRET"]);
  if (mode === "production") {
    hardFailures.push(...missing(["DATABASE_URL"]));
    if (process.env.INLINE_BACKGROUND_WORKER === "true") hardFailures.push("INLINE_BACKGROUND_WORKER must be false in production");
    if (process.env.INLINE_INJECTION_WORKER === "true") hardFailures.push("INLINE_INJECTION_WORKER must be false in production");
    if (process.env.INLINE_DUEL_WORKER === "true") hardFailures.push("INLINE_DUEL_WORKER must be false in production");
    if (isWeakJwtSecret(process.env.JWT_SECRET)) hardFailures.push("JWT_SECRET must be at least 32 chars and not use placeholder/demo values");
    if (!hasCloudinaryConfig()) hardFailures.push("Cloudinary credentials are required in production");
  }
  if (!["development","staging","production"].includes(appEnv)) hardFailures.push("APP_ENV must be development, staging, or production");
  const warnings = [];
  if (mode === "production" && !process.env.SECRETS_FILE) warnings.push("SECRETS_FILE not set; ensure your secret manager injects env values directly.");
  if (mode === "production") {
    missing(["CORS_ALLOWED_ORIGINS"]).forEach((entry) => warnings.push("Recommended production env var missing: " + entry));
    missing(["STRIPE_SECRET_KEY","STRIPE_PRICE_ID","EXPO_ACCESS_TOKEN","SENTRY_DSN"]).forEach((entry) => warnings.push("Optional production env var missing: " + entry));
  }
  if (hardFailures.length) {
    const message = "Runtime env check failed:\n" + hardFailures.map((entry) => " - " + entry).join("\n");
    if (exitOnFailure) { console.error(message); process.exit(1); }
    throw new Error(message);
  }
  warnings.forEach((entry) => console.warn(entry));
  console.log("Runtime env check passed for " + mode + " (" + appEnv + ")");
  return { mode, appEnv, warnings };
}
module.exports = { validateRuntimeEnv, parseList };
