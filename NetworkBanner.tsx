import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useConnectivity } from "../context/ConnectivityContext";

function compactEndpointLabel(endpoint: string) {
  return endpoint.replace(/^https?:\/\//, "");
}

export default function NetworkBanner() {
  const { status, endpoint, refresh } = useConnectivity();

  if (status === "online") {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <LinearGradient colors={["#5B2206", "#7D3309", "#4F190D"]} style={styles.banner}>
        <View style={styles.signalDot} />
        <View style={styles.copyWrap}>
          <Text style={styles.title}>API offline</Text>
          <Text style={styles.text}>Auth and feed actions will fail until the backend is reachable.</Text>
          <Text style={styles.endpoint}>Target: {compactEndpointLabel(endpoint)}</Text>
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
    top: 12,
    left: 12,
    right: 12,
    zIndex: 1000,
  },
  banner: {
    borderRadius: 22,
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "rgba(255,214,171,0.16)",
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  signalDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#FFD0A0",
    marginTop: 2,
  },
  copyWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: "#FFF4E2",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  text: {
    color: "rgba(255,244,226,0.92)",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  endpoint: {
    color: "rgba(255,219,179,0.82)",
    fontSize: 11,
    fontWeight: "700",
  },
  button: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
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
