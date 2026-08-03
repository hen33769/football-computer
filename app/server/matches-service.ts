import { clearMatchSelections } from "../cloud";
import { parseJson } from "../cloud-server";
import {
  fetchSportteryMatchSnapshot,
  getSportteryRefreshPolicy,
  mergeSportteryMatchCache,
  normalizeSportteryMatchId,
  retainedSportteryMatchDateCutoff,
  type SportteryMatchFetchMode,
} from "../sporttery";
import type { MatchItem } from "../types";
import { httpError } from "./errors";

export type MatchRefreshSource = "official" | "snapshot" | "cleanup";

export type MatchRefreshMetadata = {
  mode: SportteryMatchFetchMode;
  source: MatchRefreshSource;
  lastUpdateTime: string;
  fixedBonusFailureCount: number;
  savedAt: string;
  fromCache: boolean;
};

export type CurrentMatchesResponse = {
  matches: MatchItem[];
  metadata: MatchRefreshMetadata;
};

type MatchRow = {
  match_id: string;
  data_json: string;
};

type RefreshStateRow = {
  mode: SportteryMatchFetchMode;
  source: MatchRefreshSource;
  last_update_time: string;
  fixed_bonus_failure_count: number;
  last_refresh_finished_at: string | null;
  refresh_lock_until: string | null;
  error: string | null;
  updated_at: string;
};

const MATCH_STATE_ID = "sporttery";
const MANUAL_REFRESH_COOLDOWN_MS = 60 * 1000;
const REFRESH_LOCK_MS = 2 * 60 * 1000;
const MAX_MATCHES = 500;
const MAX_MATCH_BYTES = 250_000;

const beijingDatePartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const beijingDateKey = (date: Date) => {
  const parts = Object.fromEntries(beijingDatePartsFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

function isMatch(value: unknown): value is MatchItem {
  if (!value || typeof value !== "object") return false;
  const match = value as Partial<MatchItem>;
  return typeof match.id === "string"
    && typeof match.date === "string"
    && typeof match.home === "string"
    && typeof match.away === "string"
    && Array.isArray(match.markets);
}

function cacheMaxAgeMs(now = new Date()) {
  const policy = getSportteryRefreshPolicy(now);
  return policy.autoIntervalMs;
}

async function getRefreshState(d1: D1Database) {
  return d1.prepare(`
    SELECT mode, source, last_update_time, fixed_bonus_failure_count,
           last_refresh_finished_at, refresh_lock_until, error, updated_at
    FROM match_refresh_states
    WHERE id = ?1
  `).bind(MATCH_STATE_ID).first<RefreshStateRow>();
}

async function saveRefreshState(
  d1: D1Database,
  values: {
    mode: SportteryMatchFetchMode;
    source: MatchRefreshSource;
    lastUpdateTime?: string;
    fixedBonusFailureCount?: number;
    startedAt?: string | null;
    finishedAt?: string | null;
    lockUntil?: string | null;
    error?: string | null;
    updatedAt: string;
  },
) {
  await d1.prepare(`
    INSERT INTO match_refresh_states (
      id, mode, source, last_update_time, fixed_bonus_failure_count,
      last_refresh_started_at, last_refresh_finished_at, refresh_lock_until, error, updated_at
    )
    VALUES (?1, ?2, ?3, COALESCE(?4, ''), COALESCE(?5, 0), ?6, ?7, ?8, ?9, ?10)
    ON CONFLICT(id) DO UPDATE SET
      mode = excluded.mode,
      source = excluded.source,
      last_update_time = COALESCE(?4, match_refresh_states.last_update_time),
      fixed_bonus_failure_count = COALESCE(?5, match_refresh_states.fixed_bonus_failure_count),
      last_refresh_started_at = COALESCE(excluded.last_refresh_started_at, match_refresh_states.last_refresh_started_at),
      last_refresh_finished_at = COALESCE(excluded.last_refresh_finished_at, match_refresh_states.last_refresh_finished_at),
      refresh_lock_until = excluded.refresh_lock_until,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).bind(
    MATCH_STATE_ID,
    values.mode,
    values.source,
    values.lastUpdateTime ?? null,
    values.fixedBonusFailureCount ?? null,
    values.startedAt ?? null,
    values.finishedAt ?? null,
    values.lockUntil ?? null,
    values.error ?? null,
    values.updatedAt,
  ).run();
}

export async function cleanupOldMatches(d1: D1Database, now = new Date()) {
  const cutoff = retainedSportteryMatchDateCutoff(beijingDateKey(now));
  await d1.prepare("DELETE FROM shared_matches WHERE business_date < ?1").bind(cutoff).run();
  return { cutoff };
}

async function loadStoredMatches(d1: D1Database, ids?: string[]) {
  const uniqueIds = [...new Set((ids ?? []).map(normalizeSportteryMatchId).filter(Boolean))];
  const rows = uniqueIds.length > 0
    ? await d1.prepare(`
      SELECT match_id, data_json
      FROM shared_matches
      WHERE match_id IN (SELECT value FROM json_each(?1))
      ORDER BY business_date, match_id
    `).bind(JSON.stringify(uniqueIds)).all<MatchRow>()
    : await d1.prepare(`
      SELECT match_id, data_json
      FROM shared_matches
      ORDER BY business_date, match_id
    `).all<MatchRow>();
  return (rows.results ?? []).flatMap((row) => {
    const match = parseJson<MatchItem | null>(row.data_json, null);
    return match ? [{ ...match, id: normalizeSportteryMatchId(match.id || row.match_id) }] : [];
  });
}

async function saveMatches(
  d1: D1Database,
  matches: MatchItem[],
  source: MatchRefreshSource,
  metadata: {
    mode: SportteryMatchFetchMode;
    lastUpdateTime?: string;
    fixedBonusFailureCount?: number;
  },
  now = new Date(),
) {
  if (matches.length > MAX_MATCHES) throw httpError(`比赛数据超过 ${MAX_MATCHES} 场`, 400);
  const normalized = [...new Map(clearMatchSelections(structuredClone(matches)).map((match) => {
    const next = { ...match, id: normalizeSportteryMatchId(match.id) };
    if (!isMatch(next)) throw httpError("比赛数据结构无效", 400);
    const json = JSON.stringify(next);
    if (new TextEncoder().encode(json).byteLength > MAX_MATCH_BYTES) {
      throw httpError(`比赛“${next.home} VS ${next.away}”数据过大`, 400);
    }
    return [next.id, next] as const;
  })).values()];
  const nowIso = now.toISOString();
  const existing = await loadStoredMatches(d1);
  const merged = mergeSportteryMatchCache(existing, normalized, now);
  await cleanupOldMatches(d1, now);
  const statements = merged.map((match) => d1.prepare(`
    INSERT INTO shared_matches (match_id, business_date, data_json, updated_by, updated_at)
    VALUES (?1, ?2, ?3, NULL, ?4)
    ON CONFLICT(match_id) DO UPDATE SET
      business_date = excluded.business_date,
      data_json = excluded.data_json,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).bind(match.id, match.date, JSON.stringify(match), nowIso));
  if (statements.length > 0) await d1.batch(statements);
  await saveRefreshState(d1, {
    mode: metadata.mode,
    source,
    lastUpdateTime: metadata.lastUpdateTime ?? "",
    fixedBonusFailureCount: metadata.fixedBonusFailureCount ?? 0,
    finishedAt: nowIso,
    lockUntil: null,
    error: null,
    updatedAt: nowIso,
  });
  return merged;
}

function stateMetadata(state: RefreshStateRow | null, fromCache: boolean, now = new Date()): MatchRefreshMetadata {
  const policy = getSportteryRefreshPolicy(now);
  return {
    mode: state?.mode ?? policy.mode,
    source: state?.source ?? "official",
    lastUpdateTime: state?.last_update_time ?? "",
    fixedBonusFailureCount: Number(state?.fixed_bonus_failure_count ?? 0),
    savedAt: state?.last_refresh_finished_at ?? state?.updated_at ?? "",
    fromCache,
  };
}

function shouldRefresh(state: RefreshStateRow | null, now = new Date(), force = false) {
  if (force) return true;
  const maxAge = cacheMaxAgeMs(now);
  if (maxAge === null) return false;
  const savedAt = state?.last_refresh_finished_at ? new Date(state.last_refresh_finished_at).getTime() : 0;
  return !savedAt || now.getTime() - savedAt >= maxAge;
}

function isCoolingDown(state: RefreshStateRow | null, now = new Date(), cooldownMs: number) {
  const savedAt = state?.last_refresh_finished_at ? new Date(state.last_refresh_finished_at).getTime() : 0;
  return Boolean(savedAt && now.getTime() - savedAt < cooldownMs);
}

function isLocked(state: RefreshStateRow | null, now = new Date()) {
  const lockUntil = state?.refresh_lock_until ? new Date(state.refresh_lock_until).getTime() : 0;
  return Boolean(lockUntil && lockUntil > now.getTime());
}

export async function refreshMatchesFromOfficial(
  d1: D1Database,
  options: { force?: boolean; manual?: boolean; now?: Date } = {},
): Promise<CurrentMatchesResponse> {
  const now = options.now ?? new Date();
  const state = await getRefreshState(d1);
  const matches = await loadStoredMatches(d1);
  const cooldownMs = options.manual ? MANUAL_REFRESH_COOLDOWN_MS : cacheMaxAgeMs(now);
  if (!options.force && cooldownMs !== null && isCoolingDown(state, now, cooldownMs)) {
    return { matches, metadata: stateMetadata(state, true, now) };
  }
  if (isLocked(state, now)) {
    return { matches, metadata: stateMetadata(state, true, now) };
  }
  const policy = getSportteryRefreshPolicy(now);
  const startedAt = now.toISOString();
  await saveRefreshState(d1, {
    mode: policy.mode,
    source: "official",
    startedAt,
    lockUntil: new Date(now.getTime() + REFRESH_LOCK_MS).toISOString(),
    updatedAt: startedAt,
  });
  try {
    const snapshot = await fetchSportteryMatchSnapshot(policy.mode, now);
    const saved = await saveMatches(d1, snapshot.matches, "official", {
      mode: snapshot.mode,
      lastUpdateTime: snapshot.lastUpdateTime,
      fixedBonusFailureCount: snapshot.fixedBonusFailureCount,
    }, new Date());
    const nextState = await getRefreshState(d1);
    return { matches: saved, metadata: stateMetadata(nextState, false, now) };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await saveRefreshState(d1, {
      mode: policy.mode,
      source: "official",
      finishedAt,
      lockUntil: null,
      error: error instanceof Error ? error.message : "官方比赛刷新失败",
      updatedAt: finishedAt,
    });
    if (matches.length > 0) return { matches, metadata: stateMetadata(await getRefreshState(d1), true, now) };
    throw error;
  }
}

export async function getCurrentMatches(d1: D1Database, now = new Date()) {
  await cleanupOldMatches(d1, now);
  const state = await getRefreshState(d1);
  if (shouldRefresh(state, now)) return refreshMatchesFromOfficial(d1, { now });
  return {
    matches: await loadStoredMatches(d1),
    metadata: stateMetadata(state, true, now),
  };
}

export async function getMatchesByIds(d1: D1Database, ids: string[]) {
  await cleanupOldMatches(d1);
  return {
    matches: await loadStoredMatches(d1, ids),
  };
}

export async function saveClientMatchSnapshot(d1: D1Database, matches: unknown, now = new Date()) {
  const state = await getRefreshState(d1);
  if (isCoolingDown(state, now, MANUAL_REFRESH_COOLDOWN_MS)) {
    return {
      matches: await loadStoredMatches(d1),
      metadata: stateMetadata(state, true, now),
    };
  }
  if (!Array.isArray(matches) || !matches.every(isMatch)) {
    throw httpError("比赛数据结构无效", 400);
  }
  const policy = getSportteryRefreshPolicy(now);
  const saved = await saveMatches(d1, matches, "snapshot", { mode: policy.mode }, now);
  const nextState = await getRefreshState(d1);
  return {
    matches: saved,
    metadata: stateMetadata(nextState, false, now),
  };
}

export async function runScheduledMatchRefresh(d1: D1Database, scheduledTime?: number) {
  const now = scheduledTime ? new Date(scheduledTime) : new Date();
  await cleanupOldMatches(d1, now);
  const policy = getSportteryRefreshPolicy(now);
  if (policy.autoIntervalMs === null) return { refreshed: false, reason: "outside-refresh-window" };
  await refreshMatchesFromOfficial(d1, { now });
  return { refreshed: true, mode: policy.mode };
}
