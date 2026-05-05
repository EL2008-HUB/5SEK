import React, { useEffect, useState } from "react";
import { Alert, Linking, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { getApiErrorMessage, legalApi, paymentsApi, supportApi } from "../services/api";
import { useAuth } from "../context/AuthContext";

type Props = {
  isPremium?: boolean;
};

function extractStripeRefundId(notes?: string | null) {
  if (!notes) return null;
  const match = String(notes).match(/stripe_refund_id=([A-Za-z0-9_]+)/);
  return match?.[1] || null;
}

export default function AccountOperations({ isPremium }: Props) {
  const { logout } = useAuth();
  const [consent, setConsent] = useState({
    analytics: false,
    marketing: false,
    thirdParty: false,
  });
  const [ticket, setTicket] = useState({
    category: "account_issue",
    subject: "",
    description: "",
  });
  const [refund, setRefund] = useState({
    reason: "technical_issue",
    amount: "4.99",
    details: "",
    stripePaymentIntentId: "",
  });
  const [exports, setExports] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [refunds, setRefunds] = useState<any[]>([]);
  const [deletionStatus, setDeletionStatus] = useState<any>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [supportError, setSupportError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [consentRes, exportRes, deletionRes, ticketRes, refundRes] = await Promise.all([
        legalApi.getConsent(),
        legalApi.listExportRequests(),
        legalApi.getDeletionStatus(),
        supportApi.getMyTickets(),
        supportApi.getMyRefunds(),
      ]);
      setConsent(consentRes.data || {});
      setExports(exportRes.data?.requests || []);
      setDeletionStatus(deletionRes.data || null);
      setTickets(ticketRes.data?.tickets || []);
      setRefunds(refundRes.data?.requests || []);
    } catch (error) {
      console.log("Account operations refresh failed:", error);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const showLegalDoc = async (kind: "terms" | "privacy") => {
    try {
      const response = kind === "terms" ? await legalApi.getTerms() : await legalApi.getPrivacy();
      const sections = response.data?.sections || [];
      const summary = sections
        .slice(0, 3)
        .map((section: any) => `${section.title}: ${section.content}`)
        .join("\n\n");
      Alert.alert(
        kind === "terms" ? "Terms" : "Privacy Policy",
        summary.length > 1500 ? `${summary.slice(0, 1500)}...` : summary
      );
    } catch (_) {
      Alert.alert("Unavailable", `Could not load ${kind} right now.`);
    }
  };

  const saveConsent = async (nextConsent: typeof consent) => {
    setConsent(nextConsent);
    try {
      await legalApi.saveConsent(nextConsent);
    } catch (error) {
      Alert.alert("Save failed", getApiErrorMessage(error, "Could not update privacy preferences."));
    }
  };

  const requestExport = async () => {
    setExportError(null);
    try {
      const response = await legalApi.requestExport("full");
      Alert.alert(
        "Export queued",
        response.data?.request?.downloadUrl
          ? "A signed export is already ready."
          : "A data export request was queued. Refresh this section in a moment."
      );
      await refresh();
    } catch (error) {
      const message = getApiErrorMessage(error, "Could not queue a data export request.");
      setExportError(message);
      Alert.alert("Export failed", message);
    }
  };

  const openSignedExport = async (requestId: number) => {
    setExportError(null);
    try {
      const response = await legalApi.getExportLink(requestId);
      const downloadUrl = response.data?.downloadUrl;
      if (!downloadUrl) {
        throw new Error("Signed export URL missing.");
      }
      await Linking.openURL(downloadUrl);
    } catch (error) {
      const message = getApiErrorMessage(error, "Could not open the signed export link.");
      setExportError(message);
      Alert.alert("Export unavailable", message);
    }
  };

  const submitTicket = async () => {
    setSupportError(null);
    if (!ticket.subject.trim() || !ticket.description.trim()) {
      Alert.alert("Missing details", "Subject and description are required.");
      return;
    }

    try {
      await supportApi.createTicket({
        category: ticket.category,
        subject: ticket.subject.trim(),
        description: ticket.description.trim(),
        priority: ticket.category === "billing" ? "high" : "medium",
      });
      setTicket({ category: "account_issue", subject: "", description: "" });
      await refresh();
      Alert.alert("Submitted", "Support ticket created.");
    } catch (error) {
      const message = getApiErrorMessage(error, "Could not create a support ticket.");
      setSupportError(message);
      Alert.alert("Support failed", message);
    }
  };

  const submitRefund = async () => {
    setRefundError(null);
    try {
      await supportApi.createRefund({
        reason: refund.reason,
        amount: Number(refund.amount),
        details: refund.details.trim(),
        stripePaymentIntentId: refund.stripePaymentIntentId.trim() || undefined,
      });
      setRefund({
        reason: "technical_issue",
        amount: "4.99",
        details: "",
        stripePaymentIntentId: "",
      });
      await refresh();
      Alert.alert("Submitted", "Refund request created.");
    } catch (error) {
      const message = getApiErrorMessage(error, "Could not create the refund request.");
      setRefundError(message);
      Alert.alert("Refund failed", message);
    }
  };

  const requestDeletion = async () => {
    try {
      const response = await legalApi.requestDeleteAccount();
      Alert.alert(
        "Deletion scheduled",
        response.data?.billingPortalUrl
          ? "Deletion was scheduled. Cancel billing first from the billing portal."
          : "Deletion was scheduled for this account."
      );
      await logout();
    } catch (error) {
      Alert.alert("Delete failed", getApiErrorMessage(error, "Could not schedule account deletion."));
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Legal & Support</Text>
      <Text style={styles.sectionHint}>Privacy controls, exports, deletion, tickets, and refunds.</Text>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.buttonGhost} onPress={() => showLegalDoc("terms")}>
          <Text style={styles.buttonGhostText}>Terms</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.buttonGhost} onPress={() => showLegalDoc("privacy")}>
          <Text style={styles.buttonGhostText}>Privacy</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Consent</Text>
        {[
          ["analytics", "Analytics"],
          ["marketing", "Marketing"],
          ["thirdParty", "Third-party"],
        ].map(([key, label]) => (
          <View key={key} style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>{label}</Text>
            <Switch
              value={Boolean((consent as any)[key])}
              onValueChange={(value) => saveConsent({ ...consent, [key]: value })}
            />
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Data export</Text>
        <TouchableOpacity style={styles.buttonPrimary} onPress={requestExport}>
          <Text style={styles.buttonPrimaryText}>Queue export</Text>
        </TouchableOpacity>
        {exportError ? <Text style={styles.errorText}>{exportError}</Text> : null}
        {(exports || []).slice(0, 3).map((item) => (
          <View key={item.id} style={styles.subCard}>
            <Text style={styles.metaText}>#{item.id} · {item.status}</Text>
            <Text style={styles.metaText}>Created: {item.createdAt || "n/a"}</Text>
            <Text style={styles.metaText}>Expires: {item.expiresAt || "n/a"}</Text>
            {item.downloadUrl ? (
              <TouchableOpacity style={styles.buttonGhost} onPress={() => openSignedExport(item.id)}>
                <Text style={styles.buttonGhostText}>Open signed export</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.metaText}>Signed export not ready yet.</Text>
            )}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Support ticket</Text>
        <TextInput
          value={ticket.category}
          onChangeText={(value) => setTicket((prev) => ({ ...prev, category: value }))}
          placeholder="Category"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
        <TextInput
          value={ticket.subject}
          onChangeText={(value) => setTicket((prev) => ({ ...prev, subject: value }))}
          placeholder="Subject"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
        <TextInput
          value={ticket.description}
          onChangeText={(value) => setTicket((prev) => ({ ...prev, description: value }))}
          placeholder="Describe the problem"
          placeholderTextColor="rgba(255,255,255,0.35)"
          multiline
          style={[styles.input, styles.inputTall]}
        />
        <TouchableOpacity style={styles.buttonPrimary} onPress={submitTicket}>
          <Text style={styles.buttonPrimaryText}>Send ticket</Text>
        </TouchableOpacity>
        {supportError ? <Text style={styles.errorText}>{supportError}</Text> : null}
        {(tickets || []).slice(0, 3).map((item) => (
          <Text key={item.id} style={styles.metaText}>
            #{item.id} · {item.status} · {item.subject}
          </Text>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Refund request</Text>
        <TextInput
          value={refund.reason}
          onChangeText={(value) => setRefund((prev) => ({ ...prev, reason: value }))}
          placeholder="Reason"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
        <TextInput
          value={refund.amount}
          onChangeText={(value) => setRefund((prev) => ({ ...prev, amount: value }))}
          placeholder="Amount"
          placeholderTextColor="rgba(255,255,255,0.35)"
          keyboardType="decimal-pad"
          style={styles.input}
        />
        <TextInput
          value={refund.stripePaymentIntentId}
          onChangeText={(value) => setRefund((prev) => ({ ...prev, stripePaymentIntentId: value }))}
          placeholder="Stripe payment intent id"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
        <TextInput
          value={refund.details}
          onChangeText={(value) => setRefund((prev) => ({ ...prev, details: value }))}
          placeholder="Refund details"
          placeholderTextColor="rgba(255,255,255,0.35)"
          multiline
          style={[styles.input, styles.inputTall]}
        />
        <TouchableOpacity style={styles.buttonPrimary} onPress={submitRefund}>
          <Text style={styles.buttonPrimaryText}>Request refund</Text>
        </TouchableOpacity>
        {refundError ? <Text style={styles.errorText}>{refundError}</Text> : null}
        {(refunds || []).slice(0, 3).map((item) => (
          <View key={item.id} style={styles.subCard}>
            <Text style={styles.metaText}>
              #{item.id} · {item.status} · {item.amount} {item.currency}
            </Text>
            {item.stripe_payment_intent_id ? (
              <Text style={styles.metaText}>Payment intent: {item.stripe_payment_intent_id}</Text>
            ) : null}
            {extractStripeRefundId(item.admin_notes) ? (
              <Text style={styles.metaText}>Stripe refund: {extractStripeRefundId(item.admin_notes)}</Text>
            ) : null}
            {item.admin_notes ? <Text style={styles.metaText}>Admin notes: {item.admin_notes}</Text> : null}
          </View>
        ))}
      </View>

      {isPremium ? (
        <TouchableOpacity
          style={styles.buttonGhost}
          onPress={() =>
            paymentsApi
              .createPortal()
              .then((response) => {
                if (response.data?.url) {
                  return Linking.openURL(response.data.url);
                }
                Alert.alert("Billing portal", "Portal URL was not returned by the backend.");
              })
              .catch((error) => Alert.alert("Billing unavailable", getApiErrorMessage(error, "Could not open billing portal.")))
          }
        >
          <Text style={styles.buttonGhostText}>Open billing portal</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Delete account</Text>
        <Text style={styles.metaText}>
          {deletionStatus?.status === "scheduled_for_deletion"
            ? `Scheduled: ${deletionStatus.permanentDeletionDate}`
            : "No deletion currently scheduled."}
        </Text>
        {deletionStatus?.status === "scheduled_for_deletion" ? (
          <TouchableOpacity
            style={styles.buttonGhost}
            onPress={() =>
              legalApi
                .cancelDeletion()
                .then(() => refresh())
                .catch((error) => Alert.alert("Cancel failed", getApiErrorMessage(error, "Could not cancel deletion.")))
            }
          >
            <Text style={styles.buttonGhostText}>Cancel deletion</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.buttonDanger} onPress={requestDeletion}>
            <Text style={styles.buttonDangerText}>Schedule deletion</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={styles.buttonGhost} onPress={logout}>
        <Text style={styles.buttonGhostText}>Log out</Text>
      </TouchableOpacity>
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
  buttonRow: {
    flexDirection: "row",
    gap: 10,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 18,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  subCard: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  toggleLabel: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 13,
    fontWeight: "700",
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
  inputTall: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  buttonPrimary: {
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
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  buttonGhostText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 13,
    fontWeight: "800",
  },
  buttonDanger: {
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
});
