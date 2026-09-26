import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const memoryStorage = new Map<string, string>();
const SECURE_KEYS = new Set(["@5sek_auth_token", "@5sek_refresh_token"]);

function hasBrowserStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isMissingNativeStorage(error: unknown) {
  const message = String((error as any)?.message || error || "");
  return message.includes("Native module is null") || message.includes("legacy storage");
}

function shouldUseSecureStore(key: string) {
  return Platform.OS !== "web" && SECURE_KEYS.has(key);
}

async function withFallback<T>(action: () => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!isMissingNativeStorage(error)) throw error;
    return fallback();
  }
}

export const storage = {
  async getItem(key: string): Promise<string | null> {
    if (shouldUseSecureStore(key)) {
      return withFallback(
        () => SecureStore.getItemAsync(key),
        () => memoryStorage.get(key) ?? null
      );
    }
    return withFallback(
      () => AsyncStorage.getItem(key),
      () => (hasBrowserStorage() ? window.localStorage.getItem(key) : memoryStorage.get(key) ?? null)
    );
  },

  async setItem(key: string, value: string): Promise<void> {
    if (shouldUseSecureStore(key)) {
      return withFallback(
        () => SecureStore.setItemAsync(key, value),
        () => { memoryStorage.set(key, value); }
      );
    }
    return withFallback(
      () => AsyncStorage.setItem(key, value),
      () => {
        if (hasBrowserStorage()) window.localStorage.setItem(key, value);
        else memoryStorage.set(key, value);
      }
    );
  },

  async removeItem(key: string): Promise<void> {
    if (shouldUseSecureStore(key)) {
      return withFallback(
        () => SecureStore.deleteItemAsync(key),
        () => { memoryStorage.delete(key); }
      );
    }
    return withFallback(
      () => AsyncStorage.removeItem(key),
      () => {
        if (hasBrowserStorage()) window.localStorage.removeItem(key);
        else memoryStorage.delete(key);
      }
    );
  },
};

export function getStorageMode() {
  if (Platform.OS === "web" && hasBrowserStorage()) return "web-local-storage";
  return Platform.OS === "web" ? "memory" : "secure-store+async-storage";
}
