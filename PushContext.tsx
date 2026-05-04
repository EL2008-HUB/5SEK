import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Linking, Platform } from "react-native";
import { useAuth } from "./AuthContext";
import { analytics } from "../services/analytics";
import { pushApi } from "../services/api";
import { captureException, captureMessage } from "../services/observability";

type PermissionState =
  | "unknown"
  | "unsupported"
  | "granted"
  | "denied";

type PushContextValue = {
  permission: PermissionState;
  expoPushToken: string | null;
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

  useEffect(() => {
    async function syncPushRegistration() {
      if (!user?.id) {
        setExpoPushToken(null);
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
            importance: Notifications.AndroidImportance.MAX,
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
          });
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

        await pushApi.register({
          token,
          platform: Platform.OS === "ios" ? "ios" : "android",
          device_id: getDeviceId(),
          project_id: projectId,
          app_version: Constants.expoConfig?.version || "unknown",
        });

        analytics.pushRegistered({
          platform: Platform.OS,
        });
      } catch (error) {
        captureException(error, {
          tags: {
            source: "push_registration",
          },
        });
      }
    }

    syncPushRegistration();
  }, [user?.id]);

  const value = useMemo<PushContextValue>(
    () => ({
      permission,
      expoPushToken,
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
    [expoPushToken, permission]
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
