import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Video, ResizeMode } from "expo-av";
import { answersApi } from "../services/api";
import { eventTracker } from "../services/eventTracker";

const { width, height } = Dimensions.get("window");

interface ChainItem {
  id: number;
  parent_answer_id: number | null;
  depth: number;
  user_id: number;
  username: string;
  video_url: string | null;
  answer_type: string;
  text_content: string | null;
  question_text: string;
  created_at: string;
  likes: number;
  views: number;
  is_remix: boolean;
}

interface RemixChainViewProps {
  answerId: number;
  onClose: () => void;
  onRemix?: (parentAnswerId: number) => void;
}

export default function RemixChainView({ answerId, onClose, onRemix }: RemixChainViewProps) {
  const [chain, setChain] = useState<ChainItem[]>([]);
  const [root, setRoot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    loadChain();
  }, [answerId]);

  const loadChain = async () => {
    try {
      const res = await answersApi.getChain(answerId);
      setRoot(res.data.root);
      setChain(res.data.chain || []);
    } catch (_) {
    } finally {
      setLoading(false);
    }
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setActiveIndex(viewableItems[0].index || 0);
    }
  }).current;

  const renderChainItem = ({ item, index }: { item: ChainItem; index: number }) => {
    const isActive = index === activeIndex;

    return (
      <View style={styles.chainItem}>
        {/* Video */}
        <View style={styles.videoContainer}>
          {item.video_url ? (
            <Video
              source={{ uri: item.video_url }}
              style={styles.video}
              resizeMode={ResizeMode.COVER}
              shouldPlay={isActive}
              isLooping
              isMuted={!isActive}
            />
          ) : (
            <LinearGradient
              colors={["#1D2340", "#32195E"]}
              style={styles.textPlaceholder}
            >
              <Text style={styles.textContent}>{item.text_content || ""}</Text>
            </LinearGradient>
          )}

          {/* Depth indicator */}
          <View style={styles.depthBadge}>
            <Text style={styles.depthText}>
              {item.depth === 0 ? "ORIGINAL" : `REMIX #${item.depth}`}
            </Text>
          </View>

          {/* User info */}
          <View style={styles.userInfo}>
            <View style={styles.userAvatar}>
              <Text style={styles.avatarText}>
                {(item.username || "?").charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.username}>@{item.username}</Text>
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Ionicons name="heart" size={14} color="#FF3366" />
              <Text style={styles.statText}>{item.likes}</Text>
            </View>
            <View style={styles.statItem}>
              <Ionicons name="eye" size={14} color="#AAA" />
              <Text style={styles.statText}>{item.views}</Text>
            </View>
          </View>
        </View>

        {/* Chain connector */}
        {index < chain.length - 1 && (
          <View style={styles.connector}>
            <View style={styles.connectorLine} />
            <Ionicons name="arrow-down" size={16} color="#B388FF" />
            <View style={styles.connectorLine} />
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FF3366" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={28} color="#FFF" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Ionicons name="git-compare-outline" size={20} color="#00E5FF" />
          <Text style={styles.headerTitle}>Remix Chain</Text>
          <View style={styles.chainCountBadge}>
            <Text style={styles.chainCountText}>{chain.length}</Text>
          </View>
        </View>

        {onRemix && (
          <TouchableOpacity
            style={styles.remixCta}
            onPress={() => onRemix(chain[chain.length - 1]?.id || answerId)}
          >
            <Text style={styles.remixCtaText}>+ Remix</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Chain list — vertical scroll */}
      <FlatList
        ref={flatListRef}
        data={chain}
        renderItem={renderChainItem}
        keyExtractor={(item) => String(item.id)}
        showsVerticalScrollIndicator={false}
        snapToInterval={height * 0.6}
        decelerationRate="fast"
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        contentContainerStyle={styles.listContent}
      />

      {/* Social proof footer + 🔥 UPGRADE 1: Challenge Mode */}
      {chain.length > 1 && (
        <View style={styles.socialFooter}>
          <Text style={styles.socialFooterText}>
            {chain.length - 1} {chain.length - 1 === 1 ? "person" : "people"} remixed this 👀
          </Text>

          {onRemix && (
            <TouchableOpacity
              style={styles.challengeButton}
              onPress={() => onRemix(chain[chain.length - 1]?.id || answerId)}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={["#FF1744", "#FF6D00"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.challengeGradient}
              >
                <Ionicons name="flame" size={18} color="#FFF" />
                <Text style={styles.challengeText}>Can you beat this answer? 🔥</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0A0F",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0A0A0F",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  headerCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "800",
  },
  chainCountBadge: {
    backgroundColor: "rgba(0, 229, 255, 0.2)",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(0, 229, 255, 0.3)",
  },
  chainCountText: {
    color: "#00E5FF",
    fontSize: 13,
    fontWeight: "800",
  },
  remixCta: {
    backgroundColor: "#00E5FF",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  remixCtaText: {
    color: "#000",
    fontWeight: "800",
    fontSize: 13,
  },
  listContent: {
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  chainItem: {
    alignItems: "center",
  },
  videoContainer: {
    width: width - 32,
    height: height * 0.5,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#111",
  },
  video: {
    width: "100%",
    height: "100%",
  },
  textPlaceholder: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  textContent: {
    color: "#FFF",
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
  },
  depthBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    backgroundColor: "rgba(0, 229, 255, 0.2)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(0, 229, 255, 0.3)",
  },
  depthText: {
    color: "#00E5FF",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  userInfo: {
    position: "absolute",
    bottom: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#FF3366",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  avatarText: {
    color: "#FFF",
    fontWeight: "800",
    fontSize: 14,
  },
  username: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 14,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  statsRow: {
    position: "absolute",
    bottom: 12,
    right: 12,
    flexDirection: "row",
    gap: 12,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "700",
  },
  connector: {
    alignItems: "center",
    paddingVertical: 8,
    gap: 2,
  },
  connectorLine: {
    width: 2,
    height: 12,
    backgroundColor: "rgba(179, 136, 255, 0.3)",
  },
  socialFooter: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
  },
  socialFooterText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontWeight: "700",
  },
  challengeButton: {
    marginTop: 12,
    borderRadius: 20,
    overflow: "hidden",
    width: "100%",
  },
  challengeGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 20,
  },
  challengeText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "800",
  },
});
