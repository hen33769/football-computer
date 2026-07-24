import { createMarkets } from "./data";
import { winningOptionId } from "./calculator";
import type { MarketType, MatchItem } from "./types";

export const SPORTTERY_MATCH_CALCULATOR_URL =
  "https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry";
export const SPORTTERY_MATCH_LIST_URL =
  "https://webapi.sporttery.cn/gateway/uniform/football/getMatchListV1.qry";
export const SPORTTERY_FIXED_BONUS_URL =
  "https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry";
export const SPORTTERY_MATCH_SCORE_URL =
  "https://webapi.sporttery.cn/gateway/uniform/fb/getMatchScoreV1.qry";

const LEGACY_SPORTTERY_MATCH_ID_PREFIX = "sporttery-";
export const SPORTTERY_MATCH_CACHE_DAYS = 5;

type SportteryOdds = Record<string, unknown>;

export type SportteryPool = {
  poolCode: string;
  poolStatus?: string;
  single?: number;
  allUp?: number;
  bettingSingle?: number;
  bettingAllup?: number;
  cbtSingle?: number;
  cbtAllUp?: number;
  [key: string]: unknown;
};

export type SportteryMatch = {
  matchId: number;
  matchNum: number;
  matchNumStr: string;
  businessDate?: string;
  matchDate: string;
  matchTime: string;
  matchWeek?: string;
  homeTeamAbbName: string;
  awayTeamAbbName: string;
  leagueAbbName: string;
  matchStatus: string;
  isHide?: number;
  had?: SportteryOdds;
  hhad?: SportteryOdds;
  hafu?: SportteryOdds;
  crs?: SportteryOdds;
  ttg?: SportteryOdds;
  poolList?: SportteryPool[];
  oddsList?: Array<SportteryOdds & { poolCode?: string }>;
  sellStatus?: string;
  [key: string]: unknown;
};

export type SportteryMatchGroup = {
  businessDate: string;
  subMatchList: SportteryMatch[];
  [key: string]: unknown;
};

export type SportteryMatchDate = {
  businessDate: string;
  businessDateCn?: string;
  matchDate?: string;
  matchDateCn?: string;
};

export type SportteryLeague = {
  leagueId: string;
  leagueName: string;
  leagueNameAbbr: string;
};

