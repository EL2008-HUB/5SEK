import React, { useState, useRef, useEffect } from "react";
import {
  AppState,
  Linking,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
} from "react-native";
import { Audio } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import RewardOverlay from "../components/RewardOverlay";
import PaywallModal from "../components/PaywallModal";
import { useAuth } from "../context/AuthContext";
import { answersApi, paywallApi, paymentsApi } from "../services/api";
import { analytics } from "../services/analytics";
import {
  clearUploadDraft,
  enqueueUploadDraft,
  getLatestFailedDraft,
  markUploadFailed,
} from "../services/uploadQueue";
import { canShowPaywall, markPaywallShown } from "../utils/paywallCooldown";

const { width } = Dimensions.get("window");
const MAX_SECONDS = 5;

type Phase = "idle" | "countdown" | "recording" | "preview" | "submitting" | "reward";

export default function AudioAnswerScreen({ route, navigation }: any) {
  const question = route?.params?.question || {
    id: route?.params?.questionId,
    text: route?.params?.questionText,
  };
  const { user } = useAuth();

  const [phase, setPhase] = useState<Phase>("idle");
  const [countdown, setCountdown] = useState(MAX_SECONDS);
  const [recordTimer, setRecordTimer] = useState(MAX_SECONDS);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [startTime, setStartTime] = useState(0);
  const [rewardData, setRewardData] = useState<any>(null);
  const [dailyUsage, setDailyUsage] = useState<any>(null);
  const [creatorActivation, setCreatorActivation] = useState<any>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [failedUploadDraft, setFailedUploadDraft] = useState<any>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const waveAnim = useRef(new Animated.Value(0)).current;
  const countdownScale = useRef(new Animated.Value(1)).current;

  const goFeed = () => {
    if (typeof navigation.jumpTo === "function") navigation.jumpTo("Feed");
    else navigation.navigate("Feed");
  };

  // Request mic permission on mount
  useEffect(() => {
    Audio.requestPermissionsAsync().then(({ granted }) => {
      setPermissionGranted(granted);
    });
    getLatestFailedDraft("audio_answer").then(setFailedUploadDraft).catch(() => {});
    return () => {
      // Cleanup on unmount
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") return;
      if (phase === "recording") {
        stopRecording();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [phase]);

  // ── Countdown 5→0 ──
  useEffect(() => {
    if (phase !== "countdown") return;

    if (countdown === 0) {
      startRecording();
      return;
    }

    Animated.sequence([
      Animated.timing(countdownScale, { toValue: 1.4, duration: 120, useNativeDriver: true }),
      Animated.timing(countdownScale, { toValue: 1, duration: 380, useNativeDriver: true }),
    ]).start();

    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // ── Recording timer 5→0 ──
  useEffect(() => {
    if (phase !== "recording") return;

    // Pulse animation while recording
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.3, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    pulse.start();

    // Wave animation
    const wave = Animated.loop(
      Animated.timing(waveAnim, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true })
    );
    wave.start();

    if (recordTimer <= 0) {
      pulse.stop();
      wave.stop();
      stopRecording();
      return;
    }

    const t = setInterval(() => {
      setRecordTimer((prev) => {
        if (prev <= 1) { clearInterval(t); return 0; }
        return prev - 1;
      });
    }, 1000);

    return () => { clearInterval(t); pulse.stop(); wave.stop(); };
  }, [phase, recordTimer]);

  const initiateCountdown = async () => {
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
            screen: "audio_answer",
            answers_used: usage.used,
          }, user.id).catch(() => {});
        }
        return;
      }
    } catch (_) {}

    analytics.answerStart("audio_answer", { question_id: question?.id || null, mode: "audio" });
    setCountdown(MAX_SECONDS);
    setPhase("countdown");
  };

  const startRecording = async () => {
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setStartTime(Date.now());
      setRecordTimer(MAX_SECONDS);
      setPhase("recording");
    } catch (err) {
      console.error("Start recording error:", err);
      setPhase("idle");
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      if (uri) {
        setRecordingUri(uri);
        setPhase("preview");
      } else {
        setPhase("idle");
      }
    } catch (err) {
      console.error("Stop recording error:", err);
      setPhase("idle");
    }
  };

  const playPreview = async () => {
    if (!recordingUri) return;
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      const { sound } = await Audio.Sound.createAsync({ uri: recordingUri });
      soundRef.current = sound;
      setIsPlayingPreview(true);
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) setIsPlayingPreview(false);
      });
    } catch (err) {
      console.error("Play preview error:", err);
    }
  };

  const handleSubmit = async () => {
    if (!recordingUri) return;
    setPhase("submitting");

    const responseTime = Math.min((Date.now() - startTime) / 1000, MAX_SECONDS);
    const draftId = `audio-${question?.id || "unknown"}-${Date.now()}`;

    await enqueueUploadDraft({
      id: draftId,
      questionId: question?.id || 0,
      mediaUri: recordingUri,
      answerType: "audio",
      responseTime: parseFloat(responseTime.toFixed(1)),
      screen: "audio_answer",
      failedAt: null,
    });

    try {
      const result = await answersApi.upload(
        user?.id || 0,
        question?.id || 1,
        recordingUri,
        parseFloat(responseTime.toFixed(1)),
        { answer_type: "audio" }
      );

      setRewardData(result.data.reward || { response_time: responseTime, percentile: null, message: null });
      setDailyUsage(result.data.daily_usage || { used: 1, limit: 5, remaining: 4, is_premium: false });
      setCreatorActivation(result.data.creator_activation || null);
      await clearUploadDraft(draftId);
      setFailedUploadDraft(null);
      analytics.uploadCompleted("audio_answer", { question_id: question?.id || null });
      analytics.answerComplete("audio_answer", { mode: "audio", question_id: question?.id || null });
      setPhase("reward");
    } catch (error: any) {
      await markUploadFailed(draftId);
      const latestDraft = await getLatestFailedDraft("audio_answer");
      setFailedUploadDraft(latestDraft);
      analytics.uploadFailed("audio_answer", { question_id: question?.id || null });
      if (error?.response?.status === 403) {
        const errData = error.response.data;
        setDailyUsage({ used: errData.answers_used || 5, limit: 5, remaining: 0, is_premium: false });
        const shouldShow = await canShowPaywall();
        if (shouldShow) {
          setShowPaywall(true);
          await markPaywallShown();
          paywallApi.trackEvent("paywall_shown", { screen: "audio_answer", trigger: "submit_403" }, user?.id).catch(() => {});
        }
        setPhase("idle");
        return;
      }
      setPhase("preview");
    }
  };

  const retryFailedUpload = async () => {
    if (!failedUploadDraft?.mediaUri) return;
    analytics.uploadRetry("audio_answer", { question_id: failedUploadDraft.questionId });
    await clearUploadDraft(failedUploadDraft.id);
    setRecordingUri(failedUploadDraft.mediaUri);
    setPhase("preview");
  };

  const resetToIdle = () => {
    setPhase("idle");
    setCountdown(MAX_SECONDS);
    setRecordTimer(MAX_SECONDS);
    setRecordingUri(null);
    setRewardData(null);
    setCreatorActivation(null);
    setIsPlayingPreview(false);
    pulseAnim.setValue(1);
    waveAnim.setValue(0);
  };

  const isUrgent = recordTimer <= 2;

  // ── Permission not granted ──
  if (permissionGranted === false) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={["#0A0A0A", "#101022", "#0A0A0A"]} style={StyleSheet.absoluteFill} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={22} color="#FFF" />
          </TouchableOpacity>
        </View>
        <View style={styles.permissionWrap}>
          <Text style={styles.permissionEmoji}>🎙️</Text>
          <Text style={styles.permissionTitle}>Mic access needed</Text>
          <Text style={styles.permissionBody}>
            Allow microphone access to record your 5-second audio answer.
          </Text>
          <TouchableOpacity
            style={styles.permissionBtn}
            onPress={() => Audio.requestPermissionsAsync().then(({ granted }) => setPermissionGranted(granted))}
          >
            <LinearGradient colors={["#FF3366", "#FF6B6B"]} style={styles.permissionBtnGradient}>
              <Text style={styles.permissionBtnText}>Allow Microphone</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#0A0A0A", "#101022", "#0A0A0A"]} style={StyleSheet.absoluteFill} />
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color="#FFF" />
        </TouchableOpacity>
        <View style={styles.modeBadge}>
          <Ionicons name="mic-outline" size={14} color="#FF3366" />
          <Text style={styles.modeBadgeText}>Audio Answer</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {/* Question */}
      <View style={styles.questionCard}>
        <Text style={styles.questionText}>
          {question?.text || "What's on your mind?"}
        </Text>
        <Text style={styles.questionSub}>You have 5 seconds to speak 🎙️</Text>
      </View>

      {/* Center content */}
      <View style={styles.center}>

        {/* IDLE */}
        {phase === "idle" && (
          <>
            <View style={styles.micIdleWrap}>
              <Ionicons name="mic" size={64} color="rgba(255,51,102,0.4)" />
            </View>
            <Text style={styles.idleHint}>No one expects perfect answers 😅{"\n"}Just say the first thing that comes to mind</Text>
            {failedUploadDraft && (
              <TouchableOpacity style={styles.resumeCard} onPress={retryFailedUpload}>
                <Text style={styles.resumeTitle}>Resume failed upload</Text>
                <Text style={styles.resumeBody}>Your last audio answer is still ready to post again.</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.startBtn} onPress={initiateCountdown} activeOpacity={0.9}>
              <LinearGradient colors={["#FF3366", "#FF6B6B"]} style={styles.startBtnGradient}>
                <Ionicons name="mic" size={20} color="#FFF" />
                <Text style={styles.startBtnText}>⚡ Speak in 5 seconds</Text>
              </LinearGradient>
            </TouchableOpacity>
          </>
        )}

        {/* COUNTDOWN */}
        {phase === "countdown" && (
          <View style={styles.countdownWrap}>
            <Text style={styles.countdownLabel}>GET READY TO SPEAK…</Text>
            <Animated.Text
              style={[styles.countdownNum, { transform: [{ scale: countdownScale }], color: countdown <= 2 ? "#FF0000" : "#FF3366" }]}
            >
              {countdown}
            </Animated.Text>
            <Text style={styles.countdownHint}>First thing that comes to mind 😅</Text>
          </View>
        )}

        {/* RECORDING */}
        {phase === "recording" && (
          <View style={styles.recordingWrap}>
            {/* Animated mic */}
            <Animated.View style={[styles.micPulse, { transform: [{ scale: pulseAnim }] }]}>
              <LinearGradient
                colors={isUrgent ? ["#FF0000", "#FF4400"] : ["#FF3366", "#FF6B6B"]}
                style={styles.micCircle}
              >
                <Ionicons name="mic" size={48} color="#FFF" />
              </LinearGradient>
            </Animated.View>

            {/* Timer */}
            <Text style={[styles.recordTimer, isUrgent && styles.recordTimerUrgent]}>
              {recordTimer}s
            </Text>
            <Text style={styles.recordHint}>
              {isUrgent ? "🚨 HURRY!" : "🔴 RECORDING…"}
            </Text>

            {/* Progress bar */}
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${(recordTimer / MAX_SECONDS) * 100}%`,
                    backgroundColor: isUrgent ? "#FF0000" : "#FF3366",
                  },
                ]}
              />
            </View>

            <TouchableOpacity style={styles.stopBtn} onPress={stopRecording}>
              <Text style={styles.stopBtnText}>■ Stop early</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* PREVIEW */}
        {phase === "preview" && recordingUri && (
          <View style={styles.previewWrap}>
            <Text style={styles.previewTitle}>Your Answer 😅</Text>

            <TouchableOpacity style={styles.playBtn} onPress={playPreview}>
              <LinearGradient
                colors={isPlayingPreview ? ["#333", "#444"] : ["#FF3366", "#FF6B6B"]}
                style={styles.playBtnGradient}
              >
                <Ionicons name={isPlayingPreview ? "pause" : "play"} size={32} color="#FFF" />
              </LinearGradient>
            </TouchableOpacity>
            <Text style={styles.playHint}>{isPlayingPreview ? "Playing…" : "Tap to listen"}</Text>

            <View style={styles.previewActions}>
              <TouchableOpacity style={styles.retryBtn} onPress={resetToIdle}>
                <Text style={styles.retryBtnText}>🔁 Try again</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.postBtn} onPress={handleSubmit}>
                <LinearGradient colors={["#FF3366", "#FF6B6B"]} style={styles.postBtnGradient}>
                  <Text style={styles.postBtnText}>🚀 Post</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* SUBMITTING */}
        {phase === "submitting" && (
          <View style={styles.submittingWrap}>
            <Text style={styles.submittingText}>📤 Posting…</Text>
          </View>
        )}
      </View>

      {/* Reward */}
      {phase === "reward" && rewardData && (
        <RewardOverlay
          reward={rewardData}
          dailyUsage={dailyUsage || { used: 1, limit: 5, remaining: 4, is_premium: false }}
          creatorActivation={creatorActivation}
          onViewFeed={() => { resetToIdle(); goFeed(); }}
          onDone={resetToIdle}
          onUpgrade={() => setShowPaywall(true)}
        />
      )}

      {/* Paywall */}
      {showPaywall && (
        <PaywallModal
          answersUsed={dailyUsage?.used || 5}
          onUpgrade={() => {
            paywallApi.trackEvent("paywall_clicked", { screen: "audio_answer" }, user?.id).catch(() => {});
            paymentsApi.createCheckout("audio_paywall")
              .then((response) => {
                if (response.data?.url) {
                  Linking.openURL(response.data.url).catch(() => {});
                }
              })
              .catch(() => {})
              .finally(() => setShowPaywall(false));
          }}
          onClose={() => {
            paywallApi.trackEvent("paywall_closed", { screen: "audio_answer" }, user?.id).catch(() => {});
            setShowPaywall(false);
          }}
          onSecondChance={async () => {
            try {
              paywallApi.trackEvent("second_chance_used", { screen: "audio_answer" }, user?.id).catch(() => {});
              await paywallApi.grantBonus(user?.id || 0);
            } catch (_) {}
            setShowPaywall(false);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  header: {
    paddingTop: 56, paddingHorizontal: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 8,
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
  questionCard: {
    marginHorizontal: 20, marginTop: 16, marginBottom: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 18, padding: 20,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  questionText: { color: "#FFF", fontSize: 20, fontWeight: "800", lineHeight: 28, marginBottom: 8 },
  questionSub: { color: "rgba(255,255,255,0.5)", fontSize: 13, fontWeight: "600" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  micIdleWrap: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: "rgba(255,51,102,0.08)",
    borderWidth: 2, borderColor: "rgba(255,51,102,0.2)",
    justifyContent: "center", alignItems: "center", marginBottom: 24,
  },
  idleHint: {
    color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: "600",
    textAlign: "center", lineHeight: 20, marginBottom: 32,
  },
  resumeCard: {
    width: "100%",
    borderRadius: 18,
    padding: 14,
    marginBottom: 16,
    backgroundColor: "rgba(255,173,51,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,173,51,0.22)",
  },
  resumeTitle: { color: "#FFF3D7", fontSize: 15, fontWeight: "800", marginBottom: 4 },
  resumeBody: { color: "rgba(255,243,215,0.8)", fontSize: 12, fontWeight: "700", lineHeight: 18 },
  startBtn: { borderRadius: 28, overflow: "hidden", width: "100%" },
  startBtnGradient: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, paddingVertical: 18,
  },
  startBtnText: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  countdownWrap: { alignItems: "center" },
  countdownLabel: {
    color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "800",
    letterSpacing: 2, marginBottom: 16,
  },
  countdownNum: { fontSize: 96, fontWeight: "900", lineHeight: 100 },
  countdownHint: { color: "rgba(255,255,255,0.5)", fontSize: 14, fontWeight: "600", marginTop: 16 },
  recordingWrap: { alignItems: "center", width: "100%" },
  micPulse: { marginBottom: 24 },
  micCircle: {
    width: 120, height: 120, borderRadius: 60,
    justifyContent: "center", alignItems: "center",
  },
  recordTimer: { color: "#FF3366", fontSize: 64, fontWeight: "900", marginBottom: 8 },
  recordTimerUrgent: { color: "#FF0000" },
  recordHint: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: "700", marginBottom: 24 },
  progressTrack: {
    width: "100%", height: 4,
    backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 2, overflow: "hidden", marginBottom: 24,
  },
  progressFill: { height: "100%", borderRadius: 2 },
  stopBtn: {
    paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
  },
  stopBtnText: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: "700" },
  previewWrap: { alignItems: "center", width: "100%" },
  previewTitle: { color: "#FFF", fontSize: 22, fontWeight: "800", marginBottom: 24 },
  playBtn: { borderRadius: 40, overflow: "hidden", marginBottom: 12 },
  playBtnGradient: { width: 80, height: 80, borderRadius: 40, justifyContent: "center", alignItems: "center" },
  playHint: { color: "rgba(255,255,255,0.5)", fontSize: 13, fontWeight: "600", marginBottom: 32 },
  previewActions: { flexDirection: "row", gap: 12, width: "100%" },
  retryBtn: {
    flex: 1, paddingVertical: 16, borderRadius: 22, alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
  },
  retryBtnText: { color: "rgba(255,255,255,0.85)", fontSize: 15, fontWeight: "700" },
  postBtn: { flex: 1, borderRadius: 22, overflow: "hidden" },
  postBtnGradient: { paddingVertical: 16, alignItems: "center" },
  postBtnText: { color: "#FFF", fontSize: 16, fontWeight: "800" },
  submittingWrap: { alignItems: "center" },
  submittingText: { color: "#FFF", fontSize: 22, fontWeight: "700" },
  permissionWrap: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  permissionEmoji: { fontSize: 64, marginBottom: 16 },
  permissionTitle: { color: "#FFF", fontSize: 24, fontWeight: "800", marginBottom: 12, textAlign: "center" },
  permissionBody: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: "600", textAlign: "center", lineHeight: 20, marginBottom: 32 },
  permissionBtn: { borderRadius: 28, overflow: "hidden", width: "100%" },
  permissionBtnGradient: { paddingVertical: 18, alignItems: "center" },
  permissionBtnText: { color: "#FFF", fontSize: 16, fontWeight: "900" },
});
