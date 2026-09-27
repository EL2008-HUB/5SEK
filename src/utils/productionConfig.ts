import Constants from "expo-constants";

function readExtraFlag(name: string, fallback = false): boolean {
  const extra = (Constants.expoConfig?.extra || {}) as Record<string, unknown>;
  const value = extra[name];
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return fallback;
}

export function isMonetizationEnabled(): boolean {
  if (__DEV__) return true;
  return readExtraFlag("monetizationEnabled", false);
}

export function getPublicApiOrigin(): string {
  const apiUrl =
    (Constants.expoConfig?.extra as any)?.apiUrl ||
    process.env.EXPO_PUBLIC_API_URL ||
    "";
  const normalized = String(apiUrl).trim().replace(/\/$/, "");
  if (!normalized) return "https://5sek-api.onrender.com";
  return normalized.replace(/\/api$/, "");
}

export function getLegalTermsUrl(): string {
  return `${getPublicApiOrigin()}/legal/terms`;
}

export function getLegalPrivacyUrl(): string {
  return `${getPublicApiOrigin()}/legal/privacy`;
}
