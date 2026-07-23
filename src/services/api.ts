import axios, { type AxiosRequestConfig } from "axios";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { API_VERSION, CONTRACT_NAME } from "../contracts/api";
import { setFeatureAssignments } from "./featureFlags";
import { storage } from "./storage";

type ApiRequestConfig = AxiosRequestConfig & {
  suppressConnectivityWarning?: boolean;
  _retry?: boolean;
};

function inferLanHostFromExpo(): string | null {
  const hostUri =
    (Constants as any)?.expoConfig?.hostUri ||
    (Constants as any)?.manifest2?.extra?.expoClient?.hostUri ||
    (Constants as any)?.manifest?.debuggerHost;

  if (!hostUri || typeof hostUri !== "string") return null;

  const host = hostUri.split(":")[0];
  if (!host || host === "localhost" || host === "127.0.0.1") return null;

  return host;
}

function rewriteLoopbackUrlForDevice(url: string): string {
  const normalized = String(url || "").trim();
  if (!normalized) return normalized;

  if (Platform.OS === "web") {
    return normalized;
  }

  try {
    const parsed = new URL(normalized);
    const hostname = parsed.hostname;
    const isLoopback =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0";

    if (!isLoopback) {
      return normalized;
    }

    const lan = inferLanHostFromExpo();
    if (lan) {
      parsed.hostname = lan;
      return parsed.toString().replace(/\/$/, "");
    }

    if (Platform.OS === "android") {
      parsed.hostname = "10.0.2.2";
      return parsed.toString().replace(/\/$/, "");
    }

    return normalized;
  } catch (_) {
    return normalized;
  }
}

function getApiBaseUrl(): string {
  const configured =
    (Constants as any)?.expoConfig?.extra?.apiUrl ||
    (Constants as any)?.manifest2?.extra?.expoClient?.extra?.apiUrl ||
    null;
  if (configured) return rewriteLoopbackUrlForDevice(String(configured)).replace(/\/$/, "");

  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return rewriteLoopbackUrlForDevice(explicit).replace(/\/$/, "");

  if (Platform.OS === "web") {
    return "http://localhost:3000/api";
  }

  if (Platform.OS === "android") {
    const lan = inferLanHostFromExpo();
    if (lan) return `http://${lan}:3000/api`;
    return "http://10.0.2.2:3000/api";
  }

  const lan = inferLanHostFromExpo();
  if (lan) return `http://${lan}:3000/api`;
  return "http://localhost:3000/api";
}

export const API_BASE_URL = getApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
    "X-Client-Contract": CONTRACT_NAME,
    "X-Client-Version": API_VERSION,
  },
});

const refreshApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
    "X-Client-Contract": CONTRACT_NAME,
    "X-Client-Version": API_VERSION,
  },
});

if (__DEV__) {
  console.log("[api] baseURL =", API_BASE_URL);
}

const COUNTRY_STORAGE_KEY = "@5sek_user_country";
let _userCountry = "GLOBAL";
type NetworkStatus = "online" | "degraded";
const networkListeners = new Set<(status: NetworkStatus) => void>();
let currentNetworkStatus: NetworkStatus = "online";

function emitNetworkStatus(status: NetworkStatus) {
  currentNetworkStatus = status;
  networkListeners.forEach((listener) => listener(status));
}

export function subscribeNetworkStatus(listener: (status: NetworkStatus) => void) {
  networkListeners.add(listener);
  listener(currentNetworkStatus);
  return () => {
    networkListeners.delete(listener);
  };
}

export async function probeApiHealth(): Promise<NetworkStatus> {
  try {
    await api.get("/meta/contract", { timeout: 6000 });
    emitNetworkStatus("online");
    return "online";
  } catch (_) {
    emitNetworkStatus("degraded");
    return "degraded";
  }
}

export function getCurrentApiBaseUrl() {
  return api.defaults.baseURL || API_BASE_URL;
}

export const countryApi = {
  getCountry: () => _userCountry,

  setCountry: async (country: string) => {
    _userCountry = country.toUpperCase();
    api.defaults.headers.common["X-User-Country"] = _userCountry;
    try {
      await storage.setItem(COUNTRY_STORAGE_KEY, _userCountry);
    } catch (_) {}
  },

  loadCountry: async (): Promise<string> => {
    try {
      const stored = await storage.getItem(COUNTRY_STORAGE_KEY);
      if (stored) {
        _userCountry = stored;
        api.defaults.headers.common["X-User-Country"] = _userCountry;
      }
    } catch (_) {}

    return _userCountry;
  },

  getSupportedCountries: () => api.get("/ai/countries"),
};

