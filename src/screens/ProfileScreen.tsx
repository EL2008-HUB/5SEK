import React, { useEffect, useState } from "react";
import {
  Alert,
  Dimensions,
  Linking,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { usePush } from "../context/PushContext";
import { answersApi, countryApi, moderationApi, paymentsApi, questionsApi } from "../services/api";
import { analytics } from "../services/analytics";
import { buildFeedShareUrl } from "../services/deepLinks";
import AdminConsole from "../components/AdminConsole";
import AccountOperations from "../components/AccountOperations";

const { width } = Dimensions.get("window");

const COUNTRIES = [
  { code: "AL", name: "Albania" },
  { code: "XK", name: "Kosovo" },
  { code: "US", name: "USA" },
  { code: "DE", name: "Germany" },
  { code: "UK", name: "UK" },
  { code: "TR", name: "Turkey" },
  { code: "IT", name: "Italy" },
  { code: "GLOBAL", name: "Global" },
];

const AGE_GROUPS = [
  { value: "13-17", label: "13-17" },
  { value: "18-24", label: "18-24" },
  { value: "25-34", label: "25-34" },
  { value: "35+", label: "35+" },
];

const INTERESTS = [
  { value: "memes", label: "Memes" },
  { value: "relationships", label: "Relationships" },
  { value: "sports", label: "Sports" },
  { value: "music", label: "Music" },
  { value: "food", label: "Food" },
  { value: "gaming", label: "Gaming" },
  { value: "money", label: "Money" },
  { value: "travel", label: "Travel" },
  { value: "fashion", label: "Fashion" },
  { value: "tech", label: "Tech" },
  { value: "movies", label: "Movies" },
  { value: "fitness", label: "Fitness" },
];

interface UserAnswer {
  id: number;
  video_url: string;
  question_text: string;
  created_at: string;
}

interface LearnedPattern {
  id: number;
  type: string;
  value: string;
}

export default function ProfileScreen() {
  const { user, updateProfile } = useAuth();
  const { permission: pushPermission, expoPushToken, sendTestPush } = usePush();
  const [answers, setAnswers] = useState<UserAnswer[]>([]);
  const [loadingAnswers, setLoadingAnswers] = useState(true);
  const [selectedCountry, setSelectedCountry] = useState("GLOBAL");
  const [selectedAgeGroup, setSelectedAgeGroup] = useState<string | null>(null);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [patterns, setPatterns] = useState<LearnedPattern[]>([]);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [showAgePicker, setShowAgePicker] = useState(false);
  const [showInterestsPicker, setShowInterestsPicker] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<Array<{ id: number; username: string; created_at: string }>>([]);

  useEffect(() => {
    const init = async () => {
      const country = await countryApi.loadCountry();
      setSelectedCountry(user?.country || country);
      setSelectedAgeGroup(user?.age_group || null);
      setSelectedInterests(user?.interests || []);
    };
    init();
  }, [user?.age_group, user?.country, user?.interests]);

  useEffect(() => {
    const fetchMyAnswers = async () => {
      if (!user?.id) return;
      try {
        const res = await answersApi.getByUser(user.id);
        setAnswers(res.data || []);
      } catch (error) {
        console.log("Error fetching user answers:", error);
      } finally {
        setLoadingAnswers(false);
      }
    };
    fetchMyAnswers();
  }, [user?.id]);

  useEffect(() => {
    questionsApi
      .getPatterns(selectedCountry)
      .then((res) => setPatterns((res.data?.patterns || []).slice(0, 6)))
      .catch((error) => console.log("Error fetching patterns:", error));
  }, [selectedCountry]);

  useEffect(() => {
    moderationApi
      .getMyBlocks()
      .then((response) => setBlockedUsers(response.data || []))
      .catch(() => setBlockedUsers([]));
  }, []);

  const handleCountrySelect = async (code: string) => {
    setSelectedCountry(code);
    setShowCountryPicker(false);
    await countryApi.setCountry(code);
    await updateProfile({
      country: code,
      age_group: selectedAgeGroup || undefined,
      interests: selectedInterests,
    });
    const countryName = COUNTRIES.find((entry) => entry.code === code)?.name || code;
    Alert.alert("Country updated", `Questions will now follow ${countryName}.`);
  };

  const handleAgeGroupSelect = async (value: string) => {
    const nextValue = selectedAgeGroup === value ? null : value;
    setSelectedAgeGroup(nextValue);
    await updateProfile({
      country: selectedCountry,
      age_group: nextValue || undefined,
      interests: selectedInterests,
    });
  };

  const handleInterestToggle = async (value: string) => {
    const updated = selectedInterests.includes(value)
      ? selectedInterests.filter((entry) => entry !== value)
      : [...selectedInterests, value];

    setSelectedInterests(updated);
    await updateProfile({
      country: selectedCountry,
      age_group: selectedAgeGroup || undefined,
      interests: updated,
    });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const openBillingPortal = async () => {
    try {
      const response = await paymentsApi.createPortal();
      if (response.data?.url) {
        await Linking.openURL(response.data.url);
      }
    } catch (_) {
      Alert.alert("Billing unavailable", "Could not open billing portal right now.");
    }
  };

  const shareAppLink = async () => {
    try {
      analytics.shareOpened("profile", { mode: "profile_share" });
      await Share.share({
        title: "5SEK",
        message: `Jump into 5SEK: ${buildFeedShareUrl()}`,
      });
      analytics.shareCompleted("profile", { mode: "profile_share" });
    } catch (_) {
      Alert.alert("Share unavailable", "Could not open the share sheet.");
    }
  };

  const currentCountry = COUNTRIES.find((entry) => entry.code === selectedCountry) || COUNTRIES[COUNTRIES.length - 1];
  const currentAge = AGE_GROUPS.find((entry) => entry.value === selectedAgeGroup);
  const profileUser = user || {
    id: 0,
    username: "profile",
    email: "profile@5sek.app",
    country: selectedCountry,
  };

  const personalizationParts: string[] = [];
  if (currentCountry.code !== "GLOBAL") personalizationParts.push(currentCountry.name);
  if (currentAge) personalizationParts.push(currentAge.label);
  if (selectedInterests.length > 0) personalizationParts.push(selectedInterests.slice(0, 3).join(", "));

  return (
    <LinearGradient colors={["#0A0A0A", "#1A1A2E"]} style={styles.container}>
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.avatarContainer}>
            <LinearGradient colors={["#FF3366", "#FF6B6B"]} style={styles.avatar}>
              <Text style={styles.avatarText}>{profileUser.username.charAt(0).toUpperCase()}</Text>
            </LinearGradient>
          </View>
          <Text style={styles.username}>@{profileUser.username}</Text>
          {personalizationParts.length > 0 ? (
            <View style={styles.personalizationBadge}>
              <Text style={styles.personalizationText}>{personalizationParts.join(" · ")}</Text>
            </View>
          ) : null}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{answers.length}</Text>
              <Text style={styles.statLabel}>Answers</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{answers.length * 5}s</Text>
              <Text style={styles.statLabel}>Total Time</Text>
            </View>
          </View>
        </View>

        {blockedUsers.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Blocked users</Text>
            <Text style={styles.sectionHint}>Hidden from your feed until you unblock them.</Text>
            {blockedUsers.slice(0, 5).map((blockedUser) => (
              <View key={blockedUser.id} style={styles.answerCard}>
                <View style={styles.answerIcon}>
                  <Ionicons name="ban-outline" size={20} color="#FFB347" />
                </View>
                <View style={styles.answerInfo}>
                  <Text style={styles.answerQuestion}>@{blockedUser.username}</Text>
                  <Text style={styles.answerDate}>{formatDate(blockedUser.created_at)}</Text>
                </View>
                <TouchableOpacity
                  onPress={() =>
                    moderationApi
                      .unblockUser(blockedUser.id)
                      .then(() => {
                        setBlockedUsers((prev) => prev.filter((entry) => entry.id !== blockedUser.id));
                      })
                      .catch(() => Alert.alert("Unblock failed", "Could not unblock that user."))
                  }
                >
                  <Text style={styles.reportActionGhostText}>Unblock</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Push Notifications</Text>
          <Text style={styles.sectionHint}>
            {pushPermission === "granted"
              ? expoPushToken
                ? "Registered on this device."
                : "Permission granted, waiting for token sync."
              : pushPermission === "unsupported"
              ? "Requires a development or production build on a physical device."
              : pushPermission === "denied"
              ? "Notifications are denied for this app."
              : "Checking notification permissions."}
          </Text>
          {expoPushToken ? (
            <View style={styles.answerCard}>
              <View style={styles.answerIcon}>
                <Ionicons name="notifications-outline" size={20} color="#FFB347" />
              </View>
              <View style={styles.answerInfo}>
                <Text style={styles.answerQuestion}>Push token synced</Text>
                <Text style={styles.answerDate}>{expoPushToken.slice(0, 24)}...</Text>
              </View>
              <TouchableOpacity
                style={styles.reportActionGhost}
                onPress={() =>
                  sendTestPush()
                    .then(() => Alert.alert("Push queued", "A test notification was queued for this device."))
                    .catch(() => Alert.alert("Push failed", "Could not queue a test notification."))
                }
              >
                <Text style={styles.reportActionGhostText}>Test push</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <TouchableOpacity style={styles.reportActionGhost} onPress={shareAppLink}>
            <Text style={styles.reportActionGhostText}>Share app link</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <TouchableOpacity style={styles.sectionHeader} onPress={() => setShowCountryPicker((value) => !value)}>
            <Text style={styles.sectionTitle}>Country</Text>
            <View style={styles.sectionValueRow}>
              <Text style={styles.sectionValue}>{currentCountry.name}</Text>
              <Ionicons
                name={showCountryPicker ? "chevron-up" : "chevron-down"}
                size={18}
                color="rgba(255,255,255,0.4)"
              />
            </View>
          </TouchableOpacity>

          {showCountryPicker ? (
            <View style={styles.pickerGrid}>
              {COUNTRIES.map((country) => {
                const isActive = country.code === selectedCountry;
                return (
                  <TouchableOpacity
                    key={country.code}
                    style={[styles.pickerItem, isActive && styles.pickerItemActive]}
                    onPress={() => handleCountrySelect(country.code)}
                  >
                    <Text style={[styles.pickerLabel, isActive && styles.pickerLabelActive]}>{country.name}</Text>
                    {isActive ? <Ionicons name="checkmark-circle" size={16} color="#FF3366" /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <TouchableOpacity style={styles.sectionHeader} onPress={() => setShowAgePicker((value) => !value)}>
            <Text style={styles.sectionTitle}>Age Group</Text>
            <View style={styles.sectionValueRow}>
              <Text style={styles.sectionValue}>{currentAge ? currentAge.label : "Not set"}</Text>
              <Ionicons
                name={showAgePicker ? "chevron-up" : "chevron-down"}
                size={18}
                color="rgba(255,255,255,0.4)"
              />
            </View>
          </TouchableOpacity>
          <Text style={styles.sectionHint}>Questions adapt to your age group for better matches.</Text>

          {showAgePicker ? (
            <View style={styles.ageGrid}>
              {AGE_GROUPS.map((age) => {
                const isActive = age.value === selectedAgeGroup;
                return (
                  <TouchableOpacity
                    key={age.value}
                    style={[styles.ageItem, isActive && styles.ageItemActive]}
                    onPress={() => handleAgeGroupSelect(age.value)}
                  >
                    <Text style={[styles.ageLabel, isActive && styles.ageLabelActive]}>{age.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => setShowInterestsPicker((value) => !value)}
          >
            <Text style={styles.sectionTitle}>Interests</Text>
            <View style={styles.sectionValueRow}>
              <Text style={styles.sectionValue}>
                {selectedInterests.length > 0 ? `${selectedInterests.length} selected` : "None"}
              </Text>
              <Ionicons
                name={showInterestsPicker ? "chevron-up" : "chevron-down"}
                size={18}
                color="rgba(255,255,255,0.4)"
              />
            </View>
          </TouchableOpacity>
          <Text style={styles.sectionHint}>Pick topics you want the feed to bias toward.</Text>

          {showInterestsPicker ? (
            <View style={styles.interestGrid}>
              {INTERESTS.map((interest) => {
                const isActive = selectedInterests.includes(interest.value);
                return (
                  <TouchableOpacity
                    key={interest.value}
                    style={[styles.interestChip, isActive && styles.interestChipActive]}
                    onPress={() => handleInterestToggle(interest.value)}
                  >
                    <Text style={[styles.interestLabel, isActive && styles.interestLabelActive]}>
                      {interest.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </View>

        <AdminConsole role={user?.role} />

        {user?.is_premium ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Premium</Text>
            <Text style={styles.sectionHint}>
              {user.subscription_status || "active"}
              {user.premium_expires_at ? ` · renews ${formatDate(user.premium_expires_at)}` : ""}
            </Text>
            <TouchableOpacity style={styles.reportActionGhost} onPress={openBillingPortal}>
              <Text style={styles.reportActionGhostText}>Manage billing</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {patterns.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Learned Patterns</Text>
            <Text style={styles.sectionHint}>The backend is learning what formats perform in this market.</Text>
            <View style={styles.patternsWrap}>
              {patterns.map((pattern) => (
                <View key={pattern.id} style={styles.patternChip}>
                  <Text style={styles.patternChipText}>
                    {pattern.type}: {pattern.value}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <AccountOperations isPremium={user?.is_premium} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My Answers</Text>

          {loadingAnswers ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Loading answers...</Text>
            </View>
          ) : answers.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="videocam-outline" size={48} color="#333" />
              <Text style={styles.emptyText}>No answers yet</Text>
              <Text style={styles.emptySubtext}>Record your first 5-second answer.</Text>
            </View>
          ) : (
            answers.map((item) => (
              <View key={item.id} style={styles.answerCard}>
                <View style={styles.answerIcon}>
                  <Ionicons name="videocam" size={20} color="#FF3366" />
                </View>
                <View style={styles.answerInfo}>
                  <Text style={styles.answerQuestion} numberOfLines={2}>
                    {item.question_text}
                  </Text>
                  <Text style={styles.answerDate}>{formatDate(item.created_at)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#444" />
              </View>
            ))
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
  },
  header: {
    alignItems: "center",
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  avatarContainer: { marginBottom: 12 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { color: "#FFF", fontSize: 32, fontWeight: "800" },
  username: { color: "#FFF", fontSize: 22, fontWeight: "700" },
  personalizationBadge: {
    marginTop: 8,
    backgroundColor: "rgba(255, 51, 102, 0.1)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 5,
    maxWidth: width - 56,
  },
  personalizationText: {
    color: "#FF6B8A",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 20,
    gap: 30,
  },
  statItem: { alignItems: "center" },
  statNumber: { color: "#FF3366", fontSize: 24, fontWeight: "800" },
  statLabel: { color: "#888", fontSize: 12, marginTop: 2 },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "700",
  },
  sectionValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sectionValue: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
    fontWeight: "600",
  },
  sectionHint: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 4,
  },
  pickerGrid: { marginTop: 12, gap: 4 },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  pickerItemActive: {
    backgroundColor: "rgba(255, 51, 102, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(255, 51, 102, 0.3)",
  },
  pickerLabel: {
    flex: 1,
    color: "rgba(255,255,255,0.7)",
    fontSize: 15,
    fontWeight: "600",
  },
  pickerLabelActive: { color: "#FF6B8A", fontWeight: "800" },
  ageGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  ageItem: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "transparent",
  },
  ageItemActive: {
    backgroundColor: "rgba(255, 51, 102, 0.1)",
    borderColor: "rgba(255, 51, 102, 0.4)",
  },
  ageLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 15,
    fontWeight: "700",
  },
  ageLabelActive: { color: "#FF6B8A" },
  interestGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  interestChip: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  interestChipActive: {
    backgroundColor: "rgba(255, 51, 102, 0.12)",
    borderColor: "rgba(255, 51, 102, 0.35)",
  },
  interestLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontWeight: "700",
  },
  interestLabelActive: { color: "#FF6B8A" },
  patternsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  patternChip: {
    backgroundColor: "rgba(0,210,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(0,210,255,0.2)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  patternChipText: {
    color: "#BCEFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  reportActionGhost: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  reportActionGhostText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    fontWeight: "800",
  },
  emptyState: {
    paddingVertical: 40,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  emptyText: { color: "#666", fontSize: 16, fontWeight: "600" },
  emptySubtext: { color: "#444", fontSize: 13 },
  answerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    gap: 12,
  },
  answerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 51, 102, 0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  answerInfo: { flex: 1 },
  answerQuestion: {
    color: "#EEE",
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  answerDate: { color: "#666", fontSize: 11, marginTop: 4 },
});
