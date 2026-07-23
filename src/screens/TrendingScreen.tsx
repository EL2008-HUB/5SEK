import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Animated,
  Image,
  Dimensions,
  Platform,
  SafeAreaView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { trendingApi } from "../services/api";
import { analytics } from "../services/analytics";
import StreakBar from "../components/StreakBar";
import StatePanel from "../components/StatePanel";
const { width } = Dimensions.get("window");

interface ExplodingQuestion {
  id: number;
  text: string;
  country: string;
  created_at: string;
  heat_score: number;
  answers_last_2h: number;
  velocity: number;
  score: number;
}

interface ChaosThread {
  title: string;
  root_answer_id: number;
  score: number;
  chain_heat: number;
  chain_depth_score: number;
  reaction_velocity: number;
  drama_score: number;
  level: string;
  label: string;
  emoji: string;
  remix_count: number;
  joined_count: number;
  comment_count: number;
  replays: number;
  shares: number;
  chain_length: number;
  user_started_this: boolean;
  continue_chain_cta: string;
  continue_from_answer_id: number;
  top_comeback?: {
    answer_id: number;
    username: string;
    likes: number;
    label: string;
    preview: string | null;
  } | null;
  creator: {
    id: number;
    username: string;
    avatar_url: string | null;
  };
  question_text: string;
  video_url: string;
  question_id: number;
}

interface MostReplayedAnswer {
  id: number;
  video_url: string;
  answer_type: string;
  replay_count: number;
  views: number;
  likes: number;
  question_text: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
  score: number;
}

interface WildestConfession {
  id: number;
  text: string;
  category: string;
  embarrassment_score: number;
  emotion_tags: string[];
  top_answer?: {
    id: number;
    video_url: string;
    answer_type: string;
    likes: number;
    views: number;
    username: string;
    avatar_url: string | null;
  } | null;
}

interface ExplodingCityQuestion {
  id: number;
  text: string;
  country: string;
  local_virality_score: number;
  local_heat_label: string;
  city_tagline: string;
  near_you_text: string;
}

interface ChaosCreator {
  id: number;
  username: string;
  avatar_url: string | null;
  total_chaos_score: number;
  total_threads_started: number;
  badge: string;
}

interface TrendingFeedData {
  explodingNow: ExplodingQuestion[];
  chaosThreads: ChaosThread[];
  mostReplayed: MostReplayedAnswer[];
  wildestConfessions: WildestConfession[];
  explodingInCity: ExplodingCityQuestion[];
  topCreators: ChaosCreator[];
  metadata: {
    country: string;
    city: string;
    timestamp: string;
  };
}