let authToken: string | null = null;
let refreshToken: string | null = null;
let refreshRequest: Promise<string | null> | null = null;
let onSessionUpdated:
  | ((payload: { token: string | null; refreshToken: string | null }) => Promise<void> | void)
  | null = null;

export const setSessionPersistence = (
  handler:
    | ((payload: { token: string | null; refreshToken: string | null }) => Promise<void> | void)
    | null
) => {
  onSessionUpdated = handler;
};

export const setToken = (token: string | null, nextRefreshToken?: string | null) => {
  authToken = token;
  if (nextRefreshToken !== undefined) {
    refreshToken = nextRefreshToken;
  }

  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    refreshApi.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
    delete refreshApi.defaults.headers.common.Authorization;
  }
};

async function persistSessionUpdate(token: string | null, nextRefreshToken: string | null) {
  setToken(token, nextRefreshToken);
  if (onSessionUpdated) {
    await onSessionUpdated({ token, refreshToken: nextRefreshToken });
  }
}

api.interceptors.response.use(
  (response) => {
    emitNetworkStatus("online");
    return response;
  },
  async (error) => {
    const originalRequest = error?.config;
    const status = error?.response?.status;
    const suppressConnectivityWarning = Boolean(
      (originalRequest as ApiRequestConfig | undefined)?.suppressConnectivityWarning
    );

    if (!error?.response && !suppressConnectivityWarning) {
      emitNetworkStatus("degraded");
    }

    if (status !== 401 || !refreshToken || !originalRequest || originalRequest._retry) {
      throw error;
    }

    if (!refreshRequest) {
      refreshRequest = refreshApi
        .post("/auth/refresh", { refresh_token: refreshToken })
        .then(async (response) => {
          const nextToken = response.data?.token || null;
          const nextRefreshToken = response.data?.refresh_token || null;
          await persistSessionUpdate(nextToken, nextRefreshToken);
          emitNetworkStatus("online");
          return nextToken;
        })
        .catch(async (refreshError) => {
          await persistSessionUpdate(null, null);
          emitNetworkStatus("degraded");
          throw refreshError;
        })
        .finally(() => {
          refreshRequest = null;
        });
    }

    const nextToken = await refreshRequest;
    if (!nextToken) {
      throw error;
    }

    originalRequest._retry = true;
    originalRequest.headers = originalRequest.headers || {};
    originalRequest.headers.Authorization = `Bearer ${nextToken}`;
    return api(originalRequest);
  }
);

export const authApi = {
  register: (username: string, email: string, password: string, country?: string) =>
    api.post("/auth/register", {
      username,
      email,
      password,
      country: country || _userCountry,
    }),

  login: (email: string, password: string) =>
    api.post("/auth/login", { email, password }),

  refresh: (token: string) =>
    refreshApi.post("/auth/refresh", { refresh_token: token }),

  logout: (token?: string | null) =>
    api.post("/auth/logout", { refresh_token: token || refreshToken }),

  me: () => api.get("/auth/me"),

  updateCountry: (country: string) =>
    api.put("/auth/country", { country }),

  updateProfile: (data: { age_group?: string; interests?: string[]; country?: string }) =>
    api.put("/auth/profile", data),

  logoutAll: () => api.post("/auth/logout-all"),
};

export const questionsApi = {
  getRandom: (country?: string) =>
    api.get("/questions", { params: { country: country || _userCountry } }),

  getDaily: (country?: string) =>
    api.get("/questions/daily", { params: { country: country || _userCountry } }),

  getAll: (country?: string) =>
    api.get("/questions/all", { params: { country: country || _userCountry } }),

  getHot: (country?: string) =>
    api.get("/questions/hot", { params: { country: country || _userCountry } }),

  getPersonalized: (opts?: { age_group?: string; interests?: string; country?: string }) =>
    api.get("/questions/personalized", {
      params: {
        country: opts?.country || _userCountry,
        age_group: opts?.age_group,
        interests: opts?.interests,
      },
    }),

  getPatterns: (country?: string) =>
    api.get("/questions/patterns", { params: { country: country || _userCountry } }),

  getTrending: (country?: string) =>
    api.get(`/questions/trending/${country || _userCountry}`),

  getStats: (country?: string) =>
    api.get("/questions/stats", { params: { country: country || _userCountry } }),

  likeQuestion: (questionId: number) =>
    api.post(`/questions/${questionId}/like`, { country: _userCountry }),

  shareQuestion: (questionId: number) =>
    api.post(`/questions/${questionId}/share`, { country: _userCountry }),
};

