import { matchHasSelectedHit } from "./calculator";
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
  const failedMatches = new Set(slip.failedMatches ?? []);

  slip.matches.forEach((match) => {
    const selectedMarkets = match.markets.filter((market) => market.options.some((option) => option.selected));
    if (selectedMarkets.length === 0) return;
    const result = resultForMatch(results, match.id);
    if (!result) return;

    const evaluatedMarkets = selectedMarkets.filter((market) => Boolean(result.values[market.type]));
    if (evaluatedMarkets.length === 0) return;
    const nextMatchHits = { ...(hits[match.id] ?? {}) };
    evaluatedMarkets.forEach((market) => {
      const resultOptionId = result.values[market.type];
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

  return { ...slip, hits, failedMatches: [...failedMatches] };
}

export function isMatchResult(value: unknown): value is MatchResults[string] {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<MatchResults[string]>;
  if (typeof result.matchId !== "string" || typeof result.updatedAt !== "string") return false;
  if (result.source !== "manual" && result.source !== "api") return false;
  if (!result.values || typeof result.values !== "object") return false;
  return Object.entries(result.values).every(([market, optionId]) => (
    RESULT_MARKETS.includes(market as MarketType) && (typeof optionId === "undefined" || typeof optionId === "string")
  ));
}

export function isMatchResults(value: unknown): value is MatchResults {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every(isMatchResult);
}

export function resultSelectOptions(match: MatchItem, marketType: MarketType) {
  const market = match.markets.find((item) => item.type === marketType);
  return market?.options.map((option) => ({ value: option.id, label: option.label })) ?? [];
}
