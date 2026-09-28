import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const memoryStorage = new Map<string, string>();

/** Logical app keys use @; SecureStore only allows [A-Za-z0-9._-]. */
const SECURE_KEY_MAP: Record<string, string> = {
  "@5sek_auth_token": "5sek_auth_token",
  "@5sek_refresh_token": "5sek_refresh_token",
};

function isSecureKey(key: string) {
  return Object.prototype.hasOwnProperty.call(SECURE_KEY_MAP, key);
}

function secureNativeKey(logicalKey: string) {
  return SECURE_KEY_MAP[logicalKey];
}

function shouldUseSecureStore(key: string) {
  return Platform.OS !== "web" && isSecureKey(key);
}

function hasBrowserStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isMissingNativeStorage(error: unknown) {
  const message = String((error as any)?.message || error || "");
  return message.includes("Native module is null") || message.includes("legacy storage");
}

function isSecureStoreFallbackError(error: unknown) {
  const message = String((error as any)?.message || error || "");
  return isMissingNativeStorage(error) || message.includes("Invalid key provided to SecureStore");
}

async function withStorageFallback<T>(
  action: () => Promise<T>,
  fallback: () => T | Promise<T>
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!isSecureStoreFallbackError(error)) throw error;
    return fallback();
  }
}

async function migrateLegacySecureValue(logicalKey: string, nativeKey: string): Promise<string | null> {
  const legacy = await AsyncStorage.getItem(logicalKey);
  if (!legacy) return null;
  try {
    await SecureStore.setItemAsync(nativeKey, legacy);
    await AsyncStorage.removeItem(logicalKey);
  } catch (_) {
    // Keep serving from AsyncStorage if secure storage is unavailable.
  }
  return legacy;
}

export const storage = {
  async getItem(key: string): Promise<string | null> {
    if (shouldUseSecureStore(key)) {
      const nativeKey = secureNativeKey(key);
      const fromSecure = await withStorageFallback(
        () => SecureStore.getItemAsync(nativeKey),
        () => memoryStorage.get(key) ?? null
      );
      if (fromSecure != null) return fromSecure;
      return migrateLegacySecureValue(key, nativeKey);
    }
    return withStorageFallback(
      () => AsyncStorage.getItem(key),
      () => (hasBrowserStorage() ? window.localStorage.getItem(key) : memoryStorage.get(key) ?? null)
    );
  },

  async setItem(key: string, value: string): Promise<void> {
    if (shouldUseSecureStore(key)) {
      const nativeKey = secureNativeKey(key);
      await withStorageFallback(
        () => SecureStore.setItemAsync(nativeKey, value),
        async () => {
          memoryStorage.set(key, value);
          await AsyncStorage.setItem(key, value);
        }
      );
      await AsyncStorage.removeItem(key).catch(() => {});
      return;
    }
    return withStorageFallback(
      () => AsyncStorage.setItem(key, value),
      () => {
        if (hasBrowserStorage()) window.localStorage.setItem(key, value);
        else memoryStorage.set(key, value);
      }
    );
  },

  async removeItem(key: string): Promise<void> {
    if (shouldUseSecureStore(key)) {
      const nativeKey = secureNativeKey(key);
      await withStorageFallback(
        () => SecureStore.deleteItemAsync(nativeKey),
        () => {
          memoryStorage.delete(key);
        }
      );
      await AsyncStorage.removeItem(key).catch(() => {});
      return;
    }
    return withStorageFallback(
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
