import { createDefaultSettings, normalizeAppSettings, type AppSettings } from "../settings";
import { parseJson } from "../cloud-server";

export type UserSettingsState = {
  settings: AppSettings;
  revision: number;
  updatedAt: string;
};

type SettingsRow = {
  settings_json: string;
  revision: number;
  updated_at: string;
};

export async function ensureUserSettings(d1: D1Database, userId: string, now = new Date().toISOString()) {
  await d1.prepare(`
    INSERT INTO user_settings (user_id, settings_json, revision, updated_at)
    VALUES (?1, ?2, 0, ?3)
    ON CONFLICT(user_id) DO NOTHING
  `).bind(userId, JSON.stringify(createDefaultSettings()), now).run();
}

export async function getUserSettings(d1: D1Database, userId: string): Promise<UserSettingsState> {
  await ensureUserSettings(d1, userId);
  const row = await d1.prepare(`
    SELECT settings_json, revision, updated_at
    FROM user_settings
    WHERE user_id = ?1
  `).bind(userId).first<SettingsRow>();
  return {
    settings: normalizeAppSettings(parseJson(row?.settings_json ?? "{}", createDefaultSettings())),
    revision: row?.revision ?? 0,
    updatedAt: row?.updated_at ?? "",
  };
}

export async function updateUserSettings(
  d1: D1Database,
  userId: string,
  settings: AppSettings,
  expectedRevision?: number,
): Promise<UserSettingsState> {
  const now = new Date().toISOString();
  await ensureUserSettings(d1, userId, now);
  const normalized = normalizeAppSettings(settings);
  const revisionGuard = Number.isInteger(expectedRevision) ? Number(expectedRevision) : null;
  const result = await d1.prepare(`
    UPDATE user_settings
    SET settings_json = ?1,
        revision = revision + 1,
        updated_at = ?2
    WHERE user_id = ?3
      AND (?4 IS NULL OR revision = ?4)
  `).bind(JSON.stringify(normalized), now, userId, revisionGuard).run();
  if ((result.meta.changes ?? 0) === 0) {
    const current = await getUserSettings(d1, userId);
    const error = new Error("云端设置已被其他设备更新，请刷新后重试");
    Object.assign(error, { status: 409, revision: current.revision });
    throw error;
  }
  return getUserSettings(d1, userId);
}
