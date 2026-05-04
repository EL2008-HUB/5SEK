import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../context/AuthContext";
import { useConnectivity } from "../context/ConnectivityContext";
import { getApiErrorMessage } from "../services/api";

const COUNTRY_PRESETS = ["GLOBAL", "AL", "US", "DE"];

function compactEndpointLabel(endpoint: string) {
  return endpoint.replace(/^https?:\/\//, "");
}

export default function AuthScreen() {
  const { login, register } = useAuth();
  const { status, endpoint, refresh } = useConnectivity();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState("GLOBAL");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitLabel = mode === "login" ? "Enter feed" : "Create account";
  const modeHeadline =
    mode === "login" ? "Welcome back." : "Create a real identity.";
  const modeHelper =
    mode === "login"
      ? "Login with the account tied to moderation, refunds, exports, and admin actions."
      : "Register once, then every answer, duel, and support flow stays attached to the same account.";
  const endpointLabel = compactEndpointLabel(endpoint);

  const canSubmit = useMemo(() => {
    if (!email.trim() || !password) return false;
    if (mode === "register" && (!username.trim() || !country.trim())) return false;
    return true;
  }, [country, email, mode, password, username]);

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
          ? "API unavailable. Start the backend and retry."
          : "Authentication failed.";
      setError(getApiErrorMessage(submitError, fallback));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <LinearGradient colors={["#081017", "#101A24", "#1E2B32"]} style={styles.container}>
      <View style={styles.bgOrbA} />
      <View style={styles.bgOrbB} />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <View style={styles.brandRow}>
              <Text style={styles.eyebrow}>5SEK</Text>
              <View
                style={[
                  styles.statusPill,
                  status === "online" ? styles.statusPillOnline : styles.statusPillOffline,
                ]}
              >
                <View
                  style={[
                    styles.statusDot,
                    status === "online" ? styles.statusDotOnline : styles.statusDotOffline,
                  ]}
                />
                <Text style={styles.statusText}>
                  {status === "online" ? "API reachable" : "API offline"}
                </Text>
              </View>
            </View>

            <Text style={styles.title}>Real accounts. Fast entry. Clear state.</Text>
            <Text style={styles.subtitle}>
              Auth should feel clean, not heavy. This flow keeps identity explicit while showing what
              the app is connected to right now.
            </Text>

            <View style={styles.heroGrid}>
              <View style={styles.heroTile}>
                <Text style={styles.heroTileValue}>01</Text>
                <Text style={styles.heroTileLabel}>Real auth only</Text>
              </View>
              <View style={styles.heroTile}>
                <Text style={styles.heroTileValue}>24h</Text>
                <Text style={styles.heroTileLabel}>Export + support traces</Text>
              </View>
              <View style={styles.heroTileWide}>
                <Text style={styles.heroTileCaption}>Active endpoint</Text>
                <Text style={styles.heroTileEndpoint}>{endpointLabel}</Text>
                {status === "degraded" ? (
                  <TouchableOpacity style={styles.endpointButton} onPress={refresh} activeOpacity={0.9}>
                    <Text style={styles.endpointButtonText}>Retry API check</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.cardTitle}>{modeHeadline}</Text>
                <Text style={styles.cardSubtitle}>{modeHelper}</Text>
              </View>
            </View>

            <View style={styles.modeShell}>
              <LinearGradient
                colors={mode === "login" ? ["#9AE3C6", "#73D9D0"] : ["#FFC96E", "#F29B55"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.modeActiveBg, mode === "register" && styles.modeActiveBgRight]}
              />
              <TouchableOpacity
                style={styles.modeButton}
                onPress={() => setMode("login")}
                activeOpacity={0.9}
              >
                <Text style={[styles.modeText, mode === "login" && styles.modeTextActive]}>Login</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modeButton}
                onPress={() => setMode("register")}
                activeOpacity={0.9}
              >
                <Text style={[styles.modeText, mode === "register" && styles.modeTextActive]}>
                  Register
                </Text>
              </TouchableOpacity>
            </View>

            {mode === "register" ? (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Username</Text>
                <TextInput
                  value={username}
                  onChangeText={setUsername}
                  placeholder="your handle"
                  placeholderTextColor="rgba(225,236,245,0.34)"
                  autoCapitalize="none"
                  style={styles.input}
                />
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="name@example.com"
                placeholderTextColor="rgba(225,236,245,0.34)"
                autoCapitalize="none"
                keyboardType="email-address"
                style={styles.input}
              />
            </View>

            <View style={styles.inputGroup}>
              <View style={styles.passwordRow}>
                <Text style={styles.inputLabel}>Password</Text>
                <TouchableOpacity onPress={() => setShowPassword((prev) => !prev)} activeOpacity={0.8}>
                  <Text style={styles.passwordToggle}>{showPassword ? "Hide" : "Show"}</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={mode === "login" ? "Enter password" : "At least 8 characters"}
                placeholderTextColor="rgba(225,236,245,0.34)"
                secureTextEntry={!showPassword}
                style={styles.input}
              />
            </View>

            {mode === "register" ? (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Market</Text>
                <TextInput
                  value={country}
                  onChangeText={(value) => setCountry(value.toUpperCase())}
                  placeholder="Country code"
                  placeholderTextColor="rgba(225,236,245,0.34)"
                  autoCapitalize="characters"
                  maxLength={10}
                  style={styles.input}
                />
                <View style={styles.countryPresetRow}>
                  {COUNTRY_PRESETS.map((preset) => (
                    <TouchableOpacity
                      key={preset}
                      style={[
                        styles.countryChip,
                        country.trim().toUpperCase() === preset && styles.countryChipActive,
                      ]}
                      onPress={() => setCountry(preset)}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[
                          styles.countryChipText,
                          country.trim().toUpperCase() === preset && styles.countryChipTextActive,
                        ]}
                      >
                        {preset}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            {status === "degraded" ? (
              <View style={styles.offlineCard}>
                <Text style={styles.offlineTitle}>Backend not reachable</Text>
                <Text style={styles.offlineBody}>
                  Current target is `{endpointLabel}`. Start `5second-api` or point Expo to the right API URL,
                  then retry.
                </Text>
              </View>
            ) : null}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
              onPress={submit}
              disabled={submitting || !canSubmit}
              activeOpacity={0.92}
            >
              <LinearGradient
                colors={!canSubmit ? ["#2A333D", "#2A333D"] : ["#9AE3C6", "#73D9D0"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.submitGradient}
              >
                {submitting ? (
                  <ActivityIndicator color="#081117" />
                ) : (
                  <Text style={styles.submitText}>{submitLabel}</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  bgOrbA: {
    position: "absolute",
    top: -80,
    right: -40,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(115,217,208,0.1)",
  },
  bgOrbB: {
    position: "absolute",
    bottom: -120,
    left: -50,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: "rgba(255,201,110,0.08)",
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingTop: 110,
    paddingBottom: 36,
    gap: 24,
  },
  hero: {
    gap: 16,
    maxWidth: 860,
    width: "100%",
    alignSelf: "center",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  eyebrow: {
    color: "#93F2D0",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 3,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  statusPillOnline: {
    backgroundColor: "rgba(154,227,198,0.12)",
    borderColor: "rgba(154,227,198,0.22)",
  },
  statusPillOffline: {
    backgroundColor: "rgba(255,184,117,0.12)",
    borderColor: "rgba(255,184,117,0.2)",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotOnline: {
    backgroundColor: "#9AE3C6",
  },
  statusDotOffline: {
    backgroundColor: "#FFB875",
  },
  statusText: {
    color: "#F7FBFF",
    fontSize: 12,
    fontWeight: "800",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 42,
    lineHeight: 46,
    fontWeight: "900",
    maxWidth: 720,
  },
  subtitle: {
    color: "rgba(229,240,248,0.78)",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    maxWidth: 760,
  },
  heroGrid: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
  },
  heroTile: {
    minWidth: 146,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 15,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 4,
  },
  heroTileWide: {
    flexGrow: 1,
    minWidth: 230,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 15,
    backgroundColor: "rgba(10,17,25,0.72)",
    borderWidth: 1,
    borderColor: "rgba(115,217,208,0.14)",
    gap: 8,
  },
  heroTileValue: {
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "900",
  },
  heroTileLabel: {
    color: "rgba(229,240,248,0.72)",
    fontSize: 12,
    fontWeight: "800",
  },
  heroTileCaption: {
    color: "rgba(229,240,248,0.56)",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.3,
  },
  heroTileEndpoint: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  endpointButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(255,201,110,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,201,110,0.18)",
  },
  endpointButtonText: {
    color: "#FFE0A8",
    fontSize: 12,
    fontWeight: "900",
  },
  card: {
    width: "100%",
    maxWidth: 860,
    alignSelf: "center",
    borderRadius: 30,
    padding: 22,
    gap: 16,
    backgroundColor: "rgba(6,11,18,0.84)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    shadowColor: "#000",
    shadowOpacity: 0.26,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 18 },
    elevation: 10,
  },
  cardHeader: {
    gap: 6,
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
  },
  cardSubtitle: {
    color: "rgba(229,240,248,0.68)",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
  },
  modeShell: {
    position: "relative",
    flexDirection: "row",
    padding: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  modeActiveBg: {
    position: "absolute",
    top: 6,
    bottom: 6,
    left: 6,
    width: "50%",
    borderRadius: 999,
  },
  modeActiveBgRight: {
    left: "50%",
  },
  modeButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
    zIndex: 1,
  },
  modeText: {
    color: "rgba(229,240,248,0.68)",
    fontSize: 14,
    fontWeight: "900",
  },
  modeTextActive: {
    color: "#071117",
  },
  inputGroup: {
    gap: 8,
  },
  inputLabel: {
    color: "rgba(229,240,248,0.72)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  input: {
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  passwordToggle: {
    color: "#93F2D0",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  countryPresetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  countryChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  countryChipActive: {
    backgroundColor: "rgba(154,227,198,0.15)",
    borderColor: "rgba(154,227,198,0.22)",
  },
  countryChipText: {
    color: "rgba(229,240,248,0.7)",
    fontSize: 12,
    fontWeight: "800",
  },
  countryChipTextActive: {
    color: "#D8FFF1",
  },
  offlineCard: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "rgba(91,34,6,0.32)",
    borderWidth: 1,
    borderColor: "rgba(255,184,117,0.18)",
    gap: 6,
  },
  offlineTitle: {
    color: "#FFE2BF",
    fontSize: 14,
    fontWeight: "900",
  },
  offlineBody: {
    color: "rgba(255,235,209,0.82)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  errorText: {
    color: "#FFB2B8",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
  },
  submitButton: {
    borderRadius: 20,
    overflow: "hidden",
    marginTop: 4,
  },
  submitButtonDisabled: {
    opacity: 0.55,
  },
  submitGradient: {
    minHeight: 62,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: {
    color: "#081117",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
});
