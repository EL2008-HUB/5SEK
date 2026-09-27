import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { LeaderboardResponse, leaderboardApi } from "../services/api";

const PODIUM_COLORS: readonly (readonly [string, string])[] = [
  ["#FFC857", "#FF8A3D"],
  ["#C9D6FF", "#8B9BFF"],
  ["#FFB199", "#FF6B8A"],
];

function initials(name: string) {
  return (name || "?").replace(/^vizitor_/, "").charAt(0).toUpperCase();
}

/**
 * Compact weekly leaderboard preview for the Home screen: top 3 + your rank.
 * Renders nothing while loading or when the API is unavailable (never blocks Home).
 */
export default function LeaderboardTeaser() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [data, setData] = useState<LeaderboardResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await leaderboardApi.get("week", 3);
      setData(response.data);
    } catch (_) {
      // keep whatever we had
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!data || data.entries.length === 0) return null;

  const top = data.entries.slice(0, 3);
  const me = data.me;
  const meLine = !me
    ? "Hyr në renditje me një përgjigje"
    : !me.points
    ? "Ti: 0 pikë · një përgjigje = +5"
    : me.rank === 1
    ? "Ti je #1 këtë javë"
    : data.next_rank
    ? `Ti: #${me.rank} · ${data.next_rank.points_needed} pikë deri te #${data.next_rank.rank}`
    : `Ti: #${me.rank} · ${me.points} pikë`;

  return (
    <TouchableOpacity
      style={styles.wrap}
      activeOpacity={0.88}
      onPress={() => navigation.navigate("Leaderboard")}
      accessibilityRole="button"
      accessibilityLabel="Hap renditjen javore"
    >
      <LinearGradient
        colors={["rgba(255,200,87,0.16)", "rgba(255,138,61,0.06)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.inner}
      >
        <View style={styles.avatars}>
          {top.map((entry, index) => (
            <LinearGradient
              key={entry.user_id}
              colors={PODIUM_COLORS[index]}
              style={[styles.avatar, index > 0 && styles.avatarOverlap, index === 0 && styles.avatarFirst]}
            >
              <Text style={styles.avatarText}>{initials(entry.username)}</Text>
            </LinearGradient>
          ))}
        </View>
        <View style={styles.copy}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Renditja e javës</Text>
            <Text style={styles.crown}>👑</Text>
          </View>
          <Text style={styles.sub} numberOfLines={1}>
            {top[0] ? `@${top[0].is_guest ? "vizitor" : top[0].username} kryeson me ${top[0].points} pikë` : ""}
          </Text>
          <Text style={[styles.me, user?.id === top[0]?.user_id && styles.meLeader]} numberOfLines={1}>
            {meLine}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#FFC857" />
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14, borderRadius: 20, overflow: "hidden" },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,200,87,0.3)",
  },
  avatars: { flexDirection: "row", alignItems: "center" },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#0A0A10",
  },
  avatarFirst: { width: 40, height: 40, borderRadius: 20, zIndex: 3 },
  avatarOverlap: { marginLeft: -10 },
  avatarText: { color: "#1A1200", fontSize: 14, fontWeight: "900" },
  copy: { flex: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { color: "#FFF", fontSize: 14, fontWeight: "900" },
  crown: { fontSize: 13 },
  sub: { color: "rgba(255,255,255,0.65)", fontSize: 12, fontWeight: "700", marginTop: 2 },
  me: { color: "#FFC857", fontSize: 12, fontWeight: "800", marginTop: 3 },
  meLeader: { color: "#3DFFC8" },
});