function inferUploadMimeType(
  mediaUri: string,
  answerType: "video" | "audio" = "video"
): string {
  const normalized = mediaUri.toLowerCase().split("?")[0];

  if (answerType === "audio") {
    if (normalized.endsWith(".mp3")) return "audio/mpeg";
    if (normalized.endsWith(".wav")) return "audio/wav";
    if (normalized.endsWith(".aac")) return "audio/aac";
    return "audio/m4a";
  }

  if (normalized.endsWith(".webm")) return "video/webm";
  if (normalized.endsWith(".mov")) return "video/quicktime";
  return "video/mp4";
}

function inferUploadName(
  mediaUri: string,
  answerType: "video" | "audio" = "video"
): string {
  const normalized = mediaUri.split("?")[0];
  const tail = normalized.split("/").pop();
  if (tail && tail.includes(".")) return tail;
  return answerType === "audio" ? "answer.m4a" : "answer.mp4";
}

async function appendMediaField(
  form: FormData,
  fieldName: string,
  mediaUri: string,
  answerType: "video" | "audio" = "video"
) {
  const mimeType = inferUploadMimeType(mediaUri, answerType);
  const filename = inferUploadName(mediaUri, answerType);

  if (Platform.OS === "web" && mediaUri.startsWith("blob:")) {
    const blob = await fetch(mediaUri).then((response) => response.blob());
    const file = new File([blob], filename, {
      type: blob.type || mimeType,
    });
    form.append(fieldName, file);
    return;
  }

  form.append(
    fieldName,
    {
      uri: mediaUri,
      name: filename,
      type: mimeType,
    } as any
  );
}

async function uploadMediaDirect(
  mediaUri: string,
  answerType: "video" | "audio" = "video"
) {
  try {
    const signatureResponse = await api.get("/uploads/signature");
    const payload = signatureResponse.data;

    if (!payload?.cloud_name || !payload?.signature) {
      return null;
    }

    const form = new FormData();
    await appendMediaField(form, "file", mediaUri, answerType);

    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        form.append(key, String(value));
      }
    });

    const resourceType = payload.resource_type || "video";
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${payload.cloud_name}/${resourceType}/upload`,
      {
        method: "POST",
        body: form,
      }
    );

    if (!response.ok) {
      throw new Error(`direct upload failed with status ${response.status}`);
    }

    const uploaded = await response.json();
    return uploaded?.secure_url || uploaded?.url || null;
  } catch (error: any) {
    if (error?.response?.status !== 503) {
      console.log("Direct upload unavailable, using backend fallback:", error?.message || error);
    }
    return null;
  }
}

export const answersApi = {
  create: (
    user_id: number,
    question_id: number,
    video_url: string | null,
    response_time?: number,
    options?: {
      answer_type?: "video" | "audio" | "text" | "reaction";
      text_content?: string | null;
    }
  ) =>
    api.post("/answers", {
      question_id,
      video_url,
      response_time,
      answer_type: options?.answer_type,
      text_content: options?.text_content,
      country: _userCountry,
    }),

  upload: async (
    user_id: number,
    question_id: number,
    videoUri: string,
    response_time?: number,
    options?: {
      answer_type?: "video" | "audio";
    }
  ) => {
    const answerType = options?.answer_type || "video";
    const directUrl = await uploadMediaDirect(videoUri, answerType);

    if (directUrl) {
      return api.post("/answers", {
        question_id,
        video_url: directUrl,
        response_time,
        answer_type: answerType,
        country: _userCountry,
      });
    }

    const form = new FormData();
    form.append("question_id", String(question_id));

    if (response_time !== undefined && response_time !== null) {
      form.append("response_time", String(response_time));
    }

    if (answerType) {
      form.append("answer_type", answerType);
    }

    await appendMediaField(form, "video", videoUri, answerType);

    return api.post("/answers/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120000,
    });
  },

  getFeed: (cursor?: string | null, limit = 20, country?: string) =>
    api.get("/answers", {
      params: {
        cursor: cursor || undefined,
        limit,
        country: country || _userCountry,
        experiment_variant: currentExperiments.feed_ranker_v2 || "control",
      },
    }),

  getByUser: (userId: number) =>
    api.get(`/answers/user/${userId}`),

  getDailyUsage: (userId: number) =>
    api.get(`/answers/daily-usage/${userId}`),

  likeAnswer: (answerId: number) =>
    api.post(`/answers/${answerId}/like`, { country: _userCountry }),

  shareAnswer: (answerId: number) =>
    api.post(`/answers/${answerId}/share`, { country: _userCountry }),

  // FIX 5: Deep link — fetch single answer by ID
  getById: (answerId: number) =>
    api.get(`/answers/${answerId}`),

  // FIX 5: Generate shareable deep link URL
  getShareUrl: (answerId: number) =>
    `https://app.5sek.local/answer/${answerId}`,

  trackAnalytics: (
      answerId: number,
      payload: {
      event_type: "watch_progress" | "skipped" | "completed" | "replayed";
      watch_time: number;
      session_id?: string;
      metadata?: Record<string, any>;
    }
  ) => api.post(`/answers/${answerId}/analytics`, payload),

  // ── REMIX CHAIN ──

  // Create a remix of an answer
  createRemix: (
    parentAnswerId: number,
    payload: {
      video_url: string;
      answer_type?: "video" | "audio" | "text";
      text_content?: string | null;
      response_time?: number;
    }
  ) => api.post(`/answers/${parentAnswerId}/remix`, {
    ...payload,
    country: _userCountry,
  }),

  uploadRemix: async (
    parentAnswerId: number,
    mediaUri: string,
    response_time?: number,
    options?: { answer_type?: "video" | "audio" }
  ) => {
    const answerType = options?.answer_type || "video";
    const directUrl = await uploadMediaDirect(mediaUri, answerType);
    return answersApi.createRemix(parentAnswerId, {
      video_url: directUrl || mediaUri,
      answer_type: answerType,
      response_time,
    });
  },

  // Get full remix chain for an answer
  getChain: (answerId: number) =>
    api.get(`/answers/${answerId}/chain`),

  // Get remix count + can-remix status
  getRemixInfo: (answerId: number) =>
    api.get(`/answers/${answerId}/remixes`),
};

