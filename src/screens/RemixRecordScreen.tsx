import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Animated,
  Platform,
  Vibration,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Video, ResizeMode } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import Timer, { CountdownOverlay } from "../components/Timer";
import { useAuth } from "../context/AuthContext";
import { answersApi } from "../services/api";
import { eventTracker } from "../services/eventTracker";
import { showAppAlert } from "../utils/alerts";

const { width, height } = Dimensions.get("window");
const MAX_DURATION = 5;

type RemixPhase = "preview" | "countdown" | "recording" | "review" | "uploading" | "done";

export default function RemixRecordScreen({ route, navigation }: any) {
  const {
    parentAnswerId,
    parentVideoUrl,
    questionText,
    questionId,
    username,
    chainDepth,
  } = route?.params || {};

  const { user } = useAuth();
  const cameraRef = useRef<any>(null);
  const hasStartedRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<"front" | "back">("front");

  const [phase, setPhase] = useState<RemixPhase>("preview");
  const [countdownNum, setCountdownNum] = useState(3);
  const [recordTimer, setRecordTimer] = useState(MAX_DURATION);
  const [recordStartTime, setRecordStartTime] = useState(0);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for record button
  useEffect(() => {
    if (phase !== "preview") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulseAnim]);

  // Countdown logic
  useEffect(() => {
    if (phase !== "countdown") return;

    if (countdownNum === 0) {
      const goTimer = setTimeout(() => setPhase("recording"), 450);
      return () => clearTimeout(goTimer);
    }

    if (countdownNum < 0) return;
    const timer = setTimeout(() => setCountdownNum((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, countdownNum]);

  // Start recording when phase becomes "recording"
  useEffect(() => {
    if (phase !== "recording") return;
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    startRecording();
  }, [phase]);

  // Record timer countdown
  useEffect(() => {
    if (phase !== "recording") return;
    if (recordTimer <= 0) {
      stopRecording();
      return;
    }
    const interval = setInterval(() => {
      setRecordTimer((prev) => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, recordTimer]);

  const ensurePermission = async () => {
    if (permission?.granted) return true;
    const result = await requestPermission();
    return result?.granted || false;
  };

  const handleStartRemix = async () => {
    const ok = await ensurePermission();
    if (!ok) {
      showAppAlert("Camera needed", "Enable camera access to record your remix.");
      return;
    }
    Vibration.vibrate(10);
    setPhase("countdown");
    setCountdownNum(3);
    hasStartedRef.current = false;
  };

  const startRecording = async () => {
    if (!cameraRef.current) return;
    setRecordTimer(MAX_DURATION);
    setRecordStartTime(Date.now());
    setRecordedUri(null);

    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: MAX_DURATION });
      if (video?.uri) {
        setRecordedUri(video.uri);
        setPhase("review");
        hasStartedRef.current = false;
      }
    } catch (error) {
      console.error("Remix recording error:", error);
      setPhase("preview");
      hasStartedRef.current = false;
      if (Platform.OS === "web") {
        showAppAlert("Web recording not supported", "Use the iOS or Android app for video remixes.");
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

  const handleUploadRemix = async () => {
    if (!recordedUri || uploading) return;
    setPhase("uploading");
    setUploading(true);

    const responseTime = Math.min((Date.now() - recordStartTime) / 1000, MAX_DURATION);

    try {
      // Upload video first
      const uploadResult = await answersApi.upload(
        user?.id || 0,
        questionId || 1,
        recordedUri,
        parseFloat(responseTime.toFixed(1)),
        { answer_type: "video" }
      );

      const videoUrl = uploadResult.data?.video_url;

      // Now create the remix
      const remixResult = await answersApi.createRemix(parentAnswerId, {
        video_url: videoUrl,
        answer_type: "video",
        response_time: parseFloat(responseTime.toFixed(1)),
      });

      // Track event
      eventTracker.remixCreated(
        remixResult.data?.id || 0,
        parentAnswerId,
        remixResult.data?.chain_depth || (chainDepth || 0) + 1
      );

      setPhase("done");

      // Show success and go back to feed
      setTimeout(() => {
        navigation.goBack();
        showAppAlert("Remix posted! 🔥", "Your remix is now in the chain.");
      }, 1500);
    } catch (error: any) {
      console.error("Remix upload error:", error);
      const serverError = error?.response?.data?.error;

      if (serverError === "self_remix") {
        showAppAlert("Can't remix yourself", "You can only remix other people's answers.");
      } else if (serverError === "already_remixed") {
        showAppAlert("Already remixed", "You've already remixed this answer.");
      } else if (serverError === "max_depth_reached") {
        showAppAlert("Chain limit", "This chain has reached the maximum depth.");
      } else {
        showAppAlert("Upload failed", "Could not post your remix. Try again.");
      }
      setPhase("review");
    } finally {
      setUploading(false);
    }
  };

  const handleRetake = () => {
    setRecordedUri(null);
    setPhase("preview");
    hasStartedRef.current = false;
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <LinearGradient colors={["#090C17", "#0F0F1A", "#14142A"]} style={StyleSheet.absoluteFill} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Ionicons name="close" size={28} color="#FFF" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Ionicons name="git-compare-outline" size={18} color="#00E5FF" />
          <Text style={styles.headerTitle}>Remix</Text>
          {chainDepth > 0 && (
            <View style={styles.depthBadge}>
              <Text style={styles.depthText}>Chain #{chainDepth + 1}</Text>
            </View>
          )}
        </View>

        <View style={{ width: 40 }} />
      </View>

      {/* Original video (top half) */}
      <View style={styles.originalSection}>
        <View style={styles.originalLabel}>
          <Text style={styles.originalLabelText}>ORIGINAL by @{username}</Text>
        </View>
        {parentVideoUrl ? (
          <Video
            source={{ uri: parentVideoUrl }}
            style={styles.originalVideo}
            resizeMode={ResizeMode.COVER}
            shouldPlay={phase === "preview"}
            isLooping
            isMuted={phase === "recording"}
          />
        ) : (
          <View style={styles.originalPlaceholder}>
            <Ionicons name="videocam-off" size={32} color="#555" />
          </View>
        )}
      </View>

      {/* Question */}
      <View style={styles.questionBar}>
        <Text style={styles.questionText} numberOfLines={2}>
          {questionText || "What is your answer?"}
        </Text>
      </View>

      {/* Recording / Preview area (bottom half) */}
      <View style={styles.recordSection}>
        {/* Countdown overlay */}
        {phase === "countdown" && (
          <View style={styles.countdownOverlay}>
            <CountdownOverlay count={countdownNum} />
          </View>
        )}

        {/* Camera view during recording */}
        {phase === "recording" && permission?.granted && (
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing={facing}
            mode="video"
          >
            <Timer seconds={recordTimer} total={MAX_DURATION} />
            <View style={styles.recordingIndicator}>
              <View style={styles.recordDot} />
              <Text style={styles.recordingText}>REC</Text>
            </View>
          </CameraView>
        )}

        {/* Review recorded video */}
        {phase === "review" && recordedUri && (
          <Video
            source={{ uri: recordedUri }}
            style={styles.camera}
            resizeMode={ResizeMode.COVER}
            shouldPlay
            isLooping
          />
        )}

        {/* Preview state — show start button */}
        {phase === "preview" && (
          <View style={styles.previewArea}>
            <LinearGradient
              colors={["rgba(0,229,255,0.08)", "rgba(179,136,255,0.1)"]}
              style={styles.previewGradient}
            >
              <Ionicons name="videocam" size={40} color="#00E5FF" />
              <Text style={styles.previewText}>Record your version</Text>
              <Text style={styles.previewSubtext}>Show them how it's done ⚡</Text>
            </LinearGradient>
          </View>
        )}

        {/* Uploading state */}
        {phase === "uploading" && (
          <View style={styles.uploadingOverlay}>
            <ActivityIndicator size="large" color="#00E5FF" />
            <Text style={styles.uploadingText}>Posting remix...</Text>
          </View>
        )}

        {/* Done state */}
        {phase === "done" && (
          <View style={styles.doneOverlay}>
            <Ionicons name="checkmark-circle" size={64} color="#00FF88" />
            <Text style={styles.doneText}>Remix posted! 🔥</Text>
          </View>
        )}
      </View>

      {/* Bottom actions */}
      <View style={styles.bottomBar}>
        {phase === "preview" && (
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity style={styles.startButton} onPress={handleStartRemix}>
              <LinearGradient
                colors={["#00E5FF", "#7C4DFF"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.startButtonGradient}
              >
                <Ionicons name="videocam" size={22} color="#FFF" />
                <Text style={styles.startButtonText}>Record your remix</Text>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        )}

        {phase === "recording" && (
          <TouchableOpacity style={styles.stopButton} onPress={stopRecording}>
            <View style={styles.stopDot} />
            <Text style={styles.stopText}>Stop</Text>
          </TouchableOpacity>
        )}

        {phase === "review" && (
          <View style={styles.reviewActions}>
            <TouchableOpacity style={styles.retakeButton} onPress={handleRetake}>
              <Ionicons name="refresh" size={22} color="#FFF" />
              <Text style={styles.retakeText}>Retake</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.postButton} onPress={handleUploadRemix}>
              <LinearGradient
                colors={["#00E5FF", "#00FF88"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.postButtonGradient}
              >
                <Ionicons name="arrow-up" size={22} color="#000" />
                <Text style={styles.postText}>Post Remix</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#090C17",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 8,
    zIndex: 10,
  },
  headerBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  headerCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "800",
  },
  depthBadge: {
    backgroundColor: "rgba(0,229,255,0.15)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(0,229,255,0.25)",
  },
  depthText: {
    color: "#00E5FF",
    fontSize: 11,
    fontWeight: "800",
  },

  // Original video section
  originalSection: {
    height: height * 0.28,
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  originalLabel: {
    position: "absolute",
    top: 8,
    left: 8,
    zIndex: 5,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  originalLabelText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  originalVideo: {
    width: "100%",
    height: "100%",
  },
  originalPlaceholder: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1A1A2E",
  },

  // Question bar
  questionBar: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  questionText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
    textAlign: "center",
  },

  // Record section
  recordSection: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "rgba(0,229,255,0.15)",
  },
  camera: {
    width: "100%",
    height: "100%",
  },
  countdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(9,12,23,0.9)",
    zIndex: 10,
  },
  previewArea: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  previewGradient: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  previewText: {
    color: "#FFF",
    fontSize: 20,
    fontWeight: "800",
  },
  previewSubtext: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    fontWeight: "600",
  },
  recordingIndicator: {
    position: "absolute",
    top: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,0,0,0.6)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  recordDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FF0000",
  },
  recordingText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "800",
  },
  uploadingOverlay: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    backgroundColor: "rgba(9,12,23,0.95)",
  },
  uploadingText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "700",
  },
  doneOverlay: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(9,12,23,0.95)",
  },
  doneText: {
    color: "#FFF",
    fontSize: 20,
    fontWeight: "800",
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingBottom: 36,
  },
  startButton: {
    borderRadius: 24,
    overflow: "hidden",
  },
  startButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 24,
  },
  startButtonText: {
    color: "#FFF",
    fontSize: 17,
    fontWeight: "800",
  },
  stopButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FF1744",
    borderRadius: 24,
    paddingVertical: 16,
  },
  stopDot: {
    width: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: "#FFF",
  },
  stopText: {
    color: "#FFF",
    fontSize: 17,
    fontWeight: "800",
  },
  reviewActions: {
    flexDirection: "row",
    gap: 12,
  },
  retakeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 24,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  retakeText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "700",
  },
  postButton: {
    flex: 2,
    borderRadius: 24,
    overflow: "hidden",
  },
  postButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 24,
  },
  postText: {
    color: "#000",
    fontSize: 17,
    fontWeight: "800",
  },
});
