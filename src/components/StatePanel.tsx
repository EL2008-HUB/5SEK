import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

type StatePanelProps = {
  variant: "loading" | "empty" | "error";
  title?: string;
  message?: string;
  icon?: string;
  primaryLabel?: string;
  onPrimaryPress?: () => void;
  secondaryLabel?: string;
  onSecondaryPress?: () => void;
  /** Use inside ScrollView sections where flex:1 would collapse. */
  compact?: boolean;
};

/**
 * Shared empty / error / loading surface for core screens.
 * Keeps the product feeling consistent when data is missing or the network fails.
 */
export default function StatePanel({
  variant,
  title,
  message,
  icon,
  primaryLabel,
  onPrimaryPress,
  secondaryLabel,
  onSecondaryPress,
  compact = false,
}: StatePanelProps) {
  const wrapStyle = [styles.wrap, compact && styles.wrapCompact];

  if (variant === "loading") {
    return (
      <View style={wrapStyle}>
        <ActivityIndicator size="large" color="#FF3366" />
        {message ? <Text style={styles.loadingText}>{message}</Text> : null}
      </View>
    );
  }

  const resolvedIcon = icon || (variant === "error" ? "📡" : "🎬");
  const resolvedTitle =
    title || (variant === "error" ? "Something went wrong" : "Nothing here yet");
  const resolvedMessage =
    message ||
    (variant === "error"
      ? "Check your connection and try again."
      : "Be the first to start this conversation.");

  return (
    <View style={wrapStyle}>
      <Text style={styles.icon}>{resolvedIcon}</Text>
      <Text style={styles.title}>{resolvedTitle}</Text>
      <Text style={styles.message}>{resolvedMessage}</Text>

      {primaryLabel && onPrimaryPress ? (
        <TouchableOpacity onPress={onPrimaryPress} activeOpacity={0.9} style={styles.primaryWrap}>
          <LinearGradient
            colors={variant === "error" ? ["#FF5A7A", "#FF3366"] : ["#6EEDC1", "#48D9B5"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.primaryBtn}
          >
            <Text style={[styles.primaryText, variant === "error" && styles.primaryTextOnDark]}>
              {primaryLabel}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      ) : null}

      {secondaryLabel && onSecondaryPress ? (
        <TouchableOpacity onPress={onSecondaryPress} style={styles.secondaryBtn} activeOpacity={0.85}>
          <Text style={styles.secondaryText}>{secondaryLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 10,
  },
  wrapCompact: {
    flex: 0,
    paddingVertical: 28,
  },
  loadingText: {
    marginTop: 14,
    color: "rgba(255,255,255,0.55)",
    fontSize: 14,
    fontWeight: "700",
  },
  icon: {
    fontSize: 44,
    marginBottom: 4,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  message: {
    color: "rgba(229,240,248,0.58)",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    fontWeight: "600",
    maxWidth: 300,
    marginBottom: 8,
  },
  primaryWrap: {
    borderRadius: 14,
    overflow: "hidden",
    marginTop: 6,
    minWidth: 180,
  },
  primaryBtn: {
    minHeight: 48,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: {
    color: "#071117",
    fontSize: 15,
    fontWeight: "900",
  },
  primaryTextOnDark: {
    color: "#FFFFFF",
  },
  secondaryBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: {
    color: "rgba(229,240,248,0.5)",
    fontSize: 13,
    fontWeight: "700",
  },
});
