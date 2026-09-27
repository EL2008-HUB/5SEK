import React, { useMemo, useState } from "react";
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
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useScreenInsets } from "../hooks/useScreenInsets";
import { getApiErrorMessage } from "../services/api";
import { showAppAlert } from "../utils/alerts";
import { getLegalPrivacyUrl, getLegalTermsUrl } from "../utils/productionConfig";
import { Colors, Shadows } from "../theme";

const PERKS = [
  { icon: "trophy" as const, title: "Renditja me emrin tend", body: "Piket, fitoret e dueleve dhe streak-u ruhen pergjithmone." },
  { icon: "phone-portrait" as const, title: "Hyr nga cdo pajisje", body: "Me email + fjalekalim e gjen llogarine kudo." },
  { icon: "shield-checkmark" as const, title: "Asgje nuk humbet", body: "Pergjigjet, duelet dhe pelqimet e deritanishme mbeten te tua." },
];

export default function UpgradeAccountScreen() {
  const navigation = useNavigation<any>();
  const { user, isGuest, upgradeAccount } = useAuth();
  const insets = useScreenInsets();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [confirmedAge, setConfirmedAge] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameOk = /^[a-zA-Z0-9_.]{3,32}$/.test(username.trim());
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const passwordOk = password.length >= 8;

  const canSubmit = useMemo(
    () => usernameOk && emailOk && passwordOk && acceptedTerms && confirmedAge && !submitting,
    [acceptedTerms, confirmedAge, emailOk, passwordOk, submitting, usernameOk]
  );

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const upgraded = await upgradeAccount({
        username: username.trim(),
        email: email.trim().toLowerCase(),
        password,
        country: user?.country || undefined,
      });
      showAppAlert("Mire se erdhe!", `Llogaria @${upgraded.username} u krijua. Gjithcka qe bere si vizitor eshte ruajtur.`);
      navigation.goBack();
    } catch (submitError: any) {
      const code = submitError?.response?.data?.error;
      const field = submitError?.response?.data?.field;
      const fallback =
        code === "User already exists"
          ? field === "email"
            ? "Ky email eshte i zene. Provo nje tjeter ose hyr me ate llogari."
            : "Ky username eshte i zene. Zgjidh nje tjeter."
          : code === "already_registered"
          ? "Kjo llogari eshte tashme e plote."
          : "Nuk u krijua llogaria. Provo perseri.";
      setError(getApiErrorMessage(submitError, fallback));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isGuest) {
    return (
      <LinearGradient colors={Colors.background.authGradient} style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.centered}>
          <Ionicons name="checkmark-circle" size={56} color="#3DFFC8" />
          <Text style={styles.doneTitle}>Llogaria jote eshte e plote</Text>
          <Text style={styles.doneBody}>Je futur si @{user?.username}. Nuk ke asgje per te bere ketu.</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backButtonText}>Kthehu</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={Colors.background.authGradient} style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.orbA} />

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.headerTop(14), paddingBottom: insets.footerBottom(28) }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity style={styles.close} onPress={() => navigation.goBack()} hitSlop={10}>
            <Ionicons name="close" size={22} color="#FFF" />
          </TouchableOpacity>

          <View style={styles.hero}>
            <LinearGradient colors={Colors.accent.primaryGradient} style={styles.heroBadge}>
              <Ionicons name="sparkles" size={26} color="#FFF" />
            </LinearGradient>
            <Text style={styles.title}>Ruaj progresin tend</Text>
            <Text style={styles.subtitle}>
              Je vizitor si <Text style={styles.subtitleStrong}>@{user?.username}</Text>. Krijo llogarine ne 20 sekonda dhe
              mbaj gjithcka.
            </Text>
          </View>

          <View style={styles.perks}>
            {PERKS.map((perk) => (
              <View key={perk.title} style={styles.perkRow}>
                <View style={styles.perkIcon}>
                  <Ionicons name={perk.icon} size={18} color="#3DFFC8" />
                </View>
                <View style={styles.perkCopy}>
                  <Text style={styles.perkTitle}>{perk.title}</Text>
                  <Text style={styles.perkBody}>{perk.body}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <View style={styles.field}>
              <Text style={styles.label}>Username</Text>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="p.sh. elisa_5"
                placeholderTextColor="rgba(255,255,255,0.32)"
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, username.length > 0 && !usernameOk && styles.inputError]}
              />
              {username.length > 0 && !usernameOk ? (
                <Text style={styles.fieldHint}>3-32 karaktere: shkronja, numra, _ ose .</Text>
              ) : null}
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="emri@email.com"
                placeholderTextColor="rgba(255,255,255,0.32)"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                style={[styles.input, email.length > 0 && !emailOk && styles.inputError]}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Fjalekalimi</Text>
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

            <View style={styles.legalBlock}>
              <TouchableOpacity style={styles.checkRow} onPress={() => setAcceptedTerms((v) => !v)}>
                <View style={[styles.checkbox, acceptedTerms && styles.checkboxOn]}>
                  {acceptedTerms ? <Ionicons name="checkmark" size={12} color="#050508" /> : null}
                </View>
                <Text style={styles.checkLabel}>
                  Pranoj{" "}
                  <Text style={styles.link} onPress={() => Linking.openURL(getLegalTermsUrl())}>kushtet</Text>
                  {" "}dhe{" "}
                  <Text style={styles.link} onPress={() => Linking.openURL(getLegalPrivacyUrl())}>privatesine</Text>.
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.checkRow} onPress={() => setConfirmedAge((v) => !v)}>
                <View style={[styles.checkbox, confirmedAge && styles.checkboxOn]}>
                  {confirmedAge ? <Ionicons name="checkmark" size={12} color="#050508" /> : null}
                </View>
                <Text style={styles.checkLabel}>Kam te pakten 16 vjec.</Text>
              </TouchableOpacity>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.submitWrap, !canSubmit && styles.submitDisabled]}
              onPress={submit}
              disabled={!canSubmit}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={!canSubmit ? ["#2A2A36", "#2A2A36"] : Colors.accent.primaryGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.submit}
              >
                {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitText}>Krijo llogarine</Text>}
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.later} onPress={() => navigation.goBack()}>
              <Text style={styles.laterText}>Me vone</Text>
            </TouchableOpacity>
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
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(61,255,200,0.14)",
    top: -90,
    right: -70,
  },
  content: { paddingHorizontal: 22, paddingTop: 60, paddingBottom: 40 },
  close: {
    alignSelf: "flex-end",
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  hero: { alignItems: "center", marginTop: 6, marginBottom: 22 },
  heroBadge: {
    width: 60,
    height: 60,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    ...Shadows.glowPrimary,
  },
  title: { color: "#FFF", fontSize: 30, fontWeight: "900", textAlign: "center" },
  subtitle: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 8,
  },
  subtitleStrong: { color: "#3DFFC8", fontWeight: "900" },
  perks: { gap: 10, marginBottom: 18 },
  perkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  perkIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(61,255,200,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  perkCopy: { flex: 1 },
  perkTitle: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  perkBody: { color: "rgba(255,255,255,0.6)", fontSize: 12, lineHeight: 17, fontWeight: "600", marginTop: 2 },
  card: {
    backgroundColor: "rgba(12,12,20,0.82)",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 20,
  },
  field: { marginBottom: 14 },
  label: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "800", marginBottom: 8, letterSpacing: 0.4 },
  fieldHint: { color: "#FFC857", fontSize: 11, fontWeight: "700", marginTop: 6 },
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
  inputError: { borderColor: "rgba(255,107,138,0.6)" },
  passwordWrap: { position: "relative" },
  passwordInput: { paddingRight: 46 },
  eyeBtn: { position: "absolute", right: 14, top: 14 },
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
  error: { color: "#FF6B8A", fontWeight: "700", marginBottom: 10, textAlign: "center" },
  submitWrap: { marginTop: 6, borderRadius: 18, overflow: "hidden" },
  submitDisabled: { opacity: 0.55 },
  submit: { paddingVertical: 16, alignItems: "center" },
  submitText: { color: "#FFF", fontSize: 17, fontWeight: "900" },
  later: { alignItems: "center", paddingVertical: 14 },
  laterText: { color: "rgba(255,255,255,0.55)", fontSize: 14, fontWeight: "700" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 12 },
  doneTitle: { color: "#FFF", fontSize: 22, fontWeight: "900", textAlign: "center" },
  doneBody: { color: "rgba(255,255,255,0.65)", fontSize: 14, textAlign: "center", lineHeight: 20 },
  backButton: {
    marginTop: 12,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "#FF2D6A",
  },
  backButtonText: { color: "#FFF", fontWeight: "900" },
});
