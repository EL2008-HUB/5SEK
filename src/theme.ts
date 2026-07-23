export const Colors = {
  background: {
    gradient: ["#060D14", "#0B161E", "#101E28"] as const,
  },
  accent: {
    primaryGradient: ["#6EEDC1", "#48D9B5"] as const,
    dangerGradient: ["#FF5A7A", "#FF3366"] as const,
  },
  text: {
    tertiary: "rgba(229,240,248,0.5)",
  },
};

export const GlobalStyles = {
  container: {
    flex: 1,
    backgroundColor: "#0F0F1A",
  },
  glassCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 24,
  },
  ambientOrbTop: {
    position: "absolute" as const,
    width: 220,
    height: 220,
    borderRadius: 110,
    top: -80,
    right: -80,
    backgroundColor: "rgba(255,51,102,0.16)",
  },
  ambientOrbBottom: {
    position: "absolute" as const,
    width: 240,
    height: 240,
    borderRadius: 120,
    bottom: -120,
    left: -90,
    backgroundColor: "rgba(110,237,193,0.12)",
  },
};

export const Shadows = {
  glowPrimary: {
    shadowColor: "#FF3366",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
};
