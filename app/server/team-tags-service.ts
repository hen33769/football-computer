import {
  MAX_TEAM_TAG_MEMBERS,
  MAX_TEAM_TAG_NAME_LENGTH,
  MAX_TEAM_TAG_NOTE_LENGTH,
  MAX_TEAM_TAG_SHORT_TEXT_LENGTH,
  MAX_TEAM_TAGS_PER_USER,
  type TeamTag,
  type TeamTagDateBasis,
  type TeamTagDraft,
  type TeamTagMember,
} from "../team-tags";
import { normalizeTeamName } from "../team-aliases";
import { httpError } from "./errors";

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHARE_CODE_PATTERN = /^ST-[A-F0-9]{48}$/;
const SHARE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SHARE_SNAPSHOT_BYTES = 1024 * 1024;

type TagRow = {
  id: string;
  user_id: string;
  name: string;
  short_text: string;
  color: string;
  date_basis: string;
  start_date: string | null;
  end_date: string | null;
  display_order: number;
  revision: number;
  updated_at: string;
};

type MemberRow = {
  id: string;
  tag_id: string;
  source_name: string;
  source_name_key: string;
  team_group_id: string | null;
  note: string;
  display_order: number;
  revision: number;
  updated_at: string;
};

type ValidMember = {
  id?: string;
  sourceName: string;
  sourceNameKey: string;
  teamGroupId: string | null;
  note: string;
  revision: number;
};

type ValidDraft = Omit<TeamTagDraft, "members"> & { members: ValidMember[] };

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return Array.from(normalized).length <= maxLength ? normalized : null;
}

function validDate(value: unknown) {
  if (value === null || value === "" || typeof value === "undefined") return null;
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : undefined;
}

async function aliasState(d1: D1Database) {
  const [groupsResult, namesResult] = await Promise.all([
    d1.prepare("SELECT id FROM shared_team_name_groups").all<{ id: string }>(),
    d1.prepare("SELECT name_key, group_id FROM shared_team_names").all<{ name_key: string; group_id: string }>(),
  ]);
  return {
    groupIds: new Set((groupsResult.results ?? []).map((row) => row.id)),
    nameGroups: new Map((namesResult.results ?? []).map((row) => [row.name_key, row.group_id])),
  };
}

function identityFor(member: Pick<ValidMember, "sourceNameKey" | "teamGroupId">, aliases: Awaited<ReturnType<typeof aliasState>>) {
  const currentGroup = aliases.nameGroups.get(member.sourceNameKey);
  if (currentGroup) return `group:${currentGroup}`;
  if (member.teamGroupId && aliases.groupIds.has(member.teamGroupId)) return `group:${member.teamGroupId}`;
  return `name:${member.sourceNameKey}`;
}

