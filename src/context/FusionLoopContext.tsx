/**
 * Fusion Loop Provider — Global state for the engagement super loop
 *
 * Tracks: loop score, streak, badges, next prompts, exit hooks
 * Auto-syncs with backend on mount + after actions
 *
 * Usage:
 *   const { loopState, recordAction, streak, nextPrompt } = useFusionLoop();
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import { fusionApi } from "../services/api";
import { useAuth } from "./AuthContext";

// Safe haptics import
let Haptics: any = null;
try {
  Haptics = require("expo-haptics");
} catch (_) {}

// ── Types ──

interface LoopActions {
  answer: number;
  remix: number;
  comment: number;
  drop: number;
}

interface NextPrompt {
  type: "answer" | "remix" | "comment" | "drop" | "complete";
  text: string;
  cta: string;
  urgency: "high" | "medium" | "low";
}

interface ExitHook {
  streakMessage?: string;
  streakUrgency?: "critical" | "warning";
  loopMessage?: string;
  nextDropMessage?: string;
}

interface FusionBadge {
  text: string;
  timestamp: number;
}

interface RandomReward {
  message: string;
  emoji: string;
}

interface FusionState {
  // Loop
  loopScore: number;
  maxScore: number;
  loopPct: number;
  actions: LoopActions;
  missingActions: string[];
  nearComplete: boolean;

  // Streak
  streakDay: number;
  longestStreak: number;
  streakAtRisk: boolean;

  // Prompts
  nextPrompt: NextPrompt | null;
  exitHook: ExitHook;

  // Micro-dopamine
  lastBadge: FusionBadge | null;
  lastRandomReward: RandomReward | null;
  nearCompleteNudge: string | null;
  totalCompletions: number;

  // Chain reaction
  chainReactionActive: boolean;

  // Meta
  loading: boolean;
  synced: boolean;
}

interface FusionContextType extends FusionState {
  recordAction: (action: "answer" | "remix" | "comment" | "drop") => Promise<void>;
  refreshStatus: () => Promise<void>;
  dismissBadge: () => void;
  dismissReward: () => void;
}

const defaultState: FusionState = {
  loopScore: 0,
  maxScore: 4.5,
  loopPct: 0,
  actions: { answer: 0, remix: 0, comment: 0, drop: 0 },
  missingActions: ["answer", "remix", "comment", "drop"],
  nearComplete: false,
  streakDay: 0,
  longestStreak: 0,
  streakAtRisk: false,
  nextPrompt: {
    type: "answer",
    text: "👀 What would YOU say?",
    cta: "Answer now",
    urgency: "high",
  },
  exitHook: {},
  lastBadge: null,
  lastRandomReward: null,
  nearCompleteNudge: null,
  totalCompletions: 0,
  chainReactionActive: false,
  loading: true,
  synced: false,
};

const FusionContext = createContext<FusionContextType>({
  ...defaultState,
  recordAction: async () => {},
  refreshStatus: async () => {},
  dismissBadge: () => {},
  dismissReward: () => {},
});

export function FusionLoopProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<FusionState>(defaultState);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // ── Fetch full status from backend ──
  const refreshStatus = useCallback(async () => {
    if (!user) {
      setState({ ...defaultState, loading: false });
      return;
    }

    try {
      const res = await fusionApi.getStatus();
      const data = res.data;

      setState((prev) => ({
        ...prev,
        loopScore: data.loop?.score || 0,
        maxScore: data.loop?.maxScore || 4.5,
        loopPct: data.loop?.pct || 0,
        actions: data.loop?.actions || defaultState.actions,
        missingActions: data.loop?.missingActions || [],
        nearComplete: data.loop?.nearComplete || false,
        streakDay: data.streak?.current || 0,
        longestStreak: data.streak?.longest || 0,
        streakAtRisk: data.streak?.isAtRisk || false,
        nextPrompt: data.nextPrompt || defaultState.nextPrompt,
        exitHook: data.exitHook || {},
        totalCompletions: data.totalLoopCompletions || 0,
        chainReactionActive: data.session?.chainReactionActive || false,
        loading: false,
        synced: true,
      }));
    } catch (_) {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [user]);

  // ── Record an action → get instant feedback ──
  const recordAction = useCallback(
    async (action: "answer" | "remix" | "comment" | "drop") => {
      if (!user) return;

      try {
        const res = await fusionApi.recordAction(action);
        const data = res.data;

        // Haptic feedback on badge
        if (data.newBadge) {
          try {
            Haptics?.notificationAsync?.(Haptics.NotificationFeedbackType.Success);
          } catch (_) {}
        }

        // Haptic feedback on reward
        if (data.rewardTrigger) {
          try {
            Haptics?.notificationAsync?.(Haptics.NotificationFeedbackType.Success);
          } catch (_) {}
        }

        setState((prev) => ({
          ...prev,
          loopScore: data.loopScore || prev.loopScore,
          maxScore: data.maxScore || 4.5,
          actions: data.loopState || prev.actions,
          missingActions: Object.entries(data.loopState || {})
            .filter(([, v]) => v === 0)
            .map(([k]) => k),
          streakDay: data.streakDay || prev.streakDay,
          longestStreak: data.longestStreak || prev.longestStreak,
          nextPrompt: data.nextPrompt || prev.nextPrompt,
          lastBadge: data.newBadge
            ? { text: data.newBadge, timestamp: Date.now() }
            : prev.lastBadge,
          lastRandomReward: data.randomReward || prev.lastRandomReward,
          nearCompleteNudge: data.nearCompleteNudge?.message || null,
          totalCompletions: data.rewardTrigger?.completions || prev.totalCompletions,
          chainReactionActive: data.chainReactionActive || false,
          synced: true,
        }));
      } catch (_) {
        // Optimistic local update (count-based)
        setState((prev) => ({
          ...prev,
          actions: {
            ...prev.actions,
            [action]: (prev.actions[action as keyof LoopActions] || 0) + 1,
          },
        }));
      }
    },
    [user]
  );

  const dismissBadge = useCallback(() => {
    setState((prev) => ({ ...prev, lastBadge: null }));
  }, []);

  const dismissReward = useCallback(() => {
    setState((prev) => ({ ...prev, lastRandomReward: null }));
  }, []);

  // ── Auto-sync on mount + app foreground ──
  useEffect(() => {
    refreshStatus();

    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextState === "active"
      ) {
        refreshStatus();
      }
      appStateRef.current = nextState;
    });

    return () => sub.remove();
  }, [refreshStatus]);

  return (
    <FusionContext.Provider
      value={{
        ...state,
        recordAction,
        refreshStatus,
        dismissBadge,
        dismissReward,
      }}
    >
      {children}
    </FusionContext.Provider>
  );
}

export function useFusionLoop() {
  return useContext(FusionContext);
}

export default FusionContext;
