import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { adminApi, getApiErrorMessage } from "../services/api";

type Props = {
  role?: string | null;
};

function isAdminRole(role?: string | null) {
  return role === "admin" || role === "super_admin" || role === "moderator";
}

function extractStripeRefundId(notes?: string | null) {
  if (!notes) return null;
  const match = String(notes).match(/stripe_refund_id=([A-Za-z0-9_]+)/);
  return match?.[1] || null;
}

export default function AdminConsole({ role }: Props) {
  const [dashboard, setDashboard] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [dailyQuestions, setDailyQuestions] = useState<any[]>([]);
  const [trending, setTrending] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [refunds, setRefunds] = useState<any[]>([]);
  const [flags, setFlags] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState({
    questionId: "",
    scheduledFor: "",
    country: "GLOBAL",
    priority: "0",
  });
  const [flagForm, setFlagForm] = useState({
    key: "",
    description: "",
    status: "disabled",
    rolloutPercentage: "0",
    targetCountries: "[]",
    targetUserSegments: "[]",
  });
  const [ruleForm, setRuleForm] = useState({
    countryCode: "GLOBAL",
    minAge: "13",
    duelsEnabled: "true",
    paywallEnabled: "true",
    blockedKeywords: "",
  });

  const refresh = async () => {
    if (!isAdminRole(role)) return;

    try {
      const [
        dashboardRes,
        reportsRes,
        dailyRes,
        trendingRes,
        ticketsRes,
        refundsRes,
        flagsRes,
        rulesRes,
      ] = await Promise.all([
        adminApi.getDashboard(),
        adminApi.getReports({ status: "pending", limit: 5 }),
        adminApi.getDailyQuestions({ limit: 5 }),
        adminApi.getTrending("GLOBAL", 5),
        adminApi.getTickets({ limit: 5 }),
        adminApi.getRefunds({ limit: 5 }),
        adminApi.getFeatureFlags(),
        adminApi.getCountryRules(),
      ]);

      setDashboard(dashboardRes.data || null);
      setReports(reportsRes.data?.reports || []);
      setDailyQuestions(dailyRes.data?.questions || []);
      setTrending(trendingRes.data?.trending || []);
      setTickets(ticketsRes.data?.tickets || []);
      setRefunds(refundsRes.data?.requests || []);
      setFlags(flagsRes.data?.flags || []);
      setRules(rulesRes.data?.rules || []);
    } catch (error) {
      console.log("Admin console refresh failed:", error);
    }
  };

  useEffect(() => {
    refresh();
  }, [role]);

  if (!isAdminRole(role)) {
    return null;
  }

  const handleReport = async (id: number, action: string) => {
    try {
      await adminApi.reviewReport(id, { action });
      await refresh();
    } catch (error) {
      Alert.alert("Moderation failed", getApiErrorMessage(error, "Could not update that report."));
    }
  };

  const submitSchedule = async () => {
    try {
      await adminApi.createDailyQuestion({
        questionId: Number(scheduleForm.questionId),
        scheduledFor: scheduleForm.scheduledFor,
        country: scheduleForm.country.toUpperCase(),
        priority: Number(scheduleForm.priority),
      });
      setScheduleForm({ questionId: "", scheduledFor: "", country: "GLOBAL", priority: "0" });
      await refresh();
    } catch (error) {
      Alert.alert("Schedule failed", getApiErrorMessage(error, "Could not schedule the daily question."));
    }
  };

  const submitFlag = async () => {
    try {
      await adminApi.createFeatureFlag({
        key: flagForm.key.trim(),
        description: flagForm.description.trim(),
        status: flagForm.status,
        rolloutPercentage: Number(flagForm.rolloutPercentage),
        targetCountries: JSON.parse(flagForm.targetCountries || "[]"),
        targetUserSegments: JSON.parse(flagForm.targetUserSegments || "[]"),
      });
      setFlagForm({
        key: "",
        description: "",
        status: "disabled",
        rolloutPercentage: "0",
        targetCountries: "[]",
        targetUserSegments: "[]",
      });
      await refresh();
    } catch (error) {
      Alert.alert("Flag failed", getApiErrorMessage(error, "Could not save the feature flag."));
    }
  };

  const submitRule = async () => {
    try {
      await adminApi.updateCountryRule(ruleForm.countryCode.toUpperCase(), {
        min_age: Number(ruleForm.minAge),
        duels_enabled: ruleForm.duelsEnabled === "true",
        paywall_enabled: ruleForm.paywallEnabled === "true",
        blockedKeywords: ruleForm.blockedKeywords
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      await refresh();
    } catch (error) {
      Alert.alert("Country rule failed", getApiErrorMessage(error, "Could not update country rules."));
    }
  };

  const processRefund = async (refundId: number, decision: "approved" | "denied") => {
    setRefundError(null);
    try {
      const response = await adminApi.processRefund(refundId, { decision });
      const stripeRefundId = response.data?.stripeRefundId;
      await refresh();
      if (stripeRefundId) {
        Alert.alert("Refund processed", `Stripe refund id: ${stripeRefundId}`);
      }
    } catch (error) {
      const message = getApiErrorMessage(error, "Could not process the refund.");
      setRefundError(message);
      Alert.alert("Refund failed", message);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Admin Console</Text>
      <Text style={styles.sectionHint}>Unified runtime metrics, moderation queue, support ops, rollout controls.</Text>

      <View style={styles.grid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{dashboard?.realtime?.activeUsersLastHour || 0}</Text>
          <Text style={styles.statLabel}>Active users 1h</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{dashboard?.kpis?.retention?.[0]?.retention_rate || 0}%</Text>
          <Text style={styles.statLabel}>D1 retention</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{dashboard?.kpis?.completionRate?.completion_rate || 0}%</Text>
          <Text style={styles.statLabel}>Answer completion</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{dashboard?.kpis?.avgSessionLength || 0}s</Text>
          <Text style={styles.statLabel}>Feed session length</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{dashboard?.kpis?.duelParticipation?.participation_rate || 0}%</Text>
          <Text style={styles.statLabel}>Duel participation</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{dashboard?.kpis?.paywallConversion?.conversion_rate || 0}%</Text>
          <Text style={styles.statLabel}>Paywall conversion</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Moderation queue</Text>
        {(reports || []).length === 0 ? <Text style={styles.metaText}>No pending reports.</Text> : null}
        {(reports || []).map((report) => (
          <View key={report.id} style={styles.itemCard}>
            <Text style={styles.itemTitle}>{report.reason}</Text>
            <Text style={styles.metaText}>
              {report.question_text || report.reported_username || "Reported entity"}
            </Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.buttonGhost} onPress={() => handleReport(report.id, "dismiss_report")}>
                <Text style={styles.buttonGhostText}>Dismiss</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.buttonDanger}
                onPress={() => handleReport(report.id, report.reported_username ? "block_user" : "soft_delete_answer")}
              >
                <Text style={styles.buttonDangerText}>{report.reported_username ? "Block" : "Delete"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Daily questions</Text>
        <TextInput
          value={scheduleForm.questionId}
          onChangeText={(value) => setScheduleForm((prev) => ({ ...prev, questionId: value }))}
          placeholder="Question ID"
          placeholderTextColor="rgba(255,255,255,0.35)"
          keyboardType="number-pad"
          style={styles.input}
        />
        <TextInput
          value={scheduleForm.scheduledFor}
          onChangeText={(value) => setScheduleForm((prev) => ({ ...prev, scheduledFor: value }))}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
        <TextInput
          value={scheduleForm.country}
          onChangeText={(value) => setScheduleForm((prev) => ({ ...prev, country: value }))}
          placeholder="Country"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
        <TextInput
          value={scheduleForm.priority}
          onChangeText={(value) => setScheduleForm((prev) => ({ ...prev, priority: value }))}
          placeholder="Priority"
          placeholderTextColor="rgba(255,255,255,0.35)"
          keyboardType="number-pad"
          style={styles.input}
        />
        <TouchableOpacity style={styles.buttonPrimary} onPress={submitSchedule}>
          <Text style={styles.buttonPrimaryText}>Schedule question</Text>
        </TouchableOpacity>
        {(dailyQuestions || []).map((question) => (
          <Text key={question.id} style={styles.metaText}>
            #{question.question_id} · {question.country} · {question.scheduled_for} · {question.status}
          </Text>
        ))}
      </View>

      <View style={styles.card}>
        <View style={styles.inlineHeader}>
          <Text style={styles.cardTitle}>Hot questions</Text>
          <TouchableOpacity style={styles.buttonGhost} onPress={() => adminApi.recalculateTrending("GLOBAL").then(refresh)}>
            <Text style={styles.buttonGhostText}>Recalculate</Text>
          </TouchableOpacity>
        </View>
        {(trending || []).map((item) => (
          <Text key={item.id || item.question_id} style={styles.metaText}>
            Q{item.question_id} · score {Math.round(Number(item.trending_score || 0))}
          </Text>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Support tickets</Text>
        {(tickets || []).map((ticket) => (
          <View key={ticket.id} style={styles.itemCard}>
            <Text style={styles.itemTitle}>{ticket.subject}</Text>
            <Text style={styles.metaText}>{ticket.status} · {ticket.category}</Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.buttonGhost}
                onPress={() => adminApi.updateTicket(ticket.id, { status: "in_progress" }).then(refresh)}
              >
                <Text style={styles.buttonGhostText}>In progress</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.buttonPrimary}
                onPress={() => adminApi.updateTicket(ticket.id, { status: "resolved" }).then(refresh)}
              >
                <Text style={styles.buttonPrimaryText}>Resolve</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Refund requests</Text>
        {refundError ? <Text style={styles.errorText}>{refundError}</Text> : null}
        {(refunds || []).map((refund) => (
          <View key={refund.id} style={styles.itemCard}>
            <Text style={styles.itemTitle}>
              #{refund.id} · {refund.amount} {refund.currency}
            </Text>
            <Text style={styles.metaText}>{refund.reason} · {refund.status}</Text>
            {refund.stripe_payment_intent_id ? (
              <Text style={styles.metaText}>Payment intent: {refund.stripe_payment_intent_id}</Text>
            ) : null}
            {extractStripeRefundId(refund.admin_notes) ? (
              <Text style={styles.metaText}>Stripe refund: {extractStripeRefundId(refund.admin_notes)}</Text>
            ) : null}
            {refund.admin_notes ? <Text style={styles.metaText}>Admin notes: {refund.admin_notes}</Text> : null}
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.buttonGhost} onPress={() => processRefund(refund.id, "denied")}>
                <Text style={styles.buttonGhostText}>Deny</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.buttonPrimary} onPress={() => processRefund(refund.id, "approved")}>
                <Text style={styles.buttonPrimaryText}>Approve</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Feature flags</Text>
        <TextInput
          value={flagForm.key}
          onChangeText={(value) => setFlagForm((prev) => ({ ...prev, key: value }))}
          placeholder="Flag key"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
        <TextInput
          value={flagForm.description}
          onChangeText={(value) => setFlagForm((prev) => ({ ...prev, description: value }))}
          placeholder="Description"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
        <TextInput
          value={flagForm.status}
          onChangeText={(value) => setFlagForm((prev) => ({ ...prev, status: value }))}
          placeholder="Status"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
        <TextInput
          value={flagForm.rolloutPercentage}
          onChangeText={(value) => setFlagForm((prev) => ({ ...prev, rolloutPercentage: value }))}
          placeholder="Rollout %"
          placeholderTextColor="rgba(255,255,255,0.35)"
          keyboardType="number-pad"
          style={styles.input}
        />
        <TextInput
          value={flagForm.targetCountries}
          onChangeText={(value) => setFlagForm((prev) => ({ ...prev, targetCountries: value }))}
          placeholder='["US","AL"]'
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
        <TextInput
          value={flagForm.targetUserSegments}
          onChangeText={(value) => setFlagForm((prev) => ({ ...prev, targetUserSegments: value }))}
          placeholder='["premium"]'
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
        <TouchableOpacity style={styles.buttonPrimary} onPress={submitFlag}>
          <Text style={styles.buttonPrimaryText}>Create flag</Text>
        </TouchableOpacity>
        {(flags || []).slice(0, 5).map((flag) => (
          <View key={flag.id} style={styles.itemCard}>
            <Text style={styles.itemTitle}>{flag.feature_key}</Text>
            <Text style={styles.metaText}>{flag.status} · {flag.rollout_percentage}%</Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.buttonGhost}
                onPress={() => adminApi.updateFeatureFlag(flag.id, { status: "disabled" }).then(refresh)}
              >
                <Text style={styles.buttonGhostText}>Disable</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.buttonPrimary}
                onPress={() => adminApi.updateFeatureFlag(flag.id, { status: "enabled" }).then(refresh)}
              >
                <Text style={styles.buttonPrimaryText}>Enable</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Country rules</Text>
        <TextInput
          value={ruleForm.countryCode}
          onChangeText={(value) => setRuleForm((prev) => ({ ...prev, countryCode: value }))}
          placeholder="Country"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
        <TextInput
          value={ruleForm.minAge}
          onChangeText={(value) => setRuleForm((prev) => ({ ...prev, minAge: value }))}
          placeholder="Min age"
          placeholderTextColor="rgba(255,255,255,0.35)"
          keyboardType="number-pad"
          style={styles.input}
        />
        <TextInput
          value={ruleForm.duelsEnabled}
          onChangeText={(value) => setRuleForm((prev) => ({ ...prev, duelsEnabled: value }))}
          placeholder="duels enabled"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
        <TextInput
          value={ruleForm.paywallEnabled}
          onChangeText={(value) => setRuleForm((prev) => ({ ...prev, paywallEnabled: value }))}
          placeholder="paywall enabled"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
        <TextInput
          value={ruleForm.blockedKeywords}
          onChangeText={(value) => setRuleForm((prev) => ({ ...prev, blockedKeywords: value }))}
          placeholder="blocked,keywords"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
        <TouchableOpacity style={styles.buttonPrimary} onPress={submitRule}>
          <Text style={styles.buttonPrimaryText}>Save country rule</Text>
        </TouchableOpacity>
        {(rules || []).slice(0, 5).map((rule) => (
          <Text key={rule.country_code} style={styles.metaText}>
            {rule.country_code} · min age {rule.min_age} · duels {String(rule.duels_enabled)} · paywall {String(rule.paywall_enabled)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 12,
  },
  sectionTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "700",
  },
  sectionHint: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 11,
    fontWeight: "600",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statCard: {
    width: "48%",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  statValue: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
  },
  statLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 18,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  inlineHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  itemCard: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 14,
    padding: 12,
    gap: 6,
  },
  itemTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  metaText: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
  },
  errorText: {
    color: "#FF9AA1",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 8,
  },
  buttonPrimary: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#8FE7C7",
  },
  buttonPrimaryText: {
    color: "#071218",
    fontSize: 13,
    fontWeight: "900",
  },
  buttonGhost: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  buttonGhostText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 13,
    fontWeight: "800",
  },
  buttonDanger: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,90,104,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,90,104,0.3)",
  },
  buttonDangerText: {
    color: "#FF9AA1",
    fontSize: 13,
    fontWeight: "900",
  },
});