export type SportteryMatchCalculatorResponse = {
  success: boolean;
  errorCode: string;
  errorMessage: string;
  emptyFlag?: boolean;
  value?: {
    matchInfoList?: SportteryMatchGroup[];
    matchDateList?: SportteryMatchDate[];
    leagueList?: SportteryLeague[];
    totalCount?: number;
    lastUpdateTime?: string;
    vtoolsConfig?: {
      onLineSaleStatus?: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type SportteryMatchListResponse = SportteryMatchCalculatorResponse;
export type SportteryMatchFetchMode = "morning" | "standard";

export type SportteryMatchSnapshot = {
  mode: SportteryMatchFetchMode;
  matches: MatchItem[];
  matchDates: SportteryMatchDate[];
  leagues: SportteryLeague[];
  lastUpdateTime: string;
  fixedBonusFailureCount: number;
};

const POOL_BY_MARKET: Record<MarketType, string> = {
  spf: "HAD",
  rqspf: "HHAD",
  score: "CRS",
  goals: "TTG",
  halfFull: "HAFU",
};

const SOURCE_BY_MARKET: Record<MarketType, keyof SportteryMatch> = {
  spf: "had",
  rqspf: "hhad",
  score: "crs",
  goals: "ttg",
  halfFull: "hafu",
};

const resultCodeToApiCode: Record<string, string> = { W: "h", D: "d", L: "a" };

const toOdds = (value: unknown) => {
  const odds = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(odds) && odds > 0 ? odds : 0;
};

const toOddsTrend = (value: unknown): -1 | 0 | 1 => {
  const trend = Number.parseInt(String(value ?? "0"), 10);
  return trend > 0 ? 1 : trend < 0 ? -1 : 0;
};

const scoreApiKey = (optionId: string) => {
  if (optionId === "winOther") return "s1sh";
  if (optionId === "drawOther") return "s1sd";
  if (optionId === "loseOther") return "s1sa";
  const [home, away] = optionId.split(":");
  return `s${home.padStart(2, "0")}s${away.padStart(2, "0")}`;
};

const optionApiKey = (marketType: MarketType, optionId: string) => {
  if (marketType === "spf" || marketType === "rqspf") {
    return optionId === "win" ? "h" : optionId === "draw" ? "d" : "a";
  }
  if (marketType === "score") return scoreApiKey(optionId);
  if (marketType === "goals") return optionId === "7+" ? "s7" : `s${optionId}`;
  return optionId.split("").map((part) => resultCodeToApiCode[part] ?? "").join("");
};

const parseMatchNumber = (match: SportteryMatch) => {
  const matched = match.matchNumStr?.match(/^(周[一二三四五六日天])(\d+)$/);
  return {
    weekday: matched?.[1] ?? match.matchWeek ?? "",
    code: matched?.[2] ?? String(match.matchNum ?? "").slice(-3),
  };
};

const identityPart = (value: string) => value.replace(/\s+/g, "").toLocaleLowerCase("zh-CN");

export const normalizeSportteryMatchId = (id: string) => id.startsWith(LEGACY_SPORTTERY_MATCH_ID_PREFIX)
  ? id.slice(LEGACY_SPORTTERY_MATCH_ID_PREFIX.length)
  : id;

const matchIdentityKey = (match: MatchItem) => [
  identityPart(match.weekday),
  identityPart(match.code),
  identityPart(match.home),
  identityPart(match.away),
].join("|");

const sameMatch = (left: MatchItem, right: MatchItem) => (
  normalizeSportteryMatchId(left.id) === normalizeSportteryMatchId(right.id)
  || matchIdentityKey(left) === matchIdentityKey(right)
);

export const hasMatchStarted = (match: Pick<MatchItem, "date" | "time">, now = new Date()) => {
  if (!match.time) return false;
  const source = /^\d{4}-\d{2}-\d{2}/.test(match.time) ? match.time : `${match.date} ${match.time}`;
  const kickoff = new Date(source.replace(" ", "T"));
  return !Number.isNaN(kickoff.getTime()) && now.getTime() >= kickoff.getTime();
};

export type MatchSaleState = "pending" | "selling" | "stopped";

const matchSaleStartTime = (match: Pick<MatchItem, "date">) => {
  const saleStart = new Date(`${match.date}T11:00:00`);
  return Number.isNaN(saleStart.getTime()) ? null : saleStart;
};

/** 每个比赛日 11:00 前统一视为待开售，之后再根据接口销售状态判断。 */
export const getMatchSaleState = (match: MatchItem, now = new Date()): MatchSaleState => {
  const saleStart = matchSaleStartTime(match);
  if (saleStart && now.getTime() < saleStart.getTime()) return "pending";
  return match.saleStatus !== "stopped"
    && !hasMatchStarted(match, now)
    && match.markets.some((market) => market.options.some((option) => option.odds > 0))
    ? "selling"
    : "stopped";
};

export const isMatchSellable = (match: MatchItem, now = new Date()) => getMatchSaleState(match, now) === "selling";

export function convertSportteryMatches(payload: SportteryMatchCalculatorResponse, now = new Date()): MatchItem[] {
  const groups = payload.value?.matchInfoList;
  if (!Array.isArray(groups)) {
    if (payload.emptyFlag) return [];
    throw new Error("体彩比赛接口缺少 matchInfoList");
  }

  const globalSaleEnabled = payload.value?.vtoolsConfig?.onLineSaleStatus !== 0;

  return groups.flatMap((group) => (group.subMatchList ?? []).map((match) => ({ match, groupBusinessDate: group.businessDate })))
    .filter(({ match }) => !match.isHide)
    .map(({ match, groupBusinessDate }) => {
    const handicap = Number.parseFloat(String(match.hhad?.goalLine ?? ""));
    const markets = createMarkets(0, Number.isFinite(handicap) ? handicap : 0);
    if (!Number.isFinite(handicap)) {
      const rqspf = markets.find((market) => market.type === "rqspf");
      if (rqspf) rqspf.handicap = undefined;
    }
    const matchSelling = globalSaleEnabled && match.matchStatus === "Selling";

    markets.forEach((market) => {
      const pool = match.poolList?.find((item) => item.poolCode === POOL_BY_MARKET[market.type]);
      const poolSelling = matchSelling && pool?.poolStatus === "Selling";
      const source = (match[SOURCE_BY_MARKET[market.type]] ?? {}) as SportteryOdds;
      market.singleAvailable = Boolean(poolSelling && (pool?.bettingSingle ?? pool?.single ?? pool?.cbtSingle) === 1);
      market.passAvailable = Boolean(poolSelling && (pool?.bettingAllup ?? pool?.allUp ?? pool?.cbtAllUp) === 1);
      market.options = market.options.map((option) => {
        const apiKey = optionApiKey(market.type, option.id);
        return {
          ...option,
          odds: poolSelling ? toOdds(source[apiKey]) : 0,
          oddsTrend: poolSelling ? toOddsTrend(source[`${apiKey}f`]) : 0,
          selected: false,
        };
      });
    });

    const { weekday, code } = parseMatchNumber(match);
    const businessDate = match.businessDate || groupBusinessDate;
    const kickoff = [match.matchDate, match.matchTime?.slice(0, 5)].filter(Boolean).join(" ");

    const converted: MatchItem = {
      id: String(match.matchId),
      saleStatus: "stopped",
      date: businessDate,
      weekday,
      code,
      league: match.leagueAbbName ?? "",
      time: kickoff,
      home: match.homeTeamAbbName ?? "",
      away: match.awayTeamAbbName ?? "",
      markets,
    };
    converted.saleStatus = matchSelling
      && !hasMatchStarted(converted, now)
      && markets.some((market) => market.options.some((option) => option.odds > 0))
      ? "selling"
      : "stopped";
    return converted;
    });
}

const preserveSelections = (incoming: MatchItem, previous?: MatchItem): MatchItem => {
  if (!previous) return incoming;
  const selected = new Set(previous.markets.flatMap((market) => market.options
    .filter((option) => option.selected)
    .map((option) => `${market.type}:${option.id}`)));
  return {
    ...incoming,
    markets: incoming.markets.map((market) => ({
      ...market,
      options: market.options.map((option) => ({
        ...option,
        selected: option.odds > 0 && selected.has(`${market.type}:${option.id}`),
      })),
    })),
  };
};

/** 使用接口本次返回的完整比赛列表，并保留同场比赛仍然可售的选中项。 */
export function replaceSportteryMatches(current: MatchItem[], incoming: MatchItem[]) {
  return incoming.map((match) => {
    const previous = current.find((item) => sameMatch(item, match));
    return preserveSelections(match, previous);
  });
}

const retainedDateCutoff = (today: string) => {
  const date = new Date(`${today}T12:00:00`);
  if (Number.isNaN(date.getTime())) return today;
  date.setDate(date.getDate() - SPORTTERY_MATCH_CACHE_DAYS);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const clearSelections = (match: MatchItem): MatchItem => ({
  ...match,
  id: normalizeSportteryMatchId(match.id),
  markets: match.markets.map((market) => ({
    ...market,
    options: market.options.map((option) => ({ ...option, selected: false })),
  })),
});

/**
 * 将接口本次返回覆盖到本地缓存；未再次返回的比赛保留原倍率但标记停售，
 * 并自动清除早于当前日期 5 天以上的数据。
 */
export function mergeSportteryMatchCache(current: MatchItem[], incoming: MatchItem[], today: string): MatchItem[] {
  const cutoff = retainedDateCutoff(today);
  const retained = current.filter((match) => match.date >= cutoff);
  const mergedIncoming = incoming.filter((match) => match.date >= cutoff).map((match) => {
    const normalized = { ...match, id: normalizeSportteryMatchId(match.id) };
    const previous = retained.find((item) => sameMatch(item, normalized));
    return preserveSelections(normalized, previous);
  });
  const stale = retained
    .filter((match) => !mergedIncoming.some((incomingMatch) => sameMatch(match, incomingMatch)))
    .map((match) => ({ ...clearSelections(match), saleStatus: "stopped" as const }));

  return [...mergedIncoming, ...stale].sort((left, right) => (
    left.date.localeCompare(right.date)
    || left.code.localeCompare(right.code, "zh-CN", { numeric: true, sensitivity: "base" })
  ));
}

export type SelectedOddsRefreshResult = {
  matches: MatchItem[];
  matchedOptionCount: number;
  changedOptionCount: number;
  unmatchedOptionCount: number;
};

/** 使用最新官方比赛更新订单中已选投注项；停售或无法匹配的选项保留订单原值。 */
export function refreshSelectedOdds(current: MatchItem[], incoming: MatchItem[]): SelectedOddsRefreshResult {
  let matchedOptionCount = 0;
  let changedOptionCount = 0;
  let unmatchedOptionCount = 0;

  const matches = current.map((match) => {
    const latestMatch = incoming.find((item) => sameMatch(item, match));

    return {
      ...match,
      markets: match.markets.map((market) => {
        const latestMarket = latestMatch?.markets.find((item) => item.type === market.type);
        return {
          ...market,
          handicap: market.type === "rqspf" ? latestMarket?.handicap ?? market.handicap : market.handicap,
          options: market.options.map((option) => {
            if (!option.selected) return option;
            const latestOption = latestMarket?.options.find((item) => item.id === option.id);
            if (!latestOption || latestOption.odds <= 0) {
              unmatchedOptionCount += 1;
              return option;
            }
            matchedOptionCount += 1;
            if (latestOption.odds !== option.odds) changedOptionCount += 1;
            return {
              ...option,
              odds: latestOption.odds,
              oddsTrend: latestOption.oddsTrend,
            };
          }),
        };
      }),
    };
  });

  return { matches, matchedOptionCount, changedOptionCount, unmatchedOptionCount };
}

let inFlightRequest: Promise<SportteryMatchCalculatorResponse> | null = null;

/**
 * 获取体彩当前可售比赛及赔率。相邻的重复调用会共用同一个请求，
 * 避免 React 开发模式重复挂载时向接口发送两次请求。
 */
export function fetchSportteryMatchCalculator(channel = "c") {
  if (inFlightRequest) return inFlightRequest;

  const url = new URL(SPORTTERY_MATCH_CALCULATOR_URL);
  url.searchParams.set("channel", channel);

  inFlightRequest = fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`体彩比赛接口请求失败：HTTP ${response.status}`);
      }

      const payload = await response.json() as SportteryMatchCalculatorResponse;
      if (!payload.success) {
        throw new Error(payload.errorMessage || `体彩比赛接口返回错误：${payload.errorCode}`);
      }
      return payload;
    })
    .finally(() => {
      inFlightRequest = null;
    });

  return inFlightRequest;
}

