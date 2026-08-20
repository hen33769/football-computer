import { matchHasSelectedHit, winningOptionId } from "./calculator";
import { normalizeSportteryMatchId } from "./sporttery";
import type { CurrentHits, MatchItem, MatchResults, MarketType, SavedSlip } from "./types";

export const RESULT_MARKETS: MarketType[] = ["spf", "rqspf", "score", "goals", "halfFull"];

const cloneHits = (hits: CurrentHits | undefined): CurrentHits => Object.fromEntries(
  Object.entries(hits ?? {}).map(([matchId, values]) => [matchId, { ...values }]),
);

const sameHits = (left: CurrentHits | undefined, right: CurrentHits | undefined) => {
  const leftEntries = Object.entries(left ?? {});
  const rightEntries = Object.entries(right ?? {});
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([matchId, values]) => {
    if (!Object.prototype.hasOwnProperty.call(right ?? {}, matchId)) return false;
    const otherValues = right?.[matchId] ?? {};
    const markets = new Set([...Object.keys(values), ...Object.keys(otherValues)] as MarketType[]);
    return markets.size === Object.keys(values).length
      && markets.size === Object.keys(otherValues).length
      && [...markets].every((market) => values[market] === otherValues[market]);
  });
};

const sameStringSet = (left: string[] | undefined, right: string[] | undefined) => {
  const leftSet = new Set(left ?? []);
  const rightSet = new Set(right ?? []);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
};

export function resultForMatch(results: MatchResults, matchId: string) {
  return results[normalizeSportteryMatchId(matchId)];
}

export function judgeSlipWithResults(slip: SavedSlip, results: MatchResults): SavedSlip {
  const hits = cloneHits(slip.hits);
  const resultValues = cloneHits(slip.resultValues);
  const failedMatches = new Set(slip.failedMatches ?? []);
  let matchesChanged = false;
  const matches = slip.matches.map((match) => {
    const handicap = resultForMatch(results, match.id)?.rqspfHandicap;
    if (typeof handicap !== "number" || !Number.isFinite(handicap)) return match;
    let matchChanged = false;
    const markets = match.markets.map((market) => {
      if (market.type !== "rqspf" || market.handicap === handicap) return market;
      matchChanged = true;
      return { ...market, handicap };
    });
    if (!matchChanged) return match;
    matchesChanged = true;
    return { ...match, markets };
  });

  matches.forEach((match) => {
    const selectedMarkets = match.markets.filter((market) => market.options.some((option) => option.selected));
    if (selectedMarkets.length === 0) return;
    const result = resultForMatch(results, match.id);
    if (!result) return;

    const values = { ...result.values };
    if (result.fullScore && typeof result.rqspfHandicap === "number") {
      values.rqspf = winningOptionId("rqspf", result.fullScore.home, result.fullScore.away, 0, 0, result.rqspfHandicap);
    } else if (typeof result.rqspfHandicap !== "number") {
      delete values.rqspf;
    }
    const evaluatedMarkets = selectedMarkets.filter((market) => Boolean(values[market.type]));
    if (evaluatedMarkets.length === 0) return;
    resultValues[match.id] = { ...values };
    const nextMatchHits = { ...(hits[match.id] ?? {}) };
    evaluatedMarkets.forEach((market) => {
      const resultOptionId = values[market.type];
      nextMatchHits[market.type] = market.options.some((option) => option.selected && option.id === resultOptionId)
        ? resultOptionId
        : undefined;
    });
    hits[match.id] = nextMatchHits;

    if (matchHasSelectedHit(match, hits)) {
      failedMatches.delete(match.id);
    } else if (evaluatedMarkets.length === selectedMarkets.length) {
      failedMatches.add(match.id);
    }
  });

  return {
    ...slip,
    ...(matchesChanged ? { matches } : {}),
    hits,
    resultValues,
    failedMatches: [...failedMatches],
  };
}

