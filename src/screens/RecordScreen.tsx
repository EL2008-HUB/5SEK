import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Dimensions,
  Easing,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Video, ResizeMode } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import Timer, { CountdownOverlay } from "../components/Timer";
import RewardOverlay from "../components/RewardOverlay";
import ShareOverlay from "../components/ShareOverlay";
import PaywallModal from "../components/PaywallModal";
import { useAuth } from "../context/AuthContext";
import { answersApi, duelsApi, paywallApi, paymentsApi } from "../services/api";
import { analytics } from "../services/analytics";
import { isFeatureEnabled } from "../services/featureFlags";
import {
  clearUploadDraft,
  enqueueUploadDraft,
  getLatestFailedDraft,
  markUploadFailed,
} from "../services/uploadQueue";
import { showAppAlert } from "../utils/alerts";
import { canShowPaywall, markPaywallShown } from "../utils/paywallCooldown";

const { width, height } = Dimensions.get("window");
const MAX_DURATION = 5;

type RecordPhase =
  | "idle"
  | "countdown"
  | "recording"
  | "preview"
  | "uploading"
  | "upload_failed"
  | "reward";

type AnswerMode = "video" | "audio" | "text" | "reaction";

const MODE_OPTIONS: Array<{
  id: AnswerMode;
  icon: keyof typeof Ionicons.glyphMap;
  emoji: string;
  label: string;
  shortLabel: string;
  hint: string;
}> = [
  {
    id: "video",
    icon: "videocam",
    emoji: "🎥",
    label: "Video",
    shortLabel: "Live camera",
    hint: "Fast face-to-camera answer with a 3..2..1 start.",
  },
  {
    id: "audio",
    icon: "mic",
    emoji: "🎤",
    label: "Voice",
    shortLabel: "Speak only",
    hint: "Say it quickly with a clean mic-first flow.",
  },
  {
    id: "text",
    icon: "create",
    emoji: "📝",
    label: "Text",
    shortLabel: "Type fast",
    hint: "Type one quick thought before the timer kills it.",
  },
  {
    id: "reaction",
    icon: "happy",
    emoji: "😳",
    label: "React",
    shortLabel: "Tap a vibe",
    hint: "One-tap emoji answer for instant participation.",
  },
];

const REACTION_OPTIONS = [
  { emoji: "😳", label: "Caught off guard" },
  { emoji: "😂", label: "Too funny" },
  { emoji: "🤯", label: "Mind blown" },
  { emoji: "😎", label: "Too easy" },
];

function normalizeMode(entryMode: string | undefined): AnswerMode {
  if (entryMode === "text") return "text";
  if (entryMode === "audio") return "audio";
  return "video";
}

