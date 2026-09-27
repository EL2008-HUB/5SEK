const fs = require("fs");
const path = require("path");
const appJson = require("./app.json");

function normalizeOptionalEnv(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  if (!normalized) return undefined;
  if (/^REPLACE[_-]/i.test(normalized) || /^example$/i.test(normalized)) return undefined;
  return normalized;
}

function loadEnvFile(filePath, { override = false } = {}) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return;
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const normalizedValue = rawValue.replace(/^['"]|['"]$/g, "");
    if (key && (override || process.env[key] === undefined || process.env[key] === "")) {
      process.env[key] = normalizedValue;
    }
  });
}

const appEnv = process.env.APP_ENV || process.env.NODE_ENV || "development";
const appRoot = __dirname;
loadEnvFile(path.join(appRoot, ".env"));
loadEnvFile(path.join(appRoot, `.env.${appEnv}`));
loadEnvFile(path.join(appRoot, ".env.local"), { override: true });
loadEnvFile(path.join(appRoot, `.env.${appEnv}.local`), { override: true });

const base = appJson.expo || {};
const projectId =
  normalizeOptionalEnv(process.env.EXPO_PUBLIC_EAS_PROJECT_ID) ||
  normalizeOptionalEnv(process.env.EAS_PROJECT_ID) ||
  (base.extra && base.extra.eas && base.extra.eas.projectId) ||
  "00000000-0000-0000-0000-000000000000";
const iosBundleId = process.env.EXPO_PUBLIC_IOS_BUNDLE_ID || "app.fivesek.mobile";
const androidPackage = process.env.EXPO_PUBLIC_ANDROID_PACKAGE || "app.fivesek.mobile";
const isProductionBuild = appEnv === "production";

module.exports = () => ({
  expo: {
    ...base,
    name: "5SEK",
    slug: "5sek",
    scheme: "five-second",
    plugins: [
      "expo-notifications",
      "expo-secure-store",
      [
        "expo-camera",
        {
          cameraPermission: "5SEK needs camera access to record 5-second video answers.",
          microphonePermission: "5SEK needs microphone access to record audio answers.",
          recordAudioAndroid: true,
        },
      ],
      [
        "@sentry/react-native/expo",
        {
          url: normalizeOptionalEnv(process.env.SENTRY_URL) || "https://sentry.io/",
          organization: normalizeOptionalEnv(process.env.SENTRY_ORG),
          project: normalizeOptionalEnv(process.env.SENTRY_PROJECT),
        },
      ],
    ],
    ios: {
      ...base.ios,
      bundleIdentifier: iosBundleId,
      associatedDomains: ["applinks:5sek.app", "applinks:www.5sek.app"],
      infoPlist: {
        ...(base.ios && base.ios.infoPlist ? base.ios.infoPlist : {}),
        NSUserNotificationsUsageDescription: "5SEK uses notifications for duels, replies, and feed reminders.",
        NSCameraUsageDescription: "5SEK needs camera access to record 5-second video answers.",
        NSMicrophoneUsageDescription: "5SEK needs microphone access to record audio and video answers.",
        NSPhotoLibraryUsageDescription: "5SEK may access your photo library when you choose media for answers.",
      },
    },
    android: {
      ...base.android,
      package: androidPackage,
      permissions: ["CAMERA", "RECORD_AUDIO", "NOTIFICATIONS", "POST_NOTIFICATIONS"],
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: ["5sek.app", "www.5sek.app"].flatMap((host) =>
            ["/a/", "/c/", "/q/", "/d/", "/feed"].map((pathPrefix) => ({ scheme: "https", host, pathPrefix }))
          ),
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
    extra: {
      ...(base.extra || {}),
      apiUrl: process.env.EXPO_PUBLIC_API_URL || null,
      monetizationEnabled: isProductionBuild ? process.env.EXPO_PUBLIC_MONETIZATION_ENABLED === "true" : true,
      sentryDsn: normalizeOptionalEnv(process.env.EXPO_PUBLIC_SENTRY_DSN) || null,
      sentryEnvironment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
      sentryTracesSampleRate: process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || "0.25",
      sentryProfilesSampleRate: process.env.EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE || "0.1",
      eas: {
        ...((base.extra && base.extra.eas) || {}),
        projectId,
      },
    },
  },
});
