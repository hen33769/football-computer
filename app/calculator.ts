import { MARKET_LIMITS } from "./data";
import type { CurrentHits, MatchItem, MarketType, OddsOption, PrizeRange, SavedSlip } from "./types";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function combinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  const walk = (start: number, current: T[]) => {
    if (current.length === size) {
      result.push([...current]);
      return;
    }
    for (let index = start; index <= items.length - (size - current.length); index += 1) {
      current.push(items[index]);
      walk(index + 1, current);
      current.pop();
    }
  };
  if (size > 0 && size <= items.length) walk(0, []);
  return result;
}

export function selectedOptions(match: MatchItem): OddsOption[] {
  return match.markets.flatMap((market) => market.options.filter((item) => item.selected));
}

export function selectedMatches(matches: MatchItem[]): MatchItem[] {
  return matches.filter((match) => selectedOptions(match).length > 0);
}

export const MAX_SELECTED_MATCHES = 8;

export function isNewMatchSelectionBlocked(matches: MatchItem[], matchId: string): boolean {
  const target = matches.find((match) => match.id === matchId);
  return Boolean(
    target
    && selectedOptions(target).length === 0
    && selectedMatches(matches).length >= MAX_SELECTED_MATCHES
  );
}

export function getPassLimit(matches: MatchItem[]): number {
  const selectedTypes = new Set<MarketType>();
  selectedMatches(matches).forEach((match) => {
    match.markets.forEach((market) => {
      if (market.options.some((item) => item.selected)) selectedTypes.add(market.type);
    });
  });
  if (selectedTypes.size === 0) return 8;
  return Math.min(...Array.from(selectedTypes, (type) => MARKET_LIMITS[type]));
}

export function getPassOptions(matches: MatchItem[]): number[] {
  const chosenMatches = selectedMatches(matches);
  if (chosenMatches.length === 0) return [];
  const chosenMarkets = chosenMatches.flatMap((match) => match.markets.filter((market) => (
    market.options.some((option) => option.selected)
  )));
  const options: number[] = [];
  if (chosenMarkets.every((market) => market.singleAvailable !== false)) options.push(1);
  if (chosenMatches.length >= 2 && chosenMarkets.every((market) => market.passAvailable !== false)) {
    const limit = Math.min(chosenMatches.length, getPassLimit(matches));
    for (let pass = 2; pass <= limit; pass += 1) options.push(pass);
  }
  return options;
}

export function countBets(matches: MatchItem[], passes: number[]): number {
  const counts = selectedMatches(matches).map((match) => selectedOptions(match).length);
  return passes.reduce((grandTotal, pass) => {
    const passTotal = combinations(counts, pass).reduce(
      (total, group) => total + group.reduce((product, value) => product * value, 1),
      0,
    );
    return grandTotal + passTotal;
  }, 0);
}

export const SINGLE_BET_PRICE = 2;

export function calculateStake(matches: MatchItem[], passes: number[], multiple: number): number {
  return countBets(matches, passes) * SINGLE_BET_PRICE * multiple;
}

export type PrizeRangeMetrics = {
  available: boolean;
  prize: { min: number; max: number };
  profit: { min: number; max: number };
  multiplier: { min: number; max: number };
};

export function calculatePrizeRangeMetrics(range: PrizeRange, stake: number, multiple: number): PrizeRangeMetrics {
  const available = range.max > 0;
  const perBetStake = SINGLE_BET_PRICE * multiple;
  return {
    available,
    prize: {
      min: available ? range.min : 0,
      max: available ? range.max : 0,
    },
    profit: {
      min: available ? range.min - stake : 0,
      max: available ? range.max - stake : 0,
    },
    multiplier: {
      min: available && perBetStake > 0 ? range.min / perBetStake : 0,
      max: available && perBetStake > 0 ? range.max / perBetStake : 0,
    },
  };
}

function bankersRound(value: number): number {
  const scaled = value * 100;
  const floor = Math.floor(scaled + 1e-9);
  const fraction = scaled - floor;
  let cents = floor;
  if (fraction > 0.5 + 1e-8) cents += 1;
  else if (Math.abs(fraction - 0.5) <= 1e-8 && floor % 2 === 1) cents += 1;
  return cents / 100;
}

function singlePrizeCap(pass: number): number {
  if (pass <= 1) return 100_000;
  if (pass <= 3) return 200_000;
  if (pass <= 5) return 500_000;
  return 1_000_000;
}

