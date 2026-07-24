import { matchHasSelectedHit, winningOptionId } from "./calculator";
import { normalizeSportteryMatchId } from "./sporttery";
import type { CurrentHits, MatchItem, MatchResults, MarketType, SavedSlip } from "./types";

export const RESULT_MARKETS: MarketType[] = ["spf", "rqspf", "score", "goals", "halfFull"];

const cloneHits = (hits: CurrentHits | undefined): CurrentHits => Object.fromEntries(
  Object.entries(hits ?? {}).map(([matchId, values]) => [matchId, { ...values }]),
);

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
  if (typeof result.fullScore === "undefined") return true;
  return Boolean(result.fullScore)
    && typeof result.fullScore === "object"
    && Number.isInteger(result.fullScore.home)
    && result.fullScore.home >= 0
    && Number.isInteger(result.fullScore.away)
    && result.fullScore.away >= 0;
}

export function isMatchResults(value: unknown): value is MatchResults {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every(isMatchResult);
}

export function resultSelectOptions(match: MatchItem, marketType: MarketType) {
  const market = match.markets.find((item) => item.type === marketType);
  return market?.options.map((option) => ({ value: option.id, label: option.label })) ?? [];
}
