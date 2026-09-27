import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useScreenInsets } from "../hooks/useScreenInsets";
import { useConnectivity } from "../context/ConnectivityContext";
import { getApiErrorMessage } from "../services/api";
import { parseDeepLinkTarget, peekPendingDeepLink } from "../services/pendingDeepLink";
import { getLegalPrivacyUrl, getLegalTermsUrl } from "../utils/productionConfig";
import { Colors, Shadows } from "../theme";

const COUNTRY_PRESETS = [
  { code: "AL", label: "Shqipëri" },
  { code: "XK", label: "Kosovë" },
  { code: "US", label: "USA" },
  { code: "DE", label: "Germany" },
  { code: "GLOBAL", label: "Global" },
];

export default function AuthScreen() {
  const { login, register, loginAsGuest } = useAuth();
  const insets = useScreenInsets();
  const { status, refresh } = useConnectivity();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState("AL");
  const [submitting, setSubmitting] = useState(false);
  const [guestSubmitting, setGuestSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [confirmedAge, setConfirmedAge] = useState(false);
  const [invite, setInvite] = useState<"challenge" | "duel" | "answer" | "invite" | null>(null);

  // The navigator stashes incoming links asynchronously, so re-check shortly after mount and on new URLs.
  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const check = async () => {
      const url = await peekPendingDeepLink().catch(() => null);
      if (cancelled || !url) return;
      const target = parseDeepLinkTarget(url);
      if (!target) return;
      setInvite(
        target.type === "challenge" || target.type === "duel"
          ? target.type
          : target.type === "deep_answer"
            ? "answer"
            : "invite"
      );
    };
    check();
    timers.push(setTimeout(check, 700));
    const sub = Linking.addEventListener("url", () => {
      timers.push(setTimeout(check, 300));
    });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      sub.remove();
    };
  }, []);

  const inviteCopy =
    invite === "challenge"
      ? { title: "Një shok të sfidoi në duel ⚔️", sub: "Hyr me një prekje dhe prano sfidën." }
      : invite === "duel"
        ? { title: "Të ftuan të votosh në një duel 🔥", sub: "Hyr me një prekje dhe vendos fituesin." }
        : invite === "answer"
          ? { title: "Një shok të dërgoi një përgjigje 👀", sub: "Hyr me një prekje dhe shiko nëse e mund." }
          : { title: "Një shok të ftoi në 5SEK 👋", sub: "Hyr me një prekje — pa llogari, pa pritje." };

  const canSubmit = useMemo(() => {
    if (!password) return false;
    if (mode === "login") return Boolean(email.trim());
    if (password.length < 8) return false;
    if (!username.trim() || username.trim().length < 3) return false;
    if (!email.trim() || !email.includes("@")) return false;
    if (!acceptedTerms || !confirmedAge) return false;
    return true;
  }, [acceptedTerms, confirmedAge, email, mode, password, username]);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register({
          username: username.trim(),
          email: email.trim(),
          password,
          country: country.trim().toUpperCase() || "GLOBAL",
        });
      }
    } catch (submitError: any) {
      const fallback =
        status === "degraded"
          ? "Nuk lidhemi me serverin. Provo sërish."
          : mode === "login"
          ? "Email/username ose fjalëkalimi nuk përputhen."
          : "Nuk u krijua llogaria. Provo sërish.";
      setError(getApiErrorMessage(submitError, fallback));
    } finally {
      setSubmitting(false);
    }
  };

  const continueAsGuest = async () => {
    if (guestSubmitting || submitting) return;
    setGuestSubmitting(true);
    setError(null);
    try {
      await loginAsGuest(country || "GLOBAL");
    } catch (guestError: any) {
      const code = guestError?.response?.data?.error;
      const fallback =
        status === "degraded"
          ? "Nuk lidhemi me serverin. Provo sërish."
          : code === "guest_rate_limited"
          ? "Shumë hyrje si vizitor nga kjo lidhje. Provo pas pak ose krijo llogari."
          : "Nuk u hap sesioni si vizitor. Provo sërish.";
      setError(getApiErrorMessage(guestError, fallback));
    } finally {
      setGuestSubmitting(false);
    }
  };

  return (
    <LinearGradient colors={Colors.background.authGradient} style={styles.container}>
      <View style={styles.orbA} />
      <View style={styles.orbB} />

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.headerTop(28), paddingBottom: insets.footerBottom(28) }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brand}>
            <LinearGradient colors={Colors.accent.primaryGradient} style={styles.logoMark}>
              <Text style={styles.logoMarkText}>5</Text>
            </LinearGradient>
            <Text style={styles.logo}>5SEK</Text>
            <Text style={styles.tagline}>5 sekonda. Një përgjigje. Live.</Text>
          </View>

          {invite ? (
            <View style={styles.inviteCard}>
              <Text style={styles.inviteTitle}>{inviteCopy.title}</Text>
              <Text style={styles.inviteSub}>{inviteCopy.sub}</Text>
              <TouchableOpacity
                onPress={continueAsGuest}
                disabled={guestSubmitting || submitting}
                activeOpacity={0.88}
                accessibilityRole="button"
                accessibilityLabel="Hyr dhe vazhdo"
              >
                <LinearGradient
                  colors={Colors.accent.primaryGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.inviteButton}
                >
                  {guestSubmitting ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <>
                      <Ionicons name="flash" size={18} color="#FFF" />
                      <Text style={styles.inviteButtonText}>Hyr dhe vazhdo</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.card}>
            <View style={styles.tabs}>
              <TouchableOpacity style={[styles.tab, mode === "login" && styles.tabActive]} onPress={() => setMode("login")}>
                <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>Hyr</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.tab, mode === "register" && styles.tabActive]} onPress={() => setMode("register")}>
                <Text style={[styles.tabText, mode === "register" && styles.tabTextActive]}>Krijo llogari</Text>
              </TouchableOpacity>
            </View>

            {mode === "register" ? (
              <View style={styles.field}>
                <Text style={styles.label}>Username</Text>
                <TextInput
                  value={username}
                  onChangeText={setUsername}
                  placeholder="p.sh. elisa"
                  placeholderTextColor="rgba(255,255,255,0.32)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
              </View>
            ) : null}

            <View style={styles.field}>
              <Text style={styles.label}>{mode === "login" ? "Email ose username" : "Email"}</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder={mode === "login" ? "emri@email.com ose username" : "emri@email.com"}
                placeholderTextColor="rgba(255,255,255,0.32)"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={mode === "login" ? "default" : "email-address"}
                style={styles.input}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Fjalëkalimi</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Minimumi 8 karaktere"
                  placeholderTextColor="rgba(255,255,255,0.32)"
                  secureTextEntry={!showPassword}
                  style={[styles.input, styles.passwordInput]}
                />
                <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                  <Ionicons name={showPassword ? "eye-off" : "eye"} size={20} color="rgba(255,255,255,0.6)" />
                </TouchableOpacity>
              </View>
            </View>

            {mode === "register" ? (
              <View style={styles.field}>
                <Text style={styles.label}>Shteti</Text>
                <View style={styles.chips}>
                  {COUNTRY_PRESETS.map((preset) => (
                    <TouchableOpacity
                      key={preset.code}
                      style={[styles.chip, country === preset.code && styles.chipActive]}
                      onPress={() => setCountry(preset.code)}
                    >
                      <Text style={[styles.chipText, country === preset.code && styles.chipTextActive]}>
                        {preset.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            {mode === "register" ? (
              <View style={styles.legalBlock}>
                <TouchableOpacity style={styles.checkRow} onPress={() => setAcceptedTerms((v) => !v)}>
                  <View style={[styles.checkbox, acceptedTerms && styles.checkboxOn]}>
                    {acceptedTerms ? <Ionicons name="checkmark" size={12} color="#050508" /> : null}
                  </View>
                  <Text style={styles.checkLabel}>
                    Pranoj{" "}
                    <Text style={styles.link} onPress={() => Linking.openURL(getLegalTermsUrl())}>kushtet</Text>
                    {" "}dhe{" "}
                    <Text style={styles.link} onPress={() => Linking.openURL(getLegalPrivacyUrl())}>privatësinë</Text>.
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.checkRow} onPress={() => setConfirmedAge((v) => !v)}>
                  <View style={[styles.checkbox, confirmedAge && styles.checkboxOn]}>
                    {confirmedAge ? <Ionicons name="checkmark" size={12} color="#050508" /> : null}
                  </View>
                  <Text style={styles.checkLabel}>Kam të paktën 16 vjeç.</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {status === "degraded" ? (
              <TouchableOpacity style={styles.offline} onPress={refresh}>
                <Text style={styles.offlineText}>Nuk ka lidhje me serverin. Prek për të provuar sërish.</Text>
              </TouchableOpacity>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.submitWrap, !canSubmit && styles.submitDisabled]}
              onPress={submit}
              disabled={submitting || !canSubmit}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={!canSubmit ? ["#2A2A36", "#2A2A36"] : Colors.accent.primaryGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.submit}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.submitText}>{mode === "login" ? "Hyr në 5SEK" : "Fillo tani"}</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>ose</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={[styles.guestButton, (guestSubmitting || submitting) && styles.submitDisabled]}
              onPress={continueAsGuest}
              disabled={guestSubmitting || submitting}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Vazhdo si vizitor"
            >
              {guestSubmitting ? (
                <ActivityIndicator color="#3DFFC8" />
              ) : (
                <>
                  <Ionicons name="flash-outline" size={18} color="#3DFFC8" />
                  <Text style={styles.guestButtonText}>Vazhdo si vizitor</Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={styles.guestHint}>
              Pa email, pa fjalëkalim. Përgjigju, voto dhe bëj duel menjëherë — llogarinë e krijon kur të duash,
              pa humbur asgjë.
            </Text>
          </View>

          <View style={styles.perksRow}>
            <View style={styles.perk}>
              <Text style={styles.perkEmoji}>⚡</Text>
              <Text style={styles.perkText}>5 sekonda për përgjigje</Text>
            </View>
            <View style={styles.perk}>
              <Text style={styles.perkEmoji}>⚔️</Text>
              <Text style={styles.perkText}>Duele 1v1 live</Text>
            </View>
            <View style={styles.perk}>
              <Text style={styles.perkEmoji}>🏆</Text>
              <Text style={styles.perkText}>Renditja javore</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  orbA: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(255,45,106,0.28)",
    top: -80,
    right: -60,
  },
  orbB: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(139,92,255,0.22)",
    bottom: 40,
    left: -80,
  },
  content: {
    paddingHorizontal: 22,
    paddingTop: 72,
    paddingBottom: 40,
  },
  brand: { alignItems: "center", marginBottom: 28 },
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    ...Shadows.glowPrimary,
  },
  logoMarkText: { color: "#FFF", fontSize: 32, fontWeight: "900" },
  logo: { color: "#FFF", fontSize: 42, fontWeight: "900", letterSpacing: 2 },
  tagline: { color: "rgba(255,255,255,0.62)", marginTop: 8, fontSize: 15, fontWeight: "600" },
  inviteCard: {
    backgroundColor: "rgba(255,45,106,0.12)",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,45,106,0.45)",
    padding: 18,
    marginBottom: 16,
  },
  inviteTitle: { color: "#FFF", fontSize: 18, fontWeight: "900" },
  inviteSub: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: "600", marginTop: 4, marginBottom: 14 },
  inviteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 18,
  },
  inviteButtonText: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  card: {
    backgroundColor: "rgba(12,12,20,0.82)",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 20,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 16,
    padding: 4,
    marginBottom: 20,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 12 },
  tabActive: { backgroundColor: "#FF2D6A" },
  tabText: { color: "rgba(255,255,255,0.55)", fontWeight: "800" },
  tabTextActive: { color: "#FFF" },
  field: { marginBottom: 14 },
  label: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "800", marginBottom: 8, letterSpacing: 0.4 },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 16,
    color: "#FFF",
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    fontWeight: "600",
  },
  passwordWrap: { position: "relative" },
  passwordInput: { paddingRight: 46 },
  eyeBtn: { position: "absolute", right: 14, top: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  chipActive: { backgroundColor: "rgba(255,45,106,0.2)", borderColor: "#FF2D6A" },
  chipText: { color: "rgba(255,255,255,0.65)", fontWeight: "700", fontSize: 12 },
  chipTextActive: { color: "#FFF" },
  legalBlock: { gap: 10, marginBottom: 12 },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
    marginTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: "#3DFFC8", borderColor: "#3DFFC8" },
  checkLabel: { flex: 1, color: "rgba(255,255,255,0.75)", fontSize: 13, lineHeight: 18, fontWeight: "600" },
  link: { color: "#3DFFC8", textDecorationLine: "underline" },
  offline: {
    backgroundColor: "rgba(255,200,87,0.12)",
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  offlineText: { color: "#FFC857", fontWeight: "700", fontSize: 12, textAlign: "center" },
  error: { color: "#FF6B8A", fontWeight: "700", marginBottom: 10, textAlign: "center" },
  submitWrap: { marginTop: 6, borderRadius: 18, overflow: "hidden" },
  submitDisabled: { opacity: 0.55 },
  submit: { paddingVertical: 16, alignItems: "center" },
  submitText: { color: "#FFF", fontSize: 17, fontWeight: "900" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.1)" },
  dividerText: { color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  guestButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "rgba(61,255,200,0.55)",
    backgroundColor: "rgba(61,255,200,0.08)",
  },
  guestButtonText: { color: "#3DFFC8", fontSize: 16, fontWeight: "900" },
  guestHint: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 10,
  },
  perksRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginTop: 22 },
  perk: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  perkEmoji: { fontSize: 20 },
  perkText: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "700", textAlign: "center" },
});
