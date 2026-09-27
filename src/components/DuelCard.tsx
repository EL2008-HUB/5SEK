import React, { useEffect, useMemo, useState } from "react";
import {
  Dimensions,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Video, ResizeMode } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { duelsApi, getApiErrorMessage } from "../services/api";
import { analytics } from "../services/analytics";
import { buildDuelShareUrl } from "../services/deepLinks";
import { showAppAlert } from "../utils/alerts";
import { Colors } from "../theme";

let Haptics: any = null;
try {
  Haptics = require("expo-haptics");
} catch (_) {}

const { width, height: windowHeight } = Dimensions.get("window");

function isPlayableMedia(url?: string | null) {
  return Boolean(url) && /^(https?:|file:|content:|data:video)/i.test(String(url));
}

function sideText(url: string | null | undefined, fallback?: string | null, failed = false) {
  if (fallback) return fallback;
  if (failed) return "Video nuk u ngarkua";
  if (url && !isPlayableMedia(url)) return url;
  return "Pergjigje me tekst";
}

function toId(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -1;
}

export interface DuelFeedItem {
  id: number;
  question_id: number;
  question_text: string;
  user_a_id: number;
  user_b_id: number;
  user_a_username?: string;
  user_b_username?: string;
  video_a_url: string | null;
  video_b_url: string | null;
  text_a?: string | null;
  text_b?: string | null;
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
  /** Mount native video players only for nearby cells (perf). */
  mountMedia?: boolean;
  /** Visible height of the card (feed viewport minus tab bar). Defaults to window height. */
  cardHeight?: number;
  onUpdated?: (duel: DuelFeedItem) => void;
}

