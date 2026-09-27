import React, { useMemo, useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useScreenInsets } from "../hooks/useScreenInsets";
import { storage } from "../services/storage";

const PENDING_RECORD_KEY = "@5sek_pending_record_after_onboarding";

export async function consumePendingRecordIntent(): Promise<boolean> {
  const value = await storage.getItem(PENDING_RECORD_KEY);
  if (value !== "1") return false;
  await storage.removeItem(PENDING_RECORD_KEY);
  return true;
}

type Props = {
  onComplete: () => void;
};

/**
 * First-session onboarding — honest, product-led, no fake social proof.
 * Step 3 can optionally queue a "go to Record" intent for MainTabs.
 */
export default function FirstSessionFlowScreen({ onComplete }: Props) {
  const { completeFirstSession } = useAuth();
  const insets = useScreenInsets();
  const { width } = useWindowDimensions();
  const [step, setStep] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;

  const headlineMax = useMemo(() => Math.max(260, width - 64), [width]);

  const goNext = async (openRecord = false) => {
    if (step >= 2) {
      if (openRecord) {
        await storage.setItem(PENDING_RECORD_KEY, "1");
      }
      await completeFirstSession();
      onComplete();
      return;
    }

    Animated.sequence([
      Animated.timing(fade, { toValue: 0, duration: 160, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
    setStep((prev) => prev + 1);
  };

  const renderStep = () => {
    if (step === 0) {
      return (
        <>
          <Text style={styles.kicker}>Mirë se erdhe në 5SEK</Text>
          <Text style={[styles.headline, { maxWidth: headlineMax }]}>
            Përgjigju çdo pyetjeje në 5 sekonda
          </Text>
          <Text style={styles.body}>
            Video, zë ose tekst. Pa skenar, pa përgatitje — vetëm mendimi yt i parë.
          </Text>
        </>
      );
    }

    if (step === 1) {
      return (
        <>
          <Text style={styles.kicker}>Si funksionon</Text>
          <View style={styles.previewCard}>
            <Ionicons name="flash" size={36} color="#3DFFC8" />
            <Text style={styles.previewTitle}>Regjistro → Posto → Voto</Text>
            <Text style={styles.previewBody}>
              Feed 5-sekondash, remix, komente dhe duele 1v1.
            </Text>
          </View>
          <View style={styles.bulletRow}>
            <Text style={styles.bullet}>• Feed lokal dhe global</Text>
            <Text style={styles.bullet}>• Sfido shokët në duel dhe hyr në renditje</Text>
            <Text style={styles.bullet}>• Si vizitor — krijo llogari kur të duash</Text>
          </View>
        </>
      );
    }

    return (
      <>
        <Ionicons name="videocam" size={48} color="#FF2D6A" />
        <Text style={[styles.headline, { maxWidth: headlineMax }]}>Gati kur të jesh ti</Text>
        <Text style={styles.body}>
          Përgjigja e parë hap gjithë lojën. Shtyp regjistro, fol 5 sekonda dhe je live në feed.
        </Text>
      </>
    );
  };

  const primaryLabel = step === 2 ? "Regjistro përgjigjen e parë" : "Vazhdo";

  return (
    <LinearGradient colors={["#050508", "#1A0B24", "#0A1220"]} style={styles.container}>
      <Animated.View
        style={[
          styles.inner,
          { opacity: fade, paddingTop: insets.headerTop(24), paddingBottom: insets.footerBottom(20) },
        ]}
      >
        <View style={styles.dots}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.content}>{renderStep()}</View>

        <TouchableOpacity
          onPress={() => goNext(step === 2)}
          activeOpacity={0.92}
          style={styles.ctaWrap}
        >
          <LinearGradient
            colors={["#FF2D6A", "#8B5CFF"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cta}
          >
            <Text style={styles.ctaText}>{primaryLabel}</Text>
          </LinearGradient>
        </TouchableOpacity>

        {step === 2 ? (
          <TouchableOpacity onPress={() => goNext(false)} style={styles.skip}>
            <Text style={styles.skipText}>Shiko feed-in më parë</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={async () => {
              await completeFirstSession();
              onComplete();
            }}
            style={styles.skip}
          >
            <Text style={styles.skipText}>Kalo tani</Text>
          </TouchableOpacity>
        )}
      </Animated.View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 72,
    paddingBottom: 40,
    justifyContent: "space-between",
  },
  dots: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  dotActive: {
    width: 24,
    backgroundColor: "#FF2D6A",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    gap: 16,
    alignItems: "center",
  },
  kicker: {
    color: "#6EEDC1",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  headline: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "900",
    textAlign: "center",
    lineHeight: 34,
  },
  body: {
    color: "rgba(229,240,248,0.6)",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    fontWeight: "600",
    maxWidth: 320,
  },
  previewCard: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 18,
    padding: 24,
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,45,106,0.28)",
  },
  previewTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  previewBody: {
    color: "rgba(229,240,248,0.55)",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    fontWeight: "600",
  },
  bulletRow: {
    gap: 6,
    alignSelf: "stretch",
    maxWidth: 320,
  },
  bullet: {
    color: "rgba(229,240,248,0.55)",
    fontSize: 14,
    fontWeight: "700",
  },
  ctaWrap: { borderRadius: 14, overflow: "hidden" },
  cta: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  skip: {
    alignItems: "center",
    paddingVertical: 8,
  },
  skipText: {
    color: "rgba(229,240,248,0.45)",
    fontSize: 13,
    fontWeight: "700",
  },
});
