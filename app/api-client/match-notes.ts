"use client";

import {
  MAX_PERSONAL_MATCH_NOTE_BATCH_SIZE,
  type PersonalMatchNote,
} from "../match-notes";
import { requestJson } from "./http";

export async function getPersonalMatchNotes(ids: string[]) {
  const notes: PersonalMatchNote[] = [];
  for (let index = 0; index < ids.length; index += MAX_PERSONAL_MATCH_NOTE_BATCH_SIZE) {
    const batch = ids.slice(index, index + MAX_PERSONAL_MATCH_NOTE_BATCH_SIZE);
    const query = batch.map((matchId) => `ids=${encodeURIComponent(matchId)}`).join("&");
    const response = await requestJson<{ notes: PersonalMatchNote[] }>(
      `/api/users/me/match-notes?${query}`,
    );
    notes.push(...response.notes);
  }
  return { notes };
}

export function updatePersonalMatchNote(matchId: string, note: string, expectedRevision: number) {
  return requestJson<PersonalMatchNote>(`/api/users/me/match-notes/${encodeURIComponent(matchId)}`, {
    method: "PATCH",
    body: JSON.stringify({ note, expectedRevision }),
  });
}
