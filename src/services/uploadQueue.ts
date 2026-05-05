import { AnswerType } from "../contracts/api";
import { storage } from "./storage";

const STORAGE_KEY = "@5sek_upload_queue";

export type UploadDraft = {
  id: string;
  questionId: number;
  mediaUri: string;
  answerType: Extract<AnswerType, "video" | "audio">;
  responseTime: number;
  screen: "record" | "audio_answer";
  failedAt?: string | null;
};

async function readDrafts(): Promise<UploadDraft[]> {
  const raw = await storage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw) as UploadDraft[];
  } catch (_) {
    return [];
  }
}

async function writeDrafts(drafts: UploadDraft[]) {
  await storage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

export async function enqueueUploadDraft(draft: UploadDraft) {
  const drafts = await readDrafts();
  const nextDrafts = drafts.filter((entry) => entry.id !== draft.id);
  nextDrafts.unshift(draft);
  await writeDrafts(nextDrafts.slice(0, 10));
}

export async function markUploadFailed(id: string) {
  const drafts = await readDrafts();
  await writeDrafts(
    drafts.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            failedAt: new Date().toISOString(),
          }
        : entry
    )
  );
}

export async function clearUploadDraft(id: string) {
  const drafts = await readDrafts();
  await writeDrafts(drafts.filter((entry) => entry.id !== id));
}

export async function getLatestFailedDraft(screen: UploadDraft["screen"]) {
  const drafts = await readDrafts();
  return drafts.find((entry) => entry.screen === screen && Boolean(entry.failedAt)) || null;
}
