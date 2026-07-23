import * as Notifications from "expo-notifications";
import { storage } from "./storage";

const PROMPT_DISMISS_KEY = "@5sek_push_prompt_dismissed_at";
const PROMPT_SHOWN_COUNT_KEY = "@5sek_push_prompt_shown_count";
const DAILY_REMINDER_ID = "5sek-daily-question-reminder";

/** Soft-prompt cool-down after dismiss (7 days). */
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
/** Max soft prompts before we stop nagging (Profile CTA still available). */
const MAX_SOFT_PROMPTS = 3;

export async function shouldShowPushSoftPrompt(): Promise<boolean> {
  const dismissedAt = Number((await storage.getItem(PROMPT_DISMISS_KEY)) || 0);
  if (dismissedAt && Date.now() - dismissedAt < DISMISS_COOLDOWN_MS) {
    return false;
  }

  const shown = Number((await storage.getItem(PROMPT_SHOWN_COUNT_KEY)) || 0);
  return shown < MAX_SOFT_PROMPTS;
}

export async function markPushSoftPromptShown(): Promise<void> {
  const shown = Number((await storage.getItem(PROMPT_SHOWN_COUNT_KEY)) || 0);
  await storage.setItem(PROMPT_SHOWN_COUNT_KEY, String(shown + 1));
}

export async function dismissPushSoftPrompt(): Promise<void> {
  await storage.setItem(PROMPT_DISMISS_KEY, String(Date.now()));
}

export async function scheduleDailyQuestionReminder(hour = 19, minute = 0): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_ID).catch(() => {});

    await Notifications.scheduleNotificationAsync({
      identifier: DAILY_REMINDER_ID,
      content: {
        title: "Today's 5SEK question is live",
        body: "Answer in 5 seconds — keep your streak warm.",
        data: { deeplink: "five-second://feed" },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });
  } catch (_) {
    // Local scheduling is best-effort (simulator / Expo Go / denied).
  }
}

export async function cancelDailyQuestionReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_ID);
  } catch (_) {}
}
