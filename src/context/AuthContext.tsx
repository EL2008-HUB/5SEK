import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { authApi, countryApi, experimentsApi, setSessionPersistence, setToken } from "../services/api";
import { analytics } from "../services/analytics";
import { setObservabilityUser } from "../services/observability";
import { storage } from "../services/storage";

const STORAGE_KEYS = {
  token: "@5sek_auth_token",
  refreshToken: "@5sek_refresh_token",
  user: "@5sek_auth_user",
  firstSessionComplete: "@5sek_first_session_complete",
};

type AuthUser = {
  id: number;
  username: string;
  email: string;
  country: string;
  age_group?: string | null;
  interests?: string[] | null;
  role?: string;
  is_premium?: boolean;
  subscription_status?: string | null;
  premium_expires_at?: string | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  bootstrapError: string | null;
  isGuest: boolean;
  needsFirstSession: boolean;
  retryBootstrap: () => Promise<void>;
  refreshUser: () => Promise<AuthUser | null>;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (payload: {
    username: string;
    email: string;
    password: string;
    country?: string;
  }) => Promise<AuthUser>;
  logout: () => Promise<void>;
  updateProfile: (data: { age_group?: string; interests?: string[]; country?: string }) => Promise<AuthUser>;
  completeFirstSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function normalizeUser(raw: any): AuthUser {
  return {
    id: Number(raw.id),
    username: raw.username,
    email: raw.email,
    country: raw.country || "GLOBAL",
    age_group: raw.age_group || null,
    interests: Array.isArray(raw.interests) ? raw.interests : null,
    role: raw.role || "user",
    is_premium: Boolean(raw.is_premium),
    subscription_status: raw.subscription_status || null,
    premium_expires_at: raw.premium_expires_at || null,
  };
}

async function persistSession(token: string, refreshToken: string | null, user: AuthUser) {
  setToken(token, refreshToken);
  await Promise.all([
    storage.setItem(STORAGE_KEYS.token, token),
    refreshToken
      ? storage.setItem(STORAGE_KEYS.refreshToken, refreshToken)
      : storage.removeItem(STORAGE_KEYS.refreshToken),
    storage.setItem(STORAGE_KEYS.user, JSON.stringify(user)),
  ]);
}

async function clearPersistedSession() {
  setToken(null, null);
  experimentsApi.resetAssignments();
  await Promise.all([
    storage.removeItem(STORAGE_KEYS.token),
    storage.removeItem(STORAGE_KEYS.refreshToken),
    storage.removeItem(STORAGE_KEYS.user),
  ]);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [needsFirstSession, setNeedsFirstSession] = useState(false);
  const isGuest = user?.role === "guest";

  const firstSessionKey = (nextUser: AuthUser) =>
    `${STORAGE_KEYS.firstSessionComplete}:${nextUser.id}`;

  const syncFirstSessionState = async (nextUser: AuthUser) => {
    const completed = await storage.getItem(firstSessionKey(nextUser));
    setNeedsFirstSession(completed !== "1");
  };

  const syncAssignments = async () => {
    try {
      await experimentsApi.getMyAssignments();
    } catch (_) {
      experimentsApi.resetAssignments();
    }
  };

  const refreshUser = async () => {
    const response = await authApi.me();
    const nextUser = normalizeUser(response.data);
    setUser(nextUser);
    await syncFirstSessionState(nextUser);
    await countryApi.setCountry(nextUser.country || "GLOBAL");
    await storage.setItem(STORAGE_KEYS.user, JSON.stringify(nextUser));
    if (nextUser.id) {
      await syncAssignments();
    }
    return nextUser;
  };

  const applySession = async (payload: any) => {
    const nextUser = normalizeUser(payload.user);
    await persistSession(payload.token, payload.refresh_token, nextUser);
    await countryApi.setCountry(nextUser.country || "GLOBAL");
    setUser(nextUser);
    await syncFirstSessionState(nextUser);
    await syncAssignments();
    return nextUser;
  };

  const bootstrapAuth = async () => {
    setLoading(true);
    setBootstrapError(null);
    const country = await countryApi.loadCountry();

    try {
      const storedToken = await storage.getItem(STORAGE_KEYS.token);
      const storedRefreshToken = await storage.getItem(STORAGE_KEYS.refreshToken);
      if (!storedToken) {
        setUser(null);
        setNeedsFirstSession(false);
        experimentsApi.resetAssignments();
        return;
      }

      setToken(storedToken, storedRefreshToken);
      try {
        await refreshUser();
        return;
      } catch (_) {
        if (storedRefreshToken) {
          try {
            const sessionResponse = await authApi.refresh(storedRefreshToken);
            const nextUser = normalizeUser(sessionResponse.data.user);
            await persistSession(
              sessionResponse.data.token,
              sessionResponse.data.refresh_token,
              nextUser
            );
            await countryApi.setCountry(nextUser.country || country);
            setUser(nextUser);
            await syncFirstSessionState(nextUser);
            await syncAssignments();
            return;
          } catch (_) {}
        }

        await clearPersistedSession();
        setUser(null);
        setNeedsFirstSession(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    setBootstrapError(null);
    const response = await authApi.login(email, password);
    return applySession(response.data);
  };

  const register = async ({
    username,
    email,
    password,
    country,
  }: {
    username: string;
    email: string;
    password: string;
    country?: string;
  }) => {
    setBootstrapError(null);
    const response = await authApi.register(username, email, password, country);
    return applySession(response.data);
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (_) {}
    await clearPersistedSession();
    setUser(null);
    setNeedsFirstSession(false);
  };

  useEffect(() => {
    setSessionPersistence(async ({ token, refreshToken }) => {
      if (!token) {
        await clearPersistedSession();
        setUser(null);
        return;
      }

      await Promise.all([
        storage.setItem(STORAGE_KEYS.token, token),
        refreshToken
          ? storage.setItem(STORAGE_KEYS.refreshToken, refreshToken)
          : storage.removeItem(STORAGE_KEYS.refreshToken),
      ]);
    });

    bootstrapAuth().catch((error) => {
      console.log("Auth bootstrap failed:", error);
      setBootstrapError("Session recovery failed. Retry to continue.");
      analytics.sessionRecoveryFailed({
        message: error?.message || "bootstrap_failed",
      });
      setLoading(false);
    });

    return () => {
      setSessionPersistence(null);
    };
  }, []);

  useEffect(() => {
    setObservabilityUser(user ? { id: user.id, username: user.username, email: user.email } : null);
  }, [user]);

  const updateProfile = async (data: { age_group?: string; interests?: string[]; country?: string }) => {
    const response = await authApi.updateProfile(data);
    const nextUser = normalizeUser(response.data.user);
    setUser(nextUser);
    await storage.setItem(STORAGE_KEYS.user, JSON.stringify(nextUser));
    if (nextUser.country) {
      await countryApi.setCountry(nextUser.country);
    }
    return nextUser;
  };

  const completeFirstSession = async () => {
    if (user) {
      await storage.setItem(firstSessionKey(user), "1");
    }
    setNeedsFirstSession(false);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      bootstrapError,
      isGuest,
      needsFirstSession,
      retryBootstrap: bootstrapAuth,
      refreshUser,
      login,
      register,
      logout,
      updateProfile,
      completeFirstSession,
    }),
    [bootstrapError, isGuest, loading, needsFirstSession, user]
  );

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#6C5CE7" />
      </View>
    );
  }

  if (bootstrapError) {
    return (
      <View style={styles.errorWrap}>
        <Text style={styles.errorTitle}>Session recovery failed</Text>
        <Text style={styles.errorBody}>{bootstrapError}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={bootstrapAuth}>
          <Text style={styles.retryButtonText}>Retry bootstrap</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}

const styles = StyleSheet.create({
  loadingWrap: {
    flex: 1,
    backgroundColor: "#0F0F1A",
    alignItems: "center",
    justifyContent: "center",
  },
  errorWrap: {
    flex: 1,
    backgroundColor: "#0F0F1A",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  errorTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 10,
  },
  errorBody: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  retryButton: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "#FF3366",
  },
  retryButtonText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "800",
  },
});