async function validateDraft(d1: D1Database, raw: unknown, existingMembers: TeamTagMember[] = []): Promise<ValidDraft> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw httpError("球队标签配置无效", 400);
  const value = raw as Record<string, unknown>;
  const supported = new Set(["id", "name", "shortText", "color", "dateBasis", "startDate", "endDate", "expectedRevision", "members"]);
  if (Object.keys(value).some((key) => !supported.has(key))) throw httpError("球队标签配置包含不支持的字段", 400);
  const name = cleanText(value.name, MAX_TEAM_TAG_NAME_LENGTH);
  if (!name) throw httpError(`标签名称不能为空且不能超过 ${MAX_TEAM_TAG_NAME_LENGTH} 个字符`, 400);
  const shortText = cleanText(value.shortText ?? "", MAX_TEAM_TAG_SHORT_TEXT_LENGTH);
  if (shortText === null) throw httpError(`标签短文案不能超过 ${MAX_TEAM_TAG_SHORT_TEXT_LENGTH} 个字符`, 400);
  const color = typeof value.color === "string" ? value.color.toLowerCase() : "";
  if (!COLOR_PATTERN.test(color)) throw httpError("标签颜色必须是 #RRGGBB 格式", 400);
  const dateBasis = value.dateBasis === "match" ? "match" : value.dateBasis === "current" || typeof value.dateBasis === "undefined" ? "current" : null;
  if (!dateBasis) throw httpError("标签日期参照无效", 400);
  const startDate = validDate(value.startDate);
  const endDate = validDate(value.endDate);
  if (typeof startDate === "undefined" || typeof endDate === "undefined") throw httpError("标签生效日期无效", 400);
  if (startDate && endDate && startDate > endDate) throw httpError("标签开始日期不能晚于结束日期", 400);
  if (!Array.isArray(value.members) || value.members.length < 1 || value.members.length > MAX_TEAM_TAG_MEMBERS) {
    throw httpError(`每个标签需要 1 至 ${MAX_TEAM_TAG_MEMBERS} 支球队`, 400);
  }
  const aliases = await aliasState(d1);
  const existingById = new Map(existingMembers.map((member) => [member.id, member]));
  const members: ValidMember[] = value.members.map((rawMember) => {
    if (!rawMember || typeof rawMember !== "object" || Array.isArray(rawMember)) throw httpError("标签球队数据无效", 400);
    const member = rawMember as Record<string, unknown>;
    const memberSupported = new Set(["id", "sourceName", "teamGroupId", "note", "revision"]);
    if (Object.keys(member).some((key) => !memberSupported.has(key))) throw httpError("标签球队包含不支持的字段", 400);
    const sourceName = cleanText(member.sourceName, 80);
    if (!sourceName) throw httpError("球队名称不能为空且不能超过 80 个字符", 400);
    const note = cleanText(member.note ?? "", MAX_TEAM_TAG_NOTE_LENGTH);
    if (note === null) throw httpError(`球队备注不能超过 ${MAX_TEAM_TAG_NOTE_LENGTH} 个字符`, 400);
    const id = typeof member.id === "string" && member.id ? member.id : undefined;
    const existing = id ? existingById.get(id) : undefined;
    if (id && !existing) throw httpError("标签球队记录不属于当前标签", 400);
    const sourceNameKey = normalizeTeamName(sourceName);
    const currentGroupId = aliases.nameGroups.get(sourceNameKey) ?? null;
    const existingFallback = existing?.teamGroupId && aliases.groupIds.has(existing.teamGroupId) ? existing.teamGroupId : null;
    return {
      id,
      sourceName,
      sourceNameKey,
      teamGroupId: currentGroupId ?? existingFallback,
      note,
      revision: existing?.revision ?? 0,
    };
  });
  const sourceKeys = new Set<string>();
  members.forEach((member) => {
    if (sourceKeys.has(member.sourceNameKey)) throw httpError(`同一标签中球队重复：${member.sourceName}`, 409, { code: "TEAM_TAG_TEAM_CONFLICT" });
    sourceKeys.add(member.sourceNameKey);
  });
  for (let left = 0; left < members.length; left += 1) {
    for (let right = left + 1; right < members.length; right += 1) {
      const leftMember = members[left];
      const rightMember = members[right];
      if (identityFor(leftMember, aliases) !== identityFor(rightMember, aliases)) continue;
      const leftExisting = leftMember.id ? existingById.get(leftMember.id) : undefined;
      const rightExisting = rightMember.id ? existingById.get(rightMember.id) : undefined;
      const unchangedHistoricalMerge = leftExisting && rightExisting
        && normalizeTeamName(leftExisting.sourceName) === leftMember.sourceNameKey
        && normalizeTeamName(rightExisting.sourceName) === rightMember.sourceNameKey;
      if (unchangedHistoricalMerge) continue;
      throw httpError(`同一标签中「${leftMember.sourceName}」与「${rightMember.sourceName}」属于同一球队`, 409, {
        code: "TEAM_TAG_TEAM_CONFLICT",
      });
    }
  }
  const expectedRevision = Number(value.expectedRevision);
  return {
    name,
    shortText,
    color,
    dateBasis: dateBasis as TeamTagDateBasis,
    startDate,
    endDate,
    members,
    expectedRevision: Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 ? expectedRevision : undefined,
  };
}

function memberFromRow(row: MemberRow): TeamTagMember {
  return {
    id: row.id,
    tagId: row.tag_id,
    sourceName: row.source_name,
    sourceNameKey: row.source_name_key,
    teamGroupId: row.team_group_id,
    note: row.note,
    displayOrder: Number(row.display_order),
    revision: Number(row.revision),
    updatedAt: row.updated_at,
  };
}

function mapTags(rows: TagRow[], memberRows: MemberRow[]): TeamTag[] {
  const byTag = new Map<string, TeamTagMember[]>();
  memberRows.forEach((row) => {
    const members = byTag.get(row.tag_id) ?? [];
    members.push(memberFromRow(row));
    byTag.set(row.tag_id, members);
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    shortText: row.short_text,
    color: row.color,
    dateBasis: row.date_basis === "match" ? "match" : "current",
    startDate: row.start_date,
    endDate: row.end_date,
    displayOrder: Number(row.display_order),
    revision: Number(row.revision),
    updatedAt: row.updated_at,
    members: byTag.get(row.id) ?? [],
  }));
}

