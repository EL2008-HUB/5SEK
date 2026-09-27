import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useScreenInsets } from "../hooks/useScreenInsets";
import {
  LeaderboardEntry,
  LeaderboardPeriod,
  LeaderboardResponse,
  getApiErrorMessage,
  leaderboardApi,
} from "../services/api";
import { storage } from "../services/storage";
import { analytics } from "../services/analytics";
import StatePanel from "../components/StatePanel";
import { Colors } from "../theme";

const PERIODS: { key: LeaderboardPeriod; label: string }[] = [
  { key: "today", label: "Sot" },
  { key: "week", label: "Java" },
  { key: "all", label: "Gjithe" },
];
const CACHE_KEY = "@5sek_leaderboard_cache_v1";
const REFRESH_MS = 30_000;
const PODIUM_COLORS: Record<number, readonly [string, string]> = {
  1: ["#FFC857", "#FF8A3D"],
  2: ["#C9D6FF", "#8B9BFF"],
  3: ["#FFB199", "#FF6B8A"],
};
const COUNTRY_FLAGS: Record<string, string> = {
  AL: "🇦🇱", XK: "🇽🇰", US: "🇺🇸", DE: "🇩🇪", UK: "🇬🇧", TR: "🇹🇷", IT: "🇮🇹", GLOBAL: "🌍",
};

function initials(name: string) {
  return (name || "?").replace(/^vizitor_/, "").charAt(0).toUpperCase();
}

function displayName(entry: LeaderboardEntry) {
  if (entry.is_guest) return "Vizitor";
  return entry.username;
}

