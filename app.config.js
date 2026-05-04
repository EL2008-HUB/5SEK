const fs = require("fs");
const path = require("path");
const appJson = require("./app.json");

function normalizeOptionalEnv(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return undefined;
  }

  if (/^REPLACE[_-]/i.test(normalized) || /^example$/i.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function loadEnvFile(filePath, { override = false } = {}) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

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

module.exports = () => ({
  expo: {
    ...base,
    scheme: "five-second",
    plugins: [
      "expo-notifications",
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
      bundleIdentifier: process.env.EXPO_PUBLIC_IOS_BUNDLE_ID || "app.fivesek.mobile",
      infoPlist: {
        ...(base.ios && base.ios.infoPlist ? base.ios.infoPlist : {}),
        NSUserNotificationsUsageDescription: "5SEK uses notifications for duels, replies, and feed reminders.",
      },
    },
    android: {
      ...base.android,
      package: process.env.EXPO_PUBLIC_ANDROID_PACKAGE || "app.fivesek.mobile",
      permissions: ["CAMERA", "RECORD_AUDIO", "NOTIFICATIONS"],
    },
    extra: {
      ...(base.extra || {}),
      apiUrl: process.env.EXPO_PUBLIC_API_URL || null,
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
