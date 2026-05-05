import { storage } from "../services/storage";

const PAYWALL_LAST_SHOWN_KEY = "@5sek_paywall_last_shown";
const PAYWALL_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Check if we should show the paywall or if the cooldown is still active.
 * Returns true if enough time has passed since the last showing.
 */
export async function canShowPaywall(): Promise<boolean> {
  try {
    const lastShown = await storage.getItem(PAYWALL_LAST_SHOWN_KEY);
    if (!lastShown) return true;

    const elapsed = Date.now() - parseInt(lastShown, 10);
    return elapsed >= PAYWALL_COOLDOWN_MS;
  } catch {
    return true;
  }
}

/**
 * Mark that the paywall was just shown (starts the cooldown).
 */
export async function markPaywallShown(): Promise<void> {
  try {
    await storage.setItem(PAYWALL_LAST_SHOWN_KEY, String(Date.now()));
  } catch {}
}

/**
 * Get remaining cooldown seconds (for display purposes).
 * Returns 0 if cooldown is over.
 */
export async function getPaywallCooldownRemaining(): Promise<number> {
  try {
    const lastShown = await storage.getItem(PAYWALL_LAST_SHOWN_KEY);
    if (!lastShown) return 0;

    const elapsed = Date.now() - parseInt(lastShown, 10);
    const remaining = PAYWALL_COOLDOWN_MS - elapsed;
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  } catch {
    return 0;
  }
}
