import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useConnectivity } from "../context/ConnectivityContext";
import { useScreenInsets } from "../hooks/useScreenInsets";

export default function NetworkBanner() {
  const { status, refresh } = useConnectivity();
  const insets = useScreenInsets();

  if (status === "online") {
    return null;
  }

  return (
    <View style={[styles.wrap, { top: insets.top + 6 }]} pointerEvents="box-none">
      <LinearGradient colors={["#351B12", "#472013"]} style={styles.banner}>
        <Ionicons name="cloud-offline" size={18} color="#FFD7A8" />
        <View style={styles.copyWrap}>
          <Text style={styles.title}>Pa internet</Text>
          <Text style={styles.text} numberOfLines={2}>
            Po shfaqim çfarë kemi · lidhu sërish për të rifreskuar.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.button}
          onPress={refresh}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel="Provo sërish lidhjen"
        >
          <Text style={styles.buttonText}>Provo</Text>
        </TouchableOpacity>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 1000,
    alignItems: "center",
  },
  banner: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255,184,117,0.22)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  copyWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: "#FFF4E2",
    fontSize: 12,
    fontWeight: "900",
  },
  text: {
    color: "rgba(255,244,226,0.92)",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 15,
  },
  button: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
});
