import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MIN_TOP = Platform.OS === "web" ? 12 : 20;

/**
 * Real device insets (notch / Dynamic Island / Android status + nav bar)
 * with sensible minimums, so layouts never sit under system UI.
 */
export function useScreenInsets() {
  const insets = useSafeAreaInsets();
  const top = Math.max(insets.top, MIN_TOP);
  const bottom = insets.bottom;
  return {
    top,
    bottom,
    left: insets.left,
    right: insets.right,
    /** Top padding for a screen header: inset + breathing room. */
    headerTop: (extra = 12) => top + extra,
    /** Bottom padding for screens without the tab bar. */
    footerBottom: (extra = 12) => Math.max(bottom, 8) + extra,
  };
}
