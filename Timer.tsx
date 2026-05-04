import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";

interface TimerProps {
  seconds: number;
  total?: number;
}

export default function Timer({ seconds, total = 5 }: TimerProps) {
  const isUrgent = seconds <= 2;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation on each tick
  useEffect(() => {
    Animated.sequence([
      Animated.timing(pulseAnim, {
        toValue: 1.3,
        duration: 150,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(pulseAnim, {
        toValue: 1,
        duration: 350,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [seconds]);

  // Flash animation when urgent
  useEffect(() => {
    if (isUrgent) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(opacityAnim, {
            toValue: 0.3,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      opacityAnim.setValue(1);
    }
  }, [isUrgent]);

  const progressPercent = (seconds / total) * 100;

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.timerCircle,
          isUrgent && styles.timerCircleUrgent,
          {
            transform: [{ scale: pulseAnim }],
            opacity: isUrgent ? opacityAnim : 1,
          },
        ]}
      >
        <Text
          style={[
            styles.timerText,
            isUrgent && styles.timerTextUrgent,
          ]}
        >
          {seconds}
        </Text>
      </Animated.View>

      {/* Progress bar */}
      <View style={styles.progressBar}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${progressPercent}%`,
              backgroundColor: isUrgent ? "#FF0000" : "#FF3366",
            },
          ]}
        />
      </View>

      {/* Time pressure label */}
      <Text style={[styles.pressureLabel, isUrgent && styles.pressureLabelUrgent]}>
        {seconds === 0
          ? "⏰ TIME'S UP!"
          : seconds === 1
          ? "🚨 LAST SECOND!"
          : seconds === 2
          ? "⚠️ HURRY!"
          : "🔴 RECORDING"}
      </Text>
    </View>
  );
}

interface CountdownOverlayProps {
  count: number; // 3, 2, 1, or 0 (GO!)
}

export function CountdownOverlay({ count }: CountdownOverlayProps) {
  const scaleAnim = useRef(new Animated.Value(0.3)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    // Reset
    scaleAnim.setValue(0.3);
    opacityAnim.setValue(0);
    glowAnim.setValue(0.2);

    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.back(1.5)),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.delay(500),
        Animated.timing(opacityAnim, {
          toValue: 0.4,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 0.75,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.25,
          duration: 350,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [count]);

  const label = count === 0 ? "GO!" : count.toString();
  const color = count === 0 ? "#00FF88" : count === 1 ? "#FFD000" : "#FF3366";
  const topLabel = count === 0 ? "GO! ⚡" : "READY?";
  const emoji = count === 0 ? "🔥" : count === 1 ? "😳" : "⚡";

  return (
    <View style={styles.countdownContainer}>
      <Animated.View style={[styles.countdownGlow, { opacity: glowAnim }]} />
      <Animated.View
        style={[
          styles.countdownCircle,
          {
            borderColor: color,
            transform: [{ scale: scaleAnim }],
            opacity: opacityAnim,
          },
        ]}
      >
        <Text style={styles.countdownTopLabel}>{topLabel}</Text>
        <Animated.Text
          style={[
            styles.countdownText,
            { color },
          ]}
        >
          {label}
        </Animated.Text>
        <Text style={styles.countdownEmoji}>{emoji}</Text>
      </Animated.View>
      <Text style={styles.countdownHint}>
        {count === 0 ? "Just go for it 😅" : "No thinking…"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    alignItems: "center",
    marginTop: -60,
  },
  timerCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(255, 51, 102, 0.2)",
    borderWidth: 3,
    borderColor: "#FF3366",
    justifyContent: "center",
    alignItems: "center",
  },
  timerCircleUrgent: {
    borderColor: "#FF0000",
    backgroundColor: "rgba(255, 0, 0, 0.3)",
  },
  timerText: {
    color: "#FF3366",
    fontSize: 48,
    fontWeight: "900",
  },
  timerTextUrgent: {
    color: "#FF0000",
  },
  progressBar: {
    width: 200,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 2,
    marginTop: 16,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },
  pressureLabel: {
    color: "#FF3366",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 8,
    letterSpacing: 1,
  },
  pressureLabelUrgent: {
    color: "#FF0000",
  },

  // Countdown overlay (3-2-1-GO!)
  countdownContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    zIndex: 100,
  },
  countdownGlow: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: "rgba(255, 51, 102, 0.18)",
  },
  countdownCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 4,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "center",
    alignItems: "center",
  },
  countdownTopLabel: {
    color: "rgba(255, 255, 255, 0.85)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 6,
  },
  countdownText: {
    fontSize: 72,
    fontWeight: "900",
  },
  countdownEmoji: {
    marginTop: 6,
    fontSize: 18,
  },
  countdownHint: {
    color: "rgba(255, 255, 255, 0.7)",
    fontSize: 16,
    fontWeight: "600",
    marginTop: 20,
    letterSpacing: 1,
  },
});
