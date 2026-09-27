import React, { useCallback, useEffect, useState } from "react";
import { LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import DuelCard, { DuelFeedItem } from "../components/DuelCard";
import StatePanel from "../components/StatePanel";
import { duelsApi, getApiErrorMessage } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useScreenInsets } from "../hooks/useScreenInsets";
import { Colors } from "../theme";

export default function DuelDetailScreen({ route, navigation }: any) {
  const duelId = Number(route?.params?.duelId);
  const { user } = useAuth();
  const insets = useScreenInsets();
  const [duel, setDuel] = useState<DuelFeedItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cardHeight, setCardHeight] = useState(0);

  const load = useCallback(async () => {
    if (!Number.isInteger(duelId) || duelId <= 0) {
      setError("Ky link dueli duket i paplotë.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await duelsApi.getById(duelId);
      setDuel(res.data as DuelFeedItem);
    } catch (err: any) {
      setError(
        err?.response?.status === 404
          ? "Ky duel nuk ekziston më."
          : getApiErrorMessage(err, "Nuk e hapëm dot duelin. Provo sërish.")
      );
    } finally {
      setLoading(false);
    }
  }, [duelId]);

  useEffect(() => {
    load();
  }, [load]);

  const close = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.replace("Main");
  };

  const startOwnDuel = () => {
    navigation.navigate("Main", {
      screen: "Record",
      params: duel?.question_id
        ? { questionId: duel.question_id, questionText: duel.question_text }
        : undefined,
    });
  };

  const onCardLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    if (next > 0 && Math.abs(next - cardHeight) > 1) setCardHeight(next);
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={Colors.background.authGradient} style={StyleSheet.absoluteFill} />
      <View style={[styles.safe, { paddingTop: insets.headerTop(0), paddingBottom: insets.footerBottom(8) }]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Mbyll"
          >
            <Ionicons name="close" size={22} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.title}>Duel 1v1</Text>
          <View style={styles.iconButton} />
        </View>

        <View style={styles.body} onLayout={onCardLayout}>
          {loading ? (
            <View style={styles.center}>
              <StatePanel variant="loading" message="Po hapim duelin…" />
            </View>
          ) : error || !duel ? (
            <View style={styles.center}>
              <StatePanel
                variant="error"
                icon="⚔️"
                title="Dueli nuk u hap"
                message={error || "Diçka shkoi keq."}
                primaryLabel="Provo sërish"
                onPrimaryPress={load}
                secondaryLabel="Shiko duelet"
                onSecondaryPress={() => navigation.navigate("Main", { screen: "Duels" })}
              />
            </View>
          ) : cardHeight > 0 ? (
            <DuelCard
              duel={duel}
              currentUserId={Number(user?.id) || 0}
              isVisible
              cardHeight={cardHeight}
              topInset={12}
              onUpdated={setDuel}
            />
          ) : null}
        </View>

        <TouchableOpacity style={styles.cta} onPress={startOwnDuel} activeOpacity={0.88}>
          <LinearGradient
            colors={Colors.accent.primaryGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.ctaInner}
          >
            <Ionicons name="flash" size={18} color="#FFF" />
            <Text style={styles.ctaText}>Bëj duelin tënd · 5 sek</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050508" },
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  title: { color: "#FFF", fontSize: 17, fontWeight: "900", letterSpacing: 0.5 },
  body: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  cta: { marginHorizontal: 16, marginTop: 8, marginBottom: 8, borderRadius: 18, overflow: "hidden" },
  ctaInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
  },
  ctaText: { color: "#FFF", fontSize: 16, fontWeight: "900" },
});