// ── Drops API (Live Question Drops) ──

export const dropsApi = {
  // Get currently active drop
  getActive: (country?: string) =>
    api.get("/drops/active", { params: { country: country || _userCountry } }),

  // Get next upcoming drop (for countdown)
  getNext: (country?: string) =>
    api.get("/drops/next", { params: { country: country || _userCountry } }),

  // Join an active drop
  join: (questionId: number) =>
    api.post(`/drops/${questionId}/join`),

  // Leave a drop
  leave: (questionId: number) =>
    api.post(`/drops/${questionId}/leave`),

  // Get drop replay — see answers from completed drop
  getReplay: (questionId: number) =>
    api.get(`/drops/${questionId}/replay`),
};

// ── Share API (Viral Growth) ──

export const shareApi = {
  // Get share data + overlay config for an answer
  getShareData: (answerId: number) =>
    api.get(`/share/${answerId}`),

  // Generate share video overlay config
  generateVideo: (payload: {
    question: string;
    answerVideoUrl?: string;
    answerId: number;
  }) => api.post("/share/video", payload),

  // Track share events (share_export, share_open, answer_from_share)
  trackEvent: (answerId: number, event: string, platform?: string, metadata?: Record<string, any>) =>
    api.post(`/share/${answerId}/track`, { event, platform, metadata }),

  // Get top 30 shareable questions
  getTopShareable: (limit = 30) =>
    api.get("/share/top", { params: { limit } }),

  // Get creator dopamine stats for an answer
  getCreatorStats: (answerId: number) =>
    api.get(`/share/${answerId}/stats`),

  // Get share growth KPIs
  getKPIs: () =>
    api.get("/share/kpis"),
};

export const duelsApi = {
  create: (payload: {
    questionId: number;
    userB: number;
    answerAId?: number;
    answerBId?: number;
    videoA: string;
    videoB: string;
  }) =>
    api.post("/duels", {
      question_id: payload.questionId,
      user_b_id: payload.userB,
      answer_a_id: payload.answerAId,
      answer_b_id: payload.answerBId,
      video_a_url: payload.videoA,
      video_b_url: payload.videoB,
    }),

  createAuto: (payload: {
    questionId: number;
    answerId?: number;
    videoA?: string;
  }) =>
    api.post("/duels/auto", {
      question_id: payload.questionId,
      answer_id: payload.answerId,
      video_a_url: payload.videoA,
    }),

  getFeed: (page = 1, limit = 10, _userId?: number, status?: "active" | "finished") =>
    api.get("/duels", {
      params: {
        page,
        limit,
        status,
      },
    }),

  getById: (duelId: number, _userId?: number) => api.get(`/duels/${duelId}`),

  vote: (duelId: number, _userId: number, vote: "A" | "B") =>
    api.post(`/duels/${duelId}/vote`, {
      vote,
    }),
};

