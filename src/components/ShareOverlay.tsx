/**
 * ShareOverlay v3 — ZERO FRICTION SHARE
 *
 * FLOW (SUPER FAST):
 *   Tap Share → Bottom sheet hapet menjëherë → 2 butona të mëdhenj → Tap → Done
 *
 * NO complex menus. NO unnecessary choices.
 *
 * UI:
 *   👀 Share this
 *   [ TikTok ]   [ Instagram ]
 *   [ Copy Link ] [ More...   ]
 *
 * MICRO-UX:
 *   ✅ Haptic feedback
 *   ✅ Auto-copy link to clipboard
 *   ✅ Toast "Link copied 👌"
 *   ✅ Pre-filled message
 *   ✅ Share opens INSTANTLY
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Linking,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { buildAnswerShareUrl, buildChallengeShareUrl } from "../services/deepLinks";
import { shareApi } from "../services/api";
import { eventTracker } from "../services/eventTracker";

// Safe imports (may not be installed)
let Haptics: any = null;
try {
  Haptics = require("expo-haptics");
} catch (_) {}

let Clipboard: any = null;
try {
  Clipboard = require("expo-clipboard");
} catch (_) {}

const { width, height } = Dimensions.get("window");

interface ShareOverlayProps {
  video: {
    id: number;
    video_url: string | null;
    username: string;
    question_text: string;
    response_time?: number | null;
    user_id?: number;
  };
  onClose: () => void;
  /** If true, show emotional trigger text for post-answer moment */
  postAnswer?: boolean;
}

