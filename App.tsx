import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { AppState, View, Text, StyleSheet, ScrollView } from "react-native";
import AppNavigator from "./src/navigation/AppNavigator";
import { AuthProvider } from "./src/context/AuthContext";
import { countryApi } from "./src/services/api";
import { ConnectivityProvider } from "./src/context/ConnectivityContext";
import NetworkBanner from "./src/components/NetworkBanner";
import { analytics } from "./src/services/analytics";
import { installObservability, captureException, Sentry } from "./src/services/observability";
import { PushProvider } from "./src/context/PushContext";
import { FusionLoopProvider } from "./src/context/FusionLoopContext";
import FusionBadgeToast from "./src/components/FusionBadgeToast";

// Error Boundary to catch initialization errors
function ErrorFallback({ error }: { error: Error }) {
  return (
    <ScrollView style={styles.errorContainer} contentContainerStyle={styles.errorContent}>
      <Text style={styles.errorTitle}>App Failed to Start</Text>
      <Text style={styles.errorMessage}>{error.message}</Text>
      {__DEV__ && (
        <Text style={styles.errorStack}>{error.stack}</Text>
      )}
    </ScrollView>
  );
}

// React class ErrorBoundary that reports uncaught JS errors to Sentry
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class SentryErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    captureException(error, {
      extra: { componentStack: errorInfo.componentStack },
      tags: { source: "error_boundary" },
    });
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return <ErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}

function AppContent() {
  const [initError, setInitError] = useState<Error | null>(null);

  useEffect(() => {
    try {
      // Initialize observability safely
      installObservability();
    } catch (e) {
      console.error("[App] Sentry init failed:", e);
      // Non-fatal - continue without Sentry
    }

    try {
      analytics.appOpen();
    } catch (e) {
      console.error("[App] Analytics failed:", e);
    }

    // Load persisted country on app boot so X-User-Country header is set
    countryApi.loadCountry().then((c) => {
      if (__DEV__) console.log("[App] Country loaded:", c);
    }).catch((e) => {
      console.error("[App] Country load failed:", e);
    });

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        try {
          analytics.appResume();
        } catch (e) {
          console.error("[App] Resume analytics failed:", e);
        }
      } else if (nextState === "background" || nextState === "inactive") {
        try {
          analytics.appBackgrounded();
        } catch (e) {
          console.error("[App] Background analytics failed:", e);
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  if (initError) {
    return <ErrorFallback error={initError} />;
  }

  return (
    <>
      <StatusBar style="light" />
      <NetworkBanner />
      <FusionBadgeToast />
      <AppNavigator />
    </>
  );
}

export function App() {
  return (
    <SentryErrorBoundary>
      <View style={styles.container}>
        <ConnectivityProvider>
          <AuthProvider>
            <FusionLoopProvider>
              <PushProvider>
                <AppContent />
              </PushProvider>
            </FusionLoopProvider>
          </AuthProvider>
        </ConnectivityProvider>
      </View>
    </SentryErrorBoundary>
  );
}

export default Sentry.wrap(App);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F0F1A",
  },
  errorContainer: {
    flex: 1,
    backgroundColor: "#0F0F1A",
    padding: 20,
  },
  errorContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#FF3366",
    marginBottom: 16,
    textAlign: "center",
  },
  errorMessage: {
    fontSize: 16,
    color: "#FFFFFF",
    marginBottom: 20,
    textAlign: "center",
  },
  errorStack: {
    fontSize: 12,
    color: "#888888",
    fontFamily: "monospace",
  },
});