let inFlightMatchListRequest: Promise<SportteryMatchListResponse> | null = null;
const inFlightFixedBonusRequests = new Map<string, Promise<Record<string, unknown>>>();

export function fetchSportteryMatchList(clientCode = "3001") {
  if (inFlightMatchListRequest) return inFlightMatchListRequest;
  const url = new URL(SPORTTERY_MATCH_LIST_URL);
  url.searchParams.set("clientCode", clientCode);
  inFlightMatchListRequest = fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`体彩比赛列表接口请求失败：HTTP ${response.status}`);
      const payload = await response.json() as SportteryMatchListResponse;
      if (!payload.success) throw new Error(payload.errorMessage || `体彩比赛列表接口返回错误：${payload.errorCode}`);
      return payload;
    })
    .finally(() => { inFlightMatchListRequest = null; });
  return inFlightMatchListRequest;
}

export function fetchSportteryFixedBonusPayload(matchId: string) {
  const normalizedMatchId = normalizeSportteryMatchId(matchId);
  const existing = inFlightFixedBonusRequests.get(normalizedMatchId);
  if (existing) return existing;
  const url = new URL(SPORTTERY_FIXED_BONUS_URL);
  url.searchParams.set("clientCode", "3001");
  url.searchParams.set("matchId", normalizedMatchId);
  const request = fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`获取比赛 ${normalizedMatchId} 投注情况失败：HTTP ${response.status}`);
      const payload = await response.json() as Record<string, unknown>;
      if (payload.success === false) throw new Error(String(payload.errorMessage || payload.errorCode || "投注情况接口返回失败"));
      return payload;
    })
    .finally(() => { inFlightFixedBonusRequests.delete(normalizedMatchId); });
  inFlightFixedBonusRequests.set(normalizedMatchId, request);
  return request;
}