export default function ShareOverlay({ video, onClose, postAnswer }: ShareOverlayProps) {
  const slideUp = useRef(new Animated.Value(height)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const [toast, setToast] = useState<string | null>(null);
  const toastFade = useRef(new Animated.Value(0)).current;
  const [creatorStats, setCreatorStats] = useState<any>(null);
  const shareUrl = postAnswer ? buildChallengeShareUrl(video.id) : buildAnswerShareUrl(video.id);
  const previewMessage = postAnswer
    ? `Pata 5 sekonda për këtë 👀\n"${video.question_text}"\nMë mund dot? ⚔️`
    : `A mund të përgjigjesh në 5 sekonda? 👀\n"${video.question_text}"`;
  const shareMessage = `${previewMessage}\n\n${shareUrl}`;

  useEffect(() => {
    // 🔥 INSTANT open — no delay
    Animated.parallel([
      Animated.timing(fadeIn, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.spring(slideUp, {
        toValue: 0,
        friction: 9,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();

    // 🔥 Auto-copy link to clipboard immediately
    autoCopyLink();

    // Track share tap
    eventTracker.shareExport(video.id);
    shareApi.trackEvent(video.id, "share_export").catch(() => {});

    // Load creator dopamine (non-blocking)
    shareApi.getCreatorStats(video.id)
      .then((res: any) => setCreatorStats(res.data))
      .catch(() => {});
  }, []);

  // ── Auto-copy link ──
  const autoCopyLink = async () => {
    try {
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(shareUrl);
      }
    } catch (_) {}
  };

  // ── Toast ──
  const showToast = (message: string) => {
    setToast(message);
    Animated.sequence([
      Animated.timing(toastFade, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.delay(1500),
      Animated.timing(toastFade, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => setToast(null));
  };

  // ── Haptic ──
  const haptic = () => {
    try {
      Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Medium);
    } catch (_) {}
  };

  // ── Close ──
  const close = () => {
    Animated.parallel([
      Animated.timing(fadeIn, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(slideUp, {
        toValue: height,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  };

  // ── INSTANT share — no thinking needed ──
  const shareNow = async (platform: string) => {
    haptic();

    shareApi.trackEvent(video.id, "share_complete", platform).catch(() => {});

    try {
      const result = await Share.share({
        message: shareMessage,
        title: "Sfidë 5SEK",
      });
      if (result?.action !== Share.dismissedAction) showToast("U shpërnda! 🔥");
    } catch (_) {
      // User cancelled
    }
  };

  const shareWhatsApp = async () => {
    haptic();
    try {
      await Linking.openURL(`whatsapp://send?text=${encodeURIComponent(shareMessage)}`);
      shareApi.trackEvent(video.id, "share_complete", "whatsapp").catch(() => {});
    } catch (_) {
      shareNow("whatsapp");
    }
  };

  // ── Copy Link ──
  const copyLink = async () => {
    haptic();

    try {
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(shareUrl);
      }
      showToast("Linku u kopjua 👌");

      // Track
      shareApi.trackEvent(video.id, "share_complete", "copy_link").catch(() => {});
    } catch (_) {
      // Fallback: open share sheet
      shareNow("copy_link");
    }
  };

  // ── More... (native share sheet) ──
  const shareMore = async () => {
    haptic();
    shareNow("other");
  };

  // Emotional trigger text
  const triggerText = postAnswer
    ? "Sfido një shok ⚔️"
    : "😳 A mund ta mundë shoku yt?";

  const triggerSub = postAnswer
    ? "Kur përgjigjet, fillon dueli 1v1 dhe të tjerët votojnë"
    : "Dërgoja dikujt që mendon shpejt";

  return (
    <View style={styles.overlay}>
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, { opacity: fadeIn }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={close} activeOpacity={1} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideUp }] }]}>
        <View style={styles.handle} />

        {/* 🔥 Emotional Trigger */}
        <View style={styles.triggerRow}>
          <Text style={styles.triggerText}>{triggerText}</Text>
          <Text style={styles.triggerSub}>{triggerSub}</Text>
        </View>

        {/* Creator dopamine stat (one-liner) */}
        {creatorStats?.labels?.views && (
          <View style={styles.statPill}>
            <Ionicons name="eye" size={14} color="#FF6B8A" />
            <Text style={styles.statPillText}>{creatorStats.labels.views}</Text>
          </View>
        )}

        <TouchableOpacity style={styles.whatsappButton} onPress={shareWhatsApp} activeOpacity={0.8}>
          <LinearGradient colors={["#25D366", "#128C7E"]} style={styles.bigButtonGradient}>
            <Ionicons name="logo-whatsapp" size={26} color="#FFF" />
            <Text style={styles.bigButtonText}>Dërgo në WhatsApp</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* ─── 2 BIG BUTTONS ─── */}
        <View style={styles.bigGrid}>
          {/* TikTok */}
          <TouchableOpacity
            style={styles.bigButton}
            onPress={() => shareNow("tiktok")}
            activeOpacity={0.7}
          >
            <LinearGradient colors={["#000000", "#25F4EE"]} style={styles.bigButtonGradient}>
              <Ionicons name="musical-notes" size={28} color="#FFF" />
              <Text style={styles.bigButtonText}>TikTok</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Instagram */}
          <TouchableOpacity
            style={styles.bigButton}
            onPress={() => shareNow("instagram")}
            activeOpacity={0.7}
          >
            <LinearGradient colors={["#833AB4", "#C13584", "#F77737"]} style={styles.bigButtonGradient}>
              <Ionicons name="logo-instagram" size={28} color="#FFF" />
              <Text style={styles.bigButtonText}>Instagram</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* ─── 2 SMALL BUTTONS ─── */}
        <View style={styles.smallGrid}>
          {/* Copy Link */}
          <TouchableOpacity style={styles.smallButton} onPress={copyLink} activeOpacity={0.7}>
            <Ionicons name="link" size={20} color="#FFF" />
            <Text style={styles.smallButtonText}>Kopjo linkun</Text>
          </TouchableOpacity>

          {/* More... */}
          <TouchableOpacity style={styles.smallButton} onPress={shareMore} activeOpacity={0.7}>
            <Ionicons name="ellipsis-horizontal" size={20} color="#FFF" />
            <Text style={styles.smallButtonText}>Më shumë…</Text>
          </TouchableOpacity>
        </View>

        {/* Pre-filled message preview */}
        <View style={styles.previewBox}>
          <Text style={styles.previewLabel}>Mesazhi:</Text>
          <Text style={styles.previewText} numberOfLines={4}>{previewMessage}</Text>
        </View>

        {/* Cancel */}
        <TouchableOpacity style={styles.cancelButton} onPress={close}>
          <Text style={styles.cancelText}>Anulo</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* 🔥 Toast notification */}
      {toast && (
        <Animated.View style={[styles.toast, { opacity: toastFade }]}>
          <Text style={styles.toastText}>{toast}</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    zIndex: 300,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
  },
  sheet: {
    backgroundColor: "#111",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 36,
    paddingHorizontal: 20,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "#444",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 16,
  },

  // Emotional trigger
  triggerRow: {
    alignItems: "center",
    marginBottom: 12,
  },
  triggerText: {
    color: "#FFF",
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  triggerSub: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
  },

  // Creator stat pill
  statPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,51,102,0.1)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: "center",
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "rgba(255,51,102,0.15)",
  },
  statPillText: {
    color: "#FF6B8A",
    fontSize: 12,
    fontWeight: "700",
  },

  // 2 Big buttons (TikTok + Instagram)
  bigGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  bigButton: {
    flex: 1,
    borderRadius: 18,
    overflow: "hidden",
  },
  whatsappButton: {
    borderRadius: 18,
    overflow: "hidden",
    marginBottom: 12,
  },
  bigButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    gap: 10,
  },
  bigButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "800",
  },

  // 2 Small buttons (Copy Link + More)
  smallGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  smallButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 14,
    paddingVertical: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  smallButtonText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "700",
  },

  // Pre-filled message preview
  previewBox: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  previewLabel: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  previewText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },

  // Cancel
  cancelButton: {
    alignItems: "center",
    paddingVertical: 12,
  },
  cancelText: {
    color: "#555",
    fontSize: 14,
    fontWeight: "600",
  },

  // Toast
  toast: {
    position: "absolute",
    top: 80,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.9)",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  toastText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "700",
  },
});