function DuelCard({
  duel,
  currentUserId,
  isVisible,
  mountMedia = true,
  cardHeight,
  onUpdated,
}: DuelCardProps) {
  const [localDuel, setLocalDuel] = useState<DuelFeedItem>(duel);
  const [submittingVote, setSubmittingVote] = useState(false);
  const [mediaFailed, setMediaFailed] = useState<{ A: boolean; B: boolean }>({ A: false, B: false });

  useEffect(() => {
    setLocalDuel(duel);
    setMediaFailed({ A: false, B: false });
  }, [duel]);

  const resolvedHeight = cardHeight && cardHeight > 0 ? cardHeight : windowHeight;
  const compact = resolvedHeight < 700;
  const mediaHeight = Math.max(180, Math.round(resolvedHeight * (compact ? 0.34 : 0.38)));

  const me = toId(currentUserId);
  const isOwnDuel = me > 0 && (me === toId(localDuel.user_a_id) || me === toId(localDuel.user_b_id));
  const hasVoted = Boolean(localDuel.your_vote);
  const isFinished = localDuel.status === "finished";
  const voteThreshold = localDuel.vote_threshold || 20;
  const canVote =
    !isFinished &&
    Number(localDuel.remaining_seconds ?? 1) > 0 &&
    !isOwnDuel &&
    !hasVoted &&
    !submittingVote;

  const timeRemainingText = useMemo(() => {
    if (isFinished) return "Mbyllur";
    const seconds = Number(localDuel.remaining_seconds || 0);
    if (!seconds) return "Mbyllet se shpejti";
    if (seconds >= 3600) return `${Math.ceil(seconds / 3600)}h`;
    if (seconds >= 60) return `${Math.ceil(seconds / 60)}m`;
    return `${seconds}s`;
  }, [localDuel.remaining_seconds, isFinished]);

  const nameA = localDuel.user_a_username || "userA";
  const nameB = localDuel.user_b_username || "userB";

  const leaderText = useMemo(() => {
    if (isFinished) {
      if (localDuel.winner === "tie") return "Barazim";
      if (localDuel.winner === "A") return `Fitoi @${nameA}`;
      if (localDuel.winner === "B") return `Fitoi @${nameB}`;
      return "Mbaroi";
    }
    if (!localDuel.total_votes) return "Voto dhe vendos fituesin";
    if (localDuel.leader === "tie") return "Barazim 50/50";
    if (localDuel.leader === "A") return `@${nameA} kryeson (${localDuel.pct_a}%)`;
    if (localDuel.leader === "B") return `@${nameB} kryeson (${localDuel.pct_b}%)`;
    return "Voto tani";
  }, [isFinished, localDuel.winner, localDuel.total_votes, localDuel.leader, localDuel.pct_a, localDuel.pct_b, nameA, nameB]);

  const statusText = isFinished
    ? `Fituesi u vendos • ${localDuel.total_votes} vota`
    : `${localDuel.total_votes}/${voteThreshold} vota • ${timeRemainingText}`;

  const updateDuel = (updated: DuelFeedItem) => {
    setLocalDuel(updated);
    onUpdated?.(updated);
  };

  const shareDuel = async () => {
    const url = buildDuelShareUrl(localDuel.id);
    const intro = isOwnDuel
      ? isFinished
        ? "Shiko si mbaroi dueli im ne 5SEK 🏆"
        : "Me ndihmo te fitoj duelin ne 5SEK! Voto per mua ⚔️"
      : isFinished
        ? "Shiko kush fitoi kete duel ne 5SEK 🏆"
        : "Kush e ka me mire? Voto ne 5SEK ⚔️";
    try {
      await Share.share({
        message: `${intro}\n"${localDuel.question_text}"\n@${nameA} vs @${nameB}\n👉 ${url}`,
      });
      analytics.shareOpened("duel", { duel_id: localDuel.id, own: isOwnDuel });
    } catch (_) {}
  };

  const handleVote = async (vote: "A" | "B") => {
    if (isOwnDuel) {
      showAppAlert("Dueli yt", "Nuk mund te votesh ne duelin tend. Shperndaje qe te votojne te tjeret.");
      return;
    }
    if (hasVoted) {
      showAppAlert("Ke votuar", `Vota jote (${localDuel.your_vote}) eshte e ruajtur.`);
      return;
    }
    if (!canVote) return;

    try { Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Medium); } catch (_) {}

    // Optimistic update: the tap feels instant, server result reconciles after.
    const previous = localDuel;
    const optimisticA = Number(previous.votes_a || 0) + (vote === "A" ? 1 : 0);
    const optimisticB = Number(previous.votes_b || 0) + (vote === "B" ? 1 : 0);
    const optimisticTotal = optimisticA + optimisticB;
    const pctA = Math.round((optimisticA / optimisticTotal) * 100);
    updateDuel({
      ...previous,
      votes_a: optimisticA,
      votes_b: optimisticB,
      total_votes: optimisticTotal,
      pct_a: pctA,
      pct_b: 100 - pctA,
      leader: optimisticA === optimisticB ? "tie" : optimisticA > optimisticB ? "A" : "B",
      your_vote: vote,
    });

    try {
      setSubmittingVote(true);
      analytics.duelVote({ duel_id: localDuel.id, vote });
      const response = await duelsApi.vote(localDuel.id, currentUserId, vote);
      const serverDuel = response.data?.duel;
      if (serverDuel) {
        updateDuel({ ...serverDuel, your_vote: response.data?.your_vote || vote });
      }
    } catch (error: any) {
      const serverDuel = error?.response?.data?.duel;
      const serverError = error?.response?.data?.error;
      const serverVote = error?.response?.data?.your_vote;

      if (serverDuel) {
        updateDuel({
          ...serverDuel,
          your_vote: serverError === "already_voted" ? serverVote || previous.your_vote || vote : previous.your_vote ?? null,
        });
      } else {
        updateDuel(previous);
      }

      if (serverError === "already_voted") {
        showAppAlert("Ke votuar", "Ke votuar tashme ne kete duel.");
      } else if (serverError === "cannot_vote_own_duel") {
        showAppAlert("Dueli yt", "Nuk mund te votesh ne duelin tend.");
      } else if (serverError === "duel_finished") {
        showAppAlert("Mbyllur", "Ky duel ka nje fitues.");
      } else if (serverError === "duel_not_found") {
        showAppAlert("Dueli nuk u gjet", "Ky duel nuk ekziston me.");
      } else if (error?.response?.status === 401) {
        showAppAlert("Hyr ne llogari", "Duhet te hysh ne llogari per te votuar.");
      } else if (!error?.response) {
        showAppAlert("Pa lidhje", "Vota nuk u dergua. Provo perseri kur te kesh internet.");
      } else {
        showAppAlert("Votimi deshtoi", getApiErrorMessage(error, "Nuk u ruajt vota."));
      }
    } finally {
      setSubmittingVote(false);
    }
  };

  const renderSide = (side: "A" | "B") => {
    const url = side === "A" ? localDuel.video_a_url : localDuel.video_b_url;
    const text = side === "A" ? localDuel.text_a : localDuel.text_b;
    const name = side === "A" ? nameA : nameB;
    const pct = side === "A" ? localDuel.pct_a : localDuel.pct_b;
    const failed = mediaFailed[side];
    const isMine = localDuel.your_vote === side;
    const isWinner = isFinished && localDuel.winner === side;

    return (
      <TouchableOpacity
        style={[
          styles.videoCard,
          { height: mediaHeight },
          isMine && styles.videoCardVoted,
          isWinner && styles.videoCardWinner,
        ]}
        activeOpacity={canVote ? 0.85 : 1}
        onPress={() => handleVote(side)}
        disabled={!canVote && !isOwnDuel && !hasVoted}
      >
        <View style={[styles.sideBadge, side === "B" && styles.sideBadgeBlue]}>
          <Text style={styles.sideBadgeText}>{side}</Text>
        </View>
        {isWinner ? (
          <View style={styles.winnerBadge}>
            <Ionicons name="trophy" size={12} color="#FFC857" />
            <Text style={styles.winnerBadgeText}>FITUES</Text>
          </View>
        ) : null}
        {isPlayableMedia(url) && !failed ? (
          mountMedia ? (
            <Video
              source={{ uri: String(url) }}
              style={styles.video}
              resizeMode={ResizeMode.COVER}
              shouldPlay={isVisible}
              isLooping
              isMuted
              onError={() => setMediaFailed((prev) => ({ ...prev, [side]: true }))}
            />
          ) : (
            <View style={[styles.video, { backgroundColor: "#050505" }]} />
          )
        ) : (
          <LinearGradient
            colors={side === "A" ? ["#2A1030", "#12081A"] : ["#141A3A", "#0A0C1C"]}
            style={styles.textAnswerWrap}
          >
            <Text style={styles.textAnswerContent} numberOfLines={6}>
              {sideText(url, text, failed)}
            </Text>
          </LinearGradient>
        )}
        <View style={styles.videoMeta}>
          <Text style={styles.username} numberOfLines={1}>@{name}</Text>
          <Text style={styles.percent}>{pct}%</Text>
        </View>
        {isMine ? (
          <View style={styles.votedChip}>
            <Ionicons name="checkmark-circle" size={14} color="#3DFFC8" />
            <Text style={styles.votedChipText}>Vota jote</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { height: resolvedHeight }, compact && styles.containerCompact]}>
      <LinearGradient colors={[...Colors.background.gradient]} style={StyleSheet.absoluteFill} />

      <View style={styles.header}>
        <View style={styles.kickerRow}>
          <Text style={styles.kicker}>{isFinished ? "DUEL • MBYLLUR" : "1v1 LIVE"}</Text>
          <View style={styles.timePill}>
            <Ionicons name="time-outline" size={12} color="#FFF" />
            <Text style={styles.timePillText}>{statusText}</Text>
          </View>
        </View>
        <Text style={[styles.question, compact && styles.questionCompact]} numberOfLines={3}>
          {localDuel.question_text}
        </Text>
      </View>

      <View style={styles.videosRow}>
        {renderSide("A")}
        <View style={styles.vsWrap}>
          <Text style={styles.vsText}>VS</Text>
        </View>
        {renderSide("B")}
      </View>

      <View style={styles.footer}>
        <Text style={styles.resultText} numberOfLines={1}>{leaderText}</Text>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, styles.progressFillA, { width: `${localDuel.pct_a}%` }]} />
          <View style={[styles.progressFill, styles.progressFillB, { width: `${localDuel.pct_b}%` }]} />
        </View>

        {isOwnDuel ? (
          <TouchableOpacity style={styles.shareButton} onPress={shareDuel} activeOpacity={0.85}>
            <LinearGradient colors={Colors.accent.secondaryGradient} style={styles.voteInner}>
              <Ionicons name="share-social" size={18} color="#FFF" />
              <Text style={styles.voteText}>
                {isFinished ? "Shperndaje rezultatin" : "Fto shoket te votojne"}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        ) : hasVoted || isFinished ? (
          <View style={styles.lockedRow}>
            <Ionicons
              name={hasVoted ? "checkmark-circle" : "lock-closed"}
              size={16}
              color={hasVoted ? "#3DFFC8" : "rgba(255,255,255,0.6)"}
            />
            <Text style={styles.lockedText}>
              {hasVoted
                ? `Votove ${localDuel.your_vote} • ${isFinished ? "rezultati final" : "prit rezultatin"}`
                : "Rezultati eshte final"}
            </Text>
            <TouchableOpacity
              style={styles.lockedShare}
              onPress={shareDuel}
              accessibilityRole="button"
              accessibilityLabel="Shperndaje duelin"
            >
              <Ionicons name="share-social" size={14} color="#FFF" />
              <Text style={styles.lockedShareText}>Shperndaj</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.voteButton, submittingVote && styles.voteButtonDisabled]}
              onPress={() => handleVote("A")}
              disabled={!canVote}
              activeOpacity={0.85}
            >
              <LinearGradient colors={Colors.accent.primaryGradient} style={styles.voteInner}>
                <Text style={styles.voteText}>Voto A</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.voteButton, submittingVote && styles.voteButtonDisabled]}
              onPress={() => handleVote("B")}
              disabled={!canVote}
              activeOpacity={0.85}
            >
              <LinearGradient colors={Colors.accent.secondaryGradient} style={styles.voteInner}>
                <Text style={styles.voteText}>Voto B</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width,
    paddingTop: 96,
    paddingHorizontal: 16,
    paddingBottom: 20,
    justifyContent: "space-between",
  },
  containerCompact: {
    paddingTop: 88,
    paddingBottom: 14,
  },
  header: {
    gap: 8,
  },
  kickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  kicker: {
    color: "#FF2D6A",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2,
  },
  timePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  timePillText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontWeight: "800",
  },
  question: {
    color: "#FFF",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 30,
  },
  questionCompact: {
    fontSize: 20,
    lineHeight: 26,
  },
  videosRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  videoCard: {
    flex: 1,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#111",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.1)",
  },
  videoCardVoted: {
    borderColor: "#3DFFC8",
  },
  videoCardWinner: {
    borderColor: "#FFC857",
  },
  video: {
    width: "100%",
    height: "100%",
  },
  sideBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    zIndex: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#FF2D6A",
    alignItems: "center",
    justifyContent: "center",
  },
  sideBadgeBlue: {
    backgroundColor: "#8B5CFF",
  },
  sideBadgeText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "900",
  },
  winnerBadge: {
    position: "absolute",
    top: 12,
    right: 10,
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(255,200,87,0.5)",
  },
  winnerBadgeText: {
    color: "#FFC857",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  videoMeta: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  username: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "800",
  },
  percent: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    fontWeight: "700",
  },
  votedChip: {
    position: "absolute",
    top: 12,
    right: 10,
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(61,255,200,0.5)",
  },
  votedChipText: {
    color: "#3DFFC8",
    fontSize: 10,
    fontWeight: "900",
  },
  vsWrap: {
    width: 34,
    alignItems: "center",
  },
  vsText: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "900",
  },
  footer: {
    gap: 12,
  },
  resultText: {
    color: "#FFF",
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 22,
  },
  progressTrack: {
    flexDirection: "row",
    height: 10,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  progressFill: {
    height: "100%",
  },
  progressFillA: {
    backgroundColor: "#FF2D6A",
  },
  progressFillB: {
    backgroundColor: "#8B5CFF",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  voteButton: {
    flex: 1,
    borderRadius: 18,
    overflow: "hidden",
  },
  shareButton: {
    borderRadius: 18,
    overflow: "hidden",
  },
  voteInner: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  voteButtonDisabled: {
    opacity: 0.55,
  },
  voteText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "900",
  },
  lockedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  lockedText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 13,
    fontWeight: "800",
    flexShrink: 1,
  },
  lockedShare: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: "rgba(139,92,255,0.45)",
  },
  lockedShareText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "800",
  },
  textAnswerWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 14,
  },
  textAnswerContent: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
    textAlign: "center",
  },
});

function areDuelCardPropsEqual(prev: DuelCardProps, next: DuelCardProps) {
  return (
    prev.isVisible === next.isVisible &&
    prev.mountMedia === next.mountMedia &&
    prev.cardHeight === next.cardHeight &&
    prev.currentUserId === next.currentUserId &&
    prev.duel.id === next.duel.id &&
    prev.duel.votes_a === next.duel.votes_a &&
    prev.duel.votes_b === next.duel.votes_b &&
    prev.duel.pct_a === next.duel.pct_a &&
    prev.duel.pct_b === next.duel.pct_b &&
    prev.duel.your_vote === next.duel.your_vote &&
    prev.duel.status === next.duel.status
  );
}

export default React.memo(DuelCard, areDuelCardPropsEqual);