function cartesianProduct<T>(values: T[][]): T[][] {
  return values.reduce<T[][]>(
    (accumulator, current) => accumulator.flatMap((existing) => current.map((value) => [...existing, value])),
    [[]],
  );
}

export type PassMultiplierFactor = {
  matchId: string;
  matchLabel: string;
  marketType: MarketType;
  optionId: string;
  optionLabel: string;
  odds: number;
  hit: boolean;
};

export type PassMultiplierDetail = {
  pass: number;
  multiplier: number;
  hitMultiplier: number;
  fullyHit: boolean;
  factors: PassMultiplierFactor[];
};

export function calculatePassMultipliers(matches: MatchItem[], passes: number[], hits: CurrentHits): PassMultiplierDetail[] {
  const chosen = selectedMatches(matches);
  const optionGroups = chosen.map((match) => match.markets.flatMap((market) => market.options
    .filter((option) => option.selected)
    .map((option): PassMultiplierFactor => ({
      matchId: match.id,
      matchLabel: `${match.weekday}${match.code} ${match.home} VS ${match.away}`,
      marketType: market.type,
      optionId: option.id,
      optionLabel: option.label,
      odds: option.odds,
      hit: hits[match.id]?.[market.type] === option.id,
    }))));
  const details: PassMultiplierDetail[] = [];
  for (const pass of passes) {
    for (const matchIndexes of combinations(chosen.map((_, index) => index), pass)) {
      for (const factors of cartesianProduct(matchIndexes.map((index) => optionGroups[index]))) {
        const hitFactors = factors.filter((factor) => factor.hit);
        details.push({
          pass,
          multiplier: factors.reduce((product, factor) => product * factor.odds, 1),
          hitMultiplier: hitFactors.length > 0 ? hitFactors.reduce((product, factor) => product * factor.odds, 1) : 0,
          fullyHit: factors.every((factor) => factor.hit),
          factors,
        });
      }
    }
  }
  return details;
}

function payoutForWinningOdds(winning: number[][], passes: number[], multiple: number, applyCap: boolean): number {
  let baseTotal = 0;
  for (const pass of passes) {
    for (const matchIndexes of combinations(winning.map((_, index) => index), pass)) {
      const optionGroups = matchIndexes.map((index) => winning[index]);
      if (optionGroups.some((group) => group.length === 0)) continue;
      for (const oddsGroup of cartesianProduct(optionGroups)) {
        const raw = bankersRound(2 * oddsGroup.reduce((product, odds) => product * odds, 1));
        baseTotal += applyCap ? Math.min(raw, singlePrizeCap(pass)) : raw;
      }
    }
  }
  return bankersRound(baseTotal * multiple);
}

function resultCode(home: number, away: number): "W" | "D" | "L" {
  if (home > away) return "W";
  if (home < away) return "L";
  return "D";
}

const explicitWinScores = new Set(["1:0", "2:0", "2:1", "3:0", "3:1", "3:2", "4:0", "4:1", "4:2", "5:0", "5:1", "5:2"]);
const explicitDrawScores = new Set(["0:0", "1:1", "2:2", "3:3"]);
const explicitLoseScores = new Set(["0:1", "0:2", "1:2", "0:3", "1:3", "2:3", "0:4", "1:4", "2:4", "0:5", "1:5", "2:5"]);

export function winningOptionId(type: MarketType, fullHome: number, fullAway: number, halfHome: number, halfAway: number, handicap = 0): string {
  const fullResult = resultCode(fullHome, fullAway);
  if (type === "spf") return fullResult === "W" ? "win" : fullResult === "D" ? "draw" : "lose";
  if (type === "rqspf") {
    const adjusted = resultCode(fullHome + handicap, fullAway);
    return adjusted === "W" ? "win" : adjusted === "D" ? "draw" : "lose";
  }
  if (type === "goals") return fullHome + fullAway >= 7 ? "7+" : String(fullHome + fullAway);
  if (type === "halfFull") return `${resultCode(halfHome, halfAway)}${fullResult}`;
  const score = `${fullHome}:${fullAway}`;
  if (fullResult === "W") return explicitWinScores.has(score) ? score : "winOther";
  if (fullResult === "D") return explicitDrawScores.has(score) ? score : "drawOther";
  return explicitLoseScores.has(score) ? score : "loseOther";
}

export function matchHasSelectedHit(match: MatchItem, hits: CurrentHits): boolean {
  const matchHits = hits[match.id] ?? {};
  return match.markets.some((market) => {
    const hitId = matchHits[market.type];
    return Boolean(hitId && market.options.some((option) => option.selected && option.id === hitId));
  });
}

