import React, { useEffect, useState } from "react";
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { usePush } from "../context/PushContext";
import {
  dismissPushSoftPrompt,
  markPushSoftPromptShown,
  shouldShowPushSoftPrompt,
} from "../services/pushRetention";
import { analytics } from "../services/analytics";

type Props = {
  /** Compact strip for Home; full card for Profile. */
  compact?: boolean;
};

/**
 * Soft push opt-in — never ambushes the system permission dialog on cold start.
 */
export default function PushOptInBanner({ compact = false }: Props) {
  const { permission, requestEnablePush } = usePush();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (permission === "granted" || permission === "unsupported") {
        if (!cancelled) setVisible(false);
        return;
      }
      const ok = await shouldShowPushSoftPrompt();
      if (!cancelled) setVisible(ok);
      if (ok && !cancelled) {
        await markPushSoftPromptShown();
        analytics.pushPermissionDenied({ soft_prompt: "shown", compact });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [permission, compact]);

  if (!visible) return null;

  const isDenied = permission === "denied";

  const onEnable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isDenied) {
        analytics.pushPermissionDenied({ soft_prompt: "open_settings" });
        if (Platform.OS === "ios") {
          await Linking.openURL("app-settings:");
        } else {
          await Linking.openSettings();
        }
      } else {
        analytics.pushRegistered({ soft_prompt: "accepted" });
        const granted = await requestEnablePush();
        if (granted) setVisible(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const onDismiss = async () => {
    await dismissPushSoftPrompt();
    analytics.pushPermissionDenied({ soft_prompt: "dismissed" });
    setVisible(false);
  };

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <LinearGradient
        colors={["rgba(255,51,102,0.16)", "rgba(255,51,102,0.05)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View style={styles.copy}>
          <Text style={styles.title}>
            {isDenied ? "Notifications are off" : "Don't miss today's question"}
          </Text>
          <Text style={styles.body}>
            {isDenied
              ? "Turn them on in Settings to get streak and daily reminders."
              : "Get a quiet daily ping when the new 5-second question drops."}
          </Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.primary} onPress={onEnable} activeOpacity={0.9}>
            <Text style={styles.primaryText}>
              {isDenied ? "Open Settings" : busy ? "…" : "Enable"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismiss} hitSlop={8}>
            <Text style={styles.secondary}>Not now</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  wrapCompact: {
    marginTop: 8,
    marginBottom: 4,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,51,102,0.28)",
    padding: 14,
    gap: 12,
  },
  copy: {
    gap: 4,
  },
  title: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "800",
  },
  body: {
    color: "rgba(229,240,248,0.62)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  primary: {
    backgroundColor: "#FF3366",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "900",
  },
  secondary: {
    color: "rgba(229,240,248,0.5)",
    fontSize: 13,
    fontWeight: "700",
  },
});
