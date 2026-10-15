import { normalizeSportteryMatchId } from "./sporttery";

export const MAX_PERSONAL_MATCH_NOTE_LENGTH = 2000;
export const MAX_PERSONAL_MATCH_NOTE_ID_LENGTH = 128;
export const MAX_PERSONAL_MATCH_NOTE_BATCH_SIZE = 100;

export type PersonalMatchNote = {
  matchId: string;
  note: string;
  revision: number;
  updatedAt: string;
};

export type PersonalMatchNotes = Record<string, PersonalMatchNote>;
export type PersonalMatchNoteLoadStatus = "idle" | "loading" | "loaded" | "error";

export function normalizePersonalMatchNoteId(value: unknown) {
  if (typeof value !== "string") return null;
  const matchId = normalizeSportteryMatchId(value.trim());
  if (!matchId || matchId.length > MAX_PERSONAL_MATCH_NOTE_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(matchId)) return null;
  return matchId;
}

export function normalizePersonalMatchNoteText(value: unknown) {
  if (typeof value !== "string" || value.length > MAX_PERSONAL_MATCH_NOTE_LENGTH) return null;
  return value.trim();
}

export function isPersonalMatchNoteRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function emptyPersonalMatchNote(matchId: string): PersonalMatchNote {
  return { matchId, note: "", revision: 0, updatedAt: "" };
}

export function mergePersonalMatchNote(
  current: PersonalMatchNotes,
  incoming: PersonalMatchNote,
): PersonalMatchNotes {
  const previous = current[incoming.matchId];
  if (previous && previous.revision > incoming.revision) return current;
  return { ...current, [incoming.matchId]: incoming };
}
