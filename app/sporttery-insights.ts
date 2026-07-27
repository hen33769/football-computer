import { fetchSportteryFixedBonusPayload, normalizeSportteryMatchId } from "./sporttery";

export const SPORTTERY_RESULT_HISTORY_URL =
  "https://webapi.sporttery.cn/gateway/uniform/football/getResultHistoryV1.qry";
export const SPORTTERY_MATCH_FEATURE_URL =
  "https://webapi.sporttery.cn/gateway/uniform/football/getMatchFeatureV1.qry";
export const SPORTTERY_MATCH_TABLES_URL =
  "https://webapi.sporttery.cn/gateway/uniform/football/getMatchTablesV2.qry";
export const SPORTTERY_MATCH_RESULT_URL =
  "https://webapi.sporttery.cn/gateway/uniform/football/getMatchResultV1.qry";
export const SPORTTERY_MATCH_PLAYER_URL =
  "https://webapi.sporttery.cn/gateway/uniform/football/getMatchPlayerV1.qry";
export const SPORTTERY_INJURY_SUSPENSION_URL =
  "https://webapi.sporttery.cn/gateway/uniform/football/getInjurySuspensionV1.qry";

export type InsightRecord = Record<string, unknown>;

export type SportteryTrendData = {
  isCancel?: number | string;
  sectionsNo999?: string;
  matchResultList?: InsightRecord[];
  oddsHistory?: InsightRecord;
};

export type PreviewStaticData = {
  feature: InsightRecord | null;
  tables: InsightRecord | null;
  players: InsightRecord | null;
  injuries: InsightRecord | null;
};

type PreviewFilter = {
  tournamentFlag: 0 | 1;
  homeAwayFlag: 0 | 1;
};

const buildUrl = (base: string, params: Record<string, string | number>) => {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return url;
};

export function buildSportteryHistoryUrl(matchId: string, filter: PreviewFilter) {
  return buildUrl(SPORTTERY_RESULT_HISTORY_URL, {
    sportteryMatchId: normalizeSportteryMatchId(matchId),
    termLimits: 20,
    tournamentFlag: filter.tournamentFlag,
    homeAwayFlag: filter.homeAwayFlag,
  });
}

export function buildSportteryRecentUrl(matchId: string, filter: PreviewFilter) {
  return buildUrl(SPORTTERY_MATCH_RESULT_URL, {
    sportteryMatchId: normalizeSportteryMatchId(matchId),
    termLimits: 20,
    tournamentFlag: filter.tournamentFlag,
    homeAwayFlag: filter.homeAwayFlag,
  });
}

const fetchInsightValue = async (url: URL, label: string): Promise<InsightRecord | null> => {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`${label}接口请求失败：HTTP ${response.status}`);
  const payload = await response.json() as InsightRecord;
  if (payload.success === false) {
    throw new Error(String(payload.errorMessage || payload.errorCode || `${label}接口返回失败`));
  }
  return payload.value && typeof payload.value === "object" ? payload.value as InsightRecord : null;
};

export async function fetchSportteryTrend(matchId: string): Promise<SportteryTrendData | null> {
  const payload = await fetchSportteryFixedBonusPayload(matchId);
  return payload.value && typeof payload.value === "object" ? payload.value as SportteryTrendData : null;
}

export function fetchSportteryHistory(matchId: string, filter: PreviewFilter) {
  return fetchInsightValue(buildSportteryHistoryUrl(matchId, filter), "历史交锋");
}

export function fetchSportteryRecent(matchId: string, filter: PreviewFilter) {
  return fetchInsightValue(buildSportteryRecentUrl(matchId, filter), "比赛近况");
}

export async function fetchSportteryPreviewStatic(matchId: string): Promise<PreviewStaticData> {
  const normalizedMatchId = normalizeSportteryMatchId(matchId);
  const [feature, tables, players, injuries] = await Promise.all([
    fetchInsightValue(buildUrl(SPORTTERY_MATCH_FEATURE_URL, {
      termLimits: 10,
      sportteryMatchId: normalizedMatchId,
    }), "特征分析"),
    fetchInsightValue(buildUrl(SPORTTERY_MATCH_TABLES_URL, {
      gmMatchId: normalizedMatchId,
    }), "积分榜"),
    fetchInsightValue(buildUrl(SPORTTERY_MATCH_PLAYER_URL, {
      sportteryMatchId: normalizedMatchId,
      termLimits: 3,
    }), "射手信息"),
    fetchInsightValue(buildUrl(SPORTTERY_INJURY_SUSPENSION_URL, {
      sportteryMatchId: normalizedMatchId,
    }), "伤停情况"),
  ]);
  return { feature, tables, players, injuries };
}

export function getSportteryStandingsUrl(tournamentId: unknown) {
  const url = new URL("https://www.sporttery.cn/zqlszl/");
  const normalizedTournamentId = String(tournamentId ?? "").trim();
  if (normalizedTournamentId) url.searchParams.set("tournamentId", normalizedTournamentId);
  url.searchParams.set("showType", "2");
  return url.toString();
}
