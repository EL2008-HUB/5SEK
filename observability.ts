import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";

const extra = (Constants.expoConfig?.extra || {}) as Record<string, string | undefined>;
function normalizeSentryDsn(value: string | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (/^REPLACE[_-]/i.test(normalized)) return "";

  try {
    const parsed = new URL(normalized);
    if (!parsed.protocol || !/^https?:$/.test(parsed.protocol)) {
      return "";
    }
    return normalized;
  } catch (_) {
    return "";
  }
}

const sentryDsn = normalizeSentryDsn(extra.sentryDsn || process.env.EXPO_PUBLIC_SENTRY_DSN);
const sentryEnabled = Boolean(sentryDsn);
const tracesSampleRate = Number(extra.sentryTracesSampleRate || process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0.25);
const profilesSampleRate = Number(extra.sentryProfilesSampleRate || process.env.EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE || 0.1);

export const navigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: true,
  useFullPathsForNavigationRoutes: true,
});

let installed = false;

export function installObservability() {
  if (installed) return;
  installed = true;

  try {
    Sentry.init({
      dsn: sentryDsn || undefined,
      enabled: sentryEnabled,
      environment: extra.sentryEnvironment || process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT || (__DEV__ ? "development" : "production"),
      integrations: sentryEnabled ? [navigationIntegration] : [],
      tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.25,
      profilesSampleRate: Number.isFinite(profilesSampleRate) ? profilesSampleRate : 0.1,
      attachStacktrace: true,
      sendDefaultPii: false,
      enableAutoSessionTracking: true,
      debug: __DEV__ && sentryEnabled,
    });
  } catch (e) {
    console.error("[Observability] Sentry init failed:", e);
    // Continue without Sentry
  }

  try {
    const globalErrorUtils = (global as any).ErrorUtils;
    const originalHandler =
      globalErrorUtils && typeof globalErrorUtils.getGlobalHandler === "function"
        ? globalErrorUtils.getGlobalHandler()
        : null;

    if (globalErrorUtils && typeof globalErrorUtils.setGlobalHandler === "function") {
      globalErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
        captureException(error, {
          tags: {
            source: "global_error_handler",
            fatal: String(Boolean(isFatal)),
          },
        });

        if (originalHandler) {
          originalHandler(error, isFatal);
        }
      });
    }
  } catch (e) {
    console.error("[Observability] Error handler setup failed:", e);
  }
}

export function setObservabilityUser(user: { id: number | string; username?: string; email?: string } | null) {
  if (!user) {
    Sentry.setUser(null);
    return;
  }

  Sentry.setUser({
    id: String(user.id),
    username: user.username,
    email: user.email,
  });
}

export function captureException(error: unknown, context?: Parameters<typeof Sentry.captureException>[1]) {
  if (!sentryEnabled) return;
  Sentry.captureException(error, context);
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = "info") {
  if (!sentryEnabled) return;
  Sentry.captureMessage(message, level);
}

export { Sentry };