export default function LeaderboardScreen() {
  const navigation = useNavigation<any>();
  const { user, isGuest } = useAuth();
  const insets = useScreenInsets();
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const periodRef = useRef(period);
  periodRef.current = period;
  const meGlow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(meGlow, { toValue: 1, duration: 1400, useNativeDriver: false }),
        Animated.timing(meGlow, { toValue: 0, duration: 1400, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [meGlow]);

  const load = useCallback(
    async (target: LeaderboardPeriod = periodRef.current, opts: { silent?: boolean } = {}) => {
      try {
        if (!opts.silent) setError(null);
        const response = await leaderboardApi.get(target, 50);
        if (periodRef.current !== target) return;
        setData(response.data);
        setFromCache(false);
        try {
          await storage.setItem(`${CACHE_KEY}:${target}`, JSON.stringify(response.data));
        } catch (_) {}
      } catch (loadError) {
        if (periodRef.current !== target) return;
        try {
          const raw = await storage.getItem(`${CACHE_KEY}:${target}`);
          if (raw) {
            setData(JSON.parse(raw));
            setFromCache(true);
            setError(null);
            return;
          }
        } catch (_) {}
        if (!opts.silent) setError(getApiErrorMessage(loadError, "Renditja nuk u ngarkua."));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    setLoading(true);
    load(period);
  }, [load, period]);

  useFocusEffect(
    useCallback(() => {
      analytics.track({ event_type: "leaderboard_open", screen: "leaderboard", metadata: { period: periodRef.current } });
      const timer = setInterval(() => load(periodRef.current, { silent: true }), REFRESH_MS);
      return () => clearInterval(timer);
    }, [load])
  );

  const entries = data?.entries || [];
  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);
  const me = data?.me || null;
  const meInTop = Boolean(me && entries.some((entry) => entry.user_id === me.user_id));

  const meMessage = useMemo(() => {
    if (!me) return null;
    if (!me.points) return "Pergjigju nje pyetjeje dhe hyn ne renditje me 5 pike.";
    if (me.rank === 1) return "Je ne krye! Mbaje vendin me nje duel tjeter.";
    if (data?.next_rank) {
      return `Te duhen ${data.next_rank.points_needed} pike per te kaluar @${data.next_rank.username}.`;
    }
    return "Vazhdo: cdo pergjigje 5 pike, cdo fitore ne duel 25.";
  }, [data?.next_rank, me]);

  const goTab = (screen: "Record" | "Duels" | "Feed") => navigation.navigate("Main", { screen });

  const shareRank = async () => {
    if (!me?.rank) return;
    try {
      await Share.share({
        message: `Jam #${me.rank} ne renditjen e 5SEK me ${me.points} pike. Me kalon dot ne 5 sekonda?`,
      });
      analytics.shareOpened("leaderboard", { rank: me.rank });
    } catch (_) {}
  };

  const meBorder = meGlow.interpolate({
    inputRange: [0, 1],
    outputRange: ["rgba(61,255,200,0.35)", "rgba(61,255,200,0.9)"],
  });

  const renderRow = (entry: LeaderboardEntry) => {
    const isMe = user?.id === entry.user_id;
    return (
      <View key={entry.user_id} style={[styles.row, isMe && styles.rowMe]}>
        <Text style={[styles.rowRank, isMe && styles.rowRankMe]}>#{entry.rank}</Text>
        <View style={[styles.rowAvatar, isMe && styles.rowAvatarMe]}>
          <Text style={styles.rowAvatarText}>{initials(entry.username)}</Text>
        </View>
        <View style={styles.rowCopy}>
          <Text style={styles.rowName} numberOfLines={1}>
            {COUNTRY_FLAGS[entry.country] || ""} {isMe ? "Ti" : `@${displayName(entry)}`}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {entry.breakdown.answers} pergjigje · {entry.breakdown.wins} fitore · {entry.breakdown.likes_received} pelqime
          </Text>
        </View>
        {entry.badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{entry.badge.label}</Text>
          </View>
        ) : null}
        <Text style={[styles.rowPoints, isMe && styles.rowPointsMe]}>{entry.points}</Text>
      </View>
    );
  };

  const renderPodiumSlot = (entry: LeaderboardEntry | undefined, place: 1 | 2 | 3) => {
    const size = place === 1 ? 84 : 66;
    const lift = place === 1 ? 0 : 22;
    const isMe = entry && user?.id === entry.user_id;
    return (
      <View key={place} style={[styles.podiumSlot, { marginTop: lift }]}>
        <View style={styles.crownWrap}>
          {place === 1 ? <Text style={styles.crown}>👑</Text> : null}
        </View>
        <LinearGradient colors={PODIUM_COLORS[place]} style={[styles.podiumAvatar, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[styles.podiumAvatarText, place === 1 && styles.podiumAvatarTextBig]}>
            {entry ? initials(entry.username) : "?"}
          </Text>
        </LinearGradient>
        <View style={[styles.podiumRank, { backgroundColor: PODIUM_COLORS[place][0] }]}>
          <Text style={styles.podiumRankText}>{place}</Text>
        </View>
        <Text style={[styles.podiumName, isMe && styles.podiumNameMe]} numberOfLines={1}>
          {entry ? (isMe ? "Ti" : `@${displayName(entry)}`) : "Vend i lire"}
        </Text>
        <Text style={styles.podiumPoints}>{entry ? `${entry.points} pike` : "—"}</Text>
      </View>
    );
  };

  return (
    <LinearGradient colors={Colors.background.gradient} style={styles.container}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.headerTop(8), paddingBottom: insets.footerBottom(36) }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load(period);
            }}
            tintColor="#FFC857"
          />
        }
      >
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()} hitSlop={10}>
            <Ionicons name="chevron-back" size={22} color="#FFF" />
          </TouchableOpacity>
          <View style={styles.titleWrap}>
            <Text style={styles.kicker}>RENDITJA</Text>
            <Text style={styles.title}>Kush e ka fjalen?</Text>
          </View>
          <TouchableOpacity style={styles.info} onPress={() => goTab("Record")} hitSlop={10}>
            <Ionicons name="flash" size={18} color="#FF2D6A" />
          </TouchableOpacity>
        </View>

        <View style={styles.periodRow}>
          {PERIODS.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={[styles.periodChip, period === item.key && styles.periodChipActive]}
              onPress={() => setPeriod(item.key)}
            >
              <Text style={[styles.periodText, period === item.key && styles.periodTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {fromCache ? (
          <View style={styles.cacheBanner}>
            <Text style={styles.cacheBannerText}>Offline · renditja e ruajtur</Text>
          </View>
        ) : null}

        {loading && !data ? (
          <StatePanel compact variant="loading" message="Duke numeruar piket…" />
        ) : error && !data ? (
          <StatePanel compact variant="error" title="Renditja nuk u ngarkua" message={error} primaryLabel="Provo perseri" onPrimaryPress={() => load(period)} />
        ) : entries.length === 0 ? (
          <StatePanel
            compact
            variant="empty"
            title="Renditja eshte bosh"
            message="Askush s'ka fituar pike ende ne kete periudhe. Behu i pari."
            primaryLabel="Pergjigju tani"
            onPrimaryPress={() => goTab("Record")}
          />
        ) : (
          <>
            <View style={styles.podium}>
              {renderPodiumSlot(podium[1], 2)}
              {renderPodiumSlot(podium[0], 1)}
              {renderPodiumSlot(podium[2], 3)}
            </View>

            {me ? (
              <Animated.View style={[styles.meCard, { borderColor: meBorder }]}>
                <View style={styles.meTop}>
                  <View style={styles.meRankWrap}>
                    <Text style={styles.meRankLabel}>VENDI YT</Text>
                    <Text style={styles.meRank}>{me.rank ? `#${me.rank}` : "—"}</Text>
                  </View>
                  <View style={styles.mePointsWrap}>
                    <Text style={styles.mePoints}>{me.points}</Text>
                    <Text style={styles.mePointsLabel}>pike</Text>
                  </View>
                </View>
                <Text style={styles.meMessage}>{meMessage}</Text>
                <View style={styles.meActions}>
                  <TouchableOpacity style={styles.meAction} onPress={() => goTab("Record")}>
                    <LinearGradient colors={Colors.accent.primaryGradient} style={styles.meActionInner}>
                      <Ionicons name="flash" size={16} color="#FFF" />
                      <Text style={styles.meActionText}>+5 Pergjigju</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.meAction} onPress={() => goTab("Duels")}>
                    <LinearGradient colors={Colors.accent.secondaryGradient} style={styles.meActionInner}>
                      <Ionicons name="flame" size={16} color="#FFF" />
                      <Text style={styles.meActionText}>+25 Duel</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                  {me.rank ? (
                    <TouchableOpacity style={styles.meShare} onPress={shareRank} hitSlop={6}>
                      <Ionicons name="share-social" size={18} color="#FFF" />
                    </TouchableOpacity>
                  ) : null}
                </View>
                {isGuest ? (
                  <TouchableOpacity style={styles.guestNudge} onPress={() => navigation.navigate("UpgradeAccount")}>
                    <Ionicons name="lock-open" size={14} color="#FFC857" />
                    <Text style={styles.guestNudgeText}>Je vizitor - krijo llogari qe renditja te mbaje emrin tend.</Text>
                  </TouchableOpacity>
                ) : null}
              </Animated.View>
            ) : null}

            <View style={styles.listHeader}>
              <Text style={styles.listTitle}>Top {entries.length}</Text>
              <Text style={styles.listHint}>pergjigje 5 · pelqim 2 · vote 1 · fitore 25</Text>
            </View>
            <View style={styles.list}>{rest.map(renderRow)}</View>

            {me && !meInTop ? (
              <View style={styles.list}>
                <Text style={styles.gapDots}>···</Text>
                {renderRow(me)}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 54, paddingBottom: 48 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  back: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: { flex: 1 },
  kicker: { color: "#FFC857", fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  title: { color: "#FFF", fontSize: 26, fontWeight: "900", marginTop: 2 },
  info: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,45,106,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  periodRow: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 16,
    padding: 4,
    marginBottom: 18,
  },
  periodChip: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 12 },
  periodChipActive: { backgroundColor: "#FFC857" },
  periodText: { color: "rgba(255,255,255,0.6)", fontWeight: "800", fontSize: 13 },
  periodTextActive: { color: "#1A1200" },
  cacheBanner: {
    alignSelf: "center",
    backgroundColor: "rgba(255,200,87,0.12)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 12,
  },
  cacheBannerText: { color: "#FFC857", fontSize: 12, fontWeight: "800" },
  podium: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18, paddingHorizontal: 4 },
  podiumSlot: { flex: 1, alignItems: "center" },
  crownWrap: { height: 26, justifyContent: "flex-end" },
  crown: { fontSize: 22 },
  podiumAvatar: { alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "rgba(255,255,255,0.15)" },
  podiumAvatarText: { color: "#1A1200", fontSize: 24, fontWeight: "900" },
  podiumAvatarTextBig: { fontSize: 32 },
  podiumRank: {
    marginTop: -12,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#0A0A10",
  },
  podiumRankText: { color: "#1A1200", fontSize: 12, fontWeight: "900" },
  podiumName: { color: "#FFF", fontSize: 13, fontWeight: "800", marginTop: 6, maxWidth: 110 },
  podiumNameMe: { color: "#3DFFC8" },
  podiumPoints: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "700", marginTop: 2 },
  meCard: {
    backgroundColor: "rgba(61,255,200,0.07)",
    borderWidth: 1.5,
    borderRadius: 22,
    padding: 16,
    marginBottom: 20,
    gap: 10,
  },
  meTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  meRankWrap: {},
  meRankLabel: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  meRank: { color: "#3DFFC8", fontSize: 34, fontWeight: "900", marginTop: 2 },
  mePointsWrap: { alignItems: "flex-end" },
  mePoints: { color: "#FFF", fontSize: 30, fontWeight: "900" },
  mePointsLabel: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "800" },
  meMessage: { color: "rgba(255,255,255,0.78)", fontSize: 14, lineHeight: 20, fontWeight: "600" },
  meActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  meAction: { flex: 1, borderRadius: 14, overflow: "hidden" },
  meActionInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 },
  meActionText: { color: "#FFF", fontSize: 13, fontWeight: "900" },
  meShare: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  guestNudge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,200,87,0.1)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  guestNudgeText: { flex: 1, color: "#FFC857", fontSize: 12, fontWeight: "700", lineHeight: 17 },
  listHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10, paddingHorizontal: 4 },
  listTitle: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  listHint: { color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: "700" },
  list: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  rowMe: { backgroundColor: "rgba(61,255,200,0.08)", borderColor: "rgba(61,255,200,0.4)" },
  rowRank: { width: 36, color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: "900" },
  rowRankMe: { color: "#3DFFC8" },
  rowAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(139,92,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  rowAvatarMe: { backgroundColor: "rgba(61,255,200,0.35)" },
  rowAvatarText: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  rowCopy: { flex: 1 },
  rowName: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  rowMeta: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", marginTop: 2 },
  badge: {
    backgroundColor: "rgba(255,200,87,0.14)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { color: "#FFC857", fontSize: 10, fontWeight: "900" },
  rowPoints: { color: "#FFF", fontSize: 16, fontWeight: "900", minWidth: 40, textAlign: "right" },
  rowPointsMe: { color: "#3DFFC8" },
  gapDots: { color: "rgba(255,255,255,0.35)", textAlign: "center", fontSize: 18, fontWeight: "900", marginVertical: 2 },
});
