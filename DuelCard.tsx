import React, { useEffect, useMemo, useState } from "react";
import {
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Video, ResizeMode } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import { duelsApi, getApiErrorMessage } from "../services/api";
import { analytics } from "../services/analytics";
import { showAppAlert } from "../utils/alerts";

const { width, height } = Dimensions.get("window");

export interface DuelFeedItem {
  id: number;
  question_id: number;
  question_text: string;
  user_a_id: number;
  user_b_id: number;
  user_a_username?: string;
  user_b_username?: string;
  video_a_url: string;
  video_b_url: string;
  votes_a: number;
  votes_b: number;
  pct_a: number;
  pct_b: number;
  total_votes: number;
  total_views?: number;
  status: "active" | "finished";
  leader: "A" | "B" | "tie" | null;
  winner: "A" | "B" | "tie" | null;
  your_vote?: "A" | "B" | null;
  created_at: string;
  expires_at?: string | null;
  remaining_seconds?: number | null;
  vote_threshold?: number;
  social_label?: string;
  feed_score?: number;
  is_pattern_break?: boolean;
}

interface DuelCardProps {
  duel: DuelFeedItem;
  currentUserId: number;
  isVisible: boolean;
  onUpdated?: (duel: DuelFeedItem) => void;
}

export default function DuelCard({
  duel,
  currentUserId,
  isVisible,
  onUpdated,
}: DuelCardProps) {
  const [localDuel, setLocalDuel] = useState<DuelFeedItem>(duel);
  const [submittingVote, setSubmittingVote] = useState(false);

  useEffect(() => {
    setLocalDuel(duel);
  }, [duel]);

  const isOwnDuel =
    currentUserId === localDuel.user_a_id || currentUserId === localDuel.user_b_id;
  const hasVoted = Boolean(localDuel.your_vote);
  const voteThreshold = localDuel.vote_threshold || 20;
  const canVote =
    localDuel.status === "active" &&
    Number(localDuel.remaining_seconds ?? 1) > 0 &&
    !isOwnDuel &&
    !hasVoted &&
    !submittingVote;
  const timeRemainingText = useMemo(() => {
    if (localDuel.status === "finished") return "Closed";

    const seconds = Number(localDuel.remaining_seconds || 0);
    if (!seconds) return "Closing soon";

    if (seconds >= 3600) {
      return `${Math.ceil(seconds / 3600)}h left`;
    }

    if (seconds >= 60) {
      return `${Math.ceil(seconds / 60)}m left`;
    }

    return `${seconds}s left`;
  }, [localDuel.remaining_seconds, localDuel.status]);

  const leaderText = useMemo(() => {
    if (localDuel.status === "finished") {
      if (localDuel.winner === "tie") return "Tie game";
      if (localDuel.winner === "A") return `Winner: @${localDuel.user_a_username || "userA"}`;
      if (localDuel.winner === "B") return `Winner: @${localDuel.user_b_username || "userB"}`;
      return "Finished";
    }

    if (localDuel.total_votes === 0) {
      return "Vote to decide the winner";
    }

    if (localDuel.leader === "tie") {
      return "It's tied 50/50";
    }

    if (localDuel.leader === "A") {
      return `@${localDuel.user_a_username || "userA"} is leading (${localDuel.pct_a}%)`;
    }

    if (localDuel.leader === "B") {
      return `@${localDuel.user_b_username || "userB"} is leading (${localDuel.pct_b}%)`;
    }

    return "Vote now";
  }, [localDuel]);

  const statusText = localDuel.status === "finished"
    ? `Winner locked • ${localDuel.total_votes} votes`
    : `${localDuel.total_votes}/${voteThreshold} votes • ${timeRemainingText}`;

  const votePrompt = hasVoted
    ? `Vote locked • ${localDuel.your_vote}`
    : localDuel.status === "finished"
    ? "Results are final"
    : "Vote now";

  const updateDuel = (updated: DuelFeedItem) => {
    setLocalDuel(updated);
    onUpdated?.(updated);
  };

  const handleVote = async (vote: "A" | "B") => {
    if (!canVote) return;

    try {
      setSubmittingVote(true);
      analytics.duelVote({ duel_id: localDuel.id, vote });
      const response = await duelsApi.vote(localDuel.id, currentUserId, vote);
      updateDuel({
        ...response.data.duel,
        your_vote: response.data.your_vote,
      });
    } catch (error: any) {
      const serverDuel = error?.response?.data?.duel;
      const serverError = error?.response?.data?.error;
      if (serverDuel) {
        updateDuel({
          ...serverDuel,
          your_vote: serverError === "already_voted" ? localDuel.your_vote || vote : localDuel.your_vote,
        });
      }

      if (serverError === "already_voted") {
        showAppAlert("Already voted", "You already voted in this duel.");
      } else if (serverError === "cannot_vote_own_duel") {
        showAppAlert("Your duel", "You cannot vote on your own duel.");
      } else if (serverError === "duel_finished") {
        showAppAlert("Finished", "This duel already has a winner.");
      } else {
        showAppAlert("Vote failed", getApiErrorMessage(error, "Could not submit your vote."));
      }
    } finally {
      setSubmittingVote(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#050505", "#111827", "#050505"]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.header}>
        <Text style={styles.kicker}>DUEL</Text>
        <Text style={styles.question} numberOfLines={3}>
          {localDuel.question_text}
        </Text>
        <Text style={styles.subtext}>{statusText}</Text>
      </View>

      <View style={styles.videosRow}>
        <View style={styles.videoCard}>
          <View style={styles.sideBadge}>
            <Text style={styles.sideBadgeText}>A</Text>
          </View>
          {localDuel.video_a_url ? (
            <Video
              source={{ uri: localDuel.video_a_url }}
              style={styles.video}
              resizeMode={ResizeMode.COVER}
              shouldPlay={isVisible}
              isLooping
              isMuted
            />
          ) : (
            <View style={styles.textAnswerWrap}>
              <Text style={styles.textAnswerContent} numberOfLines={6}>
                {(localDuel as any).text_a || "Text answer"}
              </Text>
            </View>
          )}
          <View style={styles.videoMeta}>
            <Text style={styles.username}>@{localDuel.user_a_username || "userA"}</Text>
            <Text style={styles.percent}>{localDuel.pct_a}%</Text>
          </View>
        </View>

        <View style={styles.vsWrap}>
          <Text style={styles.vsText}>VS</Text>
        </View>

        <View style={styles.videoCard}>
          <View style={[styles.sideBadge, styles.sideBadgeBlue]}>
            <Text style={styles.sideBadgeText}>B</Text>
          </View>
          {localDuel.video_b_url ? (
            <Video
              source={{ uri: localDuel.video_b_url }}
              style={styles.video}
              resizeMode={ResizeMode.COVER}
              shouldPlay={isVisible}
              isLooping
              isMuted
            />
          ) : (
            <View style={styles.textAnswerWrap}>
              <Text style={styles.textAnswerContent} numberOfLines={6}>
                {(localDuel as any).text_b || "Text answer"}
              </Text>
            </View>
          )}
          <View style={styles.videoMeta}>
            <Text style={styles.username}>@{localDuel.user_b_username || "userB"}</Text>
            <Text style={styles.percent}>{localDuel.pct_b}%</Text>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.resultText}>{leaderText}</Text>
        <Text style={styles.votePrompt}>{votePrompt}</Text>
        {localDuel.social_label ? (
          <Text style={styles.helperText}>{localDuel.social_label}</Text>
        ) : null}

        <View style={styles.progressRow}>
          <View style={styles.progressCol}>
            <Text style={styles.progressLabel}>A</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, styles.progressFillA, { width: `${localDuel.pct_a}%` }]} />
            </View>
          </View>
          <View style={styles.progressCol}>
            <Text style={styles.progressLabel}>B</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, styles.progressFillB, { width: `${localDuel.pct_b}%` }]} />
            </View>
          </View>
        </View>

        {isOwnDuel && localDuel.status === "active" && (
          <Text style={styles.helperText}>Your duel is live. Others can vote from the feed.</Text>
        )}

        {!isOwnDuel && hasVoted && localDuel.status === "active" && (
          <Text style={styles.helperText}>Vote locked. Come back when the duel finishes.</Text>
        )}

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[
              styles.voteButton,
              styles.voteButtonA,
              (!canVote || localDuel.your_vote === "A") && styles.voteButtonDisabled,
            ]}
            onPress={() => handleVote("A")}
            disabled={!canVote}
          >
            <Text style={styles.voteText}>
              {localDuel.your_vote === "A" ? "Voted A" : "Vote A"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.voteButton,
              styles.voteButtonB,
              (!canVote || localDuel.your_vote === "B") && styles.voteButtonDisabled,
            ]}
            onPress={() => handleVote("B")}
            disabled={!canVote}
          >
            <Text style={styles.voteText}>
              {localDuel.your_vote === "B" ? "Voted B" : "Vote B"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width,
    height,
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 48,
    justifyContent: "space-between",
  },
  header: {
    gap: 8,
  },
  kicker: {
    color: "#FF8A65",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2,
  },
  question: {
    color: "#FFF",
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 34,
  },
  subtext: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 13,
    fontWeight: "700",
  },
  videosRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  videoCard: {
    flex: 1,
    height: height * 0.42,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  video: {
    width: "100%",
    height: "100%",
  },
  sideBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    zIndex: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#E53935",
    alignItems: "center",
    justifyContent: "center",
  },
  sideBadgeBlue: {
    backgroundColor: "#1E88E5",
  },
  sideBadgeText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "900",
  },
  videoMeta: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  username: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "800",
  },
  percent: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    fontWeight: "700",
  },
  vsWrap: {
    width: 42,
    alignItems: "center",
  },
  vsText: {
    color: "#FFF",
    fontSize: 20,
    fontWeight: "900",
  },
  footer: {
    gap: 12,
  },
  resultText: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24,
  },
  votePrompt: {
    color: "#FFCF8B",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  helperText: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  progressRow: {
    gap: 10,
  },
  progressCol: {
    gap: 6,
  },
  progressLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  progressFillA: {
    backgroundColor: "#D32F2F",
  },
  progressFillB: {
    backgroundColor: "#1976D2",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  voteButton: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
  },
  voteButtonA: {
    backgroundColor: "#D32F2F",
  },
  voteButtonB: {
    backgroundColor: "#1976D2",
  },
  voteButtonDisabled: {
    opacity: 0.45,
  },
  voteText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "900",
  },
  textAnswerWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  textAnswerContent: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
    textAlign: "center",
  },
});
