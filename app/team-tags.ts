import type { MatchItem } from "./types";
import { normalizeTeamName, type TeamNameGroup, type TeamNameIndex } from "./team-aliases";

export const MAX_TEAM_TAGS_PER_USER = 200;
export const MAX_TEAM_TAG_MEMBERS = 200;
export const MAX_TEAM_TAG_NAME_LENGTH = 80;
export const MAX_TEAM_TAG_SHORT_TEXT_LENGTH = 2;
export const MAX_TEAM_TAG_NOTE_LENGTH = 2000;

export type TeamTagDateBasis = "current" | "match";

export type TeamTagMember = {
  id: string;
  tagId: string;
  sourceName: string;
  sourceNameKey: string;
  teamGroupId: string | null;
  note: string;
  displayOrder: number;
  revision: number;
  updatedAt: string;
};

export type TeamTag = {
  id: string;
  name: string;
  shortText: string;
  color: string;
  dateBasis: TeamTagDateBasis;
  startDate: string | null;
  endDate: string | null;
  displayOrder: number;
  revision: number;
  updatedAt: string;
  members: TeamTagMember[];
};

export type TeamTagDraft = {
  id?: string;
  name: string;
  shortText: string;
  color: string;
  dateBasis: TeamTagDateBasis;
  startDate: string | null;
  endDate: string | null;
  expectedRevision?: number;
  members: Array<{
    id?: string;
    sourceName: string;
    teamGroupId?: string | null;
    note: string;
    revision?: number;
  }>;
};

export type TeamTagsResponse = { tags: TeamTag[]; updatedAt: string };
export type TeamTagShare = { code: string; expiresAt: string };

export type ResolvedTeamTag = {
  tag: TeamTag;
  members: TeamTagMember[];
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function firstVisibleCharacter(value: string) {
  return Array.from(value.trim())[0] ?? "";
}

export function teamTagLabel(tag: Pick<TeamTag, "name" | "shortText">) {
  return tag.shortText.trim() || firstVisibleCharacter(tag.name);
}

export function shanghaiDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function matchDateKey(match: MatchItem) {
  const direct = match.date.trim().slice(0, 10);
  if (DATE_PATTERN.test(direct)) return direct;
  const parsed = new Date(match.time);
  return Number.isFinite(parsed.getTime()) ? shanghaiDateKey(parsed) : "";
}

export function isTeamTagActive(tag: TeamTag, match: MatchItem, now: Date) {
  const dateKey = tag.dateBasis === "match" ? matchDateKey(match) : shanghaiDateKey(now);
  if (!dateKey) return false;
  return (!tag.startDate || dateKey >= tag.startDate) && (!tag.endDate || dateKey <= tag.endDate);
}

export function resolveTeamIdentity(
  name: string,
  index: TeamNameIndex,
  groups: TeamNameGroup[],
  fallbackGroupId: string | null = null,
) {
  const key = normalizeTeamName(name);
  const currentGroupId = index.get(key)?.groupId;
  if (currentGroupId) return `group:${currentGroupId}`;
  if (fallbackGroupId && groups.some((group) => group.id === fallbackGroupId)) return `group:${fallbackGroupId}`;
  return `name:${key}`;
}

export function resolveTeamTags(
  tags: TeamTag[],
  teamName: string,
  match: MatchItem,
  now: Date,
  index: TeamNameIndex,
  groups: TeamNameGroup[],
): ResolvedTeamTag[] {
  const teamIdentity = resolveTeamIdentity(teamName, index, groups);
  return tags.flatMap((tag) => {
    if (!isTeamTagActive(tag, match, now)) return [];
    const members = tag.members.filter((member) => (
      resolveTeamIdentity(member.sourceName, index, groups, member.teamGroupId) === teamIdentity
    ));
    return members.length > 0 ? [{ tag, members }] : [];
  });
}

export function upsertTeamTag(tags: TeamTag[], saved: TeamTag) {
  const index = tags.findIndex((tag) => tag.id === saved.id);
  return index < 0 ? [saved, ...tags] : tags.map((tag, itemIndex) => itemIndex === index ? saved : tag);
}
