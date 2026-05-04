/**
 * FusionBadgeToast — Instant micro-dopamine popup
 *
 * Shows: "⚡ Fast answer!" / "🔥 Hot take!" / "😳 People are reacting!"
 * Auto-dismiss after 2.5 seconds. Random rewards show differently.
 *
 * Unpredictable rewards = addictive
 */

import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
} from "react-native";
import { useFusionLoop } from "../context/FusionLoopContext";

const { width } = Dimensions.get("window");

export default function FusionBadgeToast() {
  const { lastBadge, lastRandomReward, dismissBadge, dismissReward } =
    useFusionLoop();

  const slideAnim = useRef(new Animated.Value(-80)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  const activeBadge = lastBadge || (lastRandomReward ? { text: lastRandomReward.message, timestamp: Date.now() } : null);

  useEffect(() => {
    if (!activeBadge) return;

    // Enter animation
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 4,
        tension: 100,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto-dismiss after 2.5s
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -80,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        if (lastBadge) dismissBadge();
        if (lastRandomReward) dismissReward();
      });
    }, 2500);

    return () => clearTimeout(timer);
  }, [activeBadge?.text]);

  if (!activeBadge) return null;

  const isRandom = !lastBadge && !!lastRandomReward;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [
            { translateY: slideAnim },
            { scale: scaleAnim },
          ],
          opacity: fadeAnim,
        },
      ]}
      pointerEvents="none"
    >
      <View style={[styles.toast, isRandom && styles.toastRandom]}>
        <Text style={styles.toastText}>{activeBadge.text}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 100,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 300,
  },
  toast: {
    backgroundColor: "rgba(255, 51, 102, 0.95)",
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
    shadowColor: "#FF3366",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  toastRandom: {
    backgroundColor: "rgba(101, 31, 255, 0.95)",
    shadowColor: "#651FFF",
  },
  toastText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 0.3,
  },
});
