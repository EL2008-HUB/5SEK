import { Alert, Platform } from "react-native";

export function showAppAlert(title: string, message?: string) {
  if (Platform.OS === "web") {
    // RN Web's Alert is easy to miss / inconsistently surfaced in some setups.
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}
