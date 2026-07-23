import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Animated,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { API_BASE_URL, questionsApi, countryApi } from "../services/api";
import { analytics } from "../services/analytics";
import DropBanner from "../components/DropBanner";
import StreakBar from "../components/StreakBar";
import FloatingPrompt from "../components/FloatingPrompt";
import StatePanel from "../components/StatePanel";
import PushOptInBanner from "../components/PushOptInBanner";
import { loadDailyQuestionCache, saveDailyQuestionCache } from "../services/questionCache";
import { Colors, GlobalStyles, Shadows } from "../theme";

/** Focused home: one question + one CTA + feed link (reduces attention competition). */
const COMPACT_HOME = false;

// Country display info
const COUNTRY_FLAGS: Record<string, { flag: string; name: string }> = {
  AL: { flag: "🇦🇱", name: "Shqipëri" },
  US: { flag: "🇺🇸", name: "USA" },
  DE: { flag: "🇩🇪", name: "Deutschland" },
  XK: { flag: "🇽🇰", name: "Kosovë" },
  UK: { flag: "🇬🇧", name: "UK" },
  TR: { flag: "🇹🇷", name: "Türkiye" },
  IT: { flag: "🇮🇹", name: "Italia" },
  GLOBAL: { flag: "🌍", name: "Global" },
};

interface Question {
  id: number;
  text: string;
  country?: string;
  is_hot?: boolean;
  created_at: string;
  trending_badge?: string | null;
  user_country?: string;
  social_proof?: {
    total_answers_today?: number;
    recent_answers?: number;
    hourly_answers?: number;
    recent_label?: string;
    avg_response_time?: string | null;
    velocity_label?: string | null;
  };
}

interface DiscoveryQuestion {
  id: number;
  text: string;
  live_stats?: {
    label?: string;
  };
}

interface LearnedPattern {
  id: number;
  type: string;
  value: string;
}