export async function listUserTeamTags(d1: D1Database, userId: string) {
  const [tags, members] = await Promise.all([
    d1.prepare(`SELECT id, user_id, name, short_text, color, date_basis, start_date, end_date, display_order, revision, updated_at
      FROM user_team_tags WHERE user_id = ?1 ORDER BY display_order ASC, id ASC`).bind(userId).all<TagRow>(),
    d1.prepare(`SELECT m.id, m.tag_id, m.source_name, m.source_name_key, m.team_group_id, m.note, m.display_order, m.revision, m.updated_at
      FROM user_team_tag_members m INNER JOIN user_team_tags t ON t.id = m.tag_id
      WHERE t.user_id = ?1 ORDER BY m.tag_id ASC, m.display_order ASC, m.id ASC`).bind(userId).all<MemberRow>(),
  ]);
  const mapped = mapTags(tags.results ?? [], members.results ?? []);
  return { tags: mapped, updatedAt: mapped.reduce((latest, tag) => tag.updatedAt > latest ? tag.updatedAt : latest, "") };
}

async function getUserTag(d1: D1Database, userId: string, tagId: string) {
  const row = await d1.prepare(`SELECT id, user_id, name, short_text, color, date_basis, start_date, end_date, display_order, revision, updated_at
    FROM user_team_tags WHERE id = ?1 AND user_id = ?2`).bind(tagId, userId).first<TagRow>();
  if (!row) throw httpError("找不到球队标签", 404);
  const members = await d1.prepare(`SELECT id, tag_id, source_name, source_name_key, team_group_id, note, display_order, revision, updated_at
    FROM user_team_tag_members WHERE tag_id = ?1 ORDER BY display_order ASC, id ASC`).bind(tagId).all<MemberRow>();
  return mapTags([row], members.results ?? [])[0];
}

export async function createUserTeamTag(d1: D1Database, userId: string, raw: unknown, now = new Date()) {
  const draft = await validateDraft(d1, raw);
  const count = await d1.prepare("SELECT COUNT(*) AS count FROM user_team_tags WHERE user_id = ?1").bind(userId).first<{ count: number }>();
  if (Number(count?.count ?? 0) >= MAX_TEAM_TAGS_PER_USER) throw httpError(`每个账号最多保存 ${MAX_TEAM_TAGS_PER_USER} 个标签`, 400);
  const order = await d1.prepare("SELECT MIN(display_order) AS value FROM user_team_tags WHERE user_id = ?1").bind(userId).first<{ value: number | null }>();
  const tagId = crypto.randomUUID();
  const timestamp = now.toISOString();
  const statements = [
    d1.prepare(`INSERT INTO user_team_tags (id, user_id, name, short_text, color, date_basis, start_date, end_date, display_order, revision, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?10)`).bind(
      tagId, userId, draft.name, draft.shortText, draft.color, draft.dateBasis, draft.startDate, draft.endDate,
      order?.value === null || typeof order?.value === "undefined" ? 0 : Number(order.value) - 1, timestamp,
    ),
    ...draft.members.map((member, index) => d1.prepare(`INSERT INTO user_team_tag_members
      (id, tag_id, source_name, source_name_key, team_group_id, note, display_order, revision, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)`).bind(
      crypto.randomUUID(), tagId, member.sourceName, member.sourceNameKey, member.teamGroupId, member.note, index, timestamp,
    )),
  ];
  try {
    await d1.batch(statements);
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) throw httpError("标签球队重复，请刷新别称配置后重试", 409);
    throw error;
  }
  return { tag: await getUserTag(d1, userId, tagId) };
}

