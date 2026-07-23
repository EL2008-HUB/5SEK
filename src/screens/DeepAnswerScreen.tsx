/**
 * DeepAnswerScreen v2 — Viral Deep Link Landing
 *
 * FLOW:
 *   TikTok/Instagram video → click link → DeepAnswerScreen
 *   → Shows answer full-screen
 *   → "Can you answer this?" CTA
 *   → Tap → RecordScreen (answer the same question)
 *   → After recording → Feed
 *
 * TRACKING:
 *   share_open → view → answer_from_share
 */
import React, { useCallback, useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import StatePanel from "../components/StatePanel";
import VideoCard from "../components/VideoCard";
import { answersApi, shareApi } from "../services/api";
import { eventTracker } from "../services/eventTracker";

export default function DeepAnswerScreen({ route, navigation }: any) {
  const answerId = Number(route?.params?.answerId);
  const [answer, setAnswer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatorStats, setCreatorStats] = useState<any>(null);
  const fadeIn = useRef(new Animated.Value(0)).current;
  const ctaScale = useRef(new Animated.Value(0.8)).current;
  const ctaPulse = useRef(new Animated.Value(1)).current;
  const trackedOpenRef = useRef(false);

  const loadAnswer = useCallback(() => {
    if (!answerId || Number.isNaN(answerId)) {
      setError("This link looks incomplete.");
      setLoading(false);
      setAnswer(null);
      return;
    }

    setLoading(true);
    setError(null);

    if (!trackedOpenRef.current) {
      trackedOpenRef.current = true;
      shareApi.trackEvent(answerId, "share_open").catch(() => {});
      eventTracker.shareOpen(answerId);
    }

    answersApi
      .getById(answerId)
      .then((res: any) => {
        setAnswer(res.data);
        setLoading(false);

        fadeIn.setValue(0);
        ctaScale.setValue(0.8);

        Animated.parallel([
          Animated.timing(fadeIn, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.spring(ctaScale, {
            toValue: 1,
            friction: 6,
            tension: 80,
            useNativeDriver: true,
          }),
        ]).start();

        Animated.loop(
          Animated.sequence([
            Animated.timing(ctaPulse, {
              toValue: 1.05,
              duration: 1200,
              useNativeDriver: true,
            }),
            Animated.timing(ctaPulse, {
              toValue: 1,
              duration: 1200,
              useNativeDriver: true,
            }),
          ])
        ).start();

        eventTracker.view(answerId, 0);

        shareApi
          .getCreatorStats(answerId)
          .then((statsRes: any) => setCreatorStats(statsRes.data))
          .catch(() => {});
      })
      .catch(() => {
        setError("We couldn't open this answer. It may have been removed.");
        setLoading(false);
        setAnswer(null);
      });
  }, [answerId, ctaPulse, ctaScale, fadeIn]);

  useEffect(() => {
    loadAnswer();
  }, [loadAnswer]);

  const goToFeed = () => {
    try {
      navigation.navigate("Main", { screen: "Feed" });
    } catch (_) {
      navigation.replace("Main");
    }
  };

  const answerThis = () => {
    if (!answer) return;

    shareApi.trackEvent(answerId, "answer_from_share").catch(() => {});
    eventTracker.answerFromShare(answerId);

    try {
      navigation.navigate("Main", {
        screen: "Record",
        params: {
          questionId: answer.question_id,
          questionText: answer.question_text,
          fromDeepLink: true,
        },
      });
    } catch (_) {
      navigation.replace("Main");
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <LinearGradient colors={["#090C17", "#14142A"]} style={StyleSheet.absoluteFill} />
        <StatePanel variant="loading" message="Loading answer…" />
      </View>
    );
  }

  if (error || !answer) {
    return (
      <View style={styles.center}>
        <LinearGradient colors={["#090C17", "#14142A"]} style={StyleSheet.absoluteFill} />
        <StatePanel
          variant="error"
          icon="🔗"
          title="Couldn't open answer"
          message={error || "Something went wrong opening this link."}
          primaryLabel="Try again"
          onPrimaryPress={loadAnswer}
          secondaryLabel="Browse feed"
          onSecondaryPress={goToFeed}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Show the answer full-screen */}
      <VideoCard video={answer} isVisible={true} position={0} />

      {/* Persistent overlay: "Can you answer this?" */}
      <Animated.View style={[styles.persistentOverlay, { opacity: fadeIn }]}>
        <View style={styles.persistentBadge}>
          <Text style={styles.persistentText}>👀 Can you answer this?</Text>
        </View>
        <View style={styles.persistentBadge}>
          <Text style={styles.persistentText}>⏱ 5 seconds only</Text>
        </View>
      </Animated.View>

      {/* CTA overlay at bottom */}
      <Animated.View
        style={[
          styles.ctaOverlay,
          {
            opacity: fadeIn,
            transform: [{ scale: ctaScale }],
          },
        ]}
      >
        <Text style={styles.ctaHook}>Can you answer this? 😳</Text>
        <Text style={styles.ctaQuestion} numberOfLines={2}>
          {answer.question_text}
        </Text>

        {/* Creator stats (dopamine) */}
        {creatorStats && (
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Ionicons name="eye" size={14} color="#FF6B8A" />
              <Text style={styles.statText}>{creatorStats.stats?.views || 0}</Text>
            </View>
            <View style={styles.statItem}>
              <Ionicons name="chatbubble" size={14} color="#FF6B8A" />
              <Text style={styles.statText}>{creatorStats.stats?.answers || 0}</Text>
            </View>
            {creatorStats.stats?.shares > 0 && (
              <View style={styles.statItem}>
                <Ionicons name="share-social" size={14} color="#FF6B8A" />
                <Text style={styles.statText}>{creatorStats.stats.shares}</Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.ctaRow}>
          {/* Primary CTA: Answer this question */}
          <Animated.View style={{ transform: [{ scale: ctaPulse }] }}>
            <TouchableOpacity style={styles.ctaPrimary} onPress={answerThis}>
              <LinearGradient
                colors={["#FF3366", "#FF6B6B"]}
                style={styles.ctaPrimaryGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Ionicons name="mic" size={20} color="#FFF" />
                <Text style={styles.ctaPrimaryText}>Answer in 5 seconds</Text>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>

          {/* Secondary: Watch more */}
          <TouchableOpacity style={styles.ctaSecondary} onPress={goToFeed}>
            <Ionicons name="play-circle-outline" size={18} color="#FF6B8A" />
            <Text style={styles.ctaSecondaryText}>Watch more answers</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  // Persistent overlay (top)
  persistentOverlay: {
    position: "absolute",
    top: 60,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 10,
  },
  persistentBadge: {
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  persistentText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "700",
  },

  // CTA overlay (bottom)
  ctaOverlay: {
    position: "absolute",
    bottom: 100,
    left: 16,
    right: 16,
    backgroundColor: "rgba(0,0,0,0.8)",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,51,102,0.25)",
  },
  ctaHook: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 6,
  },
  ctaQuestion: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
    lineHeight: 20,
  },

  // Stats row
  statsRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 14,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    fontWeight: "600",
  },

  // CTA buttons
  ctaRow: {
    gap: 10,
  },
  ctaPrimary: {
    borderRadius: 24,
    overflow: "hidden",
  },
  ctaPrimaryGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    gap: 8,
  },
  ctaPrimaryText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "700",
  },
  ctaSecondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    gap: 6,
  },
  ctaSecondaryText: {
    color: "#FF6B8A",
    fontSize: 13,
    fontWeight: "600",
  },
});
