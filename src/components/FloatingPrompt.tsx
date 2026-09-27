/**
 * FloatingPrompt — "Next step" floating action prompt
 *
 * Shows one missing loop action at a time, pinned just above the tab bar.
 */

import React, { useEffect, useRef, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Animated } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useFusionLoop } from "../context/FusionLoopContext";

let Haptics: any = null;
try {
  Haptics = require("expo-haptics");
} catch (_) {}

const PROMPT_ICONS: Record<string, string> = {
  answer: "mic",
  remix: "repeat",
  comment: "chatbubble-ellipses",
  drop: "flash",
  complete: "trophy",
};

const PROMPT_GRADIENTS: Record<string, [string, string]> = {
  answer: ["#FF2D6A", "#FF5C8A"],
  remix: ["#8B5CFF", "#D500F9"],
  comment: ["#FF6D00", "#FF9100"],
  drop: ["#FF1744", "#D500F9"],
  complete: ["#00C853", "#00E676"],
};

const TOTAL_STEPS = 4;

interface FloatingPromptProps {
  onPress?: (type: string) => void;
  visible?: boolean;
  /** Prompt types the host screen already surfaces with its own CTA. */
  hideTypes?: string[];
  style?: any;
}

export default function FloatingPrompt({
  onPress,
  visible = true,
  hideTypes,
  style,
}: FloatingPromptProps) {
  const { nextPrompt, loopScore, maxScore, actions } = useFusionLoop();
  const slideAnim = useRef(new Animated.Value(100)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const shouldShow =
    visible &&
    nextPrompt &&
    nextPrompt.type !== "complete" &&
    !(hideTypes || []).includes(nextPrompt.type) &&
    loopScore < maxScore;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    if (shouldShow) {
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 8,
        tension: 50,
        useNativeDriver: true,
      }).start();

      if (nextPrompt?.urgency === "high") {
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1.03, duration: 1000, useNativeDriver: true }),
            Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
          ])
        );
        loop.start();
      }
    } else {
      Animated.timing(slideAnim, {
        toValue: 100,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
    return () => loop?.stop();
  }, [shouldShow, nextPrompt?.urgency]);

  const handlePress = useCallback(() => {
    try {
      Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Medium);
    } catch (_) {}
    if (onPress && nextPrompt) {
      onPress(nextPrompt.type);
    }
  }, [onPress, nextPrompt]);

  if (!shouldShow || !nextPrompt) return null;

  const icon = PROMPT_ICONS[nextPrompt.type] || "arrow-forward";
  const gradient = PROMPT_GRADIENTS[nextPrompt.type] || PROMPT_GRADIENTS.answer;
  const completedCount = Math.min(
    TOTAL_STEPS,
    Object.values(actions).filter((v) => v > 0).length
  );

  return (
    <Animated.View
      style={[
        styles.container,
        style,
        { transform: [{ translateY: slideAnim }, { scale: pulseAnim }] },
      ]}
    >
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={nextPrompt.text}
      >
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.promptCard}
        >
          <View style={styles.iconCircle}>
            <Ionicons name={icon as any} size={18} color="#FFF" />
          </View>

          <View style={styles.textCol}>
            <Text style={styles.promptText} numberOfLines={1}>
              {nextPrompt.text}
            </Text>
            <View style={styles.stepsRow}>
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                <View key={i} style={[styles.step, i < completedCount && styles.stepFilled]} />
              ))}
              <Text style={styles.stepsText}>
                {completedCount}/{TOTAL_STEPS} sot
              </Text>
            </View>
          </View>

          <View style={styles.ctaButton}>
            <Text style={styles.ctaText} numberOfLines={1}>
              {nextPrompt.cta}
            </Text>
            <Ionicons name="arrow-forward" size={13} color="#FFF" />
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 10,
    left: 12,
    right: 12,
    zIndex: 90,
  },
  promptCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  textCol: {
    flex: 1,
    gap: 5,
  },
  promptText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "800",
  },
  stepsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  step: {
    width: 14,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  stepFilled: {
    backgroundColor: "#FFF",
  },
  stepsText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 11,
    fontWeight: "700",
    marginLeft: 4,
  },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    maxWidth: 120,
  },
  ctaText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "800",
  },
});
