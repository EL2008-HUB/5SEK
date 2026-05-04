import React, { useRef, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Easing,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { experimentsApi } from "../services/api";

const { width, height } = Dimensions.get("window");

interface PaywallModalProps {
  answersUsed: number;
  onUpgrade: () => void;
  onClose: () => void;
  onSecondChance?: () => void; // Called when user wants "one more"
}

export default function PaywallModal({
  answersUsed,
  onUpgrade,
  onClose,
  onSecondChance,
}: PaywallModalProps) {
  const paywallVariant = experimentsApi.getCurrentAssignments().paywall_v2 || "control";
  const slideUp = useRef(new Animated.Value(height)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const streakPulse = useRef(new Animated.Value(1)).current;
  const fireScale = useRef(new Animated.Value(0)).current;
  const dotAnims = useRef(
    [1, 2, 3, 4, 5].map(() => new Animated.Value(0))
  ).current;

  const [showSecondChance, setShowSecondChance] = useState(false);

  useEffect(() => {
    // Entrance animation: staggered dots + slide up
    Animated.parallel([
      // Backdrop fade
      Animated.timing(fadeIn, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
      // Modal slide up
      Animated.spring(slideUp, {
        toValue: 0,
        friction: 9,
        tension: 55,
        useNativeDriver: true,
      }),
      // Fire emoji pop
      Animated.spring(fireScale, {
        toValue: 1,
        friction: 3,
        tension: 120,
        delay: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Staggered dot animations
    dotAnims.forEach((anim, i) => {
      Animated.spring(anim, {
        toValue: 1,
        friction: 4,
        tension: 100,
        delay: 400 + i * 100,
        useNativeDriver: true,
      }).start();
    });

    // Continuous streak pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(streakPulse, {
          toValue: 1.05,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(streakPulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const close = (triggerSecondChance = true) => {
    if (triggerSecondChance && onSecondChance && !showSecondChance) {
      // Show "Second Chance" instead of closing immediately
      setShowSecondChance(true);
      return;
    }

    Animated.parallel([
      Animated.timing(fadeIn, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(slideUp, {
        toValue: height,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  };

  // ── SECOND CHANCE VIEW ──
  if (showSecondChance) {
    return (
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: fadeIn }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={() => close(false)}
            activeOpacity={1}
          />
        </Animated.View>

        <Animated.View
          style={[styles.modal, styles.secondChanceModal, { transform: [{ translateY: slideUp }] }]}
        >
          <View style={styles.handle} />

          <Text style={styles.secondChanceEmoji}>😅</Text>
          <Text style={styles.secondChanceTitle}>One more?</Text>
          <Text style={styles.secondChanceSubtitle}>
            Watch a short video for 1 bonus answer{"\n"}or come back tomorrow
          </Text>

          {/* Bonus answer button */}
          <TouchableOpacity
            style={styles.bonusButton}
            onPress={() => {
              close(false);
              onSecondChance?.();
            }}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={["#00C853", "#00E676"]}
              style={styles.bonusGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Ionicons name="play-circle" size={20} color="#FFF" />
              <Text style={styles.bonusText}>🎬 Watch & earn 1 answer</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Go unlimited */}
          <TouchableOpacity
            style={styles.unlimitedButton}
            onPress={() => {
              close(false);
              onUpgrade();
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.unlimitedText}>
              💎 Or go unlimited — $4.99/mo
            </Text>
          </TouchableOpacity>

          {/* Dismiss */}
          <TouchableOpacity
            style={styles.dismissButton}
            onPress={() => close(false)}
          >
            <Text style={styles.dismissText}>Maybe tomorrow</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  }

  // ── MAIN PAYWALL VIEW ──
  return (
    <View style={styles.overlay}>
      <Animated.View style={[styles.backdrop, { opacity: fadeIn }]}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={() => close(true)}
          activeOpacity={1}
        />
      </Animated.View>

      <Animated.View
        style={[styles.modal, { transform: [{ translateY: slideUp }] }]}
      >
        <View style={styles.handle} />

        {/* Fire emoji — game feel */}
        <Animated.Text style={[styles.fireEmoji, { transform: [{ scale: fireScale }] }]}>
          🔥
        </Animated.Text>

        {/* Streak message (not a blocker!) */}
        <Animated.View style={{ transform: [{ scale: streakPulse }] }}>
          <Text style={styles.title}>You're on a streak!</Text>
        </Animated.View>

        <Text style={styles.subtitle}>
          You answered {answersUsed} questions ⚡
        </Text>
        <Text style={styles.subtitleMuted}>Don't stop now</Text>

        {/* Progress dots — visual achievement */}
        <View style={styles.dotsRow}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Animated.View
              key={i}
              style={[
                styles.dot,
                i <= answersUsed && styles.dotUsed,
                {
                  transform: [{ scale: dotAnims[i - 1] }],
                },
              ]}
            >
              {i <= answersUsed && (
                <Ionicons name="checkmark" size={14} color="#FFF" />
              )}
            </Animated.View>
          ))}
        </View>

        {/* What you get — minimal features */}
        <View style={styles.features}>
          <View style={styles.featureRow}>
            <Text style={styles.featureIcon}>♾️</Text>
            <Text style={styles.featureText}>Unlimited answers</Text>
          </View>
          <View style={styles.featureRow}>
            <Text style={styles.featureIcon}>⚡</Text>
            <Text style={styles.featureText}>No daily limits</Text>
          </View>
          <View style={styles.featureRow}>
            <Text style={styles.featureIcon}>💎</Text>
            <Text style={styles.featureText}>Premium badge</Text>
          </View>
        </View>

        {/* CTA — Continue (not "Buy" or "Upgrade") */}
        <TouchableOpacity style={styles.upgradeButton} onPress={onUpgrade}>
          <LinearGradient
            colors={["#FF3366", "#FF6B6B"]}
            style={styles.upgradeGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Text style={styles.upgradeText}>Continue — $4.99/mo</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Not now — always visible, no pressure */}
        <TouchableOpacity style={styles.notNowButton} onPress={() => close(true)}>
          <Text style={styles.notNowText}>Not now</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    zIndex: 400,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
  },
  modal: {
    backgroundColor: "#111114",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingBottom: 44,
    paddingHorizontal: 24,
  },
  secondChanceModal: {
    paddingBottom: 36,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 20,
  },

  // ── Fire emoji ──
  fireEmoji: {
    fontSize: 48,
    textAlign: "center",
    marginBottom: 8,
  },

  // ── Title section ──
  title: {
    color: "#FFF",
    fontSize: 26,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 6,
  },
  subtitle: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 2,
  },
  subtitleMuted: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 20,
  },

  // ── Progress dots ──
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginBottom: 24,
  },
  dot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.08)",
    justifyContent: "center",
    alignItems: "center",
  },
  dotUsed: {
    backgroundColor: "#FF3366",
    borderColor: "#FF3366",
  },

  // ── Features ──
  features: {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 18,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
    gap: 4,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 6,
  },
  featureIcon: {
    fontSize: 18,
  },
  featureText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontWeight: "600",
  },

  // ── Upgrade CTA ──
  upgradeButton: {
    borderRadius: 28,
    overflow: "hidden",
    marginBottom: 12,
  },
  upgradeGradient: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
  },
  upgradeText: {
    color: "#FFF",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.3,
  },

  // ── Not now ──
  notNowButton: {
    alignItems: "center",
    paddingVertical: 12,
  },
  notNowText: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 14,
    fontWeight: "600",
  },

  // ── Second Chance ──
  secondChanceEmoji: {
    fontSize: 56,
    textAlign: "center",
    marginBottom: 12,
  },
  secondChanceTitle: {
    color: "#FFF",
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 8,
  },
  secondChanceSubtitle: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 28,
  },
  bonusButton: {
    borderRadius: 28,
    overflow: "hidden",
    marginBottom: 12,
  },
  bonusGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    gap: 8,
  },
  bonusText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "800",
  },
  unlimitedButton: {
    alignItems: "center",
    paddingVertical: 14,
    backgroundColor: "rgba(255, 215, 0, 0.06)",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255, 215, 0, 0.15)",
    marginBottom: 8,
  },
  unlimitedText: {
    color: "#FFD700",
    fontSize: 14,
    fontWeight: "700",
  },
  dismissButton: {
    alignItems: "center",
    paddingVertical: 10,
  },
  dismissText: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 13,
    fontWeight: "600",
  },
});
