import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getCurrentApiBaseUrl, probeApiHealth, subscribeNetworkStatus } from "../services/api";

type ConnectivityStatus = "online" | "degraded";

type ConnectivityContextValue = {
  status: ConnectivityStatus;
  endpoint: string;
  refresh: () => Promise<void>;
};

const ConnectivityContext = createContext<ConnectivityContextValue | undefined>(undefined);

export function ConnectivityProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ConnectivityStatus>("online");
  const [endpoint, setEndpoint] = useState(getCurrentApiBaseUrl());

  useEffect(() => {
    return subscribeNetworkStatus((nextStatus) => {
      setStatus(nextStatus);
      setEndpoint(getCurrentApiBaseUrl());
    });
  }, []);

  const value = useMemo(
    () => ({
      status,
      endpoint,
      refresh: async () => {
        const nextStatus = await probeApiHealth();
        setStatus(nextStatus);
        setEndpoint(getCurrentApiBaseUrl());
      },
    }),
    [endpoint, status]
  );

  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}

export function useConnectivity() {
  const context = useContext(ConnectivityContext);
  if (!context) {
    throw new Error("useConnectivity must be used inside ConnectivityProvider");
  }

  return context;
}