export const trendingApi = {
  getDiscoveryFeed: () => api.get("/trending/discovery"),
};

export const paywallApi = {
  trackEvent: (event_type: string, metadata?: Record<string, any>, user_id?: number) =>
    api.post("/paywall/track", {
      event_type,
      metadata,
    }),

  grantBonus: (userId: number) =>
    api.post(`/paywall/bonus/${userId}`),

  getStats: () => api.get("/paywall/stats"),
};

type ExperimentAssignments = {
  feed_ranker_v2?: string;
  paywall_v2?: string;
  duels_v1?: string;
};

let currentExperiments: ExperimentAssignments = {};

export const experimentsApi = {
  getMyAssignments: async () => {
    const response = await api.get("/analytics/experiments/me");
    currentExperiments = response.data?.assignments || {};
    setFeatureAssignments(currentExperiments);
    return response;
  },
  getCurrentAssignments: () => currentExperiments,
  resetAssignments: () => {
    currentExperiments = {};
    setFeatureAssignments({});
  },
};

export const analyticsApi = {
  trackEvent: (payload: {
    event_type: string;
    screen?: string;
    metadata?: Record<string, any>;
  }) =>
    api.post("/analytics/events", payload, {
      suppressConnectivityWarning: true,
    } as ApiRequestConfig),
  getDashboard: () => api.get("/analytics/dashboard"),
};