/** 已选玩法均有赛果，或旧订单已被手动标记成功/失败时，才视为该场已判断。 */
export function isOrderMatchJudged(order: SavedSlip, match: MatchItem): boolean {
  if ((order.failedMatches ?? []).includes(match.id)) return true;
  const selectedMarkets = match.markets.filter((market) => market.options.some((option) => option.selected));
  if (selectedMarkets.length === 0) return true;
  const resultValues = order.resultValues?.[match.id];
  if (resultValues && Object.keys(resultValues).length > 0) {
    return selectedMarkets.every((market) => Boolean(resultValues[market.type]));
  }
  return matchHasSelectedHit(match, order.hits ?? {});
}

/** 只返回传入的当前已渲染订单中，确实会被现有赛果改变的订单。 */
export function judgeLoadedOrdersWithResults(orders: SavedSlip[], results: MatchResults): SavedSlip[] {
  return orders.flatMap((order) => {
    const judged = judgeSlipWithResults(order, results);
    const changed = judged.matches !== order.matches
      || !sameHits(judged.hits, order.hits)
      || !sameHits(judged.resultValues, order.resultValues)
      || !sameStringSet(judged.failedMatches, order.failedMatches);
    return changed ? [judged] : [];
  });
}

export function repairSlipHandicapResults(slip: SavedSlip): SavedSlip {
  const hits = cloneHits(slip.hits);
  const resultValues = cloneHits(slip.resultValues);
  const failedMatches = new Set(slip.failedMatches ?? []);
  let changed = false;

  slip.matches.forEach((match) => {
    const values = resultValues[match.id];
    const score = String(values?.score ?? "").match(/^(\d+):(\d+)$/);
    const rqspf = match.markets.find((market) => market.type === "rqspf");
    if (!values || !score || !rqspf?.options.some((option) => option.selected)) return;

    const expected = winningOptionId(
      "rqspf",
      Number(score[1]),
      Number(score[2]),
      0,
      0,
      rqspf.handicap ?? 0,
    );
    if (values.rqspf === expected) return;

    changed = true;
    resultValues[match.id] = { ...values, rqspf: expected };
    hits[match.id] = {
      ...(hits[match.id] ?? {}),
      rqspf: rqspf.options.some((option) => option.selected && option.id === expected) ? expected : undefined,
    };

    const selectedMarkets = match.markets.filter((market) => market.options.some((option) => option.selected));
    if (matchHasSelectedHit(match, hits)) {
      failedMatches.delete(match.id);
    } else if (selectedMarkets.every((market) => Boolean(resultValues[match.id]?.[market.type]))) {
      failedMatches.add(match.id);
    }
  });

  return changed ? { ...slip, hits, resultValues, failedMatches: [...failedMatches] } : slip;
}

export function isMatchResult(value: unknown): value is MatchResults[string] {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<MatchResults[string]>;
  if (typeof result.matchId !== "string" || typeof result.updatedAt !== "string") return false;
  if (result.source !== "manual" && result.source !== "api") return false;
  if (!result.values || typeof result.values !== "object") return false;
  const validValues = Object.entries(result.values).every(([market, optionId]) => (
    RESULT_MARKETS.includes(market as MarketType) && (typeof optionId === "undefined" || typeof optionId === "string")
  ));
  if (!validValues) return false;
  if (typeof result.rqspfHandicap !== "undefined"
    && (typeof result.rqspfHandicap !== "number" || !Number.isFinite(result.rqspfHandicap))) return false;
  const isScore = (score: unknown): score is { home: number; away: number } => Boolean(score)
    && typeof score === "object"
    && Number.isInteger((score as { home?: unknown }).home)
    && Number((score as { home: number }).home) >= 0
    && Number.isInteger((score as { away?: unknown }).away)
    && Number((score as { away: number }).away) >= 0;
  if (typeof result.fullScore !== "undefined" && !isScore(result.fullScore)) return false;
  if (typeof result.halfScore !== "undefined" && !isScore(result.halfScore)) return false;
  return true;
}

export const hasCompleteMatchResult = (match: Pick<MatchItem, "result">) => Boolean(
  match.result?.fullScore && match.result.halfScore,
);

export function isMatchResults(value: unknown): value is MatchResults {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every(isMatchResult);
}

export function resultSelectOptions(match: MatchItem, marketType: MarketType) {
  const market = match.markets.find((item) => item.type === marketType);
  return market?.options.map((option) => ({ value: option.id, label: option.label })) ?? [];
}
