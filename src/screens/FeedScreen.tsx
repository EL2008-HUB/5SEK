import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewToken,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import VideoCard from "../components/VideoCard";
import DuelCard, { DuelFeedItem } from "../components/DuelCard";
import DropBanner from "../components/DropBanner";
import StatePanel from "../components/StatePanel";
import { useAuth } from "../context/AuthContext";
import { answersApi, countryApi, duelsApi } from "../services/api";
import { analytics } from "../services/analytics";
import { isFeatureEnabled } from "../services/featureFlags";
import { eventTracker } from "../services/eventTracker";
import { loadFeedCache, saveFeedCache } from "../services/feedCache";
import StreakBar from "../components/StreakBar";
import { GlobalStyles } from "../theme";
// 🔥 MICRO-UPGRADE 3: Haptic feedback
let Haptics: any = null;
try {
  Haptics = require("expo-haptics");
} catch (_) {}

const { height } = Dimensions.get("window");

const COUNTRY_FLAGS: Record<string, string> = {
  AL: "🇦🇱",
  US: "🇺🇸",
  DE: "🇩🇪",
  XK: "🇽🇰",
  UK: "🇬🇧",
  TR: "🇹🇷",
  IT: "🇮🇹",
  GLOBAL: "🌍",
};

interface AnswerFeedItem {
  feedType: "answer";
  feedKey: string;
  id: number;
  answer_type?: "video" | "audio" | "text" | "reaction";
  video_url: string | null;
  text_content?: string | null;
  username: string;
  user_id: number;
  question_text: string;
  question_id: number;
  question_country?: string;
  user_country?: string;
  response_time: number | null;
  created_at: string;
  likes?: number;
  shares?: number;
  views?: number;
  category?: string;
  feed_score?: number;
  feed_bucket?: "funny" | "awkward" | "fast" | "provocative";
  hook_label?: string;
  social_label?: string;
  is_trending?: boolean;
  social_proof?: {
    badge?: string;
    label?: string;
    today_answers?: number;
    recent_answers?: number;
    hourly_answers?: number;
  };
  is_remix?: boolean;
  chain_depth?: number;
  parent_answer_id?: number | null;
}

interface DuelFeedCardItem extends DuelFeedItem {
  feedType: "duel";
  feedKey: string;
}

type FeedItem = AnswerFeedItem | DuelFeedCardItem;
const ANSWERS_PER_PAGE = 20;
const DUELS_PER_PAGE = 5;
const DUEL_INJECTION_INTERVAL = 5;

function asAnswerItems(rows: Omit<AnswerFeedItem, "feedType" | "feedKey">[]): AnswerFeedItem[] {
  return rows.map((row) => ({
    ...row,
    feedType: "answer",
    feedKey: `answer-${row.id}`,
  }));
}

function asDuelItems(rows: DuelFeedItem[]): DuelFeedCardItem[] {
  return rows.map((row) => ({
    ...row,
    feedType: "duel",
    feedKey: `duel-${row.id}`,
  }));
}

function mixFeedItems(answerItems: AnswerFeedItem[], duelItems: DuelFeedCardItem[]) {
  if (!answerItems.length) return duelItems;
  if (!duelItems.length) return answerItems;

  const mixed: FeedItem[] = [];
  let duelIndex = 0;
  let answersSinceBreak = 0;

  answerItems.forEach((item, index) => {
    mixed.push(item);
    answersSinceBreak += 1;

    const hasMoreAnswers = index < answerItems.length - 1;
    if (hasMoreAnswers && duelIndex < duelItems.length && answersSinceBreak >= DUEL_INJECTION_INTERVAL) {
      mixed.push(duelItems[duelIndex]);
      duelIndex += 1;
      answersSinceBreak = 0;
    }
  });

  while (duelIndex < duelItems.length) {
    mixed.push(duelItems[duelIndex]);
    duelIndex += 1;
  }

  return mixed;
}