const mapWithConcurrency = async <T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
};

const latestHistoryRecord = (value: unknown): SportteryOdds => Array.isArray(value) && value.length > 0
  ? (value[value.length - 1] as SportteryOdds)
  : {};

const fixedBonusOddsHistory = (payload: Record<string, unknown> | null) => {
  const value = payload?.value;
  if (!value || typeof value !== "object") return null;
  const history = (value as Record<string, unknown>).oddsHistory;
  return history && typeof history === "object" ? history as Record<string, unknown> : null;
};

/** 从按 matchId 查询的官方固定奖金数据中读取该场比赛的固定让球数。 */
export function parseSportteryMatchHandicap(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const root = payload as Record<string, unknown>;
  const value = root.value && typeof root.value === "object" ? root.value as Record<string, unknown> : null;
  const resultList = Array.isArray(value?.matchResultList) ? value.matchResultList : [];
  for (const item of resultList) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const poolCode = String(record.code ?? record.poolCode ?? "").toUpperCase();
    if (poolCode !== "HHAD") continue;
    const handicap = Number.parseFloat(String(record.goalLine ?? ""));
    if (Number.isFinite(handicap)) return handicap;
  }

  const history = fixedBonusOddsHistory(root);
  const hhadList = Array.isArray(history?.hhadList) ? history.hhadList : [];
  for (let index = hhadList.length - 1; index >= 0; index -= 1) {
    const record = hhadList[index];
    if (!record || typeof record !== "object") continue;
    const handicap = Number.parseFloat(String((record as Record<string, unknown>).goalLine ?? ""));
    if (Number.isFinite(handicap)) return handicap;
  }
  return undefined;
}

