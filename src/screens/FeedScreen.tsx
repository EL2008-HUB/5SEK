import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  View,
  ViewToken,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect } from "@react-navigation/native";
import VideoCard from "../components/VideoCard";
import DuelCard, { DuelFeedItem } from "../components/DuelCard";
import DropBanner from "../components/DropBanner";
import { useAuth } from "../context/AuthContext";
import { answersApi, countryApi, duelsApi } from "../services/api";
import { analytics } from "../services/analytics";
import { isFeatureEnabled } from "../services/featureFlags";
import { eventTracker } from "../services/eventTracker";
import StreakBar from "../components/StreakBar";

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
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [visibleIndex, setVisibleIndex] = useState(0);
  const [userCountry, setUserCountry] = useState("GLOBAL");
  const [loadError, setLoadError] = useState<string | null>(null);

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
      const country = countryApi.getCountry();
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

      if (refresh || !cursor) {
        setItems(mixFeedItems(answerItems, duelItems));
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
        setLoadError("Could not load the feed right now.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [user?.id]);

  useEffect(() => {
    const init = async () => {
      const country = await countryApi.loadCountry();
      setUserCountry(country);
    };

    init();
  }, [fetchFeed]);

  useFocusEffect(
    useCallback(() => {
      setNextCursor(null);
      setHasMore(true);
      setUserCountry(countryApi.getCountry());
      analytics.feedOpen();
      eventTracker.feedOpen();
      eventTracker.newSession();
      fetchFeed(null, true);

      // Flush events when leaving feed
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

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FF3366" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.countryHeader}>
        <Text style={styles.countryHeaderText}>
          {COUNTRY_FLAGS[userCountry] || "🌍"} Feed
        </Text>
      </View>

      {/* 🔥 Live Question Drops */}
      <DropBanner country={userCountry} />

      {/* 🔥 Fusion Loop: Compact streak in feed header */}
      <View style={styles.fusionHeader}>
        <StreakBar compact />
      </View>

      {loadError ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>📡</Text>
          <Text style={styles.emptyText}>Feed unavailable</Text>
          <Text style={styles.emptySubtext}>{loadError}</Text>
          <Text style={styles.retryInline} onPress={() => fetchFeed(null, true)}>
            Retry now
          </Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>🎬</Text>
          <Text style={styles.emptyText}>No answers yet</Text>
          <Text style={styles.emptySubtext}>Be the first to answer.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.feedKey}
          renderItem={({ item, index }) =>
            item.feedType === "duel" ? (
              <DuelCard
                duel={item}
                currentUserId={user?.id || 0}
                isVisible={index === visibleIndex}
                onUpdated={handleDuelUpdated}
              />
            ) : (
              <VideoCard video={item} isVisible={index === visibleIndex} position={index} />
            )
          }
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
          maxToRenderPerBatch={4}
          windowSize={7}
          initialNumToRender={2}
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
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  countryHeader: {
    position: "absolute",
    top: 50,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: "center",
  },
  countryHeaderText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  emptyEmoji: {
    fontSize: 48,
  },
  emptyText: {
    color: "#FFF",
    fontSize: 20,
    fontWeight: "700",
  },
  emptySubtext: {
    color: "#888",
    fontSize: 14,
  },
  retryInline: {
    color: "#FF6B8A",
    fontSize: 14,
    fontWeight: "800",
    marginTop: 10,
  },
  fusionHeader: {
    position: "absolute",
    top: 50,
    right: 12,
    zIndex: 11,
  },
});
