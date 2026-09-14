import { getMatchKickoffAt, normalizeSportteryMatchId } from "./sporttery";
import type { MatchItem } from "./types";

export const MATCH_START_REMINDER_WINDOW_MS = 30 * 60 * 1000;

export type MatchStartReminderRecord = Record<string, number>;

export type MatchStartReminderItem = {
  match: MatchItem;
  kickoffAt: number;
  minutesUntil: number;
};

const normalizedReminderRecord = (value: unknown, nowMs: number): MatchStartReminderRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const reminders: MatchStartReminderRecord = {};
  Object.entries(value).forEach(([rawMatchId, rawKickoffAt]) => {
    const matchId = normalizeSportteryMatchId(rawMatchId.trim());
    if (!matchId || typeof rawKickoffAt !== "number" || !Number.isFinite(rawKickoffAt) || rawKickoffAt <= nowMs) return;
    const kickoffAt = rawKickoffAt;
    reminders[matchId] = Math.max(reminders[matchId] ?? 0, kickoffAt);
  });
  return reminders;
};

export function parseMatchStartReminderRecord(raw: string | null, now = new Date()): MatchStartReminderRecord {
  if (!raw) return {};
  try {
    return normalizedReminderRecord(JSON.parse(raw), now.getTime());
  } catch {
    return {};
  }
}

export function isMatchStartingSoon(
  match: Pick<MatchItem, "date" | "time">,
  now = new Date(),
  windowMs = MATCH_START_REMINDER_WINDOW_MS,
) {
  const kickoffAt = getMatchKickoffAt(match);
  const remainingMs = kickoffAt === null ? Number.NaN : kickoffAt - now.getTime();
  return remainingMs > 0 && remainingMs <= windowMs;
}

export function collectMatchStartReminders(
  matches: MatchItem[],
  reminded: MatchStartReminderRecord,
  now = new Date(),
  windowMs = MATCH_START_REMINDER_WINDOW_MS,
): { reminders: MatchStartReminderItem[]; nextRecord: MatchStartReminderRecord } {
  const nowMs = now.getTime();
  const nextRecord = normalizedReminderRecord(reminded, nowMs);
  const uniqueMatches = new Map<string, { match: MatchItem; kickoffAt: number }>();

  matches.forEach((match) => {
    const matchId = normalizeSportteryMatchId(match.id.trim());
    const kickoffAt = getMatchKickoffAt(match);
    if (!matchId || kickoffAt === null) return;
    const remainingMs = kickoffAt - nowMs;
    if (remainingMs <= 0 || remainingMs > windowMs) return;
    const current = uniqueMatches.get(matchId);
    if (!current || kickoffAt < current.kickoffAt) uniqueMatches.set(matchId, { match, kickoffAt });
  });

  const reminders = [...uniqueMatches.entries()]
    .filter(([matchId]) => typeof nextRecord[matchId] === "undefined")
    .map(([, item]) => ({
      ...item,
      minutesUntil: Math.max(1, Math.ceil((item.kickoffAt - nowMs) / 60_000)),
    }))
    .sort((left, right) => (
      left.kickoffAt - right.kickoffAt
      || left.match.code.localeCompare(right.match.code, "zh-CN", { numeric: true, sensitivity: "base" })
      || left.match.id.localeCompare(right.match.id, "zh-CN", { numeric: true, sensitivity: "base" })
    ));

  reminders.forEach(({ match, kickoffAt }) => {
    nextRecord[normalizeSportteryMatchId(match.id)] = kickoffAt;
  });
  return { reminders, nextRecord };
}