export function getApiErrorMessage(error: any, fallback = "Something went wrong.") {
  const code = error?.response?.data?.error;
  const message = error?.response?.data?.message;

  if (message) return String(message);
  if (code) {
    return String(code)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  return error?.message || fallback;
}

export const legalApi = {
  getTerms: () => api.get("/legal/terms"),
  getPrivacy: () => api.get("/legal/privacy"),
  getCookies: () => api.get("/legal/cookies"),
  requestExport: (exportType = "full") => api.post("/legal/export-data", { exportType }),
  listExportRequests: () => api.get("/legal/export-requests"),
  getExportLink: (requestId: number) => api.get(`/legal/export-data/${requestId}/link`),
  getDeletionStatus: () => api.get("/legal/deletion-status"),
  requestDeleteAccount: (confirmation = "DELETE_MY_ACCOUNT") =>
    api.post("/legal/delete-account", { confirmation }),
  cancelDeletion: () => api.post("/legal/cancel-deletion"),
  getConsent: () => api.get("/legal/consent"),
  saveConsent: (payload: { analytics: boolean; marketing: boolean; thirdParty: boolean }) =>
    api.post("/legal/consent", payload),
};

export const supportApi = {
  getMyTickets: (page = 1, limit = 20) => api.get("/support/tickets/me", { params: { page, limit } }),
  createTicket: (payload: {
    category: string;
    priority?: string;
    subject: string;
    description: string;
    reportedContent?: Record<string, any>;
  }) => api.post("/support/tickets", payload),
  getMyRefunds: (page = 1, limit = 20) => api.get("/support/refunds/me", { params: { page, limit } }),
  createRefund: (payload: {
    reason: string;
    details?: string;
    amount: number;
    currency?: string;
    stripePaymentIntentId?: string;
  }) => api.post("/support/refunds", payload),
};

export const adminApi = {
  getDashboard: () => api.get("/admin/dashboard"),
  getDailyQuestions: (params?: Record<string, any>) => api.get("/admin/daily-questions", { params }),
  createDailyQuestion: (payload: {
    questionId: number;
    scheduledFor: string;
    country?: string;
    priority?: number;
  }) => api.post("/admin/daily-questions", payload),
  updateDailyQuestion: (id: number, payload: Record<string, any>) => api.patch(`/admin/daily-questions/${id}`, payload),
  getTrending: (country?: string, limit = 20) => api.get("/admin/trending", { params: { country, limit } }),
  recalculateTrending: (country?: string) => api.post("/admin/trending/recalculate", { country }),
  getReports: (params?: Record<string, any>) => api.get("/admin/reports", { params }),
  reviewReport: (id: number, payload: { action: string; notes?: string }) =>
    api.post(`/admin/reports/${id}/review`, payload),
  getTickets: (params?: Record<string, any>) => api.get("/admin/tickets", { params }),
  updateTicket: (id: number, payload: Record<string, any>) => api.patch(`/admin/tickets/${id}`, payload),
  getRefunds: (params?: Record<string, any>) => api.get("/admin/refunds", { params }),
  processRefund: (id: number, payload: { decision: string; notes?: string }) =>
    api.post(`/admin/refunds/${id}/process`, payload),
  getFeatureFlags: () => api.get("/admin/feature-flags"),
  createFeatureFlag: (payload: Record<string, any>) => api.post("/admin/feature-flags", payload),
  updateFeatureFlag: (id: number, payload: Record<string, any>) => api.patch(`/admin/feature-flags/${id}`, payload),
  getCountryRules: () => api.get("/admin/country-rules"),
  updateCountryRule: (countryCode: string, payload: Record<string, any>) =>
    api.put(`/admin/country-rules/${countryCode}`, payload),
  getPaywallStats: (params?: Record<string, any>) => api.get("/admin/paywall/stats", { params }),
};

export const paymentsApi = {
  getConfig: () => api.get("/payments/config"),
  createCheckout: (source = "paywall") => api.post("/payments/checkout", { source }),
  createPortal: () => api.post("/payments/portal"),
};

export const aiApi = {
  generateQuestion: (country?: string) =>
    api.get("/ai/question", { params: { country: country || _userCountry } }),

  generateBulk: (count: number, country?: string) =>
    api.post("/ai/questions/bulk", { count, country: country || _userCountry }),

  generateDaily: (country?: string) =>
    api.post("/ai/daily", { country: country || _userCountry }),

  getSupportedCountries: () => api.get("/ai/countries"),
};

export const uploadsApi = {
  getSignature: () => api.get("/uploads/signature"),
};

export const moderationApi = {
  reportAnswer: (answerId: number, payload: { reason: string; details?: string }) =>
    api.post(`/moderation/answers/${answerId}/report`, payload),
  reportUser: (userId: number, payload: { reason: string; details?: string }) =>
    api.post(`/moderation/users/${userId}/report`, payload),
  blockUser: (userId: number) => api.post(`/moderation/users/${userId}/block`, {}),
  unblockUser: (userId: number) => api.delete(`/moderation/users/${userId}/block`),
  getMyBlocks: () => api.get("/moderation/blocks/me"),
  getQueue: (status = "pending") =>
    api.get("/moderation/queue", { params: { status } }),
  resolveReport: (
    reportId: number,
    payload: { status: "resolved" | "dismissed"; action?: string; metadata?: Record<string, any> }
  ) => api.post(`/moderation/reports/${reportId}/resolve`, payload),
};

export const pushApi = {
  listMyTokens: () => api.get("/push/tokens/me"),
  register: (payload: {
    token: string;
    platform: "ios" | "android";
    device_id?: string;
    project_id?: string;
    app_version?: string;
  }) => api.post("/push/register", payload),
  unregister: (token: string) => api.post("/push/unregister", { token }),
  sendTest: (payload: {
    title: string;
    body: string;
    deeplink?: string;
    metadata?: Record<string, any>;
  }) => api.post("/push/test", payload),
};

// ── Fusion Loop API (Engagement Super Loop) ──

export const fusionApi = {
  // Get full loop status (score, streak, prompts, exit hook)
  getStatus: () => api.get("/fusion/status"),

  // Record a loop action → returns badges, streak, next prompt
  recordAction: (action: "answer" | "remix" | "comment" | "drop") =>
    api.post("/fusion/action", { action }),

  // Get next floating prompt
  getPrompt: () => api.get("/fusion/prompt"),

  // Get exit hook data (streak warning, next drop)
  getExitHook: () => api.get("/fusion/exit-hook"),

  // Get feed adaptation config
  getFeedConfig: () => api.get("/fusion/feed-config"),
};

// ── Comments API ──

export const commentsApi = {
  // Get comments for an answer
  getComments: (answerId: number, limit = 20, offset = 0) =>
    api.get(`/comments/${answerId}?limit=${limit}&offset=${offset}`),

  // Create a comment
  createComment: (answerId: number, text: string, parentId?: number) =>
    api.post("/comments", { answer_id: answerId, text, parent_id: parentId }),

  // Delete own comment
  deleteComment: (commentId: number) =>
    api.delete(`/comments/${commentId}`),
};

export default api;
