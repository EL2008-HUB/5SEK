import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { DuelQueueEntry, duelsApi, getApiErrorMessage } from "../services/api";
import { storage } from "../services/storage";
import DuelCard, { DuelFeedItem } from "../components/DuelCard";
import StatePanel from "../components/StatePanel";
import { Colors } from "../theme";

const CACHE_KEY = "@5sek_duels_cache_v1";
const REFRESH_MS = 20_000;

type MineState = {
  active_duel: DuelFeedItem | null;
  queue: DuelQueueEntry[];
  stats?: { total: number; finished: number; wins: number };
};

function readRows(data: any): DuelFeedItem[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

export default function DuelsScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const [duels, setDuels] = useState<DuelFeedItem[]>([]);
  const [mine, setMine] = useState<MineState>({ active_duel: null, queue: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [filter, setFilter] = useState<"active" | "finished">("active");
  const [selected, setSelected] = useState<DuelFeedItem | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const persist = useCallback(async (rows: DuelFeedItem[], mineState: MineState, activeFilter: string) => {
    try {
      await storage.setItem(CACHE_KEY, JSON.stringify({ rows, mine: mineState, filter: activeFilter, at: Date.now() }));
    } catch (_) {}
  }, []);

  const restore = useCallback(async () => {
    try {
      const raw = await storage.getItem(CACHE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.rows) && parsed.rows.length) {
        setDuels(parsed.rows);
        if (parsed.mine) setMine(parsed.mine);
        setFromCache(true);
        return true;
      }
    } catch (_) {}
    return false;
  }, []);

  const load = useCallback(
    async (nextFilter: "active" | "finished" = filterRef.current, { silent = false } = {}) => {
      try {
        if (!silent) setError(null);
        const [feedResult, mineResult] = await Promise.allSettled([
          duelsApi.getFeed(1, 30, user?.id, nextFilter),
          user?.id ? duelsApi.getMine() : Promise.resolve({ data: { active_duel: null, queue: [] } }),
        ]);

        let rows: DuelFeedItem[] | null = null;
        if (feedResult.status === "fulfilled") {
          rows = readRows(feedResult.value.data);
          setDuels(rows);
          setFromCache(false);
        }

        let mineState: MineState | null = null;
        if (mineResult.status === "fulfilled") {
          const data = mineResult.value.data || {};
          mineState = {
            active_duel: data.active_duel || null,
            queue: Array.isArray(data.queue) ? data.queue : [],
            stats: data.stats,
          };
          setMine(mineState);
        }

        if (feedResult.status === "rejected") {
          const restored = await restore();
          if (!restored && !silent) {
            setError(getApiErrorMessage(feedResult.reason, "Nuk u ngarkuan duels."));
          }
        } else if (rows) {
          persist(rows, mineState || mine, nextFilter);
        }

        if (selected && rows) {
          const updated = rows.find((row) => row.id === selected.id);
          if (updated) setSelected(updated);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [mine, persist, restore, selected, user?.id]
  );

  useEffect(() => {
    restore();
  }, [restore]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
      const timer = setInterval(() => {
        load(filterRef.current, { silent: true });
      }, REFRESH_MS);
      return () => clearInterval(timer);
    }, [load])
  );

  const cancelQueue = async (entry: DuelQueueEntry) => {
    if (cancelling) return;
    try {
      setCancelling(entry.id);
      await duelsApi.cancelQueue(entry.id);
      setMine((prev) => ({ ...prev, queue: prev.queue.filter((item) => item.id !== entry.id) }));
    } catch (cancelError) {
      setError(getApiErrorMessage(cancelError, "Nuk u anulua radha."));
    } finally {
      setCancelling(null);
    }
  };

  const goAnswer = () => navigation.navigate("Home");
  const goFeed = () => navigation.navigate("Feed");

  if (selected) {
    return (
      <View
        style={styles.full}
        onLayout={(event) => {
          const next = Math.round(event.nativeEvent.layout.height);
          if (next > 0 && next !== viewportHeight) setViewportHeight(next);
        }}
      >
        <StatusBar style="light" />
        <TouchableOpacity style={styles.back} onPress={() => setSelected(null)}>
          <Ionicons name="chevron-back" size={22} color="#FFF" />
          <Text style={styles.backText}>Te gjitha duels</Text>
        </TouchableOpacity>
        <DuelCard
          duel={selected}
          currentUserId={user?.id || 0}
          isVisible
          cardHeight={viewportHeight || undefined}
          onUpdated={(next) => {
            setSelected(next);
            setDuels((prev) => prev.map((item) => (item.id === next.id ? next : item)));
          }}
        />
      </View>
    );
  }

  const myActive = mine.active_duel;
  const listWithoutMine = myActive ? duels.filter((duel) => duel.id !== myActive.id) : duels;

  return (
    <LinearGradient colors={Colors.background.gradient} style={styles.container}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor="#FF2D6A"
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.kicker}>1v1</Text>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Duels</Text>
            <TouchableOpacity
              style={styles.statsPill}
              onPress={() => navigation.navigate("Leaderboard")}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Hap renditjen"
            >
              <Ionicons name="trophy" size={14} color="#FFC857" />
              <Text style={styles.statsText}>
                {mine.stats ? `${mine.stats.wins} fitore · ` : ""}Renditja
              </Text>
              <Ionicons name="chevron-forward" size={14} color="#FFC857" />
            </TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>Voto se kush e kapi me mire pyetjen. 24 ore, nje votim.</Text>
        </View>

        {fromCache ? (
          <View style={styles.offline}>
            <Ionicons name="cloud-offline-outline" size={14} color="#FFC857" />
            <Text style={styles.offlineText}>Offline · duke treguar duels e ruajtura</Text>
          </View>
        ) : null}

        {myActive ? (
          <TouchableOpacity style={[styles.card, styles.mineCard]} onPress={() => setSelected(myActive)} activeOpacity={0.9}>
            <View style={styles.cardTop}>
              <Text style={styles.mineLabel}>DUELI YT · LIVE</Text>
              <Text style={styles.meta}>{Number(myActive.total_votes || 0)}/{myActive.vote_threshold || 20} vota</Text>
            </View>
            <Text style={styles.question} numberOfLines={2}>{myActive.question_text}</Text>
            <View style={styles.vsRow}>
              <Text style={styles.handle} numberOfLines={1}>@{myActive.user_a_username}</Text>
              <Text style={styles.vs}>VS</Text>
              <Text style={styles.handle} numberOfLines={1}>@{myActive.user_b_username}</Text>
            </View>
            <View style={styles.bar}>
              <View style={[styles.barA, { flex: Math.max(myActive.pct_a || 1, 1) }]} />
              <View style={[styles.barB, { flex: Math.max(myActive.pct_b || 1, 1) }]} />
            </View>
            <Text style={styles.cta}>Shiko rezultatin live</Text>
          </TouchableOpacity>
        ) : null}

        {mine.queue.map((entry) => (
          <View key={`queue-${entry.id}`} style={[styles.card, styles.queueCard]}>
            <View style={styles.cardTop}>
              <View style={styles.queueBadge}>
                <Ionicons name="hourglass-outline" size={12} color="#0A0A10" />
                <Text style={styles.queueBadgeText}>NE RADHE</Text>
              </View>
              <TouchableOpacity onPress={() => cancelQueue(entry)} disabled={cancelling === entry.id}>
                <Text style={styles.cancel}>{cancelling === entry.id ? "..." : "Anulo"}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.question} numberOfLines={2}>{entry.question_text || "Pyetja jote"}</Text>
            <Text style={styles.queueHint}>
              Dueli hapet automatikisht sa dikush tjeter i pergjigjet kesaj pyetjeje. Te njoftojme.
            </Text>
          </View>
        ))}

        {!myActive && mine.queue.length === 0 ? (
          <TouchableOpacity style={styles.challengeCta} onPress={goFeed} activeOpacity={0.9}>
            <LinearGradient colors={Colors.accent.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.challengeInner}>
              <Ionicons name="flash" size={18} color="#FFF" />
              <Text style={styles.challengeText}>Sfido dike nga feed-i</Text>
            </LinearGradient>
          </TouchableOpacity>
        ) : null}

        <View style={styles.filters}>
          {(["active", "finished"] as const).map((value) => (
            <TouchableOpacity
              key={value}
              style={[styles.filter, filter === value && styles.filterOn]}
              onPress={() => {
                setFilter(value);
                setLoading(true);
                load(value);
              }}
            >
              <Text style={[styles.filterText, filter === value && styles.filterTextOn]}>
                {value === "active" ? "Live" : "Mbaruara"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading && duels.length === 0 ? (
          <StatePanel variant="loading" message="Duke ngarkuar duels…" compact />
        ) : error && duels.length === 0 ? (
          <StatePanel
            variant="error"
            title="Duels nuk u hapen"
            message={error}
            primaryLabel="Riprovo"
            onPrimaryPress={() => {
              setLoading(true);
              load();
            }}
            compact
          />
        ) : listWithoutMine.length === 0 ? (
          <StatePanel
            variant="empty"
            title={filter === "active" ? "Asnje duel live" : "Asnje duel i mbaruar"}
            message="Pergjigju nje pyetjeje, pastaj sfido dike nga feed-i ose pas postimit."
            primaryLabel="Pergjigju tani"
            onPrimaryPress={goAnswer}
            secondaryLabel="Hap feed"
            onSecondaryPress={goFeed}
            compact
          />
        ) : (
          listWithoutMine.map((duel) => {
            const total = Number(duel.total_votes || 0);
            return (
              <TouchableOpacity key={duel.id} style={styles.card} onPress={() => setSelected(duel)} activeOpacity={0.9}>
                <View style={styles.cardTop}>
                  <Text style={duel.status === "active" ? styles.live : styles.done}>
                    {duel.status === "active" ? "LIVE" : "MBARUAR"}
                  </Text>
                  <Text style={styles.meta}>{total} vota</Text>
                </View>
                <Text style={styles.question} numberOfLines={2}>{duel.question_text}</Text>
                <View style={styles.vsRow}>
                  <Text style={styles.handle} numberOfLines={1}>@{duel.user_a_username || "A"}</Text>
                  <Text style={styles.vs}>VS</Text>
                  <Text style={styles.handle} numberOfLines={1}>@{duel.user_b_username || "B"}</Text>
                </View>
                <View style={styles.bar}>
                  <View style={[styles.barA, { flex: Math.max(duel.pct_a || 1, 1) }]} />
                  <View style={[styles.barB, { flex: Math.max(duel.pct_b || 1, 1) }]} />
                </View>
                <Text style={styles.cta}>
                  {duel.your_vote ? `Votove ${duel.your_vote}` : duel.status === "active" ? "Hap dhe voto" : "Shiko fituesin"}
                </Text>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 56 },
  full: { flex: 1, backgroundColor: "#050508" },
  back: {
    position: "absolute",
    top: 52,
    left: 16,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  backText: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  header: { paddingHorizontal: 4, marginBottom: 6 },
  kicker: { color: "#FF2D6A", fontWeight: "900", letterSpacing: 2, fontSize: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  title: { color: "#FFF", fontSize: 36, fontWeight: "900" },
  statsPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,200,87,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,200,87,0.3)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statsText: { color: "#FFC857", fontWeight: "800", fontSize: 12 },
  subtitle: { color: "rgba(255,255,255,0.62)", marginTop: 6, fontSize: 14, fontWeight: "600", lineHeight: 20 },
  offline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,200,87,0.1)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  offlineText: { color: "#FFC857", fontSize: 12, fontWeight: "700" },
  filters: { flexDirection: "row", gap: 8, marginTop: 4 },
  filter: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  filterOn: { backgroundColor: "#FF2D6A", borderColor: "#FF2D6A" },
  filterText: { color: "rgba(255,255,255,0.6)", fontWeight: "800" },
  filterTextOn: { color: "#FFF" },
  list: { paddingHorizontal: 18, paddingBottom: 120, gap: 12 },
  card: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  mineCard: {
    borderColor: "rgba(255,45,106,0.55)",
    backgroundColor: "rgba(255,45,106,0.1)",
  },
  mineLabel: { color: "#FF2D6A", fontWeight: "900", letterSpacing: 1, fontSize: 11 },
  queueCard: {
    borderColor: "rgba(61,255,200,0.4)",
    backgroundColor: "rgba(61,255,200,0.07)",
  },
  queueBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#3DFFC8",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  queueBadgeText: { color: "#0A0A10", fontWeight: "900", fontSize: 10, letterSpacing: 1 },
  queueHint: { color: "rgba(255,255,255,0.65)", marginTop: 10, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  cancel: { color: "rgba(255,255,255,0.6)", fontWeight: "800", fontSize: 12 },
  challengeCta: { borderRadius: 18, overflow: "hidden" },
  challengeInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  challengeText: { color: "#FFF", fontWeight: "900", fontSize: 15 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  live: { color: "#3DFFC8", fontWeight: "900", letterSpacing: 1, fontSize: 11 },
  done: { color: "rgba(255,255,255,0.5)", fontWeight: "900", letterSpacing: 1, fontSize: 11 },
  meta: { color: "rgba(255,255,255,0.55)", fontWeight: "700", fontSize: 12 },
  question: { color: "#FFF", fontSize: 18, fontWeight: "800", lineHeight: 24 },
  vsRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  handle: { flex: 1, color: "rgba(255,255,255,0.8)", fontWeight: "700" },
  vs: { color: "#FF2D6A", fontWeight: "900" },
  bar: { flexDirection: "row", height: 8, borderRadius: 999, overflow: "hidden", marginTop: 12, backgroundColor: "rgba(255,255,255,0.08)" },
  barA: { backgroundColor: "#FF2D6A" },
  barB: { backgroundColor: "#8B5CFF" },
  cta: { color: "#FFC857", marginTop: 12, fontWeight: "800", fontSize: 12 },
});
