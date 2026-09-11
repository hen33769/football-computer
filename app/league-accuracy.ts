import { normalizeSportteryMatchId } from "./sporttery";
import { getOrderStatus } from "./calculator";
import type { CurrentHits, Market, MatchItem, SavedSlip } from "./types";

export type LeagueAccuracyStatus = "hit" | "miss" | "unconfirmed";

export type LeagueAccuracyStat = {
  league: string;
  hit: number;
  miss: number;
  unconfirmed: number;
  accuracy: number | null;
};

export type LeagueAccuracyOptions = {
  excludeScore: boolean;
  countDuplicates: boolean;
};

export type LeagueAccuracySummary = {
  hit: number;
  miss: number;
  confirmed: number;
  hitRate: number | null;
};

export type OrderHitRateSummary = {
  success: number;
  failed: number;
  confirmed: number;
  hitRate: number | null;
};

const LEAGUE_ACCURACY_PRIORITY = ["世界杯", "欧冠", "英超", "法甲", "西甲", "德甲", "意甲"];
const leagueAccuracyPriority = new Map(LEAGUE_ACCURACY_PRIORITY.map((leagueName, index) => [leagueName, index]));

type Prediction = {
  key: string;
  league: string;
  status: LeagueAccuracyStatus;
};

const statusPriority: Record<LeagueAccuracyStatus, number> = {
  hit: 3,
  miss: 2,
  unconfirmed: 1,
};

const valuesForMatch = (values: CurrentHits | undefined, matchId: string) => {
  if (!values) return undefined;
  if (values[matchId]) return values[matchId];
  const normalizedMatchId = normalizeSportteryMatchId(matchId);
  return Object.entries(values).find(([savedMatchId]) => (
    normalizeSportteryMatchId(savedMatchId) === normalizedMatchId
  ))?.[1];
};

const selectedOptionIds = (market: Market) => market.options
  .filter((option) => option.selected)
  .map((option) => option.id)
  .sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" }));

const predictionStatus = (
  order: SavedSlip,
  match: MatchItem,
  market: Market,
  selectedIds: string[],
): LeagueAccuracyStatus => {
  const hitId = valuesForMatch(order.hits, match.id)?.[market.type];
  if (hitId && selectedIds.includes(hitId)) return "hit";

  const resultId = valuesForMatch(order.resultValues, match.id)?.[market.type];
  if (resultId) return "miss";

  const normalizedMatchId = normalizeSportteryMatchId(match.id);
  if ((order.failedMatches ?? []).some((failedMatchId) => (
    normalizeSportteryMatchId(failedMatchId) === normalizedMatchId
  ))) return "miss";

  return "unconfirmed";
};

const predictionsFromOrder = (order: SavedSlip, excludeScore: boolean): Prediction[] => (
  order.matches.flatMap((match) => {
    const league = match.league.trim();
    if (!league) return [];
    return match.markets.flatMap((market) => {
      if (excludeScore && market.type === "score") return [];
      const selectedIds = selectedOptionIds(market);
      if (selectedIds.length === 0) return [];
      return [{
        key: `${normalizeSportteryMatchId(match.id)}\u0000${market.type}\u0000${selectedIds.join("\u0001")}`,
        league,
        status: predictionStatus(order, match, market, selectedIds),
      }];
    });
  })
);

const deduplicatePredictions = (predictions: Prediction[]) => {
  const unique = new Map<string, Prediction>();
  predictions.forEach((prediction) => {
    const current = unique.get(prediction.key);
    if (!current || statusPriority[prediction.status] > statusPriority[current.status]) {
      unique.set(prediction.key, prediction);
    }
  });
  return [...unique.values()];
};

export function buildLeagueAccuracyStats(
  orders: SavedSlip[],
  { excludeScore, countDuplicates }: LeagueAccuracyOptions,
): LeagueAccuracyStat[] {
  const predictions = orders.flatMap((order) => predictionsFromOrder(order, excludeScore));
  const includedPredictions = countDuplicates ? predictions : deduplicatePredictions(predictions);
  const totals = new Map<string, Omit<LeagueAccuracyStat, "accuracy">>();

  includedPredictions.forEach(({ league, status }) => {
    const current = totals.get(league) ?? { league, hit: 0, miss: 0, unconfirmed: 0 };
    current[status] += 1;
    totals.set(league, current);
  });

  return [...totals.values()].map((stat) => {
    const confirmed = stat.hit + stat.miss;
    return {
      ...stat,
      accuracy: confirmed > 0 ? stat.hit / confirmed * 100 : null,
    };
  });
}

export function summarizeLeagueAccuracyStats(stats: LeagueAccuracyStat[]): LeagueAccuracySummary {
  const totals = stats.reduce((summary, stat) => ({
    hit: summary.hit + stat.hit,
    miss: summary.miss + stat.miss,
  }), { hit: 0, miss: 0 });
  const confirmed = totals.hit + totals.miss;
  return {
    ...totals,
    confirmed,
    hitRate: confirmed > 0 ? totals.hit / confirmed * 100 : null,
  };
}

export function summarizeOrderHitRate(orders: SavedSlip[]): OrderHitRateSummary {
  const totals = orders.reduce((summary, order) => {
    const status = getOrderStatus(order);
    if (status === "success") summary.success += 1;
    if (status === "failed") summary.failed += 1;
    return summary;
  }, { success: 0, failed: 0 });
  const confirmed = totals.success + totals.failed;
  return {
    ...totals,
    confirmed,
    hitRate: confirmed > 0 ? totals.success / confirmed * 100 : null,
  };
}

export const sortLeagueAccuracyLeagueNames = (leagueNames: string[]) => [...leagueNames].sort((left, right) => {
  const leftPriority = leagueAccuracyPriority.get(left);
  const rightPriority = leagueAccuracyPriority.get(right);
  if (leftPriority !== undefined || rightPriority !== undefined) {
    return (leftPriority ?? LEAGUE_ACCURACY_PRIORITY.length) - (rightPriority ?? LEAGUE_ACCURACY_PRIORITY.length);
  }
  return left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
});

export const formatLeagueHitRate = (hitRate: number | null) => {
  if (hitRate === null) return "—";
  const rounded = Math.round(hitRate * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
};
