import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const memoryStorage = new Map<string, string>();

function hasBrowserStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isMissingNativeStorage(error: unknown) {
  const message = String((error as any)?.message || error || "");
  return message.includes("Native module is null") || message.includes("legacy storage");
}

async function withFallback<T>(
  action: () => Promise<T>,
  fallback: () => T | Promise<T>
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!isMissingNativeStorage(error)) {
      throw error;
    }

    return fallback();
  }
}

export const storage = {
  async getItem(key: string): Promise<string | null> {
    return withFallback(
      () => AsyncStorage.getItem(key),
      () => {
        if (hasBrowserStorage()) {
          return window.localStorage.getItem(key);
        }
        return memoryStorage.get(key) ?? null;
      }
    );
  },

  async setItem(key: string, value: string): Promise<void> {
    return withFallback(
      () => AsyncStorage.setItem(key, value),
      () => {
        if (hasBrowserStorage()) {
          window.localStorage.setItem(key, value);
          return;
        }
        memoryStorage.set(key, value);
      }
    );
  },

  async removeItem(key: string): Promise<void> {
    return withFallback(
      () => AsyncStorage.removeItem(key),
      () => {
        if (hasBrowserStorage()) {
          window.localStorage.removeItem(key);
          return;
        }
        memoryStorage.delete(key);
      }
    );
  },
};

export function getStorageMode() {
  if (Platform.OS === "web" && hasBrowserStorage()) {
    return "web-local-storage";
  }
  return "native-async-storage";
}