export default function TrendingScreen({ navigation }: any) {
  const [data, setData] = useState<TrendingFeedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  /* ---------- Ambient Glow Animations ---------- */
  const breatheAnim = useRef(new Animated.Value(0)).current;

  const glowScale1 = breatheAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.25],
  });

  const glowScale2 = breatheAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1.2, 0.95],
  });

  const fetchTrendingData = async () => {
    try {
      setError(null);
      const response = await trendingApi.getDiscoveryFeed();
      setData(response.data);
    } catch (err: any) {
      console.error("Error loading trending discovery feed:", err);
      setError("Couldn't load trending right now.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTrendingData();

    // Track screen view
    analytics.track({ event_type: "screen_view" as any, screen: "Trending" });

    // Live indicators pulsing animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Ambient background breathe animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(breatheAnim, {
          toValue: 1,
          duration: 5000,
          useNativeDriver: true,
        }),
        Animated.timing(breatheAnim, {
          toValue: 0,
          duration: 5000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Glow background breathing animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.3,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Re-fetch when screen is focused
    const unsubscribe = navigation.addListener("focus", () => {
      fetchTrendingData();
    });

    return unsubscribe;
  }, [navigation]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchTrendingData();
  };

  const handleQuestionPress = (questionId: number, questionText: string) => {
    analytics.answerStart("trending", { question_id: questionId });
    const params = { questionId, questionText, mode: "video" };
    if (typeof navigation.jumpTo === "function") {
      navigation.jumpTo("Record", params);
    } else {
      navigation.navigate("Record", params);
    }
  };

  const handleWatchAnswer = (answerId: number) => {
    navigation.navigate("DeepAnswer", { answerId });
  };

  const handleRemixThread = (thread: ChaosThread) => {
    navigation.navigate("RemixRecord", {
      parentAnswerId: thread.continue_from_answer_id,
      parentVideoUrl: thread.video_url,
      questionText: thread.question_text,
      questionId: thread.question_id,
      username: thread.creator.username,
      chainDepth: thread.chain_length,
      autoStart: true,
    });
  };

  if (loading && !refreshing && !data) {
    return (
      <View style={styles.loadingContainer}>
        <LinearGradient colors={["#020408", "#0B0F19", "#1A0B2E"]} style={StyleSheet.absoluteFill} />
        <StatePanel variant="loading" message="Loading what's hot…" />
      </View>
    );
  }

  const cityTagline = data?.explodingInCity?.[0]?.city_tagline || `${data?.metadata?.city || "Tirana"} is going crazy tonight! 🔥`;
  const isEmpty =
    !error &&
    data &&
    !(data.explodingNow?.length ||
      data.chaosThreads?.length ||
      data.mostReplayed?.length ||
      data.wildestConfessions?.length ||
      data.explodingInCity?.length ||
      data.topCreators?.length);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <LinearGradient colors={["#020408", "#0B0F19", "#1A0B2E"]} style={StyleSheet.absoluteFill} />

      {/* Premium Animated Ambient Glow Orbs */}
      <Animated.View
        style={[
          styles.ambientOrb1,
          { transform: [{ scale: glowScale1 }] },
        ]}
        pointerEvents="none"
      />
      <Animated.View
        style={[
          styles.ambientOrb2,
          { transform: [{ scale: glowScale2 }] },
        ]}
        pointerEvents="none"
      />

      {/* Top Header */}
      <SafeAreaView style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.titleRow}>
            <Text style={styles.headerTitle}>ZBULIMI</Text>
            <View style={styles.liveIndicatorContainer}>
              <Animated.View style={[styles.liveIndicatorDot, { transform: [{ scale: pulseAnim }] }]} />
              <Text style={styles.liveIndicatorText}>LIVE</Text>
            </View>
          </View>
          <View style={styles.streakContainer}>
            <StreakBar compact />
          </View>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#FF3366" />
        }
      >
        {error ? (
          <View style={styles.statePanelWrap}>
            <StatePanel
              compact
              variant="error"
              title="Couldn't load trending"
              message={error}
              primaryLabel="Try again"
              onPrimaryPress={fetchTrendingData}
              secondaryLabel="Open feed"
              onSecondaryPress={() => navigation.navigate("Feed")}
            />
          </View>
        ) : null}

        {isEmpty ? (
          <View style={styles.statePanelWrap}>
            <StatePanel
              compact
              variant="empty"
              title="Nothing exploding yet"
              message="Be first — record a 5-second answer and start the heat."
              primaryLabel="Record now"
              onPrimaryPress={() => navigation.navigate("Record")}
              secondaryLabel="Refresh"
              onSecondaryPress={handleRefresh}
            />
          </View>
        ) : null}

        {/* 1. LOCAL HERO HERO SECTION: Exploding In Your City */}
        {data && data.explodingInCity && data.explodingInCity.length > 0 && (
          <View style={styles.localHeroSection}>
            <LinearGradient
              colors={["rgba(0, 229, 255, 0.12)", "rgba(255, 51, 102, 0.04)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.localHeroGradient}
            >
              <View style={styles.localHeroHeader}>
                <Ionicons name="location" size={20} color="#00E5FF" style={styles.glowIcon} />
                <Text style={styles.localHeroTitle}>{cityTagline}</Text>
              </View>

              <Text style={styles.localHeroSubtitle}>Po zjen lokalisht! Merr pjesë para se të ftohet:</Text>

              {data.explodingInCity.slice(0, 3).map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.localQuestionCard}
                  activeOpacity={0.8}
                  onPress={() => handleQuestionPress(item.id, item.text || "")}
                >
                  <View style={styles.localQuestionCardContent}>
                    <Text style={styles.localQuestionText} numberOfLines={2}>
                      {item.text || ""}
                    </Text>
                    <View style={styles.localCardFooter}>
                      <View style={styles.localProof}>
                        <Ionicons name="people" size={14} color="rgba(255,255,255,0.6)" />
                        <Text style={styles.localProofText}>{item.near_you_text || "Pyetje afër teje"}</Text>
                      </View>
                      <View style={styles.hotPill}>
                        <Text style={styles.hotPillText}>{(item.local_heat_label || "HOT").toUpperCase()}</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.arrowGo}>
                    <Ionicons name="chevron-forward" size={18} color="#00E5FF" />
                  </View>
                </TouchableOpacity>
              ))}
            </LinearGradient>
          </View>
        )}

        {/* 2. 🔥 EXPLODING NOW SECTION */}
        {data && data.explodingNow && data.explodingNow.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionEmoji}>🔥</Text>
                <Text style={styles.sectionTitle}>Të nxehta tani</Text>
              </View>
              <Text style={styles.sectionSubtitle}>Velocity bazuar në remixes e sekondat e fundit</Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
            >
              {data.explodingNow.map((item, idx) => {
                const colors: [string, string] = idx === 0
                  ? ["rgba(255, 51, 102, 0.2)", "rgba(255, 107, 0, 0.1)"]
                  : idx === 1
                  ? ["rgba(255, 107, 0, 0.2)", "rgba(255, 199, 0, 0.1)"]
                  : ["rgba(255, 255, 255, 0.03)", "rgba(255, 255, 255, 0.01)"];

                const borderColor = idx === 0
                  ? "rgba(255, 51, 102, 0.4)"
                  : idx === 1
                  ? "rgba(255, 107, 0, 0.4)"
                  : "rgba(255, 255, 255, 0.06)";

                const shadowColor = idx === 0
                  ? "#FF3366"
                  : idx === 1
                  ? "#FF6B00"
                  : "transparent";

                const badgeColor = idx === 0 ? "#FF3366" : idx === 1 ? "#FF6B00" : "#FFF";

                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.explodingCard,
                      {
                        borderColor,
                        shadowColor,
                        shadowOpacity: shadowColor !== "transparent" ? 0.2 : 0,
                        shadowRadius: shadowColor !== "transparent" ? 8 : 0,
                        shadowOffset: { width: 0, height: 4 },
                      }
                    ]}
                    activeOpacity={0.8}
                    onPress={() => handleQuestionPress(item.id, item.text || "")}
                  >
                    <LinearGradient
                      colors={colors}
                      style={styles.explodingGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <View style={styles.velocityHeader}>
                        <View style={styles.velocityBadge}>
                          <Ionicons name="speedometer-outline" size={12} color={badgeColor} />
                          <Text style={[styles.velocityText, { color: badgeColor }]}>
                            {(item.velocity != null ? item.velocity.toFixed(1) : "0.0")}x rritje
                          </Text>
                        </View>
                        <Text style={[styles.rankText, { color: badgeColor }]}>#{idx + 1}</Text>
                      </View>

                      <Text
                        style={styles.explodingQuestionText}
                        numberOfLines={3}
                      >
                        {item.text || ""}
                      </Text>

                      <View style={styles.explodingCardFooter}>
                        <Text style={[styles.explodingCta, { color: badgeColor, borderColor: badgeColor }]}>
                          PËRGJIGJU ⚡
                        </Text>
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* 3. ⚡ CHAOS THREADS */}
        {data && data.chaosThreads && data.chaosThreads.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionEmoji}>⚡</Text>
                <Text style={styles.sectionTitle}>Zinxhirët e Kaosit</Text>
              </View>
              <Text style={styles.sectionSubtitle}>Chains me më shumë remix-e dhe aktivitet agresiv</Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
            >
              {data.chaosThreads.map((thread) => {
                const borderNeon = (thread.chain_heat || 0) >= 100 ? "rgba(255, 51, 102, 0.4)" : "rgba(0, 229, 255, 0.4)";
                const borderSolid = (thread.chain_heat || 0) >= 100 ? "#FF3366" : "#00E5FF";
                const shadowColor = (thread.chain_heat || 0) >= 100 ? "#FF3366" : "#00E5FF";

                return (
                  <View
                    key={thread.root_answer_id}
                    style={[
                      styles.chaosCard,
                      {
                        borderColor: borderNeon,
                        shadowColor,
                        shadowOpacity: 0.15,
                        shadowRadius: 10,
                        shadowOffset: { width: 0, height: 4 }
                      }
                    ]}
                  >
                    <View style={styles.chaosCardHeader}>
                      <Image
                        source={{ uri: thread.creator?.avatar_url || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop" }}
                        style={styles.creatorAvatar}
                      />
                      <View style={styles.creatorMeta}>
                        <Text style={styles.creatorUsername} numberOfLines={1}>
                          @{thread.creator?.username || "anonymous"}
                        </Text>
                        <Text style={styles.heatBadgeText}>
                          {thread.emoji || "⚡"} {(thread.label || "LEVEL 1").replace("🔥 CHAOS LEVEL: ", "")}
                        </Text>
                      </View>
                      <View style={[styles.heatScoreContainer, { backgroundColor: borderSolid }]}>
                        <Text style={styles.heatScoreVal}>{Math.round(thread.chain_heat || 0)}</Text>
                        <Text style={styles.heatScoreLbl}>HEAT</Text>
                      </View>
                    </View>

                    <Text style={styles.chaosQuestionText} numberOfLines={2}>
                      "{thread.question_text || ""}"
                    </Text>

                    {thread.top_comeback && (
                      <View style={styles.comebackContainer}>
                        <Text style={styles.comebackLabel}>MË I MIRË:</Text>
                        <Text style={styles.comebackText} numberOfLines={1}>
                          @{thread.top_comeback.username || "anonymous"}: {thread.top_comeback.preview || "Video 🎬"}
                        </Text>
                      </View>
                    )}

                    <View style={styles.chaosSocialRow}>
                      <View style={styles.socialStats}>
                        <View style={styles.socialStatItem}>
                          <Ionicons name="git-branch" size={14} color="#FFF" />
                          <Text style={styles.socialStatVal}>{thread.remix_count || 0}</Text>
                        </View>
                        <View style={styles.socialStatItem}>
                          <Ionicons name="chatbubble-outline" size={14} color="#FFF" />
                          <Text style={styles.socialStatVal}>{thread.comment_count || 0}</Text>
                        </View>
                        <View style={styles.socialStatItem}>
                          <Ionicons name="play-outline" size={14} color="#FFF" />
                          <Text style={styles.socialStatVal}>{thread.replays || 0}</Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.chaosActions}>
                      <TouchableOpacity
                        style={styles.chaosWatchBtn}
                        onPress={() => handleWatchAnswer(thread.root_answer_id)}
                      >
                        <Ionicons name="play" size={16} color="#FFF" />
                        <Text style={styles.chaosWatchBtnText}>Shiko</Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={styles.chaosRemixBtn} onPress={() => handleRemixThread(thread)}>
                        <LinearGradient
                          colors={["#00E5FF", "#7C4DFF"]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={styles.chaosRemixGradient}
                        >
                          <Ionicons name="git-compare" size={16} color="#FFF" />
                          <Text style={styles.chaosRemixBtnText}>Remix</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* 4. 👀 MOST REPLAYED SECTION */}
        {data && data.mostReplayed && data.mostReplayed.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionEmoji}>👀</Text>
                <Text style={styles.sectionTitle}>Më të ri-shikuarat</Text>
              </View>
              <Text style={styles.sectionSubtitle}>Video që po shikohen disa herë radhazi</Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
            >
              {data.mostReplayed.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.replayedCard}
                  activeOpacity={0.8}
                  onPress={() => handleWatchAnswer(item.id)}
                >
                  <LinearGradient
                    colors={["rgba(255,255,255,0.03)", "rgba(255,255,255,0.01)"]}
                    style={styles.replayedCardGradient}
                  >
                    {/* Visual representation of a video thumbnail */}
                    <View style={styles.thumbnailPlaceholder}>
                      <LinearGradient
                        colors={["rgba(124, 77, 255, 0.3)", "rgba(255, 51, 102, 0.15)"]}
                        style={StyleSheet.absoluteFill}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                      />
                      <View style={styles.playIconOverlay}>
                        <Ionicons name="play" size={24} color="#FFF" />
                      </View>
                      <View style={styles.replayPill}>
                        <Text style={styles.replayPillText}>🔄 {item.replay_count || 0} loops</Text>
                      </View>
                    </View>

                    <View style={styles.replayedCardContent}>
                      <Text style={styles.replayedQuestion} numberOfLines={2}>
                        {item.question_text || ""}
                      </Text>
                      <View style={styles.replayedUserRow}>
                        <Image
                          source={{ uri: item.avatar_url || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop" }}
                          style={styles.replayedAvatar}
                        />
                        <Text style={styles.replayedUser} numberOfLines={1}>
                          @{item.username || "anonymous"}
                        </Text>
                      </View>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* 5. 😳 WILDEST CONFESSIONS (PINK THEME) */}
        {data && data.wildestConfessions && data.wildestConfessions.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionEmoji}>😳</Text>
                <Text style={styles.sectionTitle}>Rrëfimet më Pikante</Text>
              </View>
              <Text style={styles.sectionSubtitle}>Pyetje awkward me siklet të garantuar</Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
            >
              {data.wildestConfessions.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.confessionCard}
                  activeOpacity={0.8}
                  onPress={() => {
                    if (item.top_answer) {
                      handleWatchAnswer(item.top_answer.id);
                    } else {
                      handleQuestionPress(item.id, item.text);
                    }
                  }}
                >
                  <LinearGradient
                    colors={["rgba(255, 51, 102, 0.08)", "rgba(255, 51, 102, 0.02)"]}
                    style={styles.confessionCardGradient}
                  >
                    <View style={styles.confessionHeader}>
                      <View style={styles.confessionPill}>
                        <Text style={styles.confessionPillText}>CONFESSION 😳</Text>
                      </View>
                      <View style={styles.embarrassmentBadge}>
                        <Text style={styles.embarrassmentText}>🔥 {Math.round((item.embarrassment_score || 0) * 10)}%</Text>
                      </View>
                    </View>

                    <Text style={styles.confessionText} numberOfLines={3}>
                      {item.text || ""}
                    </Text>

                    <View style={styles.confessionFooter}>
                      <View style={styles.confessionTags}>
                        {(item.emotion_tags || []).slice(0, 2).map((tag) => (
                          <Text key={tag} style={styles.confessionTagText}>
                            #{tag.toLowerCase()}
                          </Text>
                        ))}
                      </View>

                      <Text style={styles.confessionCta}>
                        {item.top_answer ? "SHIKO KOMBATIN 🍿" : "RRËFEHU TANI ⚡"}
                      </Text>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* 6. 👑 TOP CHAOS CREATORS (LEADERBOARD) */}
        {data && data.topCreators && data.topCreators.length > 0 && (
          <View style={[styles.section, styles.leaderboardSection]}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionEmoji}>👑</Text>
                <Text style={styles.sectionTitle}>Liderët e Kaosit</Text>
              </View>
              <Text style={styles.sectionSubtitle}>Krijuesit që kanë shkaktuar më shumë stuhi chains</Text>
            </View>

            <View style={styles.leaderboardContainer}>
              {data.topCreators.map((creator, index) => {
                const isTopThree = index < 3;
                const medalColors = ["#FFD700", "#C0C0C0", "#CD7F32"];

                return (
                  <View key={creator.id} style={styles.leaderboardRow}>
                    <View style={styles.leaderboardLeft}>
                      {isTopThree ? (
                        <View style={[styles.medalCircle, { backgroundColor: medalColors[index] }]}>
                          <Text style={styles.medalText}>{index + 1}</Text>
                        </View>
                      ) : (
                        <Text style={styles.rankNumberText}>{index + 1}</Text>
                      )}

                      <Image
                        source={{ uri: creator?.avatar_url || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop" }}
                        style={styles.leaderboardAvatar}
                      />

                      <View style={styles.leaderboardUserMeta}>
                        <Text style={styles.leaderboardUsername}>@{creator?.username || "anonymous"}</Text>
                        <Text style={styles.leaderboardBadgeText}>{creator?.badge || "Chaos Starter"}</Text>
                      </View>
                    </View>

                    <View style={styles.leaderboardRight}>
                      <Text style={styles.leaderboardScoreVal}>{creator?.total_chaos_score || 0}</Text>
                      <Text style={styles.leaderboardScoreLbl}>chaos pts</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* 6b. 🌍 GLOBAL COUNTRY LEADERBOARD */}
        <View style={[styles.section, styles.leaderboardSection]}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionEmoji}>🌍</Text>
              <Text style={styles.sectionTitle}>Renditja Globale e Shteteve</Text>
            </View>
            <Text style={styles.sectionSubtitle}>Pikët e grumbulluara në sfidat ndërkombëtare 1v1</Text>
          </View>

          <View style={styles.leaderboardContainer}>
            {[
              { rank: 1, name: "Shqipëria", flag: "🇦🇱", score: "45,200", badge: "Kampionët Aktualë 🏆" },
              { rank: 2, name: "Kosova", flag: "🇽🇰", score: "38,100", badge: "Në Ndjekje ⚡" },
              { rank: 3, name: "SHBA", flag: "🇺🇸", score: "29,400", badge: "Forca Krijuese 🔥" },
              { rank: 4, name: "Gjermania", flag: "🇩🇪", score: "22,900", badge: "Kompakt & Shpejt ⏱" },
              { rank: 5, name: "Turqia", flag: "🇹🇷", score: "18,700", badge: "Komentuesit më të Mirë 💬" },
            ].map((country, index) => {
              const medalColors = ["#FFD700", "#C0C0C0", "#CD7F32"];
              const isTopThree = index < 3;

              return (
                <View key={country.name} style={styles.leaderboardRow}>
                  <View style={styles.leaderboardLeft}>
                    {isTopThree ? (
                      <View style={[styles.medalCircle, { backgroundColor: medalColors[index] }]}>
                        <Text style={styles.medalText}>{index + 1}</Text>
                      </View>
                    ) : (
                      <Text style={styles.rankNumberText}>{index + 1}</Text>
                    )}

                    <Text style={{ fontSize: 24, marginRight: 12 }}>{country.flag}</Text>

                    <View style={styles.leaderboardUserMeta}>
                      <Text style={styles.leaderboardUsername}>{country.name}</Text>
                      <Text style={styles.leaderboardBadgeText}>{country.badge}</Text>
                    </View>
                  </View>

                  <View style={styles.leaderboardRight}>
                    <Text style={styles.leaderboardScoreVal}>{country.score}</Text>
                    <Text style={styles.leaderboardScoreLbl}>pikë dueli</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.footerSpacing} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#020408",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#020408",
  },
  statePanelWrap: {
    minHeight: 280,
    justifyContent: "center",
  },
  loadingText: {
    color: "#FFF",
    marginTop: 16,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  ambientOrb1: {
    position: "absolute",
    top: -100,
    right: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: "#7C4DFF",
    opacity: 0.15,
    shadowColor: "#7C4DFF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 100,
  },
  ambientOrb2: {
    position: "absolute",
    bottom: -120,
    left: -120,
    width: 350,
    height: 350,
    borderRadius: 175,
    backgroundColor: "#FF3366",
    opacity: 0.12,
    shadowColor: "#FF3366",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 100,
  },
  header: {
    backgroundColor: "rgba(2, 4, 8, 0.7)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.06)",
    zIndex: 100,
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 12,
    paddingTop: Platform.OS === "android" ? 40 : 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    color: "#FFF",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  liveIndicatorContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 51, 102, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 51, 102, 0.3)",
    gap: 5,
  },
  liveIndicatorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#FF3366",
  },
  liveIndicatorText: {
    color: "#FF3366",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  streakContainer: {
    justifyContent: "center",
  },
  scrollContent: {
    paddingBottom: 40,
  },
  errorContainer: {
    margin: 18,
    padding: 16,
    backgroundColor: "rgba(255, 51, 102, 0.1)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 51, 102, 0.2)",
    alignItems: "center",
  },
  errorText: {
    color: "#FF3366",
    fontWeight: "700",
    marginBottom: 10,
  },
  retryButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#FF3366",
    borderRadius: 8,
  },
  retryText: {
    color: "#FFF",
    fontWeight: "800",
    fontSize: 12,
  },
  localHeroSection: {
    margin: 16,
    borderRadius: 20,
    overflow: "hidden",
  },
  localHeroGradient: {
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(0, 229, 255, 0.2)",
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    shadowColor: "#00E5FF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
  },
  localHeroHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  glowIcon: {
    textShadowColor: "#00E5FF",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  localHeroTitle: {
    color: "#FFF",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  localHeroSubtitle: {
    color: "rgba(255, 255, 255, 0.65)",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 14,
  },
  localQuestionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
  },
  localQuestionCardContent: {
    flex: 1,
    paddingRight: 8,
  },
  localQuestionText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
    marginBottom: 6,
  },
  localCardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  localProof: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  localProofText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    fontWeight: "600",
  },
  hotPill: {
    backgroundColor: "rgba(0, 229, 255, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(0, 229, 255, 0.25)",
  },
  hotPillText: {
    color: "#00E5FF",
    fontSize: 9,
    fontWeight: "900",
  },
  arrowGo: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  section: {
    marginTop: 24,
  },
  sectionHeader: {
    paddingHorizontal: 18,
    marginBottom: 12,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionEmoji: {
    fontSize: 20,
  },
  sectionTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  sectionSubtitle: {
    color: "rgba(255, 255, 255, 0.45)",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  horizontalList: {
    paddingHorizontal: 18,
    gap: 14,
  },
  explodingCard: {
    width: width * 0.65,
    height: 140,
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  explodingGradient: {
    flex: 1,
    padding: 14,
    justifyContent: "space-between",
  },
  glassCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  velocityHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  velocityBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  velocityText: {
    fontSize: 10,
    fontWeight: "900",
  },
  rankText: {
    fontSize: 14,
    fontWeight: "900",
  },
  explodingQuestionText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 18,
  },
  explodingCardFooter: {
    flexDirection: "row",
    alignItems: "center",
  },
  explodingCta: {
    fontSize: 11,
    fontWeight: "900",
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  chaosCard: {
    width: width * 0.75,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 20,
    padding: 16,
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
  },
  chaosCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  creatorAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 10,
  },
  creatorMeta: {
    flex: 1,
  },
  creatorUsername: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "800",
  },
  heatBadgeText: {
    color: "rgba(255, 255, 255, 0.5)",
    fontSize: 10,
    fontWeight: "600",
  },
  heatScoreContainer: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  heatScoreVal: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "900",
  },
  heatScoreLbl: {
    color: "#FFF",
    fontSize: 7,
    fontWeight: "900",
  },
  chaosQuestionText: {
    color: "#F6F8FF",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
    fontStyle: "italic",
    marginBottom: 8,
  },
  comebackContainer: {
    backgroundColor: "rgba(0,0,0,0.3)",
    padding: 8,
    borderRadius: 10,
    marginBottom: 10,
  },
  comebackLabel: {
    color: "#00E5FF",
    fontSize: 9,
    fontWeight: "900",
    marginBottom: 2,
  },
  comebackText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 11,
    fontWeight: "600",
  },
  chaosSocialRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  socialStats: {
    flexDirection: "row",
    gap: 12,
  },
  socialStatItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  socialStatVal: {
    color: "#FFF",
    fontSize: 10,
    fontWeight: "700",
  },
  chaosActions: {
    flexDirection: "row",
    gap: 8,
  },
  chaosWatchBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  chaosWatchBtnText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "700",
  },
  chaosRemixBtn: {
    flex: 1,
    borderRadius: 10,
    overflow: "hidden",
  },
  chaosRemixGradient: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  chaosRemixBtnText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "800",
  },
  replayedCard: {
    width: 150,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1.2,
    borderColor: "rgba(255, 255, 255, 0.09)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
  },
  replayedCardGradient: {
    flex: 1,
    borderRadius: 16,
  },
  thumbnailPlaceholder: {
    height: 140,
    backgroundColor: "#1C1C24",
    justifyContent: "center",
    alignItems: "center",
  },
  playIconOverlay: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  replayPill: {
    position: "absolute",
    bottom: 8,
    left: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  replayPillText: {
    color: "#FF3366",
    fontSize: 9,
    fontWeight: "800",
  },
  replayedCardContent: {
    padding: 10,
  },
  replayedQuestion: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 15,
    marginBottom: 8,
    height: 30,
  },
  replayedUserRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  replayedAvatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  replayedUser: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    fontWeight: "600",
    flex: 1,
  },
  confessionCard: {
    width: width * 0.65,
    height: 150,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "rgba(255, 51, 102, 0.06)",
    borderWidth: 1.5,
    borderColor: "rgba(255, 51, 102, 0.35)", // glowing pink border
    shadowColor: "#FF3366",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  confessionCardGradient: {
    flex: 1,
    padding: 14,
    justifyContent: "space-between",
  },
  confessionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  confessionPill: {
    backgroundColor: "rgba(255, 51, 102, 0.2)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 51, 102, 0.4)",
  },
  confessionPillText: {
    color: "#FF3366",
    fontSize: 9,
    fontWeight: "900",
  },
  embarrassmentBadge: {
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  embarrassmentText: {
    color: "#FF3366",
    fontSize: 10,
    fontWeight: "800",
  },
  confessionText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    fontStyle: "italic",
  },
  confessionFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  confessionTags: {
    flexDirection: "row",
    gap: 4,
  },
  confessionTagText: {
    color: "rgba(255, 51, 102, 0.6)",
    fontSize: 10,
    fontWeight: "600",
  },
  confessionCta: {
    color: "#FF3366",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  leaderboardSection: {
    paddingHorizontal: 18,
    marginTop: 28,
  },
  leaderboardContainer: {
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
    paddingVertical: 8,
    marginTop: 8,
  },
  leaderboardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.03)",
  },
  leaderboardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  medalCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  medalText: {
    color: "#000",
    fontSize: 11,
    fontWeight: "900",
  },
  rankNumberText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    fontWeight: "800",
    width: 20,
    textAlign: "center",
    marginRight: 12,
  },
  leaderboardAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 12,
  },
  leaderboardUserMeta: {
    flex: 1,
  },
  leaderboardUsername: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "800",
  },
  leaderboardBadgeText: {
    color: "#00E5FF",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 1,
  },
  leaderboardRight: {
    alignItems: "flex-end",
  },
  leaderboardScoreVal: {
    color: "#FF3366",
    fontSize: 15,
    fontWeight: "900",
  },
  leaderboardScoreLbl: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 8,
    fontWeight: "700",
  },
  footerSpacing: {
    height: 60,
  },
});
