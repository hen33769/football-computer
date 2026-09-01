"use client";

import type { TeamNameAliasesResponse, TeamNameGroup, TeamNameGroupDraft } from "../team-aliases";
import { requestJson } from "./http";

const apiUrl = (baseUrl = "") => `${baseUrl.replace(/\/$/, "")}/api/team-aliases`;

export function getTeamNameGroups(baseUrl = "") {
  return requestJson<TeamNameAliasesResponse>(apiUrl(baseUrl));
}

export async function saveTeamNameGroup(group: TeamNameGroupDraft): Promise<TeamNameGroup> {
  const payload = {
    names: group.names.map(({ id, name, activeSlot }) => ({ id, name, activeSlot })),
    expectedRevision: group.expectedRevision,
  };
  const response = group.id
    ? await requestJson<{ group: TeamNameGroup }>(`${apiUrl()}/${encodeURIComponent(group.id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      })
    : await requestJson<{ group: TeamNameGroup }>(apiUrl(), {
        method: "POST",
        body: JSON.stringify(payload),
      });
  return response.group;
}

export async function deleteTeamNameGroup(group: Pick<TeamNameGroup, "id" | "revision">) {
  const response = await requestJson<{ deletedGroupId: string }>(
    `${apiUrl()}/${encodeURIComponent(group.id)}?expectedRevision=${encodeURIComponent(String(group.revision))}`,
    { method: "DELETE" },
  );
  return response.deletedGroupId;
}