export default function HomeScreen({ navigation }: any) {
  const { user } = useAuth();
  const [question, setQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiOffline, setApiOffline] = useState(false);
  const [servingCached, setServingCached] = useState(false);
  const [userCountry, setUserCountry] = useState("GLOBAL");
  const lastFetchAtRef = useRef(0);
  const [trendingBadge, setTrendingBadge] = useState<string | null>(null);
  const [isHot, setIsHot] = useState(false);
  const [hotQuestions, setHotQuestions] = useState<DiscoveryQuestion[]>([]);
  const [personalizedQuestions, setPersonalizedQuestions] = useState<DiscoveryQuestion[]>([]);
  const [patterns, setPatterns] = useState<LearnedPattern[]>([]);

  // Animated values
  const [trendingPulse] = useState(new Animated.Value(1));
  const [hotGlow] = useState(new Animated.Value(0));
  const [fomoFade] = useState(new Animated.Value(0));

  /* ---------- Ambient Glow Animations ---------- */
  const breatheAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
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
  }, [breatheAnim]);

  const glowScale1 = breatheAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.25],
  });

  const glowScale2 = breatheAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1.2, 0.95],
  });

  const goRecord = (params?: any) => {
    const q = params?.question;
    const flatParams = {
      questionId: q?.id,
      questionText: q?.text,
      mode: params?.mode,
    };
    analytics.answerStart("home", {
      question_id: q?.id || null,
      mode: params?.mode || "video",
    });
    if (typeof navigation.jumpTo === "function") {
      navigation.jumpTo("Record", flatParams);
      return;
    }
    navigation.navigate("Record", flatParams);
  };

  const goFeed = () => {
    if (typeof navigation.jumpTo === "function") {
      navigation.jumpTo("Feed");
      return;
    }
    navigation.navigate("Feed");
  };

  // Trending pulse animation
  useEffect(() => {
    if (trendingBadge) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(trendingPulse, {
            toValue: 1.05,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(trendingPulse, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [trendingBadge]);

  // Hot glow animation
  useEffect(() => {
    if (isHot) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(hotGlow, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(hotGlow, {
            toValue: 0.3,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [isHot]);

  // FOMO fade-in
  useEffect(() => {
    if (question) {
      Animated.timing(fomoFade, {
        toValue: 1,
        duration: 600,
        delay: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [question]);

  const fetchDaily = async (opts?: { soft?: boolean }) => {
    const soft = Boolean(opts?.soft);
    if (!soft) {
      setLoading(true);
    }
    setApiOffline(false);

    const country = await countryApi.loadCountry();
    setUserCountry(country);

    // Instant hydrate from cache while network loads.
    if (!question) {
      const cached = await loadDailyQuestionCache(country);
      if (cached?.question) {
        setQuestion(cached.question as Question);
        setTrendingBadge(cached.trendingBadge ?? null);
        setIsHot(Boolean(cached.isHot));
        setServingCached(true);
        setLoading(false);
      }
    }

    try {
      const res = await questionsApi.getDaily(country);
      setQuestion(res.data);
      setTrendingBadge(res.data?.trending_badge ?? null);
      setIsHot(res.data?.is_hot ?? false);
      setServingCached(false);
      lastFetchAtRef.current = Date.now();

      await saveDailyQuestionCache(country, {
        question: res.data,
        trendingBadge: res.data?.trending_badge ?? null,
        isHot: res.data?.is_hot ?? false,
      });

      if (res.data?.user_country && res.data.user_country !== country) {
        setUserCountry(res.data.user_country);
      }

      const [hotRes, personalizedRes, patternsRes] = await Promise.all([
        questionsApi.getHot(country).catch(() => ({ data: { questions: [] } })),
        questionsApi.getPersonalized({
          country,
          age_group: user?.age_group || undefined,
          interests: user?.interests?.join(","),
        }).catch(() => ({ data: [] })),
        questionsApi.getPatterns(country).catch(() => ({ data: { patterns: [] } })),
      ]);

      const personalizedRows = Array.isArray(personalizedRes.data)
        ? personalizedRes.data
        : personalizedRes.data?.questions || [];

      setHotQuestions((hotRes.data?.questions || []).filter((item: DiscoveryQuestion) => item.id !== res.data?.id).slice(0, 3));
      setPersonalizedQuestions(personalizedRows.filter((item: DiscoveryQuestion) => item.id !== res.data?.id).slice(0, 3));
      setPatterns((patternsRes.data?.patterns || []).slice(0, 3));
    } catch (error) {
      console.log("Error fetching daily question:", error);
      try {
        const res = await questionsApi.getRandom(country);
        setQuestion(res.data);
        setTrendingBadge(null);
        setIsHot(false);
        setHotQuestions([]);
        setPersonalizedQuestions([]);
        setPatterns([]);
        setServingCached(false);
        lastFetchAtRef.current = Date.now();
        await saveDailyQuestionCache(country, {
          question: res.data,
          trendingBadge: null,
          isHot: false,
        });
      } catch (e2) {
        console.log("Error fetching random question:", e2);
        const cached = await loadDailyQuestionCache(country);
        if (cached?.question) {
          setQuestion(cached.question as Question);
          setTrendingBadge(cached.trendingBadge ?? null);
          setIsHot(Boolean(cached.isHot));
          setServingCached(true);
          setApiOffline(false);
        } else {
          setQuestion(null);
          setApiOffline(true);
          setServingCached(false);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Re-fetch on focus, but skip if we fetched recently (avoids thrash).
  useEffect(() => {
    fetchDaily();

    const unsubscribe = navigation.addListener("focus", () => {
      const stale = Date.now() - lastFetchAtRef.current > 45_000;
      if (stale) {
        fetchDaily({ soft: true });
      }
    });

    return unsubscribe;
  }, [navigation, user?.age_group, user?.interests]);

  const countryInfo = COUNTRY_FLAGS[userCountry] || COUNTRY_FLAGS.GLOBAL;
  const questionCountryInfo =
    COUNTRY_FLAGS[question?.country || "GLOBAL"] || COUNTRY_FLAGS.GLOBAL;

  const socialProof = question?.social_proof;
  const totalAnswers = socialProof?.total_answers_today ?? 0;
  const fomoLabel = socialProof?.recent_label || "";
  const velocityLabel = socialProof?.velocity_label;
  const avgTime = socialProof?.avg_response_time;

  return (
    <LinearGradient
      colors={Colors.background.gradient}
      style={[GlobalStyles.container, { paddingTop: 50 }]}
    >
      <StatusBar style="light" />

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

      {!COMPACT_HOME ? (
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.countryBadge}
            onPress={() => navigation.navigate("Profile")}
            activeOpacity={0.7}
          >
            <Text style={styles.countryFlag}>{countryInfo.flag}</Text>
            <Text style={styles.countryName}>{countryInfo.name}</Text>
            <Ionicons name="chevron-down" size={14} color="rgba(255,255,255,0.5)" />
          </TouchableOpacity>
        </View>
      ) : null}

      {!COMPACT_HOME ? <DropBanner country={userCountry} /> : null}
      {!COMPACT_HOME ? <StreakBar /> : null}
      {!COMPACT_HOME ? <PushOptInBanner compact /> : null}
      {servingCached ? (
        <View style={styles.cachedBanner}>
          <Text style={styles.cachedBannerText}>Offline · showing saved question</Text>
          <TouchableOpacity onPress={() => fetchDaily()} hitSlop={8}>
            <Text style={styles.cachedBannerAction}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.content}>
        {loading && !question ? (
          <StatePanel variant="loading" message="Loading today's question…" />
        ) : apiOffline ? (
          <StatePanel
            variant="error"
            title="Can't reach the server"
            message={
              __DEV__
                ? `Trying ${API_BASE_URL}. Start the API, then retry.`
                : "Check your connection and try again."
            }
            primaryLabel="Try again"
            onPrimaryPress={fetchDaily}
          />
        ) : question ? (
          <>
            {!COMPACT_HOME && isHot && (
              <Animated.View style={[styles.hotBadge, { opacity: hotGlow }]}>
                <Text style={styles.hotBadgeText}>🔥🔥 BLOWING UP RIGHT NOW</Text>
              </Animated.View>
            )}

            {!COMPACT_HOME && trendingBadge && !isHot && (
              <Animated.View
                style={[
                  styles.trendingBadge,
                  { transform: [{ scale: trendingPulse }] },
                ]}
              >
                <Text style={styles.trendingText}>{trendingBadge}</Text>
              </Animated.View>
            )}

            <View style={styles.titleRow}>
              <Text style={styles.todayTitle}>
                {questionCountryInfo.flag} Today's Question
              </Text>
              {question.country && question.country !== "GLOBAL" && (
                <View style={styles.questionCountryTag}>
                  <Text style={styles.questionCountryTagText}>
                    {questionCountryInfo.name}
                  </Text>
                </View>
              )}
            </View>

            <View style={[styles.questionCard, isHot && styles.questionCardHot]}>
              <Text style={styles.questionText}>"{question.text}"</Text>
            </View>

            {!COMPACT_HOME ? (
            <Animated.View style={[styles.fomoSection, { opacity: fomoFade }]}>
              <Text style={styles.fomoMainLabel}>{fomoLabel}</Text>

              {velocityLabel && (
                <View style={styles.velocityBadge}>
                  <Text style={styles.velocityText}>{velocityLabel}</Text>
                </View>
              )}

              {avgTime && (
                <Text style={styles.avgTimeLabel}>
                  ⏱️ Avg response: {avgTime}s — can you beat it?
                </Text>
              )}

              <Text style={styles.answerCount}>
                👥 {totalAnswers} people answered today
              </Text>
            </Animated.View>
            ) : totalAnswers > 0 ? (
              <Text style={styles.compactSocialProof}>
                👥 {totalAnswers} answered today
              </Text>
            ) : null}

            <TouchableOpacity
              style={styles.answerButton}
              activeOpacity={0.85}
              onPress={() => goRecord({ question })}
            >
              <LinearGradient
                colors={isHot ? Colors.accent.dangerGradient : Colors.accent.primaryGradient}
                style={styles.answerButtonGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Ionicons name="flash" size={22} color="#FFF" />
                <Text style={styles.answerButtonText}>
                  {COMPACT_HOME ? "⚡ Answer Now" : isHot ? "🔥 Answer NOW" : "⚡ Answer in 5 seconds"}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            {!COMPACT_HOME ? (
            <View style={styles.softEntryRow}>
              <TouchableOpacity
                style={styles.softEntryPill}
                onPress={() => goRecord({ question, mode: "text" })}
              >
                <Text style={styles.softEntryPillText}>😅 Text</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.softEntryPill}
                onPress={() => goRecord({ question, mode: "audio" })}
              >
                <Text style={styles.softEntryPillText}>🎙️ Audio</Text>
              </TouchableOpacity>
            </View>
            ) : null}

            <TouchableOpacity
              style={styles.scrollCta}
              onPress={goFeed}
            >
              <Text style={styles.scrollCtaText}>
                {COMPACT_HOME ? "▶ Watch answers in feed" : "⬇ Scroll to watch answers"}
              </Text>
            </TouchableOpacity>

            {!COMPACT_HOME && (hotQuestions.length > 0 || personalizedQuestions.length > 0 || patterns.length > 0) && (
              <View style={styles.discoverySection}>
                {personalizedQuestions.length > 0 && (
                  <View style={styles.discoveryBlock}>
                    <Text style={styles.discoveryTitle}>For your vibe</Text>
                    {personalizedQuestions.map((item) => (
                      <TouchableOpacity
                        key={`personalized-${item.id}`}
                        style={styles.discoveryCard}
                        onPress={() => goRecord({ question: item })}
                      >
                        <Text style={styles.discoveryCardText} numberOfLines={2}>
                          {item.text}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {hotQuestions.length > 0 && (
                  <View style={styles.discoveryBlock}>
                    <Text style={styles.discoveryTitle}>Hot right now</Text>
                    {hotQuestions.map((item) => (
                      <TouchableOpacity
                        key={`hot-${item.id}`}
                        style={styles.discoveryCard}
                        onPress={() => goRecord({ question: item })}
                      >
                        <Text style={styles.discoveryCardText} numberOfLines={2}>
                          {item.text}
                        </Text>
                        {item.live_stats?.label ? (
                          <Text style={styles.discoveryMeta}>{item.live_stats.label}</Text>
                        ) : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {patterns.length > 0 && (
                  <View style={styles.discoveryBlock}>
                    <Text style={styles.discoveryTitle}>What works here</Text>
                    <View style={styles.patternRow}>
                      {patterns.map((pattern) => (
                        <View key={`pattern-${pattern.id}`} style={styles.patternChip}>
                          <Text style={styles.patternChipText}>
                            {pattern.type}: {pattern.value}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            )}
          </>
        ) : (
          <StatePanel
            variant="empty"
            title="No questions available"
            message="Check back soon — a new daily question drops every day."
            primaryLabel="Open feed"
            onPrimaryPress={goFeed}
            secondaryLabel="Retry"
            onSecondaryPress={fetchDaily}
          />
        )}
      </View>

      {!COMPACT_HOME ? (
      <FloatingPrompt
        onPress={(type) => {
          if (type === 'answer') navigation.navigate('Record');
          else if (type === 'remix') navigation.navigate('Feed');
          else if (type === 'comment') navigation.navigate('Feed');
          else if (type === 'drop') { /* DropBanner handles this */ }
        }}
      />
      ) : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 50,
    overflow: "hidden",
  },
  ambientOrb1: GlobalStyles.ambientOrbTop,
  ambientOrb2: GlobalStyles.ambientOrbBottom,
  topBar: {
    flexDirection: "row",
    justifyContent: "center",
    paddingHorizontal: 22,
    marginBottom: 8,
  },
  countryBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255, 51, 102, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(255, 51, 102, 0.25)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  countryFlag: {
    fontSize: 16,
  },
  countryName: {
    color: "#FF6B8A",
    fontSize: 13,
    fontWeight: "800",
  },
  content: {
    flex: 1,
    paddingHorizontal: 22,
  },
  cachedBanner: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
    backgroundColor: "rgba(10,10,14,0.82)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  cachedBannerText: {
    color: "rgba(229,240,248,0.72)",
    fontSize: 12,
    fontWeight: "700",
  },
  cachedBannerAction: {
    color: "#FF6B8A",
    fontSize: 12,
    fontWeight: "900",
  },
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  // ── HOT badge ────────────────────────────────
  hotBadge: {
    alignSelf: "center",
    backgroundColor: "rgba(255, 69, 0, 0.15)",
    borderWidth: 1.5,
    borderColor: "rgba(255, 69, 0, 0.5)",
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    marginBottom: 12,
  },
  hotBadgeText: {
    color: "#FF4500",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1,
  },

  // ── Trending badge ───────────────────────────
  trendingBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255, 165, 0, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 165, 0, 0.3)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 12,
  },
  trendingText: {
    color: "#FFA500",
    fontSize: 12,
    fontWeight: "800",
  },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  todayTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  questionCountryTag: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  questionCountryTagText: {
    color: Colors.text.tertiary,
    fontSize: 11,
    fontWeight: "700",
  },
  questionCard: {
    ...GlobalStyles.glassCard,
    padding: 24,
    borderWidth: 1.5,
    borderColor: "rgba(0, 229, 255, 0.3)", // neon cyan border
    shadowColor: "#00E5FF",
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  questionCardHot: {
    borderColor: "#FF3366", // neon hot pink/red
    backgroundColor: "rgba(255, 51, 102, 0.05)",
    shadowColor: "#FF3366",
    shadowOpacity: 0.35,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 12 },
  },
  questionText: {
    color: "#FFF",
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 38,
    textAlign: "center",
    textShadowColor: "rgba(255,255,255,0.15)",
    textShadowRadius: 10,
    letterSpacing: -0.5,
  },

  // ── FOMO section ─────────────────────────────
  fomoSection: {
    marginTop: 14,
    marginBottom: 18,
    gap: 6,
  },
  fomoMainLabel: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "800",
  },
  velocityBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255, 69, 0, 0.1)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  velocityText: {
    color: "#FF6B00",
    fontSize: 12,
    fontWeight: "800",
  },
  avgTimeLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    fontWeight: "700",
  },
  answerCount: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontWeight: "600",
  },
  compactSocialProof: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },

  errorText: {
    color: "#666",
    fontSize: 16,
  },
  offlineTitle: {
    color: "#FFF",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 10,
    textAlign: "center",
  },
  offlineBody: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "left",
    paddingHorizontal: 10,
  },
  offlineMono: {
    color: "#FFD166",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", web: "monospace" }) as any,
    fontSize: 12,
    fontWeight: "700",
  },
  retryBtn: {
    marginTop: 16,
    backgroundColor: "rgba(255, 51, 102, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(255, 51, 102, 0.35)",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
  },
  retryText: {
    color: "#FFF",
    fontWeight: "900",
  },
  answerButton: {
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 14,
    ...Shadows.glowPrimary,
  },
  answerButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
  },
  answerButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  softEntryRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 18,
  },
  softEntryPill: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    paddingVertical: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  softEntryPillText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontWeight: "800",
  },
  scrollCta: {
    marginTop: "auto",
    paddingVertical: 18,
    alignItems: "center",
  },
  scrollCtaText: {
    color: "#FF3366",
    fontSize: 14,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    textShadowColor: "rgba(255, 51, 102, 0.2)",
    textShadowRadius: 6,
  },
  discoverySection: {
    marginTop: 6,
    marginBottom: 28,
    gap: 18,
  },
  discoveryBlock: {
    gap: 10,
  },
  discoveryTitle: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "800",
  },
  discoveryCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  discoveryCardText: {
    color: "#F6F8FF",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  discoveryMeta: {
    color: "#7FE7FF",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
  patternRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  patternChip: {
    backgroundColor: "rgba(124, 77, 255, 0.12)", // neon violet overlay
    borderColor: "rgba(124, 77, 255, 0.25)",
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  patternChipText: {
    color: "#D1C4E9",
    fontSize: 12,
    fontWeight: "800",
  },
});
