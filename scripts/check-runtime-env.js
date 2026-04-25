const { bootstrapEnv } = require("../src/config/bootstrapEnv");
bootstrapEnv(require("path").join(__dirname, ".."));

const requiredAlways = ["JWT_SECRET"];
const requiredProduction = ["DATABASE_URL"];
const recommendedProduction = ["CORS_ALLOWED_ORIGINS"];
const optionalProduction = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_ID",
  "EXPO_ACCESS_TOKEN",
  "SENTRY_DSN",
];

const mode = process.env.NODE_ENV || "development";
const appEnv = process.env.APP_ENV || mode;

function missing(keys) {
  return keys.filter((key) => !process.env[key]);
}

function isWeakJwtSecret(value) {
  const normalized = String(value || "");
  if (normalized.length < 32) {
    return true;
  }

  const lower = normalized.toLowerCase();
  return [
    "change_me",
    "your_jwt_secret",
    "jwt_secret",
    "secret",
    "password",
    "release-check-secret",
    "ci-test-secret",
  ].some((entry) => lower.includes(entry));
}

function hasCloudinaryConfig() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

const hardFailures = missing(requiredAlways);
if (mode === "production") {
  hardFailures.push(...missing(requiredProduction));

  if (process.env.INLINE_BACKGROUND_WORKER === "true") {
    hardFailures.push("INLINE_BACKGROUND_WORKER must be false in production");
  }

  if (process.env.INLINE_INJECTION_WORKER === "true") {
    hardFailures.push("INLINE_INJECTION_WORKER must be false in production");
  }

  if (isWeakJwtSecret(process.env.JWT_SECRET)) {
    hardFailures.push("JWT_SECRET must be at least 32 chars and not use placeholder/demo values");
  }

  if (!hasCloudinaryConfig()) {
    hardFailures.push("Cloudinary credentials are required in production");
  }
}

if (!["development", "staging", "production"].includes(appEnv)) {
  hardFailures.push("APP_ENV must be development, staging, or production");
}

if (hardFailures.length) {
  console.error("Runtime env check failed:");
  hardFailures.forEach((entry) => console.error(` - ${entry}`));
  process.exit(1);
}

const optionalMissing = mode === "production" ? missing(optionalProduction) : [];
const recommendedMissing = mode === "production" ? missing(recommendedProduction) : [];
if (mode === "production" && !process.env.SECRETS_FILE) {
  console.warn("SECRETS_FILE not set; ensure your secret manager injects env values directly.");
}
if (recommendedMissing.length) {
  console.warn("Recommended production env vars missing:");
  recommendedMissing.forEach((entry) => console.warn(` - ${entry}`));
}
if (optionalMissing.length) {
  console.warn("Optional production env vars missing:");
  optionalMissing.forEach((entry) => console.warn(` - ${entry}`));
}

console.log(`Runtime env check passed for ${mode} (${appEnv})`);
