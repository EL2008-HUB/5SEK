const fs = require("fs");
const path = require("path");
const appJson = require("./app.json");

function normalizeOptionalEnv(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  if (!normalized) return undefined;
  if (/^REPLACE[_-]/i.test(normalized) || /^example$/i.test(normalized)) return undefined;
  if (/^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(normalized)) return undefined;
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

const appRoot = __dirname;
loadEnvFile(path.join(appRoot, ".env"));
loadEnvFile(path.join(appRoot, ".env.local"), { override: true });

const appEnv = process.env.APP_ENV || process.env.NODE_ENV || "development";
const isCloudBuild = appEnv === "preview" || appEnv === "production" || process.env.EAS_BUILD === "true";
if (!isCloudBuild) {
  loadEnvFile(path.join(appRoot, `.env.${appEnv}`));
  loadEnvFile(path.join(appRoot, `.env.${appEnv}.local`), { override: true });
}

const base = appJson.expo || {};
const projectId =
  normalizeOptionalEnv(process.env.EXPO_PUBLIC_EAS_PROJECT_ID) ||
  normalizeOptionalEnv(process.env.EAS_PROJECT_ID) ||
  (base.extra && base.extra.eas && base.extra.eas.projectId) ||
  undefined;
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
          cameraPermission: "5SEK përdor kamerën për të regjistruar përgjigjet video 5-sekondëshe.",
          microphonePermission: "5SEK përdor mikrofonin për të regjistruar përgjigjet me zë dhe video.",
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
        NSUserNotificationsUsageDescription: "5SEK të njofton për duelet, përgjigjet dhe pyetjen e ditës.",
        NSCameraUsageDescription: "5SEK përdor kamerën për të regjistruar përgjigjet video 5-sekondëshe.",
        NSMicrophoneUsageDescription: "5SEK përdor mikrofonin për të regjistruar përgjigjet me zë dhe video.",
        NSPhotoLibraryUsageDescription: "5SEK hap galerinë vetëm kur zgjedh vetë një media për përgjigje.",
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      ...base.android,
      package: androidPackage,
      permissions: [
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.VIBRATE",
      ],
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
      apiUrl:
        normalizeOptionalEnv(process.env.EXPO_PUBLIC_API_URL) ||
        (appEnv === "development" ? null : "https://5sek-api.onrender.com/api"),
      webUrl: normalizeOptionalEnv(process.env.EXPO_PUBLIC_WEB_URL) || null,
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