export async function updateUserTeamTag(d1: D1Database, userId: string, tagId: string, raw: unknown, now = new Date()) {
  const current = await getUserTag(d1, userId, tagId);
  const draft = await validateDraft(d1, raw, current.members);
  if (draft.expectedRevision !== current.revision) throw httpError("球队标签已在其他位置更新，请加载最新内容", 409, { code: "TEAM_TAG_CONFLICT", revision: current.revision });
  const timestamp = now.toISOString();
  const nextRevision = current.revision + 1;
  const mutationToken = crypto.randomUUID();
  const oldById = new Map(current.members.map((member) => [member.id, member]));
  const statements = [
    d1.prepare(`UPDATE user_team_tags SET name=?1, short_text=?2, color=?3, date_basis=?4, start_date=?5, end_date=?6,
      revision=revision+1, updated_at=?7, mutation_token=?8 WHERE id=?9 AND user_id=?10 AND revision=?11`).bind(
      draft.name, draft.shortText, draft.color, draft.dateBasis, draft.startDate, draft.endDate,
      timestamp, mutationToken, tagId, userId, current.revision,
    ),
    d1.prepare(`DELETE FROM user_team_tag_members WHERE tag_id=?1 AND EXISTS (
      SELECT 1 FROM user_team_tags WHERE id=?1 AND user_id=?2 AND revision=?3 AND mutation_token=?4
    )`).bind(tagId, userId, nextRevision, mutationToken),
    ...draft.members.map((member, index) => {
      const old = member.id ? oldById.get(member.id) : undefined;
      const changed = !old || old.note !== member.note || old.sourceName !== member.sourceName || old.teamGroupId !== member.teamGroupId;
      return d1.prepare(`INSERT INTO user_team_tag_members
        (id, tag_id, source_name, source_name_key, team_group_id, note, display_order, revision, mutation_token, updated_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10 WHERE EXISTS (
          SELECT 1 FROM user_team_tags WHERE id=?2 AND user_id=?11 AND revision=?12 AND mutation_token=?9
        )`).bind(member.id ?? crypto.randomUUID(), tagId, member.sourceName, member.sourceNameKey, member.teamGroupId, member.note,
        index, old ? old.revision + (changed ? 1 : 0) : 0, mutationToken, timestamp, userId, nextRevision);
    }),
  ];
  let results: D1Result<unknown>[];
  try {
    results = await d1.batch(statements);
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) throw httpError("标签球队重复，请刷新别称配置后重试", 409);
    throw error;
  }
  const saved = await getUserTag(d1, userId, tagId);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1 || saved.revision !== nextRevision) {
    throw httpError("球队标签已在其他位置更新，请加载最新内容", 409, { revision: saved.revision });
  }
  return { tag: saved };
}

export async function deleteUserTeamTag(d1: D1Database, userId: string, tagId: string, expectedRevision: number) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw httpError("标签版本号无效", 400);
  const result = await d1.prepare("DELETE FROM user_team_tags WHERE id=?1 AND user_id=?2 AND revision=?3")
    .bind(tagId, userId, expectedRevision).run();
  if ((result.meta.changes ?? 0) === 0) {
    const current = await getUserTag(d1, userId, tagId);
    throw httpError("球队标签已在其他位置更新，请加载最新内容", 409, { revision: current.revision });
  }
  return { deletedTagId: tagId };
}

export async function updateUserTeamTagMemberNote(
  d1: D1Database,
  userId: string,
  tagId: string,
  memberId: string,
  raw: unknown,
  now = new Date(),
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw httpError("球队备注数据无效", 400);
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "note" && key !== "expectedRevision")) throw httpError("球队备注包含不支持的字段", 400);
  const note = cleanText(value.note ?? "", MAX_TEAM_TAG_NOTE_LENGTH);
  const expectedRevision = Number(value.expectedRevision);
  if (note === null) throw httpError(`球队备注不能超过 ${MAX_TEAM_TAG_NOTE_LENGTH} 个字符`, 400);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw httpError("球队备注版本号无效", 400);
  const timestamp = now.toISOString();
  const mutationToken = crypto.randomUUID();
  const results = await d1.batch([
    d1.prepare(`UPDATE user_team_tag_members SET note=?1, revision=revision+1, updated_at=?2, mutation_token=?3
      WHERE id=?4 AND tag_id=?5 AND revision=?6 AND EXISTS (
        SELECT 1 FROM user_team_tags WHERE id=?5 AND user_id=?7
      )`).bind(note, timestamp, mutationToken, memberId, tagId, expectedRevision, userId),
    d1.prepare(`UPDATE user_team_tags SET revision=revision+1, updated_at=?1 WHERE id=?2 AND user_id=?3 AND EXISTS (
      SELECT 1 FROM user_team_tag_members WHERE id=?4 AND tag_id=?2 AND revision=?5 AND mutation_token=?6
    )`).bind(timestamp, tagId, userId, memberId, expectedRevision + 1, mutationToken),
  ]);
  const tag = await getUserTag(d1, userId, tagId);
  const member = tag.members.find((item) => item.id === memberId);
  if (!member || member.revision !== expectedRevision + 1
    || Number(results[0]?.meta?.changes ?? 0) !== 1 || Number(results[1]?.meta?.changes ?? 0) !== 1) {
    throw httpError("球队备注已在其他位置更新，请加载最新内容", 409, { revision: member?.revision ?? 0 });
  }
  return { tag, member };
}