export default function RecordScreen({ route, navigation }: any) {
  const question = route?.params?.question || {
    id: route?.params?.questionId,
    text: route?.params?.questionText,
  };
  const entryMode = route?.params?.mode;
  const { user } = useAuth();
  const cameraRef = useRef<any>(null);
  const hasStartedRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<"front" | "back">("front");
  const [showCamera, setShowCamera] = useState(false);
  const [selectedMode, setSelectedMode] = useState<AnswerMode>(normalizeMode(entryMode));
  const [selectedReaction, setSelectedReaction] = useState<string | null>(null);

  const [phase, setPhase] = useState<RecordPhase>("idle");
  const [countdownNum, setCountdownNum] = useState(3);
  const [recordTimer, setRecordTimer] = useState(MAX_DURATION);
  const [recordStartTime, setRecordStartTime] = useState<number>(0);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);

  const [rewardData, setRewardData] = useState<any>(null);
  const [dailyUsage, setDailyUsage] = useState<any>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [latestPostedAnswer, setLatestPostedAnswer] = useState<any>(null);
  const [creatorActivation, setCreatorActivation] = useState<any>(null);
  const [creatingDuel, setCreatingDuel] = useState(false);
  const [failedUploadDraft, setFailedUploadDraft] = useState<any>(null);
  const [showShareOverlay, setShowShareOverlay] = useState(false);

  const timerPulse = useRef(new Animated.Value(1)).current;
  const startPulse = useRef(new Animated.Value(1)).current;
  const waveAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (entryMode) {
      setSelectedMode(normalizeMode(entryMode));
    }
  }, [entryMode]);

  useEffect(() => {
    getLatestFailedDraft("record").then(setFailedUploadDraft).catch(() => {});
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") return;

      if (phase === "recording") {
        stopRecording();
        showAppAlert("Recording paused", "Camera/audio was interrupted. Review the take before posting.");
      }
    });

    return () => {
      subscription.remove();
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "idle") return;

    const timerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(timerPulse, {
          toValue: 1.06,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.timing(timerPulse, {
          toValue: 1,
          duration: 550,
          useNativeDriver: true,
        }),
      ])
    );

    const buttonLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(startPulse, {
          toValue: 1.02,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(startPulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    const waveLoop = Animated.loop(
      Animated.timing(waveAnim, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    timerLoop.start();
    buttonLoop.start();
    waveLoop.start();

    return () => {
      timerLoop.stop();
      buttonLoop.stop();
      waveLoop.stop();
      timerPulse.setValue(1);
      startPulse.setValue(1);
      waveAnim.setValue(0);
    };
  }, [phase, startPulse, timerPulse, waveAnim]);

  useEffect(() => {
    if (phase !== "countdown") return;

    if (countdownNum === 0) {
      const goTimer = setTimeout(() => {
        setShowCamera(true);
        setPhase("recording");
      }, 450);
      return () => clearTimeout(goTimer);
    }

    if (countdownNum < 0) return;

    const timer = setTimeout(() => {
      setCountdownNum((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [phase, countdownNum]);

  useEffect(() => {
    if (phase !== "recording") return;
    if (!showCamera) return;
    if (hasStartedRef.current) return;

    hasStartedRef.current = true;
    startActualRecording();
  }, [phase, showCamera]);

  useEffect(() => {
    if (phase !== "recording") return;

    if (recordTimer <= 0) {
      stopRecording();
      return;
    }

    const interval = setInterval(() => {
      setRecordTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [phase, recordTimer]);

  const selectedModeConfig = useMemo(
    () => MODE_OPTIONS.find((mode) => mode.id === selectedMode) || MODE_OPTIONS[0],
    [selectedMode]
  );

  const canStart = selectedMode !== "reaction" || Boolean(selectedReaction);
  const questionText = question?.text || "What is your answer?";
  const canChallengeWithDuel =
    isFeatureEnabled("duels_v1") &&
    Boolean(latestPostedAnswer?.id);

  const goFeed = () => {
    if (typeof navigation.jumpTo === "function") {
      navigation.jumpTo("Feed");
      return;
    }
    navigation.navigate("Feed");
  };

  const checkDailyUsageOrShowPaywall = async () => {
    try {
      if (!user?.id) return false;
      const usageRes = await answersApi.getDailyUsage(user.id);
      const usage = usageRes.data;

      if (!usage.is_premium && usage.remaining !== null && usage.remaining <= 0) {
        const shouldShow = await canShowPaywall();
        if (shouldShow) {
          setDailyUsage(usage);
          setShowPaywall(true);
          await markPaywallShown();
          paywallApi.trackEvent("paywall_shown", {
            screen: "record",
            answers_used: usage.used,
            mode: selectedMode,
          }, user.id).catch(() => {});
        } else {
          showAppAlert(
            "Come back soon",
            "Your free answers reset tomorrow. Go Premium for unlimited answers."
          );
        }
        return false;
      }
    } catch (err) {
      console.log("Could not check daily usage:", err);
    }

    return true;
  };

  const ensureVideoPermission = async () => {
    if (permission?.granted) return true;

    const result = await requestPermission();
    if (result?.granted) return true;

    if (result?.canAskAgain === false && Platform.OS !== "web") {
      showAppAlert(
        "Camera blocked",
        "Enable camera access in settings or pick Voice, Text, or React."
      );
      Linking.openSettings().catch(() => {});
      return false;
    }

    showAppAlert(
      "Camera needed",
      "Enable camera access for Video mode, or switch to another answer mode."
    );
    return false;
  };

  const beginVideoFlow = () => {
    setPhase("countdown");
    setCountdownNum(3);
    setShowCamera(false);
    hasStartedRef.current = false;
  };

  const handleReactionSubmit = async () => {
    if (!selectedReaction) return;

    setPhase("uploading");
    setLatestPostedAnswer(null);
    setCreatorActivation(null);

    try {
      const reactionMeta = REACTION_OPTIONS.find((option) => option.emoji === selectedReaction);
      const result = await answersApi.create(
        user?.id || 0,
        question?.id || 1,
        null,
        0.8,
        {
          answer_type: "reaction",
          text_content: `${selectedReaction} ${reactionMeta?.label || "Reaction"}`,
        }
      );

      setRewardData(
        result.data.reward || { response_time: 0.8, percentile: null, message: "Quick reaction locked" }
      );
      setDailyUsage(
        result.data.daily_usage || { used: 1, limit: 5, remaining: 4, is_premium: false }
      );
      setCreatorActivation(result.data.creator_activation || null);
      analytics.answerComplete("record", { mode: "reaction", question_id: question?.id || null });
      setPhase("reward");
    } catch (error: any) {
      console.error("Reaction submit error:", error);

      if (error?.response?.status === 403) {
        const errData = error.response.data;
        setDailyUsage({
          used: errData.answers_used || 5,
          limit: errData.limit || 5,
          remaining: 0,
          is_premium: false,
        });

        const shouldShow = await canShowPaywall();
        if (shouldShow) {
          setShowPaywall(true);
          await markPaywallShown();
          paywallApi.trackEvent("paywall_shown", {
            screen: "record",
            trigger: "reaction_403",
            answers_used: errData.answers_used,
          }, user?.id).catch(() => {});
        }

        setPhase("idle");
        return;
      }

      showAppAlert("Reaction failed", "Could not submit your reaction.");
      analytics.uploadFailed("record", { mode: "reaction" });
      setPhase("idle");
    }
  };

  const handleStart = async () => {
    if (!canStart) return;

    const canAnswer = await checkDailyUsageOrShowPaywall();
    if (!canAnswer) return;
    analytics.answerStart("record", {
      question_id: question?.id || null,
      mode: selectedMode,
    });

    Vibration.vibrate(10);

    if (selectedMode === "text") {
      navigation.navigate("TextAnswer", {
        questionId: question?.id,
        questionText: question?.text,
      });
      return;
    }

    if (selectedMode === "audio") {
      navigation.navigate("AudioAnswer", {
        questionId: question?.id,
        questionText: question?.text,
      });
      return;
    }

    if (selectedMode === "reaction") {
      await handleReactionSubmit();
      return;
    }

    const hasPermission = await ensureVideoPermission();
    if (!hasPermission) return;

    beginVideoFlow();
  };

  const startActualRecording = async () => {
    if (!cameraRef.current) return;
    setRecordTimer(MAX_DURATION);
    setRecordStartTime(Date.now());
    setRecordedUri(null);

    try {
      const video = await cameraRef.current.recordAsync({
        maxDuration: MAX_DURATION,
      });

      if (video?.uri) {
        setRecordedUri(video.uri);
        setPhase("preview");
        setShowCamera(false);
        hasStartedRef.current = false;
      }
    } catch (error) {
      console.error("Recording error:", error);
      setPhase("idle");
      setShowCamera(false);
      hasStartedRef.current = false;
      if (Platform.OS === "web") {
        showAppAlert(
          "Web recording is not ready yet",
          "Use the iOS or Android app for video mode right now, or pick Voice, Text, or React."
        );
        return;
      }
      showAppAlert("Error", "Failed to record video");
    }
  };

  const stopRecording = () => {
    if (cameraRef.current && phase === "recording") {
      cameraRef.current.stopRecording();
    }
  };

  const handleUpload = async (videoUri: string, attempt = 1) => {
    setPhase("uploading");
    setRecordedUri(videoUri);

    const actualTimeUsed = (Date.now() - recordStartTime) / 1000;
    const responseTime = Math.min(actualTimeUsed, MAX_DURATION);
    const draftId = `record-${question?.id || "unknown"}-${Date.now()}`;

    await enqueueUploadDraft({
      id: draftId,
      questionId: question?.id || 0,
      mediaUri: videoUri,
      answerType: "video",
      responseTime: parseFloat(responseTime.toFixed(1)),
      screen: "record",
      failedAt: null,
    });

    try {
      const result = await answersApi.upload(
        user?.id || 0,
        question?.id || 1,
        videoUri,
        parseFloat(responseTime.toFixed(1)),
        { answer_type: "video" }
      );

      setLatestPostedAnswer(result.data);
      setRewardData(
        result.data.reward || {
          response_time: responseTime,
          percentile: null,
          message: null,
        }
      );
      setDailyUsage(
        result.data.daily_usage || { used: 1, limit: 5, remaining: 4, is_premium: false }
      );
      setCreatorActivation(result.data.creator_activation || null);
      await clearUploadDraft(draftId);
      setFailedUploadDraft(null);
      analytics.uploadCompleted("record", { answer_type: "video", question_id: question?.id || null });
      analytics.answerComplete("record", { mode: "video", question_id: question?.id || null });
      setPhase("reward");
    } catch (error: any) {
      console.error("Upload error:", error);

      if (error?.response?.status === 403) {
        await clearUploadDraft(draftId);
        const errData = error.response.data;
        setDailyUsage({
          used: errData.answers_used || 5,
          limit: errData.limit || 5,
          remaining: 0,
          is_premium: false,
        });
        const shouldShow = await canShowPaywall();
        if (shouldShow) {
          setShowPaywall(true);
          await markPaywallShown();
          paywallApi.trackEvent("paywall_shown", {
            screen: "record",
            trigger: "upload_403",
            answers_used: errData.answers_used,
          }, user?.id).catch(() => {});
        }
        setPhase("idle");
        return;
      }

      const isNetworkish =
        !error?.response ||
        error?.code === "ECONNABORTED" ||
        error?.message?.includes?.("Network");

      if (attempt < 2 && isNetworkish) {
        analytics.uploadRetry("record", {
          question_id: question?.id || null,
          auto: true,
          attempt,
        });
        await new Promise((resolve) => setTimeout(resolve, 900));
        await clearUploadDraft(draftId);
        return handleUpload(videoUri, attempt + 1);
      }

      await markUploadFailed(draftId);
      const latestDraft = await getLatestFailedDraft("record");
      setFailedUploadDraft(latestDraft);
      analytics.uploadFailed("record", {
        answer_type: "video",
        question_id: question?.id || null,
        attempt,
      });
      setPhase("upload_failed");
    }
  };

  const retryFailedUpload = async () => {
    const uri = failedUploadDraft?.mediaUri || recordedUri;
    if (!uri) return;
    analytics.uploadRetry("record", { question_id: failedUploadDraft?.questionId || question?.id || null });
    if (failedUploadDraft?.id) {
      await clearUploadDraft(failedUploadDraft.id);
    }
    setRecordedUri(uri);
    await handleUpload(uri);
  };

  const discardFailedUpload = async () => {
    if (failedUploadDraft?.id) {
      await clearUploadDraft(failedUploadDraft.id);
    }
    setFailedUploadDraft(null);
    setRecordedUri(null);
    setPhase("idle");
  };

  const toggleFacing = () => {
    setFacing((prev) => (prev === "front" ? "back" : "front"));
  };

  const handleCreateDuel = async () => {
    if (!latestPostedAnswer?.id || creatingDuel) return;

    try {
      setCreatingDuel(true);

      await duelsApi.createAuto({
        questionId: latestPostedAnswer.question_id || question?.id || 1,
        answerId: latestPostedAnswer.id,
        videoA: latestPostedAnswer.video_url || null,
      });

      showAppAlert("Duel live", "Your duel is now in the feed.");
      resetToIdle();
      goFeed();
    } catch (error: any) {
      const serverError = error?.response?.data?.error;

      if (serverError === "no_opponent") {
        showAppAlert("No opponent yet", "No one else has answered this question yet.");
      } else if (serverError === "active_duel_exists") {
        showAppAlert("One duel at a time", "You already have an active duel.");
      } else {
        showAppAlert("Duel failed", "Could not create a duel right now.");
      }

      resetToIdle();
      goFeed();
    } finally {
      setCreatingDuel(false);
    }
  };

  const resetToIdle = () => {
    setPhase("idle");
    setRecordTimer(MAX_DURATION);
    setCountdownNum(3);
    setRewardData(null);
    setLatestPostedAnswer(null);
    setCreatorActivation(null);
    setCreatingDuel(false);
    setRecordedUri(null);
    setShowCamera(false);
    hasStartedRef.current = false;
  };

  const renderIdleDynamicArea = () => {
    if (selectedMode === "video") {
      return (
        <View style={styles.dynamicCard}>
          <View style={styles.videoPreviewShell}>
            <LinearGradient
              colors={["rgba(0,210,255,0.16)", "rgba(108,92,231,0.18)"]}
              style={styles.videoPreviewGlow}
            />
            <View style={styles.videoPreviewFrame}>
              <Ionicons
                name={permission?.granted ? "scan" : "lock-closed"}
                size={44}
                color="#9ADFFF"
              />
              <Text style={styles.dynamicTitle}>
                {permission?.granted ? "Camera preview opens on start" : "Camera access needed"}
              </Text>
              <Text style={styles.dynamicSubtext}>
                {permission?.granted
                  ? "3…2…1 then live preview and auto-stop at 5 seconds."
                  : "Pick Video to request permission, or choose another mode."}
              </Text>
            </View>
            <View style={styles.recordHintPill}>
              <View style={styles.recordDot} />
              <Text style={styles.recordHintText}>Hold to rec feel</Text>
            </View>
          </View>
        </View>
      );
    }

    if (selectedMode === "audio") {
      return (
        <View style={styles.dynamicCard}>
          <View style={styles.audioOrb}>
            <LinearGradient
              colors={["rgba(0,210,255,0.25)", "rgba(108,92,231,0.25)"]}
              style={styles.audioOrbFill}
            >
              <Ionicons name="mic" size={40} color="#EAFBFF" />
            </LinearGradient>
          </View>
          <Text style={styles.dynamicTitle}>Speak now</Text>
          <View style={styles.waveRow}>
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <Animated.View
                key={index}
                style={[
                  styles.waveBar,
                  {
                    transform: [
                      {
                        scaleY: waveAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.45 + index * 0.03, 1.1 - index * 0.05],
                        }),
                      },
                    ],
                    opacity: waveAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.45, 1],
                    }),
                  },
                ]}
              />
            ))}
          </View>
          <Text style={styles.dynamicSubtext}>Waveform wakes up the moment you hit start.</Text>
        </View>
      );
    }

    if (selectedMode === "text") {
      return (
        <View style={styles.dynamicCard}>
          <View style={styles.textPreviewCard}>
            <View style={styles.textPreviewHeader}>
              <Text style={styles.textPreviewLabel}>Type your answer</Text>
              <View style={styles.textPreviewTimer}>
                <Text style={styles.textPreviewTimerText}>auto submit</Text>
              </View>
            </View>
            <View style={styles.textPreviewField}>
              <Text style={styles.textPreviewPlaceholder}>Type your answer…</Text>
            </View>
            <Text style={styles.dynamicSubtext}>Keyboard opens instantly and the timer keeps pressure high.</Text>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.dynamicCard}>
        <Text style={styles.dynamicTitle}>Tap your reaction</Text>
        <View style={styles.reactionGrid}>
          {REACTION_OPTIONS.map((option) => {
            const isActive = option.emoji === selectedReaction;
            return (
              <TouchableOpacity
                key={option.emoji}
                style={[styles.reactionChip, isActive && styles.reactionChipActive]}
                activeOpacity={0.9}
                onPress={() => {
                  Vibration.vibrate(10);
                  setSelectedReaction(option.emoji);
                }}
              >
                <Text style={[styles.reactionEmoji, isActive && styles.reactionEmojiActive]}>
                  {option.emoji}
                </Text>
                <Text style={[styles.reactionLabel, isActive && styles.reactionLabelActive]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.dynamicSubtext}>
          Quick-select mode. Pick one vibe and send it instantly.
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <LinearGradient
        colors={["#090C17", "#0F0F1A", "#14142A"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.bgOrbTop} />
      <View style={styles.bgOrbBottom} />

      {phase === "countdown" && (
        <View style={styles.preRecord}>
          <LinearGradient
            colors={["rgba(9,12,23,0.82)", "rgba(15,15,26,0.9)", "rgba(9,12,23,0.82)"]}
            style={StyleSheet.absoluteFill}
          />

          <Text style={styles.preReady}>3…2…1</Text>
          <Text style={styles.preSub}>Camera goes live after the countdown</Text>
          <CountdownOverlay count={countdownNum} />
        </View>
      )}

      {permission?.granted && showCamera && (
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          mode="video"
        >
          <View style={styles.topOverlay}>
            <TouchableOpacity style={styles.cameraIconBtn} onPress={() => navigation.goBack()}>
              <Ionicons name="close" size={24} color="#FFF" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.cameraIconBtn} onPress={toggleFacing}>
              <Ionicons name="camera-reverse" size={22} color="#FFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.questionOverlay}>
            <Text style={styles.cameraQuestionKicker}>QUESTION</Text>
            <Text style={styles.questionText} numberOfLines={3}>
              {questionText}
            </Text>
          </View>

          {phase === "recording" && (
            <>
              <Timer seconds={recordTimer} total={MAX_DURATION} />
              <View style={styles.saySomethingWrap}>
                <Text style={styles.saySomething}>Say the first thing that comes to mind</Text>
              </View>
            </>
          )}

          <View style={styles.bottomOverlay}>
            <TouchableOpacity
              style={[
                styles.recordBtn,
                phase === "recording" && styles.recordBtnActive,
              ]}
              onPress={phase === "recording" ? stopRecording : undefined}
              activeOpacity={0.8}
            >
              <View
                style={[
                  styles.recordBtnInner,
                  phase === "recording" && styles.recordBtnInnerActive,
                ]}
              />
            </TouchableOpacity>

            <Text style={styles.cameraHint}>
              {phase === "recording" ? "Recording live" : "Get ready"}
            </Text>
          </View>
        </CameraView>
      )}

      {!showCamera && phase === "idle" && (
        <ScrollView
          contentContainerStyle={styles.answerScroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.answerShell}>
            <View style={styles.topSection}>
              <Text style={styles.screenKicker}>ANSWER</Text>
              <Text style={styles.answerQuestion} numberOfLines={2}>
                {questionText}
              </Text>
              <Animated.View
                style={[styles.timerBadge, { transform: [{ scale: timerPulse }] }]}
              >
                <Text style={styles.timerBadgeIcon}>⏱</Text>
                <Text style={styles.timerBadgeText}>05</Text>
              </Animated.View>
            </View>

            <View style={styles.selectorSection}>
              <Text style={styles.sectionLabel}>Select mode</Text>
              <View style={styles.modeSelector}>
                {MODE_OPTIONS.map((mode) => {
                  const isActive = selectedMode === mode.id;
                  return (
                    <TouchableOpacity
                      key={mode.id}
                      style={[styles.modePill, isActive && styles.modePillActive]}
                      activeOpacity={0.9}
                      onPress={() => {
                        Vibration.vibrate(10);
                        setSelectedMode(mode.id);
                      }}
                    >
                      <Text style={styles.modeEmoji}>{mode.emoji}</Text>
                      <Ionicons
                        name={mode.icon}
                        size={22}
                        color={isActive ? "#EAFBFF" : "rgba(234,251,255,0.75)"}
                      />
                      <Text style={[styles.modeLabel, isActive && styles.modeLabelActive]}>
                        {mode.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.dynamicSection}>
              <View style={styles.dynamicHeader}>
                <Text style={styles.dynamicHeaderTitle}>{selectedModeConfig.shortLabel}</Text>
                <Text style={styles.dynamicHeaderHint}>{selectedModeConfig.hint}</Text>
              </View>
              {renderIdleDynamicArea()}
            </View>

            {failedUploadDraft && (
              <TouchableOpacity style={styles.resumeCard} activeOpacity={0.9} onPress={retryFailedUpload}>
                <Text style={styles.resumeTitle}>Upload still pending</Text>
                <Text style={styles.resumeBody}>Retry the last video submission from where the network failed.</Text>
              </TouchableOpacity>
            )}

            <Animated.View style={{ transform: [{ scale: startPulse }] }}>
              <TouchableOpacity
                style={[styles.startBtn, !canStart && styles.startBtnDisabled]}
                activeOpacity={canStart ? 0.92 : 1}
                onPress={handleStart}
                disabled={!canStart}
              >
                <LinearGradient
                  colors={["#00D2FF", "#6C5CE7"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.startBtnGradient}
                >
                  <Text style={styles.startBtnText}>
                    {selectedMode === "video" && !permission?.granted
                      ? "START VIDEO"
                      : "START"}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>

            <Text style={styles.startHelper}>
              {canStart
                ? `One decision only: ${selectedModeConfig.label}. Then go.`
                : "Pick a reaction first to unlock Start."}
            </Text>
          </View>
        </ScrollView>
      )}

      {phase === "preview" && recordedUri && (
        <View style={styles.previewOverlay}>
          <Video
            source={{ uri: recordedUri }}
            style={styles.previewVideo}
            resizeMode={ResizeMode.COVER}
            shouldPlay
            isLooping
            isMuted={false}
          />

          <LinearGradient
            colors={["rgba(0,0,0,0.18)", "rgba(9,12,23,0.92)"]}
            style={styles.previewGradient}
          />

          <View style={styles.previewTopRow}>
            <TouchableOpacity
              style={styles.previewBack}
              onPress={() => {
                setRecordedUri(null);
                setPhase("idle");
              }}
            >
              <Ionicons name="close" size={24} color="#FFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.previewContent}>
            <Text style={styles.previewTitle}>Your answer</Text>
            <Text style={styles.previewBody}>Keep it or try one more take.</Text>

            <View style={styles.previewActionsRow}>
              <TouchableOpacity
                style={styles.tryAgainBtn}
                activeOpacity={0.88}
                onPress={() => {
                  setRecordedUri(null);
                  setPhase("idle");
                }}
              >
                <Text style={styles.tryAgainText}>Try again</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.postBtn}
                activeOpacity={0.92}
                onPress={() => handleUpload(recordedUri)}
              >
                <LinearGradient
                  colors={["#00D2FF", "#6C5CE7"]}
                  style={styles.postBtnGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Text style={styles.postBtnText}>Post</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {phase === "uploading" && (
        <View style={styles.uploadingOverlay}>
          <View style={styles.uploadingCard}>
            <Text style={styles.uploadingTitle}>Posting…</Text>
            <Text style={styles.uploadingBody}>Locking your answer into the feed.</Text>
          </View>
        </View>
      )}

      {phase === "upload_failed" && recordedUri && (
        <View style={styles.previewOverlay}>
          <Video
            source={{ uri: recordedUri }}
            style={styles.previewVideo}
            resizeMode={ResizeMode.COVER}
            shouldPlay
            isLooping
            isMuted={false}
          />

          <LinearGradient
            colors={["rgba(0,0,0,0.35)", "rgba(9,12,23,0.94)"]}
            style={styles.previewGradient}
          />

          <View style={styles.previewContent}>
            <Text style={styles.previewTitle}>Couldn't post</Text>
            <Text style={styles.previewBody}>
              Your take is still here. Retry when the connection is back — nothing is lost.
            </Text>

            <View style={styles.previewActionsRow}>
              <TouchableOpacity
                style={styles.tryAgainBtn}
                activeOpacity={0.88}
                onPress={discardFailedUpload}
              >
                <Text style={styles.tryAgainText}>Discard</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.postBtn}
                activeOpacity={0.92}
                onPress={retryFailedUpload}
              >
                <LinearGradient
                  colors={["#FF5A7A", "#FF3366"]}
                  style={styles.postBtnGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Text style={styles.postBtnText}>Retry</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {phase === "reward" && rewardData && (
        <RewardOverlay
          reward={rewardData}
          dailyUsage={dailyUsage || { used: 1, limit: 5, remaining: 4, is_premium: false }}
          creatorActivation={creatorActivation}
          onViewFeed={() => {
            resetToIdle();
            goFeed();
          }}
          onDone={resetToIdle}
          onUpgrade={() => {
            setShowPaywall(true);
          }}
          onChallenge={canChallengeWithDuel ? handleCreateDuel : undefined}
          challengeLoading={creatingDuel}
          onShare={() => setShowShareOverlay(true)}
        />
      )}

      {/* 🔥 Post-answer share overlay (emotional trigger) */}
      {showShareOverlay && latestPostedAnswer && (
        <ShareOverlay
          video={{
            id: latestPostedAnswer.id,
            video_url: latestPostedAnswer.video_url || null,
            username: user?.username || "you",
            question_text: question?.text || "Can you answer this?",
            response_time: rewardData?.response_time || null,
            user_id: user?.id,
          }}
          postAnswer={true}
          onClose={() => setShowShareOverlay(false)}
        />
      )}

      {showPaywall && (
        <PaywallModal
          answersUsed={dailyUsage?.used || 5}
          onUpgrade={() => {
            paywallApi.trackEvent("paywall_clicked", {
              screen: "record",
              answers_used: dailyUsage?.used,
            }, user?.id).catch(() => {});
            paymentsApi.createCheckout("record_paywall")
              .then((response) => {
                if (response.data?.url) {
                  Linking.openURL(response.data.url).catch(() => {});
                }
              })
              .catch(() => {
                showAppAlert("Premium unavailable", "Checkout is not configured yet.");
              })
              .finally(() => {
                setShowPaywall(false);
              });
          }}
          onClose={() => {
            paywallApi.trackEvent("paywall_closed", {
              screen: "record",
            }, user?.id).catch(() => {});
            setShowPaywall(false);
          }}
          onSecondChance={async () => {
            try {
              paywallApi.trackEvent("second_chance_used", {
                screen: "record",
              }, user?.id).catch(() => {});
              const result = await paywallApi.grantBonus(user?.id || 0);
              if (result.data.ok) {
                showAppAlert("Bonus answer", "You earned 1 extra answer. Go again.");
              }
            } catch (err: any) {
              if (err?.response?.status === 403) {
                showAppAlert(
                  "No more bonuses",
                  "You've used your bonus answers today. Go Premium for unlimited."
                );
              }
            }
            setShowPaywall(false);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F0F1A",
  },
  bgOrbTop: {
    position: "absolute",
    top: -120,
    right: -50,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(0, 210, 255, 0.08)",
  },
  bgOrbBottom: {
    position: "absolute",
    bottom: -120,
    left: -60,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(108, 92, 231, 0.12)",
  },
  answerScroll: {
    paddingTop: 44,
    paddingBottom: 28,
  },
  answerShell: {
    paddingHorizontal: 18,
    minHeight: height,
    justifyContent: "space-between",
  },
  topSection: {
    alignItems: "center",
    paddingTop: 28,
    marginBottom: 22,
  },
  screenKicker: {
    color: "rgba(234,251,255,0.65)",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 3,
    marginBottom: 12,
  },
  answerQuestion: {
    color: "#F7FAFF",
    fontSize: 30,
    fontWeight: "900",
    lineHeight: 36,
    textAlign: "center",
    maxWidth: 320,
    marginBottom: 18,
  },
  timerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.11)",
  },
  timerBadgeIcon: {
    color: "#FFFFFF",
    fontSize: 16,
  },
  timerBadgeText: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 1,
  },
  selectorSection: {
    marginBottom: 16,
  },
  sectionLabel: {
    color: "rgba(234,251,255,0.72)",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.4,
    marginBottom: 12,
  },
  modeSelector: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  modePill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minHeight: 92,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  modePillActive: {
    backgroundColor: "rgba(0,210,255,0.12)",
    borderColor: "rgba(0,210,255,0.45)",
    shadowColor: "#6C5CE7",
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
    transform: [{ scale: 1.04 }],
  },
  modeEmoji: {
    fontSize: 24,
  },
  modeLabel: {
    color: "rgba(234,251,255,0.7)",
    fontSize: 12,
    fontWeight: "800",
  },
  modeLabelActive: {
    color: "#FFFFFF",
  },
  dynamicSection: {
    marginBottom: 18,
  },
  resumeCard: {
    marginBottom: 14,
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255,173,51,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,173,51,0.22)",
  },
  resumeTitle: {
    color: "#FFF3D7",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 4,
  },
  resumeBody: {
    color: "rgba(255,243,215,0.8)",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  },
  dynamicHeader: {
    marginBottom: 12,
  },
  dynamicHeaderTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 4,
  },
  dynamicHeaderHint: {
    color: "rgba(234,251,255,0.62)",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  dynamicCard: {
    minHeight: 290,
    borderRadius: 28,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
  },
  dynamicTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 10,
  },
  dynamicSubtext: {
    color: "rgba(234,251,255,0.64)",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 18,
    marginTop: 12,
  },
  videoPreviewShell: {
    alignItems: "center",
  },
  videoPreviewGlow: {
    position: "absolute",
    top: 18,
    alignSelf: "center",
    width: width - 120,
    height: 180,
    borderRadius: 28,
  },
  videoPreviewFrame: {
    width: "100%",
    minHeight: 190,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(0,210,255,0.24)",
    backgroundColor: "rgba(6, 10, 20, 0.72)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  recordHintPill: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: "rgba(255,59,48,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,59,48,0.26)",
  },
  recordDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#FF3B30",
  },
  recordHintText: {
    color: "#FFD9D6",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  audioOrb: {
    alignSelf: "center",
    marginBottom: 18,
    shadowColor: "#00D2FF",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  audioOrbFill: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  waveRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-end",
    gap: 8,
    minHeight: 74,
    marginTop: 8,
  },
  waveBar: {
    width: 12,
    height: 54,
    borderRadius: 999,
    backgroundColor: "#00D2FF",
  },
  textPreviewCard: {
    width: "100%",
  },
  textPreviewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  textPreviewLabel: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  textPreviewTimer: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  textPreviewTimerText: {
    color: "rgba(234,251,255,0.78)",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  textPreviewField: {
    minHeight: 130,
    borderRadius: 22,
    padding: 16,
    backgroundColor: "rgba(6,10,20,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    justifyContent: "flex-start",
  },
  textPreviewPlaceholder: {
    color: "rgba(234,251,255,0.34)",
    fontSize: 17,
    fontWeight: "600",
  },
  reactionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 10,
  },
  reactionChip: {
    width: "48%",
    minHeight: 112,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(6,10,20,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  reactionChipActive: {
    backgroundColor: "rgba(108,92,231,0.18)",
    borderColor: "rgba(0,210,255,0.5)",
    transform: [{ scale: 1.03 }],
  },
  reactionEmoji: {
    fontSize: 34,
  },
  reactionEmojiActive: {
    transform: [{ scale: 1.08 }],
  },
  reactionLabel: {
    color: "rgba(234,251,255,0.7)",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    paddingHorizontal: 8,
  },
  reactionLabelActive: {
    color: "#FFFFFF",
  },
  startBtn: {
    borderRadius: 26,
    overflow: "hidden",
    marginBottom: 10,
  },
  startBtnDisabled: {
    opacity: 0.45,
  },
  startBtnGradient: {
    minHeight: 62,
    alignItems: "center",
    justifyContent: "center",
  },
  startBtnText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  startHelper: {
    color: "rgba(234,251,255,0.56)",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    paddingBottom: 10,
  },
  camera: {
    flex: 1,
  },
  preRecord: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 120,
    justifyContent: "center",
    alignItems: "center",
  },
  preReady: {
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 10,
  },
  preSub: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 28,
  },
  topOverlay: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 56,
    paddingHorizontal: 18,
  },
  cameraIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.42)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  questionOverlay: {
    position: "absolute",
    top: 116,
    left: 18,
    right: 18,
    padding: 18,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.48)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  cameraQuestionKicker: {
    color: "rgba(255,255,255,0.64)",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 8,
  },
  questionText: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 28,
  },
  saySomethingWrap: {
    position: "absolute",
    top: 198,
    left: 18,
    right: 18,
    alignItems: "center",
  },
  saySomething: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    backgroundColor: "rgba(0,0,0,0.38)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    overflow: "hidden",
  },
  bottomOverlay: {
    position: "absolute",
    bottom: 54,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  recordBtn: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 4,
    borderColor: "#00D2FF",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
    backgroundColor: "rgba(15,15,26,0.35)",
  },
  recordBtnActive: {
    borderColor: "#FF3B30",
  },
  recordBtnInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#FF3B30",
  },
  recordBtnInnerActive: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  cameraHint: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    fontWeight: "800",
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 250,
    backgroundColor: "#000",
  },
  previewVideo: {
    width: "100%",
    height: "100%",
  },
  previewGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  previewTopRow: {
    position: "absolute",
    top: 54,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  previewBack: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.46)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewContent: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 42,
  },
  previewTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
    marginBottom: 6,
  },
  previewBody: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 18,
  },
  previewActionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  tryAgainBtn: {
    flex: 1,
    borderRadius: 22,
    paddingVertical: 16,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  tryAgainText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 15,
    fontWeight: "800",
  },
  postBtn: {
    flex: 1,
    borderRadius: 22,
    overflow: "hidden",
  },
  postBtnGradient: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  postBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(9,12,23,0.75)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 280,
  },
  uploadingCard: {
    width: width - 54,
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingVertical: 24,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
  },
  uploadingTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 6,
  },
  uploadingBody: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 20,
  },
});
