export const Colors = {
  background: {
    dark: "#050508",
    mid: "#0C0C14",
    card: "rgba(255,255,255,0.06)",
    gradient: ["#050508", "#0E0A18", "#12081A"] as const,
    authGradient: ["#050508", "#1A0B24", "#0A1220"] as const,
  },
  accent: {
    pink: "#FF2D6A",
    violet: "#8B5CFF",
    mint: "#3DFFC8",
    gold: "#FFC857",
    primaryGradient: ["#FF2D6A", "#FF5C8A"] as const,
    secondaryGradient: ["#8B5CFF", "#5B8CFF"] as const,
    mintGradient: ["#3DFFC8", "#2EE0B8"] as const,
    dangerGradient: ["#FF2D6A", "#FF6B3D"] as const,
  },
  text: {
    primary: "#FFFFFF",
    secondary: "rgba(255,255,255,0.72)",
    tertiary: "rgba(255,255,255,0.48)",
    inverse: "#0A0A10",
  },
  border: "rgba(255,255,255,0.10)",
};

export const GlobalStyles = {
  container: {
    flex: 1,
    backgroundColor: Colors.background.dark,
  },
  glassCard: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 28,
  },
  ambientOrbTop: {
    position: "absolute" as const,
    width: 280,
    height: 280,
    borderRadius: 140,
    top: -100,
    right: -80,
    backgroundColor: "rgba(255,45,106,0.22)",
  },
  ambientOrbBottom: {
    position: "absolute" as const,
    width: 260,
    height: 260,
    borderRadius: 130,
    bottom: -90,
    left: -70,
    backgroundColor: "rgba(139,92,255,0.18)",
  },
};

export const Shadows = {
  glowPrimary: {
    shadowColor: "#FF2D6A",
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  glowMint: {
    shadowColor: "#3DFFC8",
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
};
