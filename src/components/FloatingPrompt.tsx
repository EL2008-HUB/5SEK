/**
 * FloatingPrompt — "Next step" floating action prompt
 *
 * Always visible when there's a missing loop action.
 * Shows: "👀 What would YOU say?" / "🔥 Remix this in 5s" / "💬 See reactions"
 *
 * Zero thinking → just one action visible at a time.
 */

import React, { useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useFusionLoop } from "../context/FusionLoopContext";

const { width } = Dimensions.get("window");

// Safe haptics
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
  answer: ["#FF3366", "#FF6B6B"],
  remix: ["#651FFF", "#D500F9"],
  comment: ["#FF6D00", "#FF9100"],
  drop: ["#FF1744", "#D500F9"],
  complete: ["#00C853", "#00E676"],
};

interface FloatingPromptProps {
  onPress?: (type: string) => void;
  visible?: boolean;
  style?: any;
}

export default function FloatingPrompt({
  onPress,
  visible = true,
  style,
}: FloatingPromptProps) {
  const { nextPrompt, loopScore, maxScore, actions, loopPct, nearComplete } = useFusionLoop();
  const slideAnim = useRef(new Animated.Value(100)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const shouldShow =
    visible && nextPrompt && nextPrompt.type !== "complete" && loopScore < maxScore;

  useEffect(() => {
    if (shouldShow) {
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 8,
        tension: 50,
        useNativeDriver: true,
      }).start();

      // Pulse for high urgency
      if (nextPrompt?.urgency === "high") {
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 1.05,
              duration: 1000,
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 1,
              duration: 1000,
              useNativeDriver: true,
            }),
          ])
        ).start();
      }
    } else {
      Animated.timing(slideAnim, {
        toValue: 100,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
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
  const gradient = PROMPT_GRADIENTS[nextPrompt.type] || ["#FF3366", "#FF6B6B"];
  const completedCount = Object.values(actions).filter((v) => v > 0).length;
  const pct = loopPct || Math.round((loopScore / maxScore) * 100);

  return (
    <Animated.View
      style={[
        styles.container,
        style,
        {
          transform: [
            { translateY: slideAnim },
            { scale: pulseAnim },
          ],
        },
      ]}
    >
      <TouchableOpacity onPress={handlePress} activeOpacity={0.85}>
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.promptCard}
        >
          {/* Loop progress dots */}
          <View style={styles.dotsRow}>
            {[0, 1, 2, 3].map((i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i < completedCount && styles.dotFilled,
                ]}
              />
            ))}
          </View>

          <View style={styles.contentRow}>
            <View style={styles.iconCircle}>
              <Ionicons name={icon as any} size={20} color="#FFF" />
            </View>

            <View style={styles.textCol}>
              <Text style={styles.promptText}>{nextPrompt.text}</Text>
              <Text style={styles.scoreText}>
                {pct}% loop
              </Text>
            </View>

            <View style={styles.ctaButton}>
              <Text style={styles.ctaText}>{nextPrompt.cta}</Text>
              <Ionicons name="arrow-forward" size={14} color="#FFF" />
            </View>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 90,
    left: 12,
    right: 12,
    zIndex: 90,
  },
  promptCard: {
    borderRadius: 18,
    padding: 14,
    shadowColor: "#FF3366",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginBottom: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  dotFilled: {
    backgroundColor: "#FFF",
  },
  contentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  textCol: {
    flex: 1,
  },
  promptText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 20,
  },
  scoreText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  ctaText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "800",
  },
});
