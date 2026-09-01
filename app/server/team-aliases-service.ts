import { httpError } from "./errors";
import {
  normalizeTeamName,
  type TeamNameActiveSlot,
  type TeamNameEntry,
  type TeamNameGroup,
} from "../team-aliases";

const MAX_TEAM_NAMES = 32;
const MAX_TEAM_NAME_LENGTH = 80;
const MAX_TEAM_ICON_DATA_LENGTH = 350_000;
const TEAM_ICON_DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,[A-Za-z0-9+/]+={0,2}$/;

type TeamNameGroupRow = {
  id: string;
  icon_data_url: string | null;
  revision: number;
  updated_at: string;
  display_order: number;
};

type TeamNameRow = {
  id: string;
  group_id: string;
  name: string;
  name_key: string;
  active_slot: number | null;
  updated_at: string;
};

export type TeamNameGroupPayload = {
  iconDataUrl?: string | null;
  names: Array<{
    id?: string;
    name: string;
    activeSlot: TeamNameActiveSlot;
  }>;
  expectedRevision?: number;
};

function constraintError(error: unknown): void {
  if (!(error instanceof Error) || !/unique|constraint/i.test(error.message)) return;
  throw httpError("队伍名称已被其他配置占用，请刷新后重试", 409, { code: "TEAM_NAME_CONFLICT" });
}

function validateTeamIcon(raw: unknown) {
  if (raw === null || typeof raw === "undefined" || raw === "") return null;
  if (typeof raw !== "string" || raw.length > MAX_TEAM_ICON_DATA_LENGTH || !TEAM_ICON_DATA_URL_PATTERN.test(raw)) {
    throw httpError("队伍图标必须是 350KB 以内的 PNG、JPG 或 WebP 图片", 400);
  }
  return raw;
}

export function validateTeamNameGroupPayload(raw: unknown): TeamNameGroupPayload {
  if (!raw || typeof raw !== "object") throw httpError("队伍名称配置无效", 400);
  const payload = raw as Partial<TeamNameGroupPayload>;
  if (!Array.isArray(payload.names)) {
    throw httpError("至少输入一个队伍名称", 400);
  }

  const entries = payload.names.filter((entry) => {
    if (!entry || typeof entry !== "object" || typeof entry.name !== "string") return true;
    return Boolean(entry.name.normalize("NFKC").trim());
  });
  if (entries.length < 1) throw httpError("至少输入一个队伍名称", 400);
  if (entries.length > MAX_TEAM_NAMES) throw httpError(`每个队伍最多配置 ${MAX_TEAM_NAMES} 个名称`, 400);

  const names = entries.map((entry) => {
    if (!entry || typeof entry !== "object" || typeof entry.name !== "string") {
      throw httpError("队伍名称不能为空", 400);
    }
    const name = entry.name.normalize("NFKC").trim();
    const nameKey = normalizeTeamName(name);
    if (!nameKey || name.length > MAX_TEAM_NAME_LENGTH) {
      throw httpError(`队伍名称不能为空且不能超过 ${MAX_TEAM_NAME_LENGTH} 个字符`, 400);
    }
    if (entry.activeSlot !== null && entry.activeSlot !== 1 && entry.activeSlot !== 2) {
      throw httpError("激活名称必须使用第 1 或第 2 个激活位", 400);
    }
    if (typeof entry.id !== "undefined" && (typeof entry.id !== "string" || !entry.id.trim())) {
      throw httpError("队伍名称 ID 无效", 400);
    }
    return {
      id: typeof entry.id === "string" ? entry.id : undefined,
      name,
      nameKey,
      activeSlot: entry.activeSlot,
    };
  });

  const nameKeys = new Set<string>();
  names.forEach((entry) => {
    if (nameKeys.has(entry.nameKey)) throw httpError(`队伍名称重复：${entry.name}`, 409, { code: "TEAM_NAME_CONFLICT" });
    nameKeys.add(entry.nameKey);
  });
  const activeSlots = names.flatMap((entry) => entry.activeSlot === null ? [] : [entry.activeSlot]);
  if (activeSlots.length > 2 || new Set(activeSlots).size !== activeSlots.length) {
    throw httpError("每个队伍最多激活两个名称，且激活位不能重复", 400);
  }
  const normalizedNames = names.map((entry) => (
    activeSlots.length === 1 && activeSlots[0] === 2 && entry.activeSlot === 2
      ? { ...entry, activeSlot: 1 as TeamNameActiveSlot }
      : entry
  ));

  return {
    iconDataUrl: Object.prototype.hasOwnProperty.call(payload, "iconDataUrl")
      ? validateTeamIcon(payload.iconDataUrl)
      : undefined,
    names: normalizedNames.map(({ id, name, activeSlot }) => ({ id, name, activeSlot })),
    expectedRevision: Number.isInteger(payload.expectedRevision) ? Number(payload.expectedRevision) : undefined,
  };
}

