"use client";

import type { TeamTag, TeamTagDraft, TeamTagsResponse, TeamTagShare } from "../team-tags";
import { requestJson } from "./http";

const base = "/api/users/me/team-tags";

export function getTeamTags() {
  return requestJson<TeamTagsResponse>(base);
}

export async function saveTeamTag(draft: TeamTagDraft) {
  const response = draft.id
    ? await requestJson<{ tag: TeamTag }>(`${base}/${encodeURIComponent(draft.id)}`, { method: "PATCH", body: JSON.stringify(draft) })
    : await requestJson<{ tag: TeamTag }>(base, { method: "POST", body: JSON.stringify(draft) });
  return response.tag;
}

export async function deleteTeamTag(tag: Pick<TeamTag, "id" | "revision">) {
  return requestJson<{ deletedTagId: string }>(
    `${base}/${encodeURIComponent(tag.id)}?expectedRevision=${encodeURIComponent(String(tag.revision))}`,
    { method: "DELETE" },
  );
}

export async function saveTeamTagMemberNote(tagId: string, memberId: string, note: string, expectedRevision: number) {
  return requestJson<{ tag: TeamTag; member: TeamTag["members"][number] }>(
    `${base}/${encodeURIComponent(tagId)}/members/${encodeURIComponent(memberId)}`,
    { method: "PATCH", body: JSON.stringify({ note, expectedRevision }) },
  );
}

export function createTeamTagShare(tag: Pick<TeamTag, "id" | "revision">) {
  return requestJson<TeamTagShare>(`${base}/${encodeURIComponent(tag.id)}/shares`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision: tag.revision }),
  });
}

export function importTeamTag(code: string, requestId: string) {
  return requestJson<{ tag: TeamTag; imported: boolean }>(`${base}/import`, {
    method: "POST",
    body: JSON.stringify({ code, requestId }),
  });
}