async function hashCode(code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomShareCode() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `ST-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export async function createTeamTagShare(d1: D1Database, userId: string, tagId: string, raw: unknown, now = new Date()) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const expectedRevision = Number(value.expectedRevision);
  if (Object.keys(value).some((key) => key !== "expectedRevision") || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw httpError("分享请求无效", 400);
  }
  const tag = await getUserTag(d1, userId, tagId);
  if (tag.revision !== expectedRevision) throw httpError("球队标签已更新，请加载最新内容后分享", 409, { revision: tag.revision });
  const since = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const recent = await d1.prepare("SELECT COUNT(*) AS count FROM team_tag_shares WHERE owner_id=?1 AND created_at>=?2")
    .bind(userId, since).first<{ count: number }>();
  if (Number(recent?.count ?? 0) >= 30) throw httpError("分享码生成过于频繁，请稍后重试", 429);
  const snapshot = JSON.stringify({ version: 1, tag: {
    name: tag.name,
    shortText: tag.shortText,
    color: tag.color,
    dateBasis: tag.dateBasis,
    startDate: tag.startDate,
    endDate: tag.endDate,
    members: tag.members.map(({ sourceName, note }) => ({ sourceName, note })),
  } });
  if (new TextEncoder().encode(snapshot).byteLength > MAX_SHARE_SNAPSHOT_BYTES) throw httpError("标签内容过大，无法分享", 400);
  const code = randomShareCode();
  const shareId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + SHARE_TTL_MS).toISOString();
  const result = await d1.prepare(`INSERT INTO team_tag_shares
    (id, code_hash, owner_id, source_tag_id, snapshot_version, snapshot_json, created_at, expires_at)
    SELECT ?1, ?2, ?3, ?4, 1, ?5, ?6, ?7 WHERE EXISTS (
      SELECT 1 FROM user_team_tags WHERE id=?4 AND user_id=?3 AND revision=?8
    )`).bind(
    shareId, await hashCode(code), userId, tagId, snapshot, now.toISOString(), expiresAt, expectedRevision,
  ).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw httpError("球队标签已更新，请加载最新内容后分享", 409);
  return { code, expiresAt };
}

type ShareRow = { id: string; snapshot_version: number; snapshot_json: string; expires_at: string };

async function consumeImportAttempt(d1: D1Database, userId: string, now: Date) {
  const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  const row = await d1.prepare(`INSERT INTO team_tag_import_rate_limits (user_id,window_start,attempts,updated_at)
    VALUES (?1,?2,1,?3)
    ON CONFLICT(user_id,window_start) DO UPDATE SET attempts=attempts+1,updated_at=excluded.updated_at
    RETURNING attempts`).bind(userId, windowStart, now.toISOString()).first<{ attempts: number }>();
  if (Number(row?.attempts ?? 1) > 20) throw httpError("分享码导入尝试过于频繁，请稍后重试", 429);
}

export async function importTeamTagShare(d1: D1Database, userId: string, raw: unknown, now = new Date()) {
  await consumeImportAttempt(d1, userId, now);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw httpError("分享码导入数据无效", 400);
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "code" && key !== "requestId")) throw httpError("分享码导入包含不支持的字段", 400);
  const code = typeof value.code === "string" ? value.code.trim().toUpperCase() : "";
  const requestId = typeof value.requestId === "string" ? value.requestId.trim() : "";
  if (!SHARE_CODE_PATTERN.test(code) || !requestId || requestId.length > 100) throw httpError("分享码格式无效", 400);
  const previous = await d1.prepare(`SELECT i.target_tag_id FROM user_team_tag_imports i
    INNER JOIN user_team_tags t ON t.id=i.target_tag_id AND t.user_id=i.user_id
    WHERE i.user_id=?1 AND i.request_id=?2`).bind(userId, requestId).first<{ target_tag_id: string }>();
  if (previous?.target_tag_id) return { tag: await getUserTag(d1, userId, previous.target_tag_id), imported: false };
  const share = await d1.prepare(`SELECT id, snapshot_version, snapshot_json, expires_at FROM team_tag_shares
    WHERE code_hash=?1`).bind(await hashCode(code)).first<ShareRow>();
  if (!share || share.expires_at <= now.toISOString()) throw httpError("分享码不存在或已过期", 409, { code: "TEAM_TAG_SHARE_EXPIRED" });
  const existing = await d1.prepare(`SELECT i.target_tag_id FROM user_team_tag_imports i
    INNER JOIN user_team_tags t ON t.id=i.target_tag_id AND t.user_id=i.user_id
    WHERE i.user_id=?1 AND i.share_id=?2`).bind(userId, share.id).first<{ target_tag_id: string }>();
  if (existing?.target_tag_id) return { tag: await getUserTag(d1, userId, existing.target_tag_id), imported: false };
  let snapshot: { version?: unknown; tag?: unknown };
  try { snapshot = JSON.parse(share.snapshot_json) as { version?: unknown; tag?: unknown }; } catch { throw httpError("分享配置已损坏", 409); }
  if (share.snapshot_version !== 1 || snapshot.version !== 1) throw httpError("暂不支持此分享配置版本", 409);
  const draft = await validateDraft(d1, snapshot.tag);
  const count = await d1.prepare("SELECT COUNT(*) AS count FROM user_team_tags WHERE user_id=?1").bind(userId).first<{ count: number }>();
  if (Number(count?.count ?? 0) >= MAX_TEAM_TAGS_PER_USER) throw httpError(`每个账号最多保存 ${MAX_TEAM_TAGS_PER_USER} 个标签`, 400);
  const order = await d1.prepare("SELECT MIN(display_order) AS value FROM user_team_tags WHERE user_id=?1").bind(userId).first<{ value: number | null }>();
  const tagId = crypto.randomUUID();
  const timestamp = now.toISOString();
  const importId = crypto.randomUUID();
  try {
    const results = await d1.batch([
      d1.prepare(`DELETE FROM user_team_tag_imports WHERE user_id=?1 AND target_tag_id IS NULL
        AND (share_id=?2 OR request_id=?3)`).bind(userId,share.id,requestId),
      d1.prepare(`INSERT INTO user_team_tags (id,user_id,name,short_text,color,date_basis,start_date,end_date,display_order,revision,created_at,updated_at)
        SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10,?10 WHERE EXISTS (
          SELECT 1 FROM team_tag_shares WHERE id=?11 AND expires_at>?10
        )`).bind(tagId,userId,draft.name,draft.shortText,draft.color,draft.dateBasis,draft.startDate,draft.endDate,
        order?.value === null || typeof order?.value === "undefined" ? 0 : Number(order.value)-1,timestamp,share.id),
      ...draft.members.map((member,index)=>d1.prepare(`INSERT INTO user_team_tag_members
        (id,tag_id,source_name,source_name_key,team_group_id,note,display_order,revision,updated_at)
        SELECT ?1,?2,?3,?4,?5,?6,?7,0,?8 WHERE EXISTS (SELECT 1 FROM user_team_tags WHERE id=?2 AND user_id=?9)`)
        .bind(crypto.randomUUID(),tagId,member.sourceName,member.sourceNameKey,member.teamGroupId,member.note,index,timestamp,userId)),
      d1.prepare(`INSERT INTO user_team_tag_imports (id,user_id,share_id,request_id,target_tag_id,created_at)
        SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS (SELECT 1 FROM user_team_tags WHERE id=?5 AND user_id=?2)`)
        .bind(importId,userId,share.id,requestId,tagId,timestamp),
    ]);
    if (Number(results[1]?.meta?.changes ?? 0) !== 1) throw httpError("分享码不存在或已过期", 409, { code: "TEAM_TAG_SHARE_EXPIRED" });
  } catch (error) {
    const raced = await d1.prepare(`SELECT target_tag_id FROM user_team_tag_imports WHERE user_id=?1 AND (share_id=?2 OR request_id=?3)`)
      .bind(userId,share.id,requestId).first<{ target_tag_id: string | null }>();
    if (raced?.target_tag_id) return { tag: await getUserTag(d1,userId,raced.target_tag_id), imported:false };
    if (error instanceof Error && /unique|constraint/i.test(error.message)) throw httpError("分享标签导入冲突，请重试",409);
    throw error;
  }
  return { tag: await getUserTag(d1,userId,tagId), imported:true };
}