async function ensureNameKeysAvailable(d1: D1Database, groupId: string | null, names: TeamNameGroupPayload["names"]) {
  const keys = [...new Set(names.map((entry) => normalizeTeamName(entry.name)))];
  const rows = await d1.prepare(`
    SELECT group_id, name, name_key
    FROM shared_team_names
    WHERE name_key IN (SELECT value FROM json_each(?1))
      AND (?2 IS NULL OR group_id <> ?2)
  `).bind(JSON.stringify(keys), groupId).all<Pick<TeamNameRow, "group_id" | "name" | "name_key">>();
  if ((rows.results ?? []).length > 0) {
    const duplicateNames = (rows.results ?? []).map((row) => row.name).join("、");
    throw httpError(`队伍名称已存在：${duplicateNames}`, 409, { code: "TEAM_NAME_CONFLICT" });
  }
}

function asActiveSlot(value: number | null): TeamNameActiveSlot {
  return value === 1 || value === 2 ? value : null;
}

function mapGroups(groupRows: TeamNameGroupRow[], nameRows: TeamNameRow[]): TeamNameGroup[] {
  const namesByGroup = new Map<string, TeamNameEntry[]>();
  nameRows.forEach((row) => {
    const names = namesByGroup.get(row.group_id) ?? [];
    names.push({
      id: row.id,
      groupId: row.group_id,
      name: row.name,
      nameKey: row.name_key,
      activeSlot: asActiveSlot(row.active_slot),
    });
    namesByGroup.set(row.group_id, names);
  });
  return groupRows.map((row) => ({
    id: row.id,
    iconDataUrl: row.icon_data_url ?? null,
    names: (namesByGroup.get(row.id) ?? []).sort((left, right) => (
      (left.activeSlot ?? 3) - (right.activeSlot ?? 3) || left.name.localeCompare(right.name, "zh-CN")
    )),
    revision: Number(row.revision ?? 0),
    updatedAt: row.updated_at,
  }));
}

export async function listTeamNameGroups(d1: D1Database) {
  const [groups, names] = await Promise.all([
    d1.prepare(`
      SELECT id, icon_data_url, revision, updated_at, display_order
      FROM shared_team_name_groups
      ORDER BY display_order ASC, id ASC
    `).all<TeamNameGroupRow>(),
    d1.prepare(`
      SELECT id, group_id, name, name_key, active_slot, updated_at
      FROM shared_team_names
      ORDER BY group_id ASC, active_slot ASC, name ASC
    `).all<TeamNameRow>(),
  ]);
  const mapped = mapGroups(groups.results ?? [], names.results ?? []);
  return {
    groups: mapped,
    updatedAt: mapped.reduce((latest, group) => group.updatedAt > latest ? group.updatedAt : latest, ""),
  };
}

async function getGroup(d1: D1Database, groupId: string) {
  const row = await d1.prepare(`
    SELECT id, icon_data_url, revision, updated_at, display_order
    FROM shared_team_name_groups
    WHERE id = ?1
  `).bind(groupId).first<TeamNameGroupRow>();
  return row ?? null;
}

export async function createTeamNameGroup(d1: D1Database, userId: string, rawPayload: unknown) {
  const payload = validateTeamNameGroupPayload(rawPayload);
  await ensureNameKeysAvailable(d1, null, payload.names);
  const groupId = crypto.randomUUID();
  const now = new Date().toISOString();
  const orderRow = await d1.prepare(`
    SELECT MIN(display_order) AS min_display_order
    FROM shared_team_name_groups
  `).first<{ min_display_order: number | null }>();
  const displayOrder = orderRow?.min_display_order === null || typeof orderRow?.min_display_order === "undefined"
    ? 0
    : Number(orderRow.min_display_order) - 1;
  const statements = [
    d1.prepare(`
      INSERT INTO shared_team_name_groups (id, icon_data_url, updated_by, revision, updated_at, display_order)
      VALUES (?1, ?2, ?3, 0, ?4, ?5)
    `).bind(groupId, payload.iconDataUrl ?? null, userId, now, displayOrder),
    ...payload.names.map((entry) => d1.prepare(`
      INSERT INTO shared_team_names (id, group_id, name, name_key, active_slot, updated_by, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `).bind(crypto.randomUUID(), groupId, entry.name, normalizeTeamName(entry.name), entry.activeSlot, userId, now)),
  ];
  try {
    await d1.batch(statements);
  } catch (error) {
    constraintError(error);
    throw error;
  }
  const created = await getGroupById(d1, groupId);
  return { group: created };
}

