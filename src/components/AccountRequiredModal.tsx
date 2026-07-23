import React from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

type Props = {
  visible: boolean;
  title: string;
  message: string;
  onCreateAccount: () => void;
  onDismiss: () => void;
};

export default function AccountRequiredModal({
  visible,
  title,
  message,
  onCreateAccount,
  onDismiss,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <TouchableOpacity style={styles.primaryWrap} onPress={onCreateAccount} activeOpacity={0.9}>
            <LinearGradient colors={["#FF5A7A", "#FF3366"]} style={styles.primary}>
              <Text style={styles.primaryText}>Create account</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={onDismiss}>
            <Text style={styles.secondaryText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 24,
    padding: 22,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 10,
    textAlign: "center",
  },
  message: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 20,
  },
  primaryWrap: {
    borderRadius: 16,
    overflow: "hidden",
  },
  primary: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  secondary: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  secondaryText: {
    color: "rgba(255,255,255,0.56)",
    fontSize: 14,
    fontWeight: "800",
  },
});