export async function fetchSportteryMatchHandicap(matchId: string) {
  return parseSportteryMatchHandicap(await fetchSportteryFixedBonusPayload(matchId));
}

export function convertSportteryMorningMatches(
  payload: SportteryMatchListResponse,
  fixedBonusPayloads: Map<string, Record<string, unknown>>,
  now = new Date(),
) {
  const groups = payload.value?.matchInfoList;
  if (!Array.isArray(groups)) {
    if (payload.emptyFlag) return [];
    throw new Error("体彩比赛列表接口缺少 matchInfoList");
  }
  const enrichedGroups = groups.map((group) => ({
    ...group,
    subMatchList: (group.subMatchList ?? []).map((match) => {
      const history = fixedBonusOddsHistory(fixedBonusPayloads.get(String(match.matchId)) ?? null);
      const singles = Array.isArray(history?.singleList) ? history.singleList as Array<Record<string, unknown>> : [];
      return {
        ...match,
        had: latestHistoryRecord(history?.hadList),
        hhad: latestHistoryRecord(history?.hhadList),
        crs: latestHistoryRecord(history?.crsList),
        ttg: latestHistoryRecord(history?.ttgList),
        hafu: latestHistoryRecord(history?.hafuList),
        poolList: (match.poolList ?? []).map((pool) => ({
          ...pool,
          bettingSingle: Number(singles.find((item) => item.poolCode === pool.poolCode)?.single ?? pool.cbtSingle ?? 0),
          bettingAllup: Number(pool.cbtAllUp ?? 0),
        })),
      };
    }),
  }));
  return convertSportteryMatches({
    ...payload,
    value: { ...payload.value, matchInfoList: enrichedGroups, vtoolsConfig: { onLineSaleStatus: 1 } },
  }, now);
}

