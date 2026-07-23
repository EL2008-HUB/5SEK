import React from "react";
import { StyleSheet, Text, View } from "react-native";

export type ChaosThreadMeta = {
  score?: number;
  chain_heat?: number;
  level?: "LOW" | "MEDIUM" | "HIGH" | "NUCLEAR" | string;
  label?: string;
  emoji?: string;
  remix_count?: number;
  joined_count?: number;
  comment_count?: number;
  user_started_this?: boolean;
  continue_chain_cta?: string;
  join_overlay?: {
    reply_count?: number;
    countdown_seconds?: number;
    blurred_previews?: Array<{ username?: string; label?: string; preview?: string | null }>;
  } | null;
};

type Props = {
  chaos: ChaosThreadMeta;
  compact?: boolean;
};

export default function ChaosMeter({ chaos, compact = false }: Props) {
  const score = Math.round(chaos.chain_heat ?? chaos.score ?? 0);
  const label = chaos.label || `${chaos.emoji || "🔥"} Chaos thread`;

  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(8, Math.min(100, score))}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 14,
    padding: 10,
    backgroundColor: "rgba(255,90,122,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,90,122,0.25)",
    gap: 6,
  },
  compact: {
    paddingVertical: 8,
  },
  label: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  track: {
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#FF3366",
  },
});
