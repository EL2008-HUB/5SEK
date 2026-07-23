import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useConnectivity } from "../context/ConnectivityContext";

export default function NetworkBanner() {
  const { status, refresh } = useConnectivity();

  if (status === "online") {
    return null;
  }

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <LinearGradient colors={["#351B12", "#472013"]} style={styles.banner}>
        <View style={styles.copyWrap}>
          <Text style={styles.title}>Offline</Text>
          <Text style={styles.text}>Showing what we can · reconnect to refresh.</Text>
        </View>
        <TouchableOpacity style={styles.button} onPress={refresh} activeOpacity={0.9}>
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 14,
    right: 14,
    zIndex: 1000,
    alignItems: "flex-end",
  },
  banner: {
    width: "100%",
    maxWidth: 390,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255,184,117,0.22)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
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
    borderRadius: 8,
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