async function getGroupById(d1: D1Database, groupId: string): Promise<TeamNameGroup> {
  const group = await getGroup(d1, groupId);
  if (!group) throw httpError("找不到队伍名称组", 404);
  const names = await d1.prepare(`
    SELECT id, group_id, name, name_key, active_slot, updated_at
    FROM shared_team_names
    WHERE group_id = ?1
    ORDER BY active_slot ASC, name ASC
  `).bind(groupId).all<TeamNameRow>();
  return mapGroups([group], names.results ?? [])[0];
}

export async function updateTeamNameGroup(d1: D1Database, userId: string, groupId: string, rawPayload: unknown) {
  const payload = validateTeamNameGroupPayload(rawPayload);
  const current = await getGroup(d1, groupId);
  if (!current) throw httpError("找不到队伍名称组", 404);
  const expectedRevision = payload.expectedRevision ?? null;
  if (expectedRevision !== null && expectedRevision !== current.revision) {
    throw httpError("队伍名称配置已被其他页面更新，请刷新后重试", 409, { code: "TEAM_ALIAS_CONFLICT", revision: current.revision });
  }
  const currentNames = await d1.prepare(`
    SELECT id
    FROM shared_team_names
    WHERE group_id = ?1
  `).bind(groupId).all<{ id: string }>();
  const currentIds = new Set((currentNames.results ?? []).map((row) => row.id));
  const incomingIds = payload.names.flatMap((entry) => entry.id ? [entry.id] : []);
  if (new Set(incomingIds).size !== incomingIds.length || incomingIds.some((id) => !currentIds.has(id))) {
    throw httpError("队伍名称记录不属于当前队伍组", 400);
  }
  await ensureNameKeysAvailable(d1, groupId, payload.names);

  const now = new Date().toISOString();
  const iconDataUrl = typeof payload.iconDataUrl === "undefined" ? current.icon_data_url : payload.iconDataUrl;
  const statements = [
    d1.prepare(`
      UPDATE shared_team_name_groups
      SET icon_data_url = ?1, updated_by = ?2, revision = revision + 1, updated_at = ?3
      WHERE id = ?4
        AND (?5 IS NULL OR revision = ?5)
    `).bind(iconDataUrl, userId, now, groupId, expectedRevision),
    d1.prepare(`
      DELETE FROM shared_team_names
      WHERE group_id = ?1
        AND (?2 IS NULL OR EXISTS (
          SELECT 1 FROM shared_team_name_groups
          WHERE id = ?1 AND revision = ?2 + 1
        ))
    `).bind(groupId, expectedRevision),
    ...payload.names.map((entry) => d1.prepare(`
      INSERT INTO shared_team_names (id, group_id, name, name_key, active_slot, updated_by, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
      WHERE ?8 IS NULL OR EXISTS (
        SELECT 1 FROM shared_team_name_groups
        WHERE id = ?2 AND revision = ?8 + 1
      )
    `).bind(
      entry.id ?? crypto.randomUUID(),
      groupId,
      entry.name,
      normalizeTeamName(entry.name),
      entry.activeSlot,
      userId,
      now,
      expectedRevision,
    )),
  ];
  try {
    const results = await d1.batch(statements);
    if ((results[0]?.meta?.changes ?? 0) === 0) {
      const latest = await getGroup(d1, groupId);
      throw httpError("队伍名称配置已被其他页面更新，请刷新后重试", 409, {
        code: "TEAM_ALIAS_CONFLICT",
        revision: latest?.revision ?? current.revision,
      });
    }
  } catch (error) {
    constraintError(error);
    throw error;
  }
  return { group: await getGroupById(d1, groupId) };
}

export async function deleteTeamNameGroup(d1: D1Database, groupId: string, expectedRevision?: number) {
  const result = await d1.prepare(`
    DELETE FROM shared_team_name_groups
    WHERE id = ?1
      AND (?2 IS NULL OR revision = ?2)
  `).bind(groupId, Number.isInteger(expectedRevision) ? expectedRevision : null).run();
  if ((result.meta.changes ?? 0) === 0) {
    const current = await getGroup(d1, groupId);
    if (!current) throw httpError("找不到队伍名称组", 404);
    throw httpError("队伍名称配置已被其他页面更新，请刷新后重试", 409, { code: "TEAM_ALIAS_CONFLICT", revision: current.revision });
  }
  return { deletedGroupId: groupId };
}
