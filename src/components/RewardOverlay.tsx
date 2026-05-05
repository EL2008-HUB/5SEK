import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useFusionLoop } from "../context/FusionLoopContext";

// Safe haptics import
let Haptics: any = null;
try {
  Haptics = require("expo-haptics");
} catch (_) {}

const { width } = Dimensions.get("window");

interface RewardData {
  response_time: number | null;
  percentile: number | null;
  message: string | null;
}

interface DailyUsage {
  used: number;
  limit: number | null;
  remaining: number | null;
  is_premium: boolean;
}

interface CreatorActivation {
  reach_label?: string | null;
  live_label?: string | null;
  cta_label?: string | null;
}

interface RewardOverlayProps {
  reward: RewardData;
  dailyUsage: DailyUsage;
  creatorActivation?: CreatorActivation | null;
  fusionLoop?: any;
  onViewFeed: () => void;
  onDone: () => void;
  onUpgrade?: () => void;
  onChallenge?: () => void;
  onShare?: () => void;
  onRemix?: () => void;
  challengeLoading?: boolean;
}

export default function RewardOverlay({
  reward,
  dailyUsage,
  creatorActivation,
  fusionLoop,
  onViewFeed,
  onDone,
  onUpgrade,
  onChallenge,
  onShare,
  onRemix,
  challengeLoading = false,
}: RewardOverlayProps) {
  const { loopScore, maxScore, actions, nextPrompt, streakDay } = useFusionLoop();
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(100)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const fireScale = useRef(new Animated.Value(0.5)).current;

  // 🔥 HAPI 3: Auto-redirect to feed after 3 seconds
  const autoRedirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Staggered entrance animation
    Animated.sequence([
      Animated.spring(fireScale, {
        toValue: 1,
        friction: 3,
        tension: 120,
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 5,
          tension: 80,
          useNativeDriver: true,
        }),
        Animated.timing(slideUp, {
          toValue: 0,
          duration: 400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(fadeIn, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // If duel challenge is available, give 5s; otherwise auto-redirect in 1.5s
    const redirectDelay = onChallenge ? 5000 : 1500;

    // Auto-redirect countdown animation
    Animated.timing(countdownAnim, {
      toValue: 0,
      duration: redirectDelay,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    // Auto-redirect to feed
    autoRedirectTimer.current = setTimeout(() => {
      onViewFeed();
    }, redirectDelay);

    return () => {
      if (autoRedirectTimer.current) {
        clearTimeout(autoRedirectTimer.current);
      }
    };
  }, []);

  const responseTimeStr = reward.response_time !== null
    ? reward.response_time.toFixed(1)
    : "5.0";

  const isFast = (reward.percentile || 0) > 50;

  return (
    <View style={styles.overlay}>
      <LinearGradient
        colors={["rgba(0,0,0,0.95)", "rgba(10,10,10,0.98)"]}
        style={styles.background}
      >
        {/* Fire emoji */}
        <Animated.Text
          style={[styles.fireEmoji, { transform: [{ scale: fireScale }] }]}
        >
          🔥
        </Animated.Text>

        {/* Main reward card */}
        <Animated.View
          style={[
            styles.rewardCard,
            {
              transform: [{ scale: scaleAnim }],
              opacity: fadeIn,
            },
          ]}
        >
          <Text style={styles.postedText}>🔥 Nice! You did it</Text>
          <Text style={styles.postedSubtext}>No judging. Just showing up.</Text>

          {/* Response time */}
          <View style={styles.timeContainer}>
            <Text style={styles.timeLabel}>Response Time</Text>
            <Text style={[styles.timeValue, isFast && styles.timeValueFast]}>
              {responseTimeStr}s
            </Text>
          </View>

          {/* Percentile badge */}
          {reward.percentile !== null && (
            <LinearGradient
              colors={isFast ? ["#00C853", "#00E676"] : ["#FF6D00", "#FF9100"]}
              style={styles.percentileBadge}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Ionicons
                name={isFast ? "flash" : "time"}
                size={20}
                color="#FFF"
              />
              <Text style={styles.percentileText}>
                {reward.message || `⚡ Faster than ${reward.percentile}% of users`}
              </Text>
            </LinearGradient>
          )}

          {/* 🔥 HAPI 3: Feed Hook CTA */}
          {creatorActivation && (
            <View style={styles.creatorLoop}>
              {creatorActivation.reach_label ? (
                <View style={styles.creatorLoopRow}>
                  <Ionicons name="eye" size={16} color="#7FE7FF" />
                  <Text style={styles.creatorLoopText}>{creatorActivation.reach_label}</Text>
                </View>
              ) : null}
              {creatorActivation.live_label ? (
                <View style={styles.creatorLoopRow}>
                  <Ionicons name="radio" size={16} color="#FFB86B" />
                  <Text style={styles.creatorLoopText}>{creatorActivation.live_label}</Text>
                </View>
              ) : null}
            </View>
          )}

          <View style={styles.feedHookContainer}>
            <Text style={styles.feedHookText}>
              {creatorActivation?.cta_label || "Shiko si u përgjigjën të tjerët 👇"}
            </Text>
            <Animated.View
              style={[
                styles.autoRedirectBar,
                {
                  width: countdownAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0%", "100%"],
                  }),
                },
              ]}
            />
          </View>
        </Animated.View>

        {/* Daily usage */}
        <Animated.View
          style={[
            styles.usageContainer,
            { transform: [{ translateY: slideUp }], opacity: fadeIn },
          ]}
        >
          {!dailyUsage.is_premium && dailyUsage.remaining !== null && (
            <View style={styles.usageBar}>
              <Text style={styles.usageText}>
                📊 {dailyUsage.used}/{dailyUsage.limit} free answers today
              </Text>
              <View style={styles.usageProgress}>
                <View
                  style={[
                    styles.usageProgressFill,
                    {
                      width: `${(dailyUsage.used / (dailyUsage.limit || 5)) * 100}%`,
                      backgroundColor:
                        dailyUsage.remaining <= 1 ? "#FF0000" : "#FF3366",
                    },
                  ]}
                />
              </View>
              {dailyUsage.remaining <= 2 && (
                <TouchableOpacity
                  style={styles.upgradeButton}
                  onPress={onUpgrade}
                >
                  <Ionicons name="diamond" size={16} color="#FFD700" />
                  <Text style={styles.upgradeText}>Go Premium - Unlimited</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </Animated.View>

        {onChallenge && (
          <Animated.View
            style={[
              styles.challengeContainer,
              { transform: [{ translateY: slideUp }], opacity: fadeIn },
            ]}
          >
            <View style={styles.challengeCard}>
              <Text style={styles.challengeTitle}>Challenge someone?</Text>
              <Text style={styles.challengeBody}>
                Turn this answer into a duel and send it back to the feed.
              </Text>

              <View style={styles.challengeRow}>
                <TouchableOpacity
                  style={styles.challengePrimary}
                  onPress={onChallenge}
                  disabled={challengeLoading}
                >
                  <LinearGradient
                    colors={["#FF3366", "#FF6B6B"]}
                    style={styles.challengePrimaryGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                  >
                    <Text style={styles.challengePrimaryText}>
                      {challengeLoading ? "Creating..." : "Yes"}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.challengeSecondary}
                  onPress={onViewFeed}
                  disabled={challengeLoading}
                >
                  <Text style={styles.challengeSecondaryText}>Skip</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        )}

        {/* 🔥 Share your answer — emotional trigger */}
        {onShare && (
          <Animated.View
            style={[
              styles.shareContainer,
              { transform: [{ translateY: slideUp }], opacity: fadeIn },
            ]}
          >
            <TouchableOpacity
              style={styles.shareButton}
              onPress={() => {
                if (autoRedirectTimer.current) clearTimeout(autoRedirectTimer.current);
                try { Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Medium); } catch (_) {}
                onShare();
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="share-social" size={20} color="#FFF" />
              <Text style={styles.shareButtonText}>That was good 👀  Share it</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* 🔥 FUSION LOOP: Next action prompt */}
        <Animated.View
          style={[
            styles.fusionSection,
            { transform: [{ translateY: slideUp }], opacity: fadeIn },
          ]}
        >
          {/* Loop progress */}
          <View style={styles.fusionProgress}>
            <View style={styles.fusionDots}>
              {['answer', 'remix', 'comment', 'drop'].map((action) => (
                <View
                  key={action}
                  style={[
                    styles.fusionDot,
                    actions[action as keyof typeof actions] > 0 && styles.fusionDotFilled,
                  ]}
                >
                  <Ionicons
                    name={
                      (action === 'answer'
                        ? 'mic'
                        : action === 'remix'
                        ? 'repeat'
                        : action === 'comment'
                        ? 'chatbubble'
                        : 'flash') as any
                    }
                    size={12}
                    color={
                      actions[action as keyof typeof actions] > 0
                        ? '#FFF'
                        : 'rgba(255,255,255,0.3)'
                    }
                  />
                </View>
              ))}
              <Text style={styles.fusionScoreText}>
                {Math.round((loopScore / maxScore) * 100)}%
              </Text>
            </View>
            {streakDay >= 2 && (
              <Text style={styles.fusionStreakText}>
                🔥 Day {streakDay} Streak
              </Text>
            )}
          </View>

          {/* Fusion badge from server */}
          {fusionLoop?.newBadge && (
            <View style={styles.fusionBadge}>
              <Text style={styles.fusionBadgeText}>{fusionLoop.newBadge}</Text>
            </View>
          )}

          {/* Next prompt CTA */}
          {nextPrompt && nextPrompt.type !== 'complete' && nextPrompt.type !== 'answer' && (
            <TouchableOpacity
              style={styles.fusionNextAction}
              onPress={() => {
                if (autoRedirectTimer.current) clearTimeout(autoRedirectTimer.current);
                if (nextPrompt.type === 'remix' && onRemix) {
                  onRemix();
                } else {
                  onViewFeed();
                }
              }}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={
                  nextPrompt.type === 'remix'
                    ? ['#651FFF', '#D500F9']
                    : nextPrompt.type === 'comment'
                    ? ['#FF6D00', '#FF9100']
                    : ['#FF1744', '#D500F9']
                }
                style={styles.fusionNextGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Text style={styles.fusionNextText}>{nextPrompt.text}</Text>
                <View style={styles.fusionNextCta}>
                  <Text style={styles.fusionNextCtaText}>{nextPrompt.cta}</Text>
                  <Ionicons name="arrow-forward" size={14} color="#FFF" />
                </View>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </Animated.View>

        {/* Action buttons */}
        <Animated.View
          style={[
            styles.actions,
            { transform: [{ translateY: slideUp }], opacity: fadeIn },
          ]}
        >
          {!onChallenge && (
            <TouchableOpacity style={styles.feedButton} onPress={() => {
              if (autoRedirectTimer.current) clearTimeout(autoRedirectTimer.current);
              onViewFeed();
            }}>
              <LinearGradient
                colors={["#FF3366", "#FF6B6B"]}
                style={styles.feedButtonGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Ionicons name="play-circle" size={22} color="#FFF" />
                <Text style={styles.feedButtonText}>Shiko përgjigjet tani</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.doneButton} onPress={() => {
            if (autoRedirectTimer.current) clearTimeout(autoRedirectTimer.current);
            onDone();
          }}>
            <Text style={styles.doneButtonText}>Përgjigju një pyetje tjetër</Text>
          </TouchableOpacity>
        </Animated.View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 200,
  },
  background: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  fireEmoji: {
    fontSize: 64,
    marginBottom: 20,
  },
  rewardCard: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 24,
    padding: 28,
    width: width - 48,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 51, 102, 0.2)",
  },
  postedText: {
    color: "#FFF",
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: 8,
    textAlign: "center",
  },
  postedSubtext: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 18,
  },
  timeContainer: {
    alignItems: "center",
    marginBottom: 20,
  },
  timeLabel: {
    color: "#888",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  timeValue: {
    color: "#FF3366",
    fontSize: 56,
    fontWeight: "900",
  },
  timeValueFast: {
    color: "#00E676",
  },
  percentileBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 30,
    gap: 8,
  },
  percentileText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "700",
  },
  creatorLoop: {
    width: "100%",
    marginTop: 16,
    gap: 8,
  },
  creatorLoopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  creatorLoopText: {
    flex: 1,
    color: "rgba(255,255,255,0.86)",
    fontSize: 13,
    fontWeight: "700",
  },
  usageContainer: {
    marginTop: 20,
    width: width - 48,
  },
  challengeContainer: {
    marginTop: 16,
    width: width - 48,
  },
  usageBar: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
  },
  usageText: {
    color: "#AAA",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  usageProgress: {
    width: "100%",
    height: 6,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 3,
    overflow: "hidden",
  },
  usageProgressFill: {
    height: "100%",
    borderRadius: 3,
  },
  upgradeButton: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    backgroundColor: "rgba(255, 215, 0, 0.1)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 215, 0, 0.3)",
  },
  upgradeText: {
    color: "#FFD700",
    fontSize: 13,
    fontWeight: "700",
  },
  challengeCard: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 51, 102, 0.14)",
  },
  challengeTitle: {
    color: "#FFF",
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 6,
  },
  challengeBody: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    textAlign: "center",
    marginBottom: 14,
  },
  challengeRow: {
    flexDirection: "row",
    gap: 10,
  },
  challengePrimary: {
    flex: 1,
    borderRadius: 20,
    overflow: "hidden",
  },
  challengePrimaryGradient: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  challengePrimaryText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "800",
  },
  challengeSecondary: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  challengeSecondaryText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 15,
    fontWeight: "800",
  },
  actions: {
    marginTop: 28,
    width: width - 48,
    gap: 12,
  },
  feedButton: {
    borderRadius: 30,
    overflow: "hidden",
  },
  feedButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 8,
  },
  feedButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "700",
  },
  doneButton: {
    alignItems: "center",
    paddingVertical: 14,
  },
  doneButtonText: {
    color: "#888",
    fontSize: 14,
    fontWeight: "600",
  },
  // 🔥 Share your answer button
  shareContainer: {
    marginTop: 12,
    width: width - 48,
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(255,51,102,0.12)",
    borderRadius: 20,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "rgba(255,51,102,0.2)",
  },
  shareButtonText: {
    color: "#FF6B8A",
    fontSize: 14,
    fontWeight: "700",
  },
  // 🔥 HAPI 3: Feed hook styles
  feedHookContainer: {
    marginTop: 20,
    alignItems: "center",
    width: "100%",
  },
  feedHookText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 10,
    textAlign: "center",
  },
  autoRedirectBar: {
    height: 3,
    backgroundColor: "#FF3366",
    borderRadius: 1.5,
    alignSelf: "flex-start",
  },
  // 🔥 Fusion Loop styles
  fusionSection: {
    width: "100%",
    marginTop: 16,
    alignItems: "center",
  },
  fusionProgress: {
    alignItems: "center",
    gap: 6,
  },
  fusionDots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  fusionDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  fusionDotFilled: {
    backgroundColor: "#FF3366",
    borderColor: "#FF3366",
  },
  fusionScoreText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontWeight: "800",
    marginLeft: 4,
  },
  fusionStreakText: {
    color: "#FFB86B",
    fontSize: 13,
    fontWeight: "800",
  },
  fusionBadge: {
    backgroundColor: "rgba(255, 51, 102, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(255, 51, 102, 0.4)",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginTop: 8,
  },
  fusionBadgeText: {
    color: "#FF6B8A",
    fontSize: 14,
    fontWeight: "800",
  },
  fusionNextAction: {
    width: "100%",
    marginTop: 12,
    borderRadius: 16,
    overflow: "hidden",
  },
  fusionNextGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  fusionNextText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "800",
    flex: 1,
  },
  fusionNextCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  fusionNextCtaText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "800",
  },
});