export default function FeedScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const [feedMode, setFeedMode] = useState<"local" | "global">("local");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [visibleIndex, setVisibleIndex] = useState(0);
  const [userCountry, setUserCountry] = useState("GLOBAL");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [servingCached, setServingCached] = useState(false);
  const lastFetchAtRef = useRef(0);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        const nextIndex = viewableItems[0].index || 0;
        setVisibleIndex(nextIndex);
        analytics.feedSwipe({ index: nextIndex });

        // 🔥 MICRO-UPGRADE 3: Haptic feedback on swipe
        if (Haptics && nextIndex > 0) {
          try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_) {}
        }

        // Track swipe in event pipeline
        const visibleItem = viewableItems[0].item;
        if (visibleItem?.feedType === "answer" && visibleItem?.id) {
          eventTracker.swipe(visibleItem.id);
        }
      }
    }
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
  }).current;

  const fetchFeed = useCallback(async (cursor: string | null = null, refresh = false) => {
    try {
      const country = feedMode === "local" ? countryApi.getCountry() : "GLOBAL";
      const duelsEnabled = isFeatureEnabled("duels_v1");
      setLoadError(null);

      if (cursor) {
        setLoadingMore(true);
      }

      const [answersResponse, duelsResponse] = await Promise.all([
        answersApi.getFeed(cursor, ANSWERS_PER_PAGE, country),
        duelsEnabled ? duelsApi.getFeed(1, DUELS_PER_PAGE, user?.id, "active") : Promise.resolve({ data: [] }),
      ]);

      // Handle cursor-based response
      const responseData = answersResponse.data;
      const answerRows = responseData.items || responseData;
      const serverCursor = responseData.nextCursor || null;
      const serverHasMore = responseData.hasMore !== undefined ? responseData.hasMore : answerRows.length >= ANSWERS_PER_PAGE;

      const answerItems = asAnswerItems(answerRows);
      const duelItems = asDuelItems(duelsResponse.data);

      setNextCursor(serverCursor);
      setHasMore(serverHasMore);
      setServingCached(false);
      lastFetchAtRef.current = Date.now();

      if (refresh || !cursor) {
        const mixed = mixFeedItems(answerItems, duelItems);
        setItems(mixed);
        await saveFeedCache(feedMode, country, mixed);
      } else {
        setItems((prev) => {
          const seen = new Set(prev.map((item) => item.feedKey));
          const nextAnswers = answerItems.filter((item) => !seen.has(item.feedKey));
          const nextDuels = duelItems.filter((item) => !seen.has(item.feedKey));
          return [...prev, ...mixFeedItems(nextAnswers, nextDuels)];
        });
      }
    } catch (error) {
      console.log("Error fetching feed:", error);
      if (!cursor) {
        const country = feedMode === "local" ? countryApi.getCountry() : "GLOBAL";
        const cached = await loadFeedCache(feedMode, country);
        if (cached?.items?.length) {
          setItems(cached.items as FeedItem[]);
          setServingCached(true);
          setLoadError(null);
          setHasMore(false);
          setNextCursor(null);
        } else {
          setLoadError("Could not load the feed right now.");
          setServingCached(false);
        }
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [user?.id, feedMode]);

  useEffect(() => {
    const init = async () => {
      const country = await countryApi.loadCountry();
      setUserCountry(country);
    };

    init();
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setNextCursor(null);
      setHasMore(true);
      setServingCached(false);

      const country = feedMode === "local" ? countryApi.getCountry() : "GLOBAL";
      const cached = await loadFeedCache(feedMode, country);
      if (!cancelled && cached?.items?.length) {
        setItems(cached.items as FeedItem[]);
        setServingCached(true);
        setLoading(false);
      } else if (!cancelled) {
        setLoading(true);
      }

      if (!cancelled) {
        await fetchFeed(null, true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [feedMode, fetchFeed]);

  useFocusEffect(
    useCallback(() => {
      setUserCountry(countryApi.getCountry());
      analytics.feedOpen();
      eventTracker.feedOpen();
      eventTracker.newSession();

      const stale = Date.now() - lastFetchAtRef.current > 45_000;
      if (stale) {
        setNextCursor(null);
        setHasMore(true);
        fetchFeed(null, true);
      }

      return () => {
        eventTracker.feedClose();
      };
    }, [fetchFeed])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setNextCursor(null);
    setHasMore(true);
    eventTracker.newSession();
    fetchFeed(null, true);
  }, [fetchFeed]);

  const onEndReached = useCallback(() => {
    if (loadingMore || refreshing || loading || !hasMore || !nextCursor) return;
    fetchFeed(nextCursor);
  }, [fetchFeed, loading, loadingMore, hasMore, nextCursor, refreshing]);

  const handleDuelUpdated = useCallback((updatedDuel: DuelFeedItem) => {
    setItems((prev) =>
      prev.map((item) =>
        item.feedType === "duel" && item.id === updatedDuel.id
          ? {
              ...updatedDuel,
              feedType: "duel",
              feedKey: `duel-${updatedDuel.id}`,
            }
          : item
      )
    );
  }, []);

  if (loading && items.length === 0) {
    return (
      <View style={styles.container}>
        <StatePanel variant="loading" message="Loading feed…" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.countryHeader}>
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[styles.toggleButton, feedMode === "local" && styles.toggleButtonActive]}
            onPress={() => setFeedMode("local")}
            activeOpacity={0.8}
          >
            <Text style={[styles.toggleText, feedMode === "local" && styles.toggleTextActive]}>
              {COUNTRY_FLAGS[userCountry] || "🇦🇱"} LOKAL
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, feedMode === "global" && styles.toggleButtonActive]}
            onPress={() => setFeedMode("global")}
            activeOpacity={0.8}
          >
            <Text style={[styles.toggleText, feedMode === "global" && styles.toggleTextActive]}>
              🌍 GLOBAL
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 🔥 Live Question Drops */}
      <DropBanner country={userCountry} />

      {/* 🔥 Fusion Loop: Compact streak in feed header */}
      <View style={styles.fusionHeader}>
        <StreakBar compact />
      </View>

      {servingCached ? (
        <View style={styles.offlineBanner} pointerEvents="box-none">
          <Text style={styles.offlineBannerText}>Offline · showing saved feed</Text>
          <TouchableOpacity onPress={() => fetchFeed(null, true)} hitSlop={8}>
            <Text style={styles.offlineBannerAction}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {loadError ? (
        <StatePanel
          variant="error"
          title="Feed unavailable"
          message={loadError}
          primaryLabel="Try again"
          onPrimaryPress={() => fetchFeed(null, true)}
        />
      ) : items.length === 0 ? (
        <StatePanel
          variant="empty"
          title="No answers yet"
          message="Be the first to answer today's question in 5 seconds."
          primaryLabel="Record my answer"
          onPrimaryPress={() => navigation.navigate("Record")}
          secondaryLabel="Refresh"
          onSecondaryPress={onRefresh}
        />
      ) : (
        <FlatList
          data={items}
          extraData={visibleIndex}
          keyExtractor={(item) => item.feedKey}
          renderItem={({ item, index }) => {
            const mountMedia = Math.abs(index - visibleIndex) <= 1;
            return item.feedType === "duel" ? (
              <DuelCard
                duel={item}
                currentUserId={user?.id || 0}
                isVisible={index === visibleIndex}
                mountMedia={mountMedia}
                onUpdated={handleDuelUpdated}
              />
            ) : (
              <VideoCard
                video={item}
                isVisible={index === visibleIndex}
                mountMedia={mountMedia}
                position={index}
              />
            );
          }}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={height}
          snapToAlignment="start"
          decelerationRate="fast"
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          refreshing={refreshing}
          onRefresh={onRefresh}
          removeClippedSubviews
          maxToRenderPerBatch={2}
          windowSize={5}
          initialNumToRender={1}
          updateCellsBatchingPeriod={50}
          getItemLayout={(_, index) => ({
            length: height,
            offset: height * index,
            index,
          })}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: GlobalStyles.container,
  countryHeader: {
    position: "absolute",
    top: 50,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleContainer: {
    flexDirection: "row",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 20,
    padding: 3,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
  },
  toggleButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 17,
  },
  toggleButtonActive: {
    backgroundColor: "#FF3366",
    shadowColor: "#FF3366",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 3,
  },
  toggleText: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  toggleTextActive: {
    color: "#FFF",
    fontWeight: "800",
  },
  fusionHeader: {
    position: "absolute",
    top: 50,
    right: 12,
    zIndex: 11,
  },
  offlineBanner: {
    position: "absolute",
    top: 96,
    alignSelf: "center",
    zIndex: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(10,10,14,0.82)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  offlineBannerText: {
    color: "rgba(229,240,248,0.72)",
    fontSize: 12,
    fontWeight: "700",
  },
  offlineBannerAction: {
    color: "#FF6B8A",
    fontSize: 12,
    fontWeight: "900",
  },
});
