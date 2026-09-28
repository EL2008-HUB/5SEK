import Constants from "expo-constants";

/** True when running inside the Expo Go client (not a standalone/dev build). */
export function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}
