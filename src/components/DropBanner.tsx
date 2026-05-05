import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { dropsApi } from "../services/api";
import { eventTracker } from "../services/eventTracker";
import { useNavigation } from "@react-navigation/native";

const { width } = Dimensions.get("window");

interface DropData {
  id: number;
  question_text: string;
  category: string;
  remaining_seconds: number;
  is_active: boolean;
  participants: {
    display_count: number;
  };
}

interface NextDropData {
  id: number;
  question_text: string;
  seconds_until: number;
}

interface DropBannerProps {
  country?: string;
}

export default function DropBanner({ country }: DropBannerProps) {
  const navigation = useNavigation<any>();
  const [activeDrop, setActiveDrop] = useState<DropData | null>(null);
  const [nextDrop, setNextDrop] = useState<NextDropData | null>(null);
  const [lastCompletedDropId, setLastCompletedDropId] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [joining, setJoining] = useState(false);
  const lastActiveDropIdRef = useRef<number | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(-100)).current;

  // Poll for active drops
  useEffect(() => {
    const fetchDrop = async () => {
      try {
        const res = await dropsApi.getActive(country);
        const data = res.data;

        if (data.has_active_drop && data.active_drop) {
          lastActiveDropIdRef.current = data.active_drop.id;
          setActiveDrop(data.active_drop);
          setNextDrop(null);
          setLastCompletedDropId(null);
          setCountdown(data.active_drop.remaining_seconds);
          eventTracker.dropView(data.active_drop.id);
        } else {
          // Drop just ended — show replay
          if (lastActiveDropIdRef.current && activeDrop) {
            setLastCompletedDropId(lastActiveDropIdRef.current);
            lastActiveDropIdRef.current = null;
          }
          setActiveDrop(null);

          if (data.next_drop) {
            setNextDrop(data.next_drop);
            setCountdown(data.next_drop.seconds_until);
          } else {
            setNextDrop(null);
          }
        }
      } catch (_) {}
    };

    fetchDrop();
    const interval = setInterval(fetchDrop, 15000);
    return () => clearInterval(interval);
  }, [country]);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [countdown]);

  // Slide in animation
  useEffect(() => {
    if (activeDrop || nextDrop || lastCompletedDropId) {
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [activeDrop, nextDrop, lastCompletedDropId, slideAnim]);

  // Pulse animation for active drop
  useEffect(() => {
    if (!activeDrop) return;

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [activeDrop, pulseAnim]);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (seconds >= 3600) {
      const hrs = Math.floor(seconds / 3600);
      return `${hrs}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
    }
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, []);

  const handleJoinDrop = useCallback(async () => {
    if (!activeDrop || joining) return;

    setJoining(true);
    try {
      await dropsApi.join(activeDrop.id);
      eventTracker.dropJoin(activeDrop.id);

      // Navigate to record screen with the drop question
      navigation.navigate("Record", {
        questionId: activeDrop.id,
        questionText: activeDrop.question_text,
        fromDrop: true,
      });
    } catch (_) {
    } finally {
      setJoining(false);
    }
  }, [activeDrop, joining, navigation]);

  if (!activeDrop && !nextDrop && !lastCompletedDropId) return null;

  // Active drop — full urgency mode
  if (activeDrop) {
    return (
      <Animated.View
        style={[
          styles.container,
          { transform: [{ translateY: slideAnim }, { scale: pulseAnim }] },
        ]}
      >
        <TouchableOpacity onPress={handleJoinDrop} activeOpacity={0.85}>
          <LinearGradient
            colors={["#FF1744", "#D500F9", "#651FFF"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.activeBanner}
          >
            {/* Live indicator */}
            <View style={styles.liveRow}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE DROP</Text>
              <View style={styles.countdownBadge}>
                <Ionicons name="time-outline" size={14} color="#FFF" />
                <Text style={styles.countdownText}>{formatTime(countdown)}</Text>
              </View>
            </View>

            {/* Question */}
            <Text style={styles.questionText} numberOfLines={2}>
              {activeDrop.question_text}
            </Text>

            {/* Bottom row */}
            <View style={styles.bottomRow}>
              <View style={styles.participantsBadge}>
                <Ionicons name="people" size={14} color="#FFF" />
                <Text style={styles.participantsText}>
                  🔥 {activeDrop.participants.display_count} answering now
                </Text>
              </View>

              <View style={styles.answerButton}>
                <Text style={styles.answerButtonText}>
                  {joining ? "Joining..." : "Answer now →"}
                </Text>
              </View>
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    );
  }

  // 🔥 UPGRADE 2: Drop just completed — "See how others answered"
  if (lastCompletedDropId) {
    return (
      <Animated.View
        style={[styles.container, { transform: [{ translateY: slideAnim }] }]}
      >
        <TouchableOpacity
          style={styles.replayBanner}
          onPress={() => {
            setLastCompletedDropId(null);
            // Navigate to feed — answers from drop are boosted there
            navigation.navigate("Feed");
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="play-circle" size={20} color="#B388FF" />
          <Text style={styles.replayText}>
            Drop ended — <Text style={styles.replayBold}>See how others answered →</Text>
          </Text>
        </TouchableOpacity>
      </Animated.View>
    );
  }

  // Next drop — countdown mode (FIX 3: shows fixed schedule)
  if (nextDrop && countdown > 0 && countdown < 7200) {
    return (
      <Animated.View
        style={[styles.container, { transform: [{ translateY: slideAnim }] }]}
      >
        <View style={styles.nextBanner}>
          <View style={styles.nextRow}>
            <Ionicons name="timer-outline" size={18} color="#B388FF" />
            <Text style={styles.nextText}>
              Next drop in{" "}
              <Text style={styles.nextCountdown}>{formatTime(countdown)}</Text>
            </Text>
          </View>
        </View>
      </Animated.View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 50,
    left: 12,
    right: 12,
    zIndex: 100,
  },
  activeBanner: {
    borderRadius: 16,
    padding: 16,
    gap: 10,
    shadowColor: "#FF1744",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#00FF88",
  },
  liveText: {
    color: "#FFF",
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 1.5,
    flex: 1,
  },
  countdownBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  countdownText: {
    color: "#FFF",
    fontWeight: "800",
    fontSize: 15,
    fontVariant: ["tabular-nums"],
  },
  questionText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  bottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  participantsBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  participantsText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 13,
    fontWeight: "700",
  },
  answerButton: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  answerButtonText: {
    color: "#FFF",
    fontWeight: "800",
    fontSize: 14,
  },
  nextBanner: {
    backgroundColor: "rgba(25, 20, 50, 0.92)",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(179, 136, 255, 0.25)",
  },
  nextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
  },
  nextText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontWeight: "600",
  },
  nextCountdown: {
    color: "#B388FF",
    fontWeight: "800",
    fontSize: 16,
    fontVariant: ["tabular-nums"],
  },
  replayBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(25, 20, 50, 0.92)",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(179, 136, 255, 0.3)",
  },
  replayText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  replayBold: {
    color: "#B388FF",
    fontWeight: "800",
  },
});
