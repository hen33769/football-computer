import {
  MAX_PERSONAL_MATCH_NOTE_BATCH_SIZE,
  emptyPersonalMatchNote,
  isPersonalMatchNoteRevision,
  normalizePersonalMatchNoteId,
  normalizePersonalMatchNoteText,
  type PersonalMatchNote,
} from "../match-notes";
import { httpError } from "./errors";

type MatchNoteRow = {
  match_id: string;
  note: string;
  revision: number;
  updated_at: string;
};

const noteFromRow = (row: MatchNoteRow): PersonalMatchNote => ({
  matchId: row.match_id,
  note: row.note,
  revision: Number(row.revision),
  updatedAt: row.updated_at,
});

export function parsePersonalMatchNoteIds(values: unknown) {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_PERSONAL_MATCH_NOTE_BATCH_SIZE) {
    throw httpError(`每次需要查询 1 至 ${MAX_PERSONAL_MATCH_NOTE_BATCH_SIZE} 场比赛`, 400);
  }
  const ids = values.map(normalizePersonalMatchNoteId);
  if (ids.some((id) => !id)) throw httpError("比赛 ID 无效", 400);
  return [...new Set(ids as string[])];
}

export async function getUserMatchNotes(d1: D1Database, userId: string, rawIds: unknown) {
  const ids = parsePersonalMatchNoteIds(rawIds);
  const rows = await d1.prepare(`
    SELECT match_id, note, revision, updated_at
    FROM user_match_notes
    WHERE user_id = ?1
      AND match_id IN (SELECT value FROM json_each(?2))
  `).bind(userId, JSON.stringify(ids)).all<MatchNoteRow>();
  const notesById = new Map((rows.results ?? []).map((row) => [row.match_id, noteFromRow(row)]));
  return { notes: ids.map((matchId) => notesById.get(matchId) ?? emptyPersonalMatchNote(matchId)) };
}

export async function updateUserMatchNote(
  d1: D1Database,
  userId: string,
  rawMatchId: unknown,
  rawPayload: unknown,
  now = new Date(),
) {
  const matchId = normalizePersonalMatchNoteId(rawMatchId);
  if (!matchId) throw httpError("比赛 ID 无效", 400);
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    throw httpError("个人备注数据无效", 400);
  }
  const payload = rawPayload as Record<string, unknown>;
  if (Object.keys(payload).some((key) => key !== "note" && key !== "expectedRevision")) {
    throw httpError("个人备注包含不支持的字段", 400);
  }
  const note = normalizePersonalMatchNoteText(payload.note);
  if (note === null) throw httpError("个人备注需为 2000 字以内的文本", 400);
  if (!isPersonalMatchNoteRevision(payload.expectedRevision)) throw httpError("个人备注版本号无效", 400);
  const expectedRevision = payload.expectedRevision;
  const updatedAt = now.toISOString();
  const saved = await d1.prepare(`
    INSERT INTO user_match_notes (user_id, match_id, note, revision, updated_at)
    SELECT ?1, ?2, ?3, 1, ?4
    WHERE ?5 = 0
       OR EXISTS (
         SELECT 1 FROM user_match_notes
         WHERE user_id = ?1 AND match_id = ?2
       )
    ON CONFLICT(user_id, match_id) DO UPDATE SET
      note = excluded.note,
      revision = user_match_notes.revision + 1,
      updated_at = excluded.updated_at
    WHERE user_match_notes.revision = ?5
    RETURNING match_id, note, revision, updated_at
  `).bind(userId, matchId, note, updatedAt, expectedRevision).first<MatchNoteRow>();
  if (saved) return noteFromRow(saved);

  const current = await d1.prepare(`
    SELECT revision
    FROM user_match_notes
    WHERE user_id = ?1 AND match_id = ?2
  `).bind(userId, matchId).first<{ revision: number }>();
  throw httpError("个人备注已在其他位置更新，请加载最新内容后重试", 409, {
    code: "MATCH_NOTE_CONFLICT",
    revision: Number(current?.revision ?? 0),
  });
}
