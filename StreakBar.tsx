/**
 * StreakBar — Streak lock-in + exit hook UI
 *
 * Shows: "🔥 Day 3 Streak" + loop progress ring
 * When leaving: "Your streak expires soon" + "Next drop in 2h"
 *
 * Compact bar that sits at the top of the screen.
 */

import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFusionLoop } from "../context/FusionLoopContext";

interface StreakBarProps {
  onPress?: () => void;
  compact?: boolean;
}

export default function StreakBar({ onPress, compact = false }: StreakBarProps) {
  const {
    streakDay,
    loopScore,
    maxScore,
    loopPct,
    actions,
    streakAtRisk,
    nextPrompt,
    loading,
  } = useFusionLoop();

  const glowAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Glow animation for active streaks
  useEffect(() => {
    if (streakDay >= 2) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0.4,
            duration: 1500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [streakDay]);

  // Shake for at-risk streaks
  useEffect(() => {
    if (streakAtRisk) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(shakeAnim, {
            toValue: 3,
            duration: 80,
            useNativeDriver: true,
          }),
          Animated.timing(shakeAnim, {
            toValue: -3,
            duration: 80,
            useNativeDriver: true,
          }),
          Animated.timing(shakeAnim, {
            toValue: 0,
            duration: 80,
            useNativeDriver: true,
          }),
          Animated.delay(3000),
        ])
      ).start();
    }
  }, [streakAtRisk]);

  if (loading || (streakDay === 0 && loopScore === 0)) return null;

  const streakEmoji = streakDay >= 7 ? "🔥🔥" : streakDay >= 3 ? "🔥" : "⚡";
  const pct = loopPct || Math.round((loopScore / maxScore) * 100);
  const completedActions = Object.entries(actions)
    .filter(([, v]) => (v as number) > 0)
    .map(([k]) => k);

  if (compact) {
    return (
      <TouchableOpacity
        style={styles.compactContainer}
        onPress={onPress}
        activeOpacity={0.8}
      >
        <Animated.View
          style={[
            styles.compactInner,
            streakAtRisk && styles.compactAtRisk,
            {
              transform: [{ translateX: shakeAnim }],
              opacity: streakDay >= 2
                ? glowAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.85, 1],
                  })
                : 1,
            },
          ]}
        >
          <Text style={styles.compactStreak}>
            {streakEmoji} {streakDay}
          </Text>
          <View style={styles.compactDots}>
            {[0, 1, 2, 3].map((i) => (
              <View
                key={i}
                style={[
                  styles.compactDot,
                  i < completedActions.length && styles.compactDotFilled,
                ]}
              />
            ))}
          </View>
        </Animated.View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Animated.View
        style={[
          styles.bar,
          streakAtRisk && styles.barAtRisk,
          {
            transform: [{ translateX: shakeAnim }],
          },
        ]}
      >
        {/* Left: Streak info */}
        <View style={styles.streakSection}>
          <Text style={styles.streakEmoji}>{streakEmoji}</Text>
          <View>
            <Text style={styles.streakLabel}>
              {streakAtRisk
                ? "Don't lose it!"
                : streakDay >= 2
                ? `Day ${streakDay} Streak`
                : "Start a streak!"}
            </Text>
            {streakAtRisk && (
              <Text style={styles.riskText}>⏳ Expires tonight</Text>
            )}
          </View>
        </View>

        {/* Right: Loop progress */}
        <View style={styles.loopSection}>
          <View style={styles.loopDots}>
            {["answer", "remix", "comment", "drop"].map((action) => (
              <View
                key={action}
                style={[
                  styles.loopDot,
                  completedActions.includes(action) && styles.loopDotFilled,
                ]}
              >
                <Ionicons
                  name={
                    (action === "answer"
                      ? "mic"
                      : action === "remix"
                      ? "repeat"
                      : action === "comment"
                      ? "chatbubble"
                      : "flash") as any
                  }
                  size={10}
                  color={
                    completedActions.includes(action)
                      ? "#FFF"
                      : "rgba(255,255,255,0.3)"
                  }
                />
              </View>
            ))}
          </View>
          <Text style={styles.loopLabel}>{pct}%</Text>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // ── Full bar ──
  container: {
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255, 51, 102, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 51, 102, 0.2)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  barAtRisk: {
    borderColor: "rgba(255, 69, 0, 0.5)",
    backgroundColor: "rgba(255, 69, 0, 0.1)",
  },
  streakSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  streakEmoji: {
    fontSize: 20,
  },
  streakLabel: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "800",
  },
  riskText: {
    color: "#FF6B00",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 1,
  },
  loopSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  loopDots: {
    flexDirection: "row",
    gap: 4,
  },
  loopDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  loopDotFilled: {
    backgroundColor: "#FF3366",
    borderColor: "#FF3366",
  },
  loopLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    fontWeight: "800",
  },

  // ── Compact mode ──
  compactContainer: {},
  compactInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255, 51, 102, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(255, 51, 102, 0.25)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  compactAtRisk: {
    borderColor: "rgba(255, 69, 0, 0.5)",
    backgroundColor: "rgba(255, 69, 0, 0.12)",
  },
  compactStreak: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "900",
  },
  compactDots: {
    flexDirection: "row",
    gap: 3,
  },
  compactDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  compactDotFilled: {
    backgroundColor: "#FF3366",
  },
});
