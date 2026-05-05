import React, { useState, useRef, useEffect } from "react";
import {
  Linking,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Animated,
  Easing,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import RewardOverlay from "../components/RewardOverlay";
import PaywallModal from "../components/PaywallModal";
import { useAuth } from "../context/AuthContext";
import { answersApi, duelsApi, paywallApi, paymentsApi } from "../services/api";
import { isFeatureEnabled } from "../services/featureFlags";
import { showAppAlert } from "../utils/alerts";
import { canShowPaywall, markPaywallShown } from "../utils/paywallCooldown";

const { width } = Dimensions.get("window");
const MAX_SECONDS = 5;
const MAX_CHARS = 120;

type Phase = "idle" | "countdown" | "typing" | "submitting" | "reward";

export default function TextAnswerScreen({ route, navigation }: any) {
  const question = route?.params?.question || {
    id: route?.params?.questionId,
    text: route?.params?.questionText,
  };
  const { user } = useAuth();

  const [phase, setPhase] = useState<Phase>("idle");
  const [countdown, setCountdown] = useState(MAX_SECONDS);
  const [text, setText] = useState("");
  const [startTime, setStartTime] = useState(0);
  const [rewardData, setRewardData] = useState<any>(null);
  const [dailyUsage, setDailyUsage] = useState<any>(null);
  const [creatorActivation, setCreatorActivation] = useState<any>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [latestPostedAnswer, setLatestPostedAnswer] = useState<any>(null);
  const [creatingDuel, setCreatingDuel] = useState(false);

  // Animations
  const timerScale = useRef(new Animated.Value(1)).current;
  const timerOpacity = useRef(new Animated.Value(1)).current;
  const cardSlide = useRef(new Animated.Value(60)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;

  const inputRef = useRef<TextInput>(null);

  const goFeed = () => {
    if (typeof navigation.jumpTo === "function") navigation.jumpTo("Feed");
    else navigation.navigate("Feed");
  };

  // ── Countdown 5→4→3→2→1→0 then open typing ──
  useEffect(() => {
    if (phase !== "countdown") return;

    if (countdown === 0) {
      // Transition to typing
      setPhase("typing");
      setStartTime(Date.now());
      Animated.parallel([
        Animated.timing(cardSlide, { toValue: 0, duration: 350, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(cardOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start(() => inputRef.current?.focus());
      return;
    }

    // Pulse animation on each tick
    Animated.sequence([
      Animated.timing(timerScale, { toValue: 1.4, duration: 120, useNativeDriver: true }),
      Animated.timing(timerScale, { toValue: 1, duration: 380, useNativeDriver: true }),
    ]).start();

    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // ── Auto-submit when 5s typing window closes ──
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (phase !== "typing") return;

    typingTimerRef.current = setTimeout(() => {
      if (text.trim().length > 0) handleSubmit();
      else {
        // No text — go back to idle
        resetToIdle();
      }
    }, MAX_SECONDS * 1000);

    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, [phase]);

  const startCountdown = async () => {
    // Check daily limit
    try {
      if (!user?.id) return;
      const usageRes = await answersApi.getDailyUsage(user.id);
      const usage = usageRes.data;
      if (!usage.is_premium && usage.remaining !== null && usage.remaining <= 0) {
        // 🔥 SOFT PAYWALL: Check cooldown
        const shouldShow = await canShowPaywall();
        if (shouldShow) {
          setDailyUsage(usage);
          setShowPaywall(true);
          await markPaywallShown();
          paywallApi.trackEvent("paywall_shown", {
            screen: "text_answer",
            answers_used: usage.used,
          }, user.id).catch(() => {});
        }
        return;
      }
    } catch (_) {}

    setCountdown(MAX_SECONDS);
    setPhase("countdown");
  };

  const handleSubmit = async () => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (!text.trim()) return;

    setPhase("submitting");
    const responseTime = Math.min((Date.now() - startTime) / 1000, MAX_SECONDS);

    try {
      // Save as a text answer — use a placeholder video_url with the text embedded
      const result = await answersApi.create(
        user?.id || 0,
        question?.id || 1,
        null,
        parseFloat(responseTime.toFixed(1)),
        {
          answer_type: "text",
          text_content: text.trim(),
        }
      );

      console.log("[TextAnswer] Posted OK, id:", result.data?.id);

      setLatestPostedAnswer({
        id: result.data?.id,
        question_id: question?.id,
        answer_type: "text",
        text_content: text.trim(),
      });

      setRewardData(result.data.reward || { response_time: responseTime, percentile: null, message: null });
      setDailyUsage(result.data.daily_usage || { used: 1, limit: 5, remaining: 4, is_premium: false });
      setCreatorActivation(result.data.creator_activation || null);
      setPhase("reward");
    } catch (error: any) {
      if (error?.response?.status === 403) {
        const errData = error.response.data;
        setDailyUsage({ used: errData.answers_used || 5, limit: 5, remaining: 0, is_premium: false });
        const shouldShow = await canShowPaywall();
        if (shouldShow) {
          setShowPaywall(true);
          await markPaywallShown();
          paywallApi.trackEvent("paywall_shown", { screen: "text_answer", trigger: "submit_403" }, user?.id).catch(() => {});
        }
        setPhase("idle");
        return;
      }
      setPhase("typing");
    }
  };

  const resetToIdle = () => {
    setPhase("idle");
    setCountdown(MAX_SECONDS);
    setText("");
    setRewardData(null);
    setLatestPostedAnswer(null);
    setCreatorActivation(null);
    cardSlide.setValue(60);
    cardOpacity.setValue(0);
  };

  const isUrgent = countdown <= 2;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <LinearGradient colors={["#0A0A0A", "#101022", "#0A0A0A"]} style={StyleSheet.absoluteFill} />
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color="#FFF" />
        </TouchableOpacity>
        <View style={styles.modeBadge}>
          <Ionicons name="create-outline" size={14} color="#FF3366" />
          <Text style={styles.modeBadgeText}>Text Answer</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Question card */}
        <View style={styles.questionCard}>
          <Text style={styles.questionText}>
            {question?.text || "What's on your mind?"}
          </Text>
          <Text style={styles.questionSub}>You have 5 seconds to type ⌨️</Text>
        </View>

        {/* IDLE — start button */}
        {phase === "idle" && (
          <TouchableOpacity style={styles.startBtn} onPress={startCountdown} activeOpacity={0.9}>
            <LinearGradient colors={["#FF3366", "#FF6B6B"]} style={styles.startBtnGradient}>
              <Ionicons name="create" size={20} color="#FFF" />
              <Text style={styles.startBtnText}>⚡ Type in 5 seconds</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* COUNTDOWN */}
        {phase === "countdown" && (
          <View style={styles.countdownWrap}>
            <Text style={styles.countdownLabel}>GET READY TO TYPE…</Text>
            <Animated.Text
              style={[
                styles.countdownNum,
                { transform: [{ scale: timerScale }], color: isUrgent ? "#FF0000" : "#FF3366" },
              ]}
            >
              {countdown}
            </Animated.Text>
            <Text style={styles.countdownHint}>First thing that comes to mind 😅</Text>
          </View>
        )}

        {/* TYPING */}
        {(phase === "typing" || phase === "submitting") && (
          <Animated.View
            style={[styles.typingCard, { transform: [{ translateY: cardSlide }], opacity: cardOpacity }]}
          >
            {/* Live timer bar */}
            <LiveTimerBar startTime={startTime} maxSeconds={MAX_SECONDS} />

            <TextInput
              ref={inputRef}
              style={styles.textInput}
              placeholder="Type your answer…"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={text}
              onChangeText={(t) => setText(t.slice(0, MAX_CHARS))}
              multiline
              maxLength={MAX_CHARS}
              autoFocus
              editable={phase === "typing"}
            />

            <View style={styles.typingFooter}>
              <Text style={styles.charCount}>{text.length}/{MAX_CHARS}</Text>
              <TouchableOpacity
                style={[styles.submitBtn, !text.trim() && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={!text.trim() || phase === "submitting"}
              >
                <LinearGradient
                  colors={text.trim() ? ["#FF3366", "#FF6B6B"] : ["#333", "#333"]}
                  style={styles.submitBtnGradient}
                >
                  <Text style={styles.submitBtnText}>
                    {phase === "submitting" ? "Posting…" : "🚀 Post"}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}
      </ScrollView>

      {/* Reward overlay */}
      {phase === "reward" && rewardData && (
        <RewardOverlay
          reward={rewardData}
          dailyUsage={dailyUsage || { used: 1, limit: 5, remaining: 4, is_premium: false }}
          creatorActivation={creatorActivation}
          onViewFeed={() => { resetToIdle(); goFeed(); }}
          onDone={resetToIdle}
          onUpgrade={() => setShowPaywall(true)}
          onChallenge={isFeatureEnabled("duels_v1") && latestPostedAnswer?.id ? async () => {
            if (creatingDuel) return;
            try {
              setCreatingDuel(true);
              await duelsApi.createAuto({
                questionId: question?.id || 1,
                answerId: latestPostedAnswer.id,
              });
              showAppAlert("Duel live", "Your duel is now in the feed.");
              resetToIdle();
              goFeed();
            } catch (error: any) {
              const serverError = error?.response?.data?.error;
              if (serverError === "no_opponent") {
                showAppAlert("No opponent yet", "No one else has answered this question yet.");
              } else if (serverError === "active_duel_exists") {
                showAppAlert("One at a time", "You already have an active duel.");
              } else {
                showAppAlert("Duel failed", "Could not create a duel right now.");
              }
              resetToIdle();
              goFeed();
            } finally {
              setCreatingDuel(false);
            }
          } : undefined}
          challengeLoading={creatingDuel}
        />
      )}

      {/* Paywall */}
      {showPaywall && (
        <PaywallModal
          answersUsed={dailyUsage?.used || 5}
          onUpgrade={() => {
            paywallApi.trackEvent("paywall_clicked", { screen: "text_answer" }, user?.id).catch(() => {});
            paymentsApi.createCheckout("text_paywall")
              .then((response) => {
                if (response.data?.url) {
                  Linking.openURL(response.data.url).catch(() => {});
                }
              })
              .catch(() => {})
              .finally(() => setShowPaywall(false));
          }}
          onClose={() => {
            paywallApi.trackEvent("paywall_closed", { screen: "text_answer" }, user?.id).catch(() => {});
            setShowPaywall(false);
          }}
          onSecondChance={async () => {
            try {
              paywallApi.trackEvent("second_chance_used", { screen: "text_answer" }, user?.id).catch(() => {});
              await paywallApi.grantBonus(user?.id || 0);
            } catch (_) {}
            setShowPaywall(false);
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// ── Live countdown bar component ──────────────────────────────
function LiveTimerBar({ startTime, maxSeconds }: { startTime: number; maxSeconds: number }) {
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 0,
      duration: maxSeconds * 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, []);

  const isUrgent = progress;

  return (
    <View style={styles.timerBarTrack}>
      <Animated.View
        style={[
          styles.timerBarFill,
          {
            width: progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
            backgroundColor: progress.interpolate({
              inputRange: [0, 0.4, 1],
              outputRange: ["#FF0000", "#FF6600", "#FF3366"],
            }),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  header: {
    paddingTop: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 8,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
    justifyContent: "center", alignItems: "center",
  },
  modeBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(255,51,102,0.12)",
    borderWidth: 1, borderColor: "rgba(255,51,102,0.25)",
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
  },
  modeBadgeText: { color: "#FF3366", fontSize: 13, fontWeight: "800" },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  questionCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 18, padding: 20, marginTop: 16, marginBottom: 24,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  questionText: { color: "#FFF", fontSize: 22, fontWeight: "800", lineHeight: 30, marginBottom: 8 },
  questionSub: { color: "rgba(255,255,255,0.5)", fontSize: 13, fontWeight: "600" },
  startBtn: { borderRadius: 28, overflow: "hidden" },
  startBtnGradient: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, paddingVertical: 18,
  },
  startBtnText: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  countdownWrap: { alignItems: "center", paddingVertical: 40 },
  countdownLabel: {
    color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "800",
    letterSpacing: 2, marginBottom: 16,
  },
  countdownNum: { fontSize: 96, fontWeight: "900", lineHeight: 100 },
  countdownHint: { color: "rgba(255,255,255,0.5)", fontSize: 14, fontWeight: "600", marginTop: 16 },
  typingCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: "rgba(255,51,102,0.25)",
  },
  timerBarTrack: {
    height: 4, backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 2, overflow: "hidden", marginBottom: 16,
  },
  timerBarFill: { height: "100%", borderRadius: 2 },
  textInput: {
    color: "#FFF", fontSize: 18, fontWeight: "600", lineHeight: 26,
    minHeight: 100, textAlignVertical: "top",
  },
  typingFooter: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginTop: 12,
  },
  charCount: { color: "rgba(255,255,255,0.4)", fontSize: 12, fontWeight: "600" },
  submitBtn: { borderRadius: 20, overflow: "hidden" },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnGradient: { paddingHorizontal: 24, paddingVertical: 12 },
  submitBtnText: { color: "#FFF", fontSize: 14, fontWeight: "800" },
});