export async function fetchSportteryMatchSnapshot(mode: SportteryMatchFetchMode): Promise<SportteryMatchSnapshot> {
  if (mode === "standard") {
    const payload = await fetchSportteryMatchCalculator();
    return {
      mode,
      matches: convertSportteryMatches(payload),
      matchDates: payload.value?.matchDateList ?? [],
      leagues: payload.value?.leagueList ?? [],
      lastUpdateTime: payload.value?.lastUpdateTime ?? "",
      fixedBonusFailureCount: 0,
    };
  }

  const payload = await fetchSportteryMatchList();
  const listedMatches = (payload.value?.matchInfoList ?? []).flatMap((group) => group.subMatchList ?? []);
  let fixedBonusFailureCount = 0;
  const fixedPayloads = await mapWithConcurrency(listedMatches, 6, async (match) => {
    try {
      return await fetchSportteryFixedBonusPayload(String(match.matchId));
    } catch {
      fixedBonusFailureCount += 1;
      return null;
    }
  });
  const fixedBonusPayloads = new Map<string, Record<string, unknown>>();
  listedMatches.forEach((match, index) => {
    const fixedPayload = fixedPayloads[index];
    if (fixedPayload) fixedBonusPayloads.set(String(match.matchId), fixedPayload);
  });
  return {
    mode,
    matches: convertSportteryMorningMatches(payload, fixedBonusPayloads),
    matchDates: payload.value?.matchDateList ?? [],
    leagues: payload.value?.leagueList ?? [],
    lastUpdateTime: payload.value?.lastUpdateTime ?? "",
    fixedBonusFailureCount,
  };
}

export function getSportteryRefreshPolicy(now = new Date()) {
  const hour = now.getHours();
  if (hour >= 9 && hour < 11) return { mode: "morning" as const, autoIntervalMs: 5 * 60 * 1000 };
  if (hour >= 11 && hour < 23) return { mode: "standard" as const, autoIntervalMs: 60 * 60 * 1000 };
  return { mode: "standard" as const, autoIntervalMs: null };
}

