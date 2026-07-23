import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Linking, Platform } from "react-native";
import { useAuth } from "./AuthContext";
import { analytics } from "../services/analytics";
import { pushApi } from "../services/api";
import { captureException, captureMessage } from "../services/observability";
import {
  cancelDailyQuestionReminder,
  scheduleDailyQuestionReminder,
} from "../services/pushRetention";

type PermissionState =
  | "unknown"
  | "unsupported"
  | "granted"
  | "denied";

type PushContextValue = {
  permission: PermissionState;
  expoPushToken: string | null;
  /** Explicit user opt-in — requests OS permission + registers token. */
  requestEnablePush: () => Promise<boolean>;
  sendTestPush: () => Promise<void>;
};

const PushContext = createContext<PushContextValue | undefined>(undefined);

function getProjectId() {
  return (
    (Constants.expoConfig?.extra as any)?.eas?.projectId ||
    (Constants.easConfig as any)?.projectId ||
    null
  );
}

function getDeviceId() {
  return (
    Device.osInternalBuildId ||
    Device.osBuildId ||
    Device.modelId ||
    Device.modelName ||
    "unknown-device"
  );
}

function resolveDeeplink(data: Record<string, unknown> | null | undefined) {
  if (!data) return null;

  if (typeof data.deeplink === "string") return data.deeplink;
  if (typeof data.url === "string") return data.url;
  return null;
}

function isExpoGo() {
  return Constants.appOwnership === "expo";
}

async function registerTokenWithBackend(token: string) {
  const projectId = getProjectId();
  await pushApi.register({
    token,
    platform: Platform.OS === "ios" ? "ios" : "android",
    device_id: getDeviceId(),
    project_id: projectId,
    app_version: Constants.expoConfig?.version || "unknown",
  });
}

export function PushProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [permission, setPermission] = useState<PermissionState>("unknown");
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);

  useEffect(() => {
    if (isExpoGo()) {
      setPermission("unsupported");
      return;
    }

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    const received = Notifications.addNotificationReceivedListener((notification) => {
      const deeplink = resolveDeeplink(notification.request.content.data as Record<string, unknown>);
      if (deeplink) {
        captureMessage(`push_received:${deeplink}`);
      }
    });

    const response = Notifications.addNotificationResponseReceivedListener((event) => {
      const deeplink = resolveDeeplink(event.notification.request.content.data as Record<string, unknown>);
      analytics.pushOpen({ deeplink: deeplink || "none" });
      if (deeplink) {
        Linking.openURL(deeplink).catch((error) => {
          captureException(error, {
            tags: {
              source: "push_open_url",
            },
          });
        });
      }
    });

    return () => {
      received.remove();
      response.remove();
    };
  }, []);

  const syncExistingGrant = useCallback(async () => {
    if (!user?.id) {
      setExpoPushToken(null);
      await cancelDailyQuestionReminder();
      return;
    }

    if (!Device.isDevice || isExpoGo()) {
      setPermission("unsupported");
      return;
    }

    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
        await Notifications.setNotificationChannelAsync("retention", {
          name: "Daily reminders",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

      const existing = await Notifications.getPermissionsAsync();
      if (existing.status !== "granted") {
        setPermission(existing.status === "denied" ? "denied" : "unknown");
        setExpoPushToken(null);
        return;
      }

      const projectId = getProjectId();
      if (!projectId) {
        setPermission("unsupported");
        captureMessage("push_project_id_missing", "warning");
        return;
      }

      const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
      const token = tokenResponse.data;
      setPermission("granted");
      setExpoPushToken(token);
      await registerTokenWithBackend(token);
      await scheduleDailyQuestionReminder();
      analytics.pushRegistered({
        platform: Platform.OS,
        source: "existing_grant",
      });
    } catch (error) {
      captureException(error, {
        tags: {
          source: "push_sync_existing",
        },
      });
    }
  }, [user?.id]);

  useEffect(() => {
    syncExistingGrant();
  }, [syncExistingGrant]);

  const requestEnablePush = useCallback(async () => {
    if (!user?.id) return false;
    if (!Device.isDevice || isExpoGo()) {
      setPermission("unsupported");
      return false;
    }

    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

      const existing = await Notifications.getPermissionsAsync();
      let finalStatus = existing.status;
      if (finalStatus !== "granted") {
        const requested = await Notifications.requestPermissionsAsync();
        finalStatus = requested.status;
      }

      if (finalStatus !== "granted") {
        setPermission("denied");
        analytics.pushPermissionDenied({
          status: finalStatus,
          source: "explicit_opt_in",
        });
        return false;
      }

      const projectId = getProjectId();
      if (!projectId) {
        setPermission("unsupported");
        captureMessage("push_project_id_missing", "warning");
        return false;
      }

      const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
      const token = tokenResponse.data;
      setPermission("granted");
      setExpoPushToken(token);
      await registerTokenWithBackend(token);
      await scheduleDailyQuestionReminder();
      analytics.pushRegistered({
        platform: Platform.OS,
        source: "explicit_opt_in",
      });
      return true;
    } catch (error) {
      captureException(error, {
        tags: {
          source: "push_explicit_opt_in",
        },
      });
      return false;
    }
  }, [user?.id]);

  const value = useMemo<PushContextValue>(
    () => ({
      permission,
      expoPushToken,
      requestEnablePush,
      async sendTestPush() {
        await pushApi.sendTest({
          title: "5SEK test push",
          body: "Push delivery is wired to this device.",
          deeplink: "five-second://feed",
          metadata: {
            source: "profile_debug",
          },
        });
      },
    }),
    [expoPushToken, permission, requestEnablePush]
  );

  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

export function usePush() {
  const context = useContext(PushContext);
  if (!context) {
    throw new Error("usePush must be used inside PushProvider");
  }

  return context;
}