export function isOrderFailed(slip: Pick<SavedSlip, "matches" | "passes" | "failedMatches">): boolean {
  const chosen = selectedMatches(slip.matches);
  const failures = new Set(slip.failedMatches ?? []);
  const failedCount = chosen.filter((match) => failures.has(match.id)).length;
  if (failedCount === 0 || slip.passes.length === 0) return false;
  const remainingMatchCount = chosen.length - failedCount;
  return slip.passes.every((pass) => remainingMatchCount < pass);
}

export type OrderStatus = "success" | "hopeful" | "failed";

export function getOrderStatus(slip: SavedSlip): OrderStatus {
  if (isOrderFailed(slip)) return "failed";
  const prize = Math.max(
    slip.settledPrize ?? 0,
    calculateCurrentPrize(slip.matches, slip.passes, slip.multiple, slip.hits ?? {}),
  );
  return prize > 0 ? "success" : "hopeful";
}

export function isOrderSettleable(slip: SavedSlip): boolean {
  return !slip.settledAt && getOrderStatus(slip) !== "hopeful";
}

function scenarioWinningOdds(match: MatchItem): number[][] {
  const selectedByKey = new Map<string, OddsOption>();
  match.markets.forEach((market) => market.options.forEach((item) => {
    if (item.selected) selectedByKey.set(`${market.type}:${item.id}`, item);
  }));
  if (selectedByKey.size === 0) return [[]];

  const unique = new Map<string, number[]>();
  for (let fullHome = 0; fullHome <= 12; fullHome += 1) {
    for (let fullAway = 0; fullAway <= 12; fullAway += 1) {
      for (let halfHome = 0; halfHome <= fullHome; halfHome += 1) {
        for (let halfAway = 0; halfAway <= fullAway; halfAway += 1) {
          const hits: Array<{ key: string; odds: number }> = [];
          match.markets.forEach((market) => {
            const id = winningOptionId(market.type, fullHome, fullAway, halfHome, halfAway, market.handicap);
            const key = `${market.type}:${id}`;
            const selected = selectedByKey.get(key);
            if (selected) hits.push({ key, odds: selected.odds });
          });
          hits.sort((left, right) => left.key.localeCompare(right.key));
          unique.set(hits.map((hit) => hit.key).join("|"), hits.map((hit) => hit.odds));
        }
      }
    }
  }
  return Array.from(unique.values());
}

export function calculateCurrentPrize(matches: MatchItem[], passes: number[], multiple: number, hits: CurrentHits): number {
  const chosen = selectedMatches(matches);
  const winning = chosen.map((match) => {
    const matchHits = hits[match.id] ?? {};
    return match.markets.flatMap((market) => {
      const hitId = matchHits[market.type];
      if (!hitId) return [];
      const hit = market.options.find((item) => item.selected && item.id === hitId);
      return hit ? [hit.odds] : [];
    });
  });
  return payoutForWinningOdds(winning, passes, multiple, true);
}

export function calculatePrizeRange(matches: MatchItem[], passes: number[], multiple: number): PrizeRange {
  const chosen = selectedMatches(matches);
  if (chosen.length === 0 || passes.length === 0) return { min: 0, max: 0, uncappedMax: 0 };
  const scenarios = chosen.map(scenarioWinningOdds);
  const maxWinning = scenarios.map((items) => [...items].sort((left, right) => sum(right) - sum(left))[0] ?? []);
  const max = payoutForWinningOdds(maxWinning, passes, multiple, true);
  const uncappedMax = payoutForWinningOdds(maxWinning, passes, multiple, false);

  const minimumPositive = scenarios.map((items) => [...items].filter((item) => item.length > 0).sort((left, right) => sum(left) - sum(right))[0] ?? []);
  const canLose = scenarios.map((items) => items.some((item) => item.length === 0));
  const optionalIndexes = canLose.map((value, index) => value ? index : -1).filter((index) => index >= 0);
  let minimum = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 2 ** optionalIndexes.length; mask += 1) {
    const winning = minimumPositive.map((item, index) => canLose[index] ? [] : item);
    optionalIndexes.forEach((matchIndex, optionalIndex) => {
      if ((mask & (1 << optionalIndex)) !== 0) winning[matchIndex] = minimumPositive[matchIndex];
    });
    const prize = payoutForWinningOdds(winning, passes, multiple, true);
    if (prize > 0 && prize < minimum) minimum = prize;
  }
  return { min: Number.isFinite(minimum) ? minimum : 0, max, uncappedMax };
}
