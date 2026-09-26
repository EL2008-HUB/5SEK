import React, { useState, useRef, useCallback } from "react";
import {
  Alert,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
  AppState,
  AppStateStatus,
} from "react-native";
import { Video, ResizeMode, AVPlaybackStatus } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import ShareOverlay from "./ShareOverlay";
import RemixChainView from "./RemixChainView";
import ChaosMeter, { ChaosThreadMeta } from "./ChaosMeter";
import CommentSheet from "./CommentSheet";
import { answersApi, duelsApi, moderationApi } from "../services/api";
import { eventTracker } from "../services/eventTracker";
import { isFeatureEnabled } from "../services/featureFlags";
import { showAppAlert } from "../utils/alerts";
import { useAuth } from "../context/AuthContext";
import { useNavigation } from "@react-navigation/native";

// Safe haptics import (may not be installed)
let Haptics: any = null;
try {
  Haptics = require("expo-haptics");
} catch (_) {}

const { width, height } = Dimensions.get("window");

interface VideoCardProps {
  video: {
    id: number;
    answer_type?: "video" | "audio" | "text" | "reaction";
    video_url: string | null;
    text_content?: string | null;
    username: string;
    user_id?: number;
    question_text: string;
    question_id?: number;
    response_time?: number | null;
    created_at: string;
    likes?: number;
    liked_by_me?: boolean;
    hook_label?: string;
    social_label?: string;
    is_trending?: boolean;
    is_remix?: boolean;
    chain_depth?: number;
    parent_answer_id?: number | null;
    social_proof?: {
      badge?: string;
      label?: string;
      today_answers?: number;
    };
    heat_overlay?: {
      label?: string;
      sublabel?: string | null;
      intensity?: "low" | "medium" | "high";
      variant?: string;
    } | null;
    chaos_thread?: ChaosThreadMeta | null;
  };
  isVisible: boolean;
  /** Mount native video player only for nearby cells (perf). */
  mountMedia?: boolean;
  position?: number; // FIX 2: feed position for analytics
  /** Visible height of the card (feed viewport minus tab bar). Defaults to window height. */
  cardHeight?: number;
}