const millisecondsUntilHour = (now: Date, hour: number, nextDay = false) => {
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  if (nextDay || target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
};

export function getNextSportteryAutoRefreshDelay(now = new Date()) {
  const hour = now.getHours();
  if (hour < 9) return millisecondsUntilHour(now, 9);
  if (hour < 11) return Math.min(5 * 60 * 1000, millisecondsUntilHour(now, 11));
  if (hour < 23) return Math.min(60 * 60 * 1000, millisecondsUntilHour(now, 23));
  return millisecondsUntilHour(now, 9, true);
}

const normalizedKey = (value: string) => value.replace(/[_\-\s]/g, "").toLowerCase();

const findDeepValue = (payload: unknown, aliases: string[]): unknown => {
  const wanted = new Set(aliases.map(normalizedKey));
  const queue: unknown[] = [payload];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    for (const [key, value] of Object.entries(current)) {
      if (wanted.has(normalizedKey(key)) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) return value;
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return undefined;
};

const parseScore = (value: unknown): [number, number] | null => {
  const matched = String(value ?? "").match(/(\d+)\s*[:：-]\s*(\d+)/);
  if (!matched) return null;
  return [Number(matched[1]), Number(matched[2])];
};

export const SPORTTERY_REGULAR_TIME_ACTIVE_PHASES = [1, 2, 10, 16] as const;

export function getSportteryMatchPhaseTc(payload: unknown) {
  const phase = Number(findDeepValue(payload, ["matchPhaseTc"]));
  return Number.isInteger(phase) ? phase : null;
}

export function isSportteryRegularTimeFinished(payload: unknown) {
  const phase = getSportteryMatchPhaseTc(payload);
  return phase !== null && !SPORTTERY_REGULAR_TIME_ACTIVE_PHASES.includes(phase as 1 | 2 | 10 | 16);
}

export type ParsedSportteryMatchScore = {
  values: Partial<Record<MarketType, string>>;
  fullScore?: { home: number; away: number };
};

/** 从比分接口提取竞彩足球所需的常规时间赛果；sectionNo 2 优先于可能包含加时的总比分。 */
export function parseSportteryMatchScoreDetails(payload: unknown, match: MatchItem): ParsedSportteryMatchScore {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const value = root?.value && typeof root.value === "object" ? root.value as Record<string, unknown> : null;
  const sections = Array.isArray(value?.sectionsNos) ? value.sectionsNos as Array<Record<string, unknown>> : [];
  const sectionScore = (sectionNo: number) => parseScore(sections.find((section) => Number(section.sectionNo) === sectionNo)?.score);
  const fullScore = sectionScore(2) ?? parseScore(value?.sectionsNo999);
  const halfScore = sectionScore(1);
  if (!fullScore) return { values: {} };

  const handicap = match.markets.find((market) => market.type === "rqspf")?.handicap;
  const values: Partial<Record<MarketType, string>> = {
    spf: winningOptionId("spf", fullScore[0], fullScore[1], 0, 0),
    score: winningOptionId("score", fullScore[0], fullScore[1], 0, 0),
    goals: winningOptionId("goals", fullScore[0], fullScore[1], 0, 0),
  };
  if (typeof handicap === "number" && Number.isFinite(handicap)) {
    values.rqspf = winningOptionId("rqspf", fullScore[0], fullScore[1], 0, 0, handicap);
  }
  if (halfScore) values.halfFull = winningOptionId("halfFull", fullScore[0], fullScore[1], halfScore[0], halfScore[1]);
  return {
    values,
    fullScore: { home: fullScore[0], away: fullScore[1] },
  };
}

export function parseSportteryMatchScore(payload: unknown, match: MatchItem): Partial<Record<MarketType, string>> {
  return parseSportteryMatchScoreDetails(payload, match).values;
}

const findPoolResult = (payload: unknown, poolCode: string): unknown => {
  const poolAliases = new Set([poolCode.toLowerCase(), POOL_BY_MARKET[poolCode as MarketType]?.toLowerCase()].filter(Boolean));
  const resultAliases = ["combination", "combinationDesc", "result", "poolResult", "resultCode", "winningResult", "lotteryResult", "resultValue"];
  const queue: unknown[] = [payload];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    for (const [key, value] of Object.entries(current)) {
      if (poolAliases.has(key.toLowerCase())) {
        if (typeof value === "string" || typeof value === "number") return value;
        const nested = findDeepValue(value, resultAliases);
        if (typeof nested !== "undefined") return nested;
      }
      if (["poolcode", "code"].includes(normalizedKey(key)) && poolAliases.has(String(value).toLowerCase())) {
        const nested = findDeepValue(current, resultAliases);
        if (typeof nested !== "undefined") return nested;
      }
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return undefined;
};

const normalizeOutcome = (value: unknown) => {
  const text = String(value ?? "").trim().toUpperCase();
  if (["3", "H", "W", "WIN", "胜", "主胜"].includes(text)) return "win";
  if (["1", "D", "DRAW", "平", "平局"].includes(text)) return "draw";
  if (["0", "A", "L", "LOSE", "负", "主负"].includes(text)) return "lose";
  return undefined;
};

const normalizeScoreResult = (value: unknown) => {
  const text = String(value ?? "").trim();
  const apiScore = text.match(/^s(\d{2})s(\d{2})$/i);
  if (apiScore) return `${Number(apiScore[1])}:${Number(apiScore[2])}`;
  const score = parseScore(text);
  if (score) return `${score[0]}:${score[1]}`;
  const lower = text.toLowerCase();
  if (["s1sh", "winother", "胜其他"].includes(lower)) return "winOther";
  if (["s1sd", "drawother", "平其他"].includes(lower)) return "drawOther";
  if (["s1sa", "loseother", "负其他"].includes(lower)) return "loseOther";
  return undefined;
};

const normalizeGoalsResult = (value: unknown) => {
  const text = String(value ?? "").trim().toLowerCase().replace(/^s/, "");
  if (["7", "7+", "7及以上"].includes(text)) return "7+";
  return /^[0-6]$/.test(text) ? text : undefined;
};

const normalizeHalfFullResult = (value: unknown) => {
  const text = String(value ?? "").trim().toUpperCase().replace(/[\s/:：\-]/g, "");
  const chinese = text.replace(/主胜|胜/g, "W").replace(/平局|平/g, "D").replace(/主负|负/g, "L");
  const api = chinese.replace(/H/g, "W").replace(/A/g, "L");
  return /^[WDL]{2}$/.test(api) ? api : undefined;
};

/** 将官方固定奖金接口的多种返回结构归一成页面玩法选项 ID。 */
export function parseSportteryFixedBonus(payload: unknown, match: MatchItem): Partial<Record<MarketType, string>> {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const rootValue = root?.value && typeof root.value === "object" ? root.value as Record<string, unknown> : null;
  const matchResultList = Array.isArray(rootValue?.matchResultList) ? rootValue.matchResultList : [];
  const resultPayload = {
    matchResultList,
    sectionsNo999: rootValue?.sectionsNo999,
    sectionsNo1: rootValue?.sectionsNo1,
  };
  const values: Partial<Record<MarketType, string>> = {};
  const fullScore = parseScore(findDeepValue(resultPayload, ["finalScore", "fullScore", "fullTimeScore", "matchScore", "matchResult", "score", "finalResult", "sectionsNo999"]));
  const halfScore = parseScore(findDeepValue(resultPayload, ["halfScore", "halfTimeScore", "halfResult", "halfMatchScore", "sectionsNo1", "firstHalfScore"]));
  if (fullScore) {
    const handicap = match.markets.find((market) => market.type === "rqspf")?.handicap ?? 0;
    values.spf = winningOptionId("spf", fullScore[0], fullScore[1], halfScore?.[0] ?? 0, halfScore?.[1] ?? 0);
    values.rqspf = winningOptionId("rqspf", fullScore[0], fullScore[1], halfScore?.[0] ?? 0, halfScore?.[1] ?? 0, handicap);
    values.score = winningOptionId("score", fullScore[0], fullScore[1], halfScore?.[0] ?? 0, halfScore?.[1] ?? 0);
    values.goals = winningOptionId("goals", fullScore[0], fullScore[1], halfScore?.[0] ?? 0, halfScore?.[1] ?? 0);
    if (halfScore) values.halfFull = winningOptionId("halfFull", fullScore[0], fullScore[1], halfScore[0], halfScore[1]);
  }
  const directSpf = normalizeOutcome(findPoolResult(resultPayload, "spf"));
  const directRqspf = normalizeOutcome(findPoolResult(resultPayload, "rqspf"));
  const directScore = normalizeScoreResult(findPoolResult(resultPayload, "score"));
  const directGoals = normalizeGoalsResult(findPoolResult(resultPayload, "goals"));
  const directHalfFull = normalizeHalfFullResult(findPoolResult(resultPayload, "halfFull"));
  if (directSpf) values.spf = directSpf;
  if (directRqspf) values.rqspf = directRqspf;
  if (directScore) values.score = directScore;
  if (directGoals) values.goals = directGoals;
  if (directHalfFull) values.halfFull = directHalfFull;
  return values;
}

export async function fetchSportteryFixedBonus(match: MatchItem) {
  const payload = await fetchSportteryFixedBonusPayload(match.id);
  return { payload, values: parseSportteryFixedBonus(payload, match) };
}

export async function fetchSportteryMatchScore(matchId: string) {
  const url = new URL(SPORTTERY_MATCH_SCORE_URL);
  url.searchParams.set("matchId", normalizeSportteryMatchId(matchId));
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("完赛状态接口未返回有效 JSON");
  }
  if (!response.ok) throw new Error(`完赛状态接口请求失败：HTTP ${response.status}`);
  if (payload.success === false) throw new Error(String(payload.errorMessage || payload.errorCode || "完赛状态接口返回失败"));
  return payload;
}