export function VideoCard({ video, isVisible, mountMedia = true, position, cardHeight }: VideoCardProps) {
  const videoRef = useRef<Video>(null);
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const resolvedHeight = cardHeight && cardHeight > 0 ? cardHeight : height;
  const [challenging, setChallenging] = useState(false);
  const isTextAnswer = video.answer_type === "text" || video.answer_type === "reaction";
  const isAudioAnswer = video.answer_type === "audio";
  const shouldMountMedia = mountMedia && !isTextAnswer;
  const [isPlaying, setIsPlaying] = useState(false);
  const [showShareOverlay, setShowShareOverlay] = useState(false);
  const [liked, setLiked] = useState(Boolean(video.liked_by_me));
  const [likeCount, setLikeCount] = useState(video.likes || 0);
  const likeInFlightRef = useRef(false);
  const [remixCount, setRemixCount] = useState(0);
  const [chaosThread, setChaosThread] = useState<ChaosThreadMeta | null>(
    video.chaos_thread || null
  );
  const [showRemixPrompt, setShowRemixPrompt] = useState(false);
  const [showChainModal, setShowChainModal] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const remixPromptShownRef = useRef(false);
  const watchStartedAtRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string>(`${video.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  // 🔥 MICRO-UPGRADE 2: Progress bar (0 → 5s)
  const progressAnim = useRef(new Animated.Value(0)).current;
  const chaosPulseAnim = useRef(new Animated.Value(1)).current;
  // 🔥 MICRO-UPGRADE 4: Replay counter
  const replayCountRef = useRef(0);
  const chainHeat = video.chaos_thread?.chain_heat || video.chaos_thread?.score || 0;
  const isHotChain =
    Boolean(video.chaos_thread) &&
    video.chaos_thread?.level !== "LOW" &&
    chainHeat >= 45;

  React.useEffect(() => {
    if (!isVisible || !isHotChain) return;
    if (chainHeat >= 80) {
      try { Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Heavy); } catch (_) {}
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(chaosPulseAnim, { toValue: 1.035, duration: 620, useNativeDriver: true }),
        Animated.timing(chaosPulseAnim, { toValue: 1, duration: 620, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isVisible, isHotChain, chainHeat, chaosPulseAnim]);

  // Autoplay when visible (TikTok behavior)
  React.useEffect(() => {
    if (isVisible) {
      watchStartedAtRef.current = Date.now();
      // 🔥 v2: view + incremental watch tracking with position
      eventTracker.view(video.id, position);
      eventTracker.startWatching(video.id, 5, position);
    } else {
      // 🔥 v2: stopWatching handles watch/complete/skip detection (relative)
      eventTracker.stopWatching(video.id);

      // Legacy analytics (backward compat)
      if (watchStartedAtRef.current) {
        const watchedSeconds = (Date.now() - watchStartedAtRef.current) / 1000;
        watchStartedAtRef.current = null;
        if (watchedSeconds > 0.2) {
          const event_type =
            watchedSeconds >= 4.5 ? "completed" : watchedSeconds <= 1.5 ? "skipped" : "watch_progress";
          answersApi.trackAnalytics(video.id, {
            event_type,
            watch_time: Number(watchedSeconds.toFixed(2)),
            session_id: sessionIdRef.current,
            metadata: { answer_type: video.answer_type || "video", position },
          }).catch(() => {});
        }
      }
    }

    if (isTextAnswer || !shouldMountMedia) return;
    if (!videoRef.current) return;

    if (isVisible) {
      videoRef.current.playAsync();
      setIsPlaying(true);

      // 🔥 MICRO-UPGRADE 2: Start progress bar animation
      progressAnim.setValue(0);
      replayCountRef.current = 0;
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 5000,
        useNativeDriver: false,
      }).start();
    } else {
      videoRef.current.pauseAsync();
      videoRef.current.setPositionAsync(0);
      setIsPlaying(false);
      progressAnim.setValue(0);
    }
  }, [isTextAnswer, isVisible, shouldMountMedia]);

  React.useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (isTextAnswer || !shouldMountMedia || !videoRef.current) return;

      if (nextState !== "active") {
        videoRef.current.pauseAsync().catch(() => {});
        setIsPlaying(false);
        return;
      }

      if (isVisible) {
        videoRef.current.playAsync().catch(() => {});
        setIsPlaying(true);
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, [isTextAnswer, isVisible, shouldMountMedia]);

  // 🔥 MICRO-UPGRADE 1: Hold frame + MICRO-UPGRADE 4: replay boost
  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    if (status.didJustFinish && isVisible) {
      replayCountRef.current += 1;

      // 🔥 MICRO-UPGRADE 4: Track replay on 2nd+ watch
      if (replayCountRef.current >= 1) {
        eventTracker.replay(video.id, position);
      }

      // 🔥 FIX 1: Auto-suggest remix after video finishes (replay = watched 3s+)
      if (!remixPromptShownRef.current && video.answer_type === "video" && replayCountRef.current >= 1) {
        remixPromptShownRef.current = true;
        setShowRemixPrompt(true);
        setTimeout(() => setShowRemixPrompt(false), 4000);
      }

      // 🔥 MICRO-UPGRADE 1: Hold frame 200ms before replay
      if (videoRef.current) {
        videoRef.current.pauseAsync();
        setTimeout(() => {
          if (videoRef.current && isVisible) {
            videoRef.current.setPositionAsync(0);
            videoRef.current.playAsync();

            // Restart progress bar
            progressAnim.setValue(0);
            Animated.timing(progressAnim, {
              toValue: 1,
              duration: 5000,
              useNativeDriver: false,
            }).start();
          }
        }, 200);
      }
    }
  }, [isVisible, video.id, position, progressAnim]);

  React.useEffect(() => {
    return () => {
      if (!watchStartedAtRef.current) return;
      const watchedSeconds = (Date.now() - watchStartedAtRef.current) / 1000;
      watchStartedAtRef.current = null;
      if (watchedSeconds > 0.2) {
        const event_type =
          watchedSeconds >= 4.5 ? "completed" : watchedSeconds <= 1.5 ? "skipped" : "watch_progress";
        answersApi.trackAnalytics(video.id, {
          event_type,
          watch_time: Number(watchedSeconds.toFixed(2)),
          session_id: sessionIdRef.current,
          metadata: { answer_type: video.answer_type || "video", source: "unmount" },
        }).catch(() => {});
      }
    };
  }, [video.answer_type, video.id]);

  // Fetch remix count only when the card is on-screen (avoid N+1 on scroll).
  React.useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    answersApi.getRemixInfo(video.id)
      .then((res) => {
        if (cancelled) return;
        setRemixCount(res.data?.remix_count || 0);
        if (res.data?.chaos_thread) setChaosThread(res.data.chaos_thread);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [video.id, isVisible]);

  React.useEffect(() => {
    setLikeCount(video.likes || 0);
    setLiked(Boolean(video.liked_by_me));
    setShowRemixPrompt(false);
    setShowChainModal(false);
    remixPromptShownRef.current = false;
  }, [video.id, video.likes, video.liked_by_me]);

  // Like = the feed's vote. Optimistic toggle, reconciled with the server's authoritative state.
  const toggleLike = useCallback(async () => {
    if (likeInFlightRef.current) return;
    if (!user?.id) {
      showAppAlert("Hyr ne llogari", "Duhet te hysh ne llogari per te pelqyer pergjigjet.");
      return;
    }
    const nextLiked = !liked;
    const previousLiked = liked;
    const previousCount = likeCount;

    likeInFlightRef.current = true;
    setLiked(nextLiked);
    setLikeCount((c) => Math.max(0, c + (nextLiked ? 1 : -1)));
    try { Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Light); } catch (_) {}
    if (nextLiked) eventTracker.like(video.id);

    try {
      const response = await answersApi.likeAnswer(video.id);
      const data = response.data;
      if (data && typeof data.liked === "boolean") {
        setLiked(data.liked);
        if (typeof data.likes === "number") setLikeCount(Math.max(0, data.likes));
      }
    } catch (error: any) {
      setLiked(previousLiked);
      setLikeCount(previousCount);
      if (error?.response?.status === 429) {
        showAppAlert("Ngadale", "Shume veprime brenda pak sekondave. Provo perseri pas pak.");
      } else if (!error?.response) {
        showAppAlert("Pa lidhje", "Pelqimi nuk u ruajt. Provo perseri kur te kesh internet.");
      }
    } finally {
      likeInFlightRef.current = false;
    }
  }, [liked, likeCount, user?.id, video.id]);

  const togglePlay = async () => {
    if (isTextAnswer) return;
    if (!videoRef.current) return;

    if (isPlaying) {
      await videoRef.current.pauseAsync();
    } else {
      await videoRef.current.playAsync();
    }
    setIsPlaying(!isPlaying);
  };

  const timeAgo = (dateStr: string) => {
    const seconds = Math.floor(
      (new Date().getTime() - new Date(dateStr).getTime()) / 1000
    );
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const vibeTag = () => {
    // Social-proof microcopy: normalize imperfect/real answers
    if (video.response_time == null) return { emoji: "😅", text: "no pressure" };
    if (video.response_time >= 4.4) return { emoji: "🤦", text: "first thought" };
    if (video.response_time >= 3.4) return { emoji: "😂", text: "kinda random" };
    if (video.response_time <= 1.8) return { emoji: "⚡", text: "no thinking" };
    return { emoji: "😳", text: "real answer" };
  };

  const tag = vibeTag();
  const hookLabel = video.hook_label || `${tag.emoji} ${tag.text}`;
  const socialLabel = video.social_label || video.social_proof?.label || null;
  const chaosJoin = chaosThread?.join_overlay || video.chaos_thread?.join_overlay || null;
  const chaosReplyCount =
    chaosJoin?.reply_count ??
    ((chaosThread?.joined_count ?? chaosThread?.remix_count ?? video.chaos_thread?.remix_count ?? 0) +
      (chaosThread?.comment_count ?? video.chaos_thread?.comment_count ?? 0));
  const textAnswerBody = video.text_content || "";
  const mediaUri = video.video_url || "";
  const requireLogin = () => {
    if (user?.id) return true;
    showAppAlert("Hyr ne llogari", "Duhet te hysh ne llogari per kete veprim.");
    return false;
  };

  const reportAnswer = () => {
    if (!requireLogin()) return;
    Alert.alert("Raporto pergjigjen", "Pse e raporton kete pergjigje?", [
      { text: "Anulo", style: "cancel" },
      {
        text: "Spam",
        onPress: async () => {
          try {
            await moderationApi.reportAnswer(video.id, { reason: "spam" });
            showAppAlert("U raportua", "Faleminderit. Ekipi i moderimit e ka marre.");
          } catch (_) {
            showAppAlert("Nuk u raportua", "Provo perseri pas pak.");
          }
        },
      },
      {
        text: "Abuzim",
        style: "destructive",
        onPress: async () => {
          try {
            await moderationApi.reportAnswer(video.id, { reason: "abuse" });
            showAppAlert("U raportua", "Faleminderit. Ekipi i moderimit e ka marre.");
          } catch (_) {
            showAppAlert("Nuk u raportua", "Provo perseri pas pak.");
          }
        },
      },
    ]);
  };

  const openSafetyActions = () => {
    Alert.alert("Me shume", `@${video.username}`, [
      { text: "Anulo", style: "cancel" },
      { text: "Raporto pergjigjen", onPress: reportAnswer },
      {
        text: "Raporto perdoruesin",
        onPress: async () => {
          if (!requireLogin()) return;
          try {
            await moderationApi.reportUser(video.user_id || 0, { reason: "abuse" });
            showAppAlert("U raportua", "Raporti per perdoruesin u dergua.");
          } catch (_) {
            showAppAlert("Nuk u raportua", "Provo perseri pas pak.");
          }
        },
      },
      {
        text: "Blloko perdoruesin",
        style: "destructive",
        onPress: async () => {
          if (!requireLogin()) return;
          try {
            await moderationApi.blockUser(video.user_id || 0);
            showAppAlert("U bllokua", `Nuk do ta shohesh me @${video.username} ne feed.`);
          } catch (_) {
            showAppAlert("Nuk u bllokua", "Provo perseri pas pak.");
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { height: resolvedHeight }]}>
      {/* Full-screen video */}
      <TouchableOpacity
        style={[styles.videoWrapper, { height: resolvedHeight }]}
        onPress={togglePlay}
        activeOpacity={1}
      >
        {isTextAnswer ? (
          <LinearGradient
            colors={video.answer_type === "reaction" ? ["#1D2340", "#32195E"] : ["#131A2D", "#12243A"]}
            style={styles.textAnswerCanvas}
          >
            <View style={styles.textAnswerBadge}>
              <Text style={styles.textAnswerBadgeText}>
                {video.answer_type === "reaction" ? "REACTION" : "TEXT"}
              </Text>
            </View>
            <Text style={styles.textAnswerBody}>{textAnswerBody}</Text>
          </LinearGradient>
        ) : shouldMountMedia ? (
          <>
            <Video
              ref={videoRef}
              source={{ uri: mediaUri }}
              style={styles.video}
              resizeMode={ResizeMode.COVER}
              isLooping={false}
              shouldPlay={false}
              isMuted={false}
              onPlaybackStatusUpdate={onPlaybackStatusUpdate}
              onLoad={() => {
                if (isVisible && videoRef.current) {
                  videoRef.current.playAsync().catch(() => {});
                  setIsPlaying(true);
                }
              }}
            />

            {/* 🔥 MICRO-UPGRADE 2: Subtle progress bar */}
            {isVisible && (
              <View style={styles.progressBarContainer}>
                <Animated.View
                  style={[
                    styles.progressBarFill,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["0%", "100%"],
                      }),
                    },
                  ]}
                />
              </View>
            )}
          </>
        ) : (
          <View style={[styles.video, styles.videoPlaceholder]} />
        )}

        {isAudioAnswer && (
          <View style={styles.audioAnswerOverlay}>
            <View style={styles.audioPulse}>
              <Ionicons name="mic" size={42} color="#FFF" />
            </View>
            <Text style={styles.audioAnswerLabel}>{isPlaying ? "Audio playing" : "Audio answer"}</Text>
          </View>
        )}

        {/* Play/pause indicator */}
        {!isTextAnswer && !isPlaying && (
          <View style={styles.playOverlay}>
            <View style={styles.playButton}>
              <Ionicons name="play" size={40} color="#FFF" />
            </View>
          </View>
        )}

        {/* Top gradient */}
        <LinearGradient
          colors={["rgba(0,0,0,0.6)", "transparent"]}
          style={styles.topGradient}
        >
          {/* 5 SEK badge */}
          <View style={styles.badge}>
            <Text style={styles.badgeText}>5s</Text>
          </View>

          {/* Social-proof tag */}
          <View style={styles.vibeTag}>
            <Text style={styles.vibeTagText}>{hookLabel}</Text>
          </View>

          {/* Response time badge */}
          {video.response_time && (
            <View style={styles.responseBadge}>
              <Ionicons name="flash" size={12} color="#FFD700" />
              <Text style={styles.responseBadgeText}>
                {video.response_time.toFixed(1)}s
              </Text>
            </View>
          )}
        </LinearGradient>

        {/* Bottom gradient with info */}
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.85)"]}
          style={styles.bottomGradient}
        >
          {socialLabel && (
            <View style={styles.socialProofPill}>
              <Text style={styles.socialProofText}>{socialLabel}</Text>
            </View>
          )}

          {video.heat_overlay?.label && (
            <View
              style={[
                styles.heatOverlayPill,
                video.heat_overlay.intensity === "high" && styles.heatOverlayPillHot,
              ]}
            >
              <Text style={styles.heatOverlayText} numberOfLines={1}>
                {video.heat_overlay.label}
              </Text>
              {video.heat_overlay.sublabel ? (
                <Text style={styles.heatOverlaySubtext} numberOfLines={1}>
                  {video.heat_overlay.sublabel}
                </Text>
              ) : null}
            </View>
          )}

          {/* Remix badge */}
          {video.is_remix && (
            <View style={styles.remixBadge}>
              <Ionicons name="git-compare-outline" size={12} color="#00E5FF" />
              <Text style={styles.remixBadgeText}>
                REMIX #{video.chain_depth || 1}
              </Text>
            </View>
          )}

          {/* Chaos thread badge (feed) */}
          {video.chaos_thread &&
            video.chaos_thread.level !== "LOW" && (
              <TouchableOpacity
                style={styles.chaosBadge}
                onPress={() => setShowChainModal(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.chaosBadgeText} numberOfLines={1}>
                  {video.chaos_thread.label}
                </Text>
              </TouchableOpacity>
            )}

          {/* Chain visibility — clickable remix count */}
          {remixCount > 0 && (
            <TouchableOpacity
              style={styles.chainBadge}
              onPress={() => setShowChainModal(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="git-compare-outline" size={13} color="#00E5FF" />
              <Text style={styles.chainBadgeText}>
                {remixCount} {remixCount === 1 ? "remix" : "remixes"} 👀
              </Text>
              <Ionicons name="chevron-forward" size={12} color="rgba(0,229,255,0.6)" />
            </TouchableOpacity>
          )}

          {chaosThread && chaosThread.level !== "LOW" && (
            <ChaosMeter chaos={chaosThread} compact />
          )}

          {isHotChain && (
            <Animated.View style={{ transform: [{ scale: chaosPulseAnim }] }}>
              <TouchableOpacity
                style={[
                  styles.joinChaosCard,
                  chainHeat >= 90 && styles.joinChaosCardHot,
                ]}
                activeOpacity={0.88}
                onPress={() => setShowChainModal(true)}
              >
                <View style={styles.joinChaosPreviewRow}>
                  {(chaosJoin?.blurred_previews || [{ answer_id: 1 }, { answer_id: 2 }, { answer_id: 3 }])
                    .slice(0, 3)
                    .map((preview: any, idx: number) => (
                      <View key={`${preview.answer_id || idx}`} style={styles.blurredPreviewDot}>
                        <Ionicons name="eye-off" size={13} color="rgba(255,255,255,0.78)" />
                      </View>
                    ))}
                </View>
                <View style={styles.joinChaosCopy}>
                  <Text style={styles.joinChaosTitle}>
                    {video.chaos_thread?.user_started_this ? "YOU STARTED THIS" : "JOIN THE CHAOS"}
                  </Text>
                  <Text style={styles.joinChaosSub} numberOfLines={1}>
                    {chaosReplyCount} replies - {chaosJoin?.countdown_seconds ? `${Math.ceil(chaosJoin.countdown_seconds / 60)}m left` : "live now"}
                  </Text>
                </View>
                <Ionicons name="flash" size={18} color="#FFF" />
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* Question */}
          <Text style={styles.questionText} numberOfLines={2}>
            {video.question_text}
          </Text>

          {/* User info */}
          <View style={styles.userRow}>
            <View style={styles.userAvatar}>
              <Text style={styles.userAvatarText}>
                {video.username.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.userInfo}>
              <Text style={styles.username}>@{video.username}</Text>
              <Text style={styles.timeAgo}>{timeAgo(video.created_at)}</Text>
            </View>
          </View>
        </LinearGradient>

        {/* Right side action buttons (TikTok style) */}
        <View style={styles.sideActions}>
          {isFeatureEnabled("duels_v1") && Number(video.user_id) !== Number(user?.id) ? (
            <TouchableOpacity
              style={styles.sideButton}
              onPress={async () => {
                if (challenging) return;
                try {
                  setChallenging(true);
                  const result = await duelsApi.challengeOrQueue(video.id);
                  if (result.kind === "queued") {
                    showAppAlert(
                      "Je ne radhe",
                      "Ky lojtar eshte ne nje duel tjeter. Dueli yt hapet automatikisht sa gjendet rival."
                    );
                  } else {
                    showAppAlert("Duel live", "Dueli u krijua. Hap tab Duels per te pare votat.");
                  }
                  navigation.navigate("Duels");
                } catch (error: any) {
                  const code = error?.response?.data?.error;
                  if (code === "need_own_answer") {
                    showAppAlert("Pergjigju fillimisht", "Posto pergjigjen tende ne te njejten pyetje dhe dueli niset automatikisht.");
                    navigation.navigate("Record", {
                      questionId: video.question_id,
                      questionText: video.question_text,
                      challengeAnswerId: video.id,
                    });
                    return;
                  }
                  if (code === "active_duel_exists") {
                    showAppAlert("Nje duel ne kohe", "Ke nje duel aktiv. Shko te Duels.");
                    navigation.navigate("Duels");
                    return;
                  }
                  if (code === "cannot_duel_yourself") {
                    showAppAlert("Duel", "Nuk mund te sfidosh veten.");
                    return;
                  }
                  showAppAlert("Dueli deshtoi", "Provo perseri pas pak.");
                } finally {
                  setChallenging(false);
                }
              }}
            >
              <Ionicons name="flash" size={28} color="#3DFFC8" />
              <Text style={[styles.sideButtonText, { color: "#3DFFC8" }]}>
                {challenging ? "..." : "Duel"}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Like (feed vote) */}
          <TouchableOpacity
            style={styles.sideButton}
            onPress={toggleLike}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: liked }}
            accessibilityLabel={liked ? "Hiq pelqimin" : "Pelqe"}
          >
            <Ionicons
              name={liked ? "heart" : "heart-outline"}
              size={30}
              color={liked ? "#FF2D6A" : "#FFF"}
            />
            <Text style={[styles.sideButtonText, liked && styles.sideButtonTextActive]}>
              {likeCount > 0 ? likeCount : "Pelqe"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sideButton}
            hitSlop={8}
            onPress={() => {
              try { Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Medium); } catch (_) {}
              setShowShareOverlay(true);
              eventTracker.share(video.id);
              answersApi.shareAnswer(video.id).catch(() => {});
            }}
          >
            <Ionicons name="share-social" size={28} color="#FFF" />
            <Text style={styles.sideButtonText}>Shperndaj</Text>
          </TouchableOpacity>

          {/* Comment */}
          <TouchableOpacity
            style={styles.sideButton}
            onPress={() => {
              try { Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Light); } catch (_) {}
              setShowComments(true);
            }}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={26} color="#FFF" />
            <Text style={styles.sideButtonText}>Komento</Text>
          </TouchableOpacity>

          {Number(video.user_id) !== Number(user?.id) ? (
            <TouchableOpacity style={styles.sideButton} onPress={openSafetyActions} hitSlop={8}>
              <Ionicons name="ellipsis-horizontal-circle-outline" size={26} color="#FFF" />
              <Text style={styles.sideButtonText}>Me shume</Text>
            </TouchableOpacity>
          ) : null}

          {video.answer_type === "video" && (
            <TouchableOpacity
              style={styles.sideButton}
              onPress={() => {
                try { Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Light); } catch (_) {}
                eventTracker.remixViewed(video.id, video.chain_depth || 0);
                navigation.navigate("RemixRecord", {
                  parentAnswerId: video.id,
                  parentVideoUrl: video.video_url,
                  questionText: video.question_text,
                  questionId: video.question_id,
                  username: video.username,
                  chainDepth: video.chain_depth || 0,
                  autoStart: true,
                });
              }}
            >
              <Ionicons name="git-compare-outline" size={28} color="#00E5FF" />
              <Text style={[styles.sideButtonText, { color: "#00E5FF" }]}>
                {remixCount > 0
                  ? chaosThread?.continue_chain_cta?.replace("⚡ ", "") || `${remixCount}`
                  : "Chain"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>

      {/* 🔥 VIRAL Share Overlay */}
      {showShareOverlay && (
        <ShareOverlay
          video={video}
          onClose={() => setShowShareOverlay(false)}
        />
      )}

      {/* 🔥 FIX 1: Auto-suggest remix prompt */}
      {showRemixPrompt && video.answer_type === "video" && (
        <View style={styles.remixPrompt}>
          <TouchableOpacity
            style={styles.remixPromptInner}
            activeOpacity={0.85}
            onPress={() => {
              setShowRemixPrompt(false);
              try { Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Medium); } catch (_) {}
              navigation.navigate("RemixRecord", {
                parentAnswerId: video.id,
                parentVideoUrl: video.video_url,
                questionText: video.question_text,
                questionId: video.question_id,
                username: video.username,
                chainDepth: video.chain_depth || 0,
                autoStart: true,
              });
            }}
          >
            <Text style={styles.remixPromptEmoji}>👀</Text>
            <View style={styles.remixPromptTextWrap}>
              <Text style={styles.remixPromptTitle}>What would YOU say?</Text>
              <Text style={styles.remixPromptSub}>Remix in 5 seconds ⚡</Text>
            </View>
            <Ionicons name="arrow-forward-circle" size={28} color="#00E5FF" />
          </TouchableOpacity>
        </View>
      )}

      {/* 🔥 FIX 2: Chain modal */}
      {showChainModal && (
        <View style={styles.chainModalOverlay}>
          <RemixChainView
            answerId={video.id}
            onClose={() => setShowChainModal(false)}
            onRemix={(parentId) => {
              setShowChainModal(false);
              navigation.navigate("RemixRecord", {
                parentAnswerId: parentId,
                parentVideoUrl: video.video_url,
                questionText: video.question_text,
                questionId: video.question_id,
                username: video.username,
                chainDepth: video.chain_depth || 0,
                autoStart: true,
              });
            }}
          />
        </View>
      )}

      {/* 💬 Comment Sheet */}
      <CommentSheet
        answerId={video.id}
        visible={showComments}
        onClose={() => setShowComments(false)}
      />
    </View>
  );
}

function areVideoCardPropsEqual(prev: VideoCardProps, next: VideoCardProps) {
  return (
    prev.isVisible === next.isVisible &&
    prev.mountMedia === next.mountMedia &&
    prev.position === next.position &&
    prev.cardHeight === next.cardHeight &&
    prev.video.id === next.video.id &&
    prev.video.likes === next.video.likes &&
    prev.video.liked_by_me === next.video.liked_by_me &&
    prev.video.video_url === next.video.video_url
  );
}

export default React.memo(VideoCard, areVideoCardPropsEqual);

const styles = StyleSheet.create({
  container: {
    width: width,
    height: height,
  },
  videoWrapper: {
    width: width,
    height: height,
    backgroundColor: "#000",
  },
  video: {
    width: "100%",
    height: "100%",
  },
  videoPlaceholder: {
    backgroundColor: "#050505",
  },
  textAnswerCanvas: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
  },
  textAnswerBadge: {
    position: "absolute",
    top: 96,
    left: 20,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  textAnswerBadgeText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  textAnswerBody: {
    color: "#FFF",
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 42,
    textAlign: "center",
  },
  audioAnswerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  audioPulse: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: "rgba(0,210,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  audioAnswerLabel: {
    color: "#EAFBFF",
    fontSize: 15,
    fontWeight: "800",
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255, 51, 102, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    paddingLeft: 4,
  },
  topGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  badge: {
    backgroundColor: "#FF3366",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: {
    color: "#FFF",
    fontWeight: "800",
    fontSize: 14,
  },
  vibeTag: {
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  vibeTagText: {
    color: "rgba(255,255,255,0.9)",
    fontWeight: "700",
    fontSize: 12,
  },
  responseBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 215, 0, 0.3)",
  },
  responseBadgeText: {
    color: "#FFD700",
    fontWeight: "700",
    fontSize: 13,
  },
  bottomGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 28,
    paddingTop: 80,
    paddingRight: 80, // Space for side buttons
  },
  socialProofPill: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  socialProofText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "800",
  },
  heatOverlayPill: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    maxWidth: width * 0.68,
  },
  heatOverlayPillHot: {
    backgroundColor: "rgba(255, 51, 102, 0.2)",
    borderColor: "rgba(255, 186, 73, 0.45)",
  },
  heatOverlayText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "900",
  },
  heatOverlaySubtext: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 2,
  },
  questionText: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 24,
    marginBottom: 14,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FF3366",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  userAvatarText: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 16,
  },
  userInfo: {
    flex: 1,
  },
  username: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 15,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  timeAgo: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    marginTop: 2,
  },

  // TikTok-style side action buttons
  sideActions: {
    position: "absolute",
    right: 12,
    bottom: 96,
    alignItems: "center",
    gap: 18,
  },
  sideButton: {
    alignItems: "center",
    gap: 4,
    minWidth: 52,
  },
  sideButtonText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  sideButtonTextActive: {
    color: "#FF2D6A",
    fontWeight: "800",
  },
  // 🔥 MICRO-UPGRADE 2: Progress bar
  progressBarContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "rgba(255,255,255,0.15)",
    zIndex: 10,
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "rgba(255,51,102,0.85)",
    borderRadius: 1.5,
  },
  // Remix badge
  remixBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0, 229, 255, 0.12)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "rgba(0, 229, 255, 0.2)",
  },
  remixBadgeText: {
    color: "#00E5FF",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  chaosBadge: {
    alignSelf: "flex-start",
    marginBottom: 6,
    backgroundColor: "rgba(255, 23, 68, 0.2)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(255, 109, 0, 0.45)",
    maxWidth: width * 0.7,
  },
  chaosBadgeText: {
    color: "#FF6D00",
    fontSize: 11,
    fontWeight: "800",
  },
  chainBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0, 229, 255, 0.08)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: "flex-start",
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "rgba(0, 229, 255, 0.15)",
  },
  chainBadgeText: {
    color: "#00E5FF",
    fontSize: 12,
    fontWeight: "700",
  },
  joinChaosCard: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 9,
    maxWidth: width * 0.72,
    marginBottom: 9,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "rgba(255, 109, 0, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(255, 109, 0, 0.42)",
  },
  joinChaosCardHot: {
    backgroundColor: "rgba(255, 23, 68, 0.24)",
    borderColor: "rgba(255, 186, 73, 0.62)",
  },
  joinChaosPreviewRow: {
    flexDirection: "row",
    marginRight: 1,
  },
  blurredPreviewDot: {
    width: 25,
    height: 25,
    borderRadius: 13,
    marginLeft: -4,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  joinChaosCopy: {
    flexShrink: 1,
  },
  joinChaosTitle: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "900",
  },
  joinChaosSub: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 2,
  },
  remixPrompt: {
    position: "absolute",
    bottom: 120,
    left: 16,
    right: 70,
    zIndex: 50,
  },
  remixPromptInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(0, 20, 40, 0.92)",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderColor: "rgba(0, 229, 255, 0.3)",
    shadowColor: "#00E5FF",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  remixPromptEmoji: {
    fontSize: 24,
  },
  remixPromptTextWrap: {
    flex: 1,
  },
  remixPromptTitle: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "800",
  },
  remixPromptSub: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 1,
  },
  chainModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    backgroundColor: "#0A0A0F",
  },
});
