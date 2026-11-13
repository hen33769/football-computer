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

const selectedPricedOptions = (match: MatchItem) => selectedOptions(match).filter((option) => option.odds > 0);

const selectedPricedMatches = (matches: MatchItem[]) => matches.filter((match) => selectedPricedOptions(match).length > 0);

const selectedPricedMarketCount = (match: MatchItem) => match.markets.reduce((count, market) => (
  count + Number(market.options.some((option) => option.selected && option.odds > 0))
), 0);

function groupBetCount(marketCounts: number[], includedIndexes: number[]): number {
  const included = new Set(includedIndexes);
  return marketCounts.reduce((product, count, index) => included.has(index) ? product : product * count, 1);
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
  selectedPricedMatches(matches).forEach((match) => {
    match.markets.forEach((market) => {
      if (market.options.some((item) => item.selected && item.odds > 0)) selectedTypes.add(market.type);
    });
  });
  if (selectedTypes.size === 0) return 8;
  return Math.min(...Array.from(selectedTypes, (type) => MARKET_LIMITS[type]));
}

export function getPassOptions(matches: MatchItem[]): number[] {
  const chosenMatches = selectedPricedMatches(matches);
  if (chosenMatches.length === 0) return [];
  const chosenMarkets = chosenMatches.flatMap((match) => match.markets.filter((market) => (
    market.options.some((option) => option.selected && option.odds > 0)
  )));
  const options: number[] = [];
  if (chosenMarkets.length > 0) options.push(1);
  if (chosenMatches.length >= 2) {
    const limit = Math.min(chosenMatches.length, getPassLimit(matches));
    for (let pass = 2; pass <= limit; pass += 1) options.push(pass);
  }
  return options;
}

export type BetSummary = {
  ticketCount: number;
  groupCount: number;
  betCount: number;
};

export function calculateBetSummary(matches: MatchItem[], passes: number[]): BetSummary {
  const chosen = selectedPricedMatches(matches);
  const optionCounts = chosen.map((match) => selectedPricedOptions(match).length);
  const marketCounts = chosen.map(selectedPricedMarketCount);
  let groupCount = 0;
  let betCount = 0;

  for (const pass of passes) {
    for (const matchIndexes of combinations(chosen.map((_, index) => index), pass)) {
      const groups = matchIndexes.reduce((product, index) => product * optionCounts[index], 1);
      groupCount += groups;
      betCount += groups * groupBetCount(marketCounts, matchIndexes);
    }
  }

  const validPasses = passes.filter((pass) => Number.isInteger(pass) && pass >= 1 && pass <= chosen.length);
  const batchCount = Number(validPasses.includes(1)) + Number(validPasses.some((pass) => pass >= 2));
  const marketTicketCount = marketCounts.reduce((product, count) => product * count, 1);
  return {
    ticketCount: groupCount > 0 ? marketTicketCount * batchCount : 0,
    groupCount,
    betCount,
  };
}

export function countBets(matches: MatchItem[], passes: number[]): number {
  return calculateBetSummary(matches, passes).betCount;
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
  betCount: number;
  multiplier: number;
  hitMultiplier: number;
  fullyHit: boolean;
  factors: PassMultiplierFactor[];
};

export function calculatePassMultipliers(matches: MatchItem[], passes: number[], hits: CurrentHits): PassMultiplierDetail[] {
  const chosen = selectedPricedMatches(matches);
  const marketCounts = chosen.map(selectedPricedMarketCount);
  const optionGroups = chosen.map((match) => match.markets.flatMap((market) => market.options
      .filter((option) => option.selected)
      .filter((option) => option.odds > 0)
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
      const betCount = groupBetCount(marketCounts, matchIndexes);
      for (const factors of cartesianProduct(matchIndexes.map((index) => optionGroups[index]))) {
        const hitFactors = factors.filter((factor) => factor.hit);
        details.push({
          pass,
          betCount,
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

export function sortPassMultiplierDetails(details: PassMultiplierDetail[]): PassMultiplierDetail[] {
  return details
    .map((item, index) => ({ item, index }))
    .sort((left, right) => right.item.multiplier - left.item.multiplier || left.index - right.index)
    .map(({ item }) => item);
}

function payoutForWinningOdds(winning: number[][], marketCounts: number[], passes: number[], multiple: number, applyCap: boolean): number {
  let baseTotal = 0;
  for (const pass of passes) {
    for (const matchIndexes of combinations(winning.map((_, index) => index), pass)) {
      const optionGroups = matchIndexes.map((index) => winning[index]);
      if (optionGroups.some((group) => group.length === 0)) continue;
      const betCount = groupBetCount(marketCounts, matchIndexes);
      for (const oddsGroup of cartesianProduct(optionGroups)) {
        const raw = bankersRound(2 * oddsGroup.reduce((product, odds) => product * odds, 1));
        baseTotal += (applyCap ? Math.min(raw, singlePrizeCap(pass)) : raw) * betCount;
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

function isOrderPassImpossible(
  slip: Pick<SavedSlip, "matches" | "failedMatches">,
  pass: number,
): boolean {
  const chosen = selectedMatches(slip.matches);
  const failures = new Set(slip.failedMatches ?? []);
  const failedCount = chosen.filter((match) => failures.has(match.id)).length;
  if (failedCount === 0) return false;
  return chosen.length - failedCount < pass;
}

/**
 * 返回订单距离每个已选串关“全部确认命中”还差的场次数。
 * 未确认和明确未命中的比赛都不计入 confirmed hit，因此都会被计入差关数。
 */
export function getOrderShortPasses(
  slip: Pick<SavedSlip, "matches" | "passes" | "hits" | "failedMatches">,
): number[] {
  const chosen = selectedMatches(slip.matches);
  const hits = slip.hits ?? {};
  const hitCount = chosen.filter((match) => matchHasSelectedHit(match, hits)).length;
  const shortPasses = new Set<number>();

  slip.passes.forEach((pass) => {
    const neededCount = pass - hitCount;
    if (neededCount >= 1) shortPasses.add(neededCount);
  });
  return [...shortPasses].sort((left, right) => left - right);
}

export function isOrderFailed(slip: Pick<SavedSlip, "matches" | "passes" | "failedMatches">): boolean {
  if (slip.passes.length === 0) return false;
  return slip.passes.every((pass) => isOrderPassImpossible(slip, pass));
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
  return slip.paymentStatus === "paid" && !slip.settledAt && getOrderStatus(slip) !== "hopeful";
}

function selectedHitOdds(match: MatchItem, hits: CurrentHits): number[] {
  const matchHits = hits[match.id] ?? {};
  return match.markets.flatMap((market) => {
    const hitId = matchHits[market.type];
    if (!hitId) return [];
    const hit = market.options.find((option) => option.selected && option.id === hitId);
    return hit && hit.odds > 0 ? [hit.odds] : [];
  });
}

type PrizeRangeContext = Pick<SavedSlip, "failedMatches" | "resultValues" | "resultScores">;

function scenarioWinningOdds(match: MatchItem, hits: CurrentHits, context: PrizeRangeContext): number[][] {
  if (context.failedMatches?.includes(match.id)) return [[]];
  const knownResults = { ...context.resultValues?.[match.id] };
  match.markets.forEach((market) => {
    const hitId = hits[match.id]?.[market.type];
    if (market.options.some((option) => option.selected && option.id === hitId && option.odds > 0)) {
      knownResults[market.type] = hitId;
    }
  });

  const selectedByKey = new Map<string, OddsOption>();
  match.markets.forEach((market) => market.options.forEach((item) => {
    if (item.selected && item.odds > 0) selectedByKey.set(`${market.type}:${item.id}`, item);
  }));
  if (selectedByKey.size === 0) return [[]];

  const handicap = match.markets.find((market) => market.type === "rqspf")?.handicap;
  const knownScore = context.resultScores?.[match.id];
  // 7+ covers total goals and other scores; include the handicap boundary and its neighbours.
  const scoreLimit = Math.max(7, Math.ceil(Math.abs(handicap ?? 0)) + 1);
  const homeScores = knownScore ? [knownScore.home] : Array.from({ length: scoreLimit + 1 }, (_, index) => index);
  const awayScores = knownScore ? [knownScore.away] : Array.from({ length: scoreLimit + 1 }, (_, index) => index);
  const unique = new Map<string, number[]>();
  for (const fullHome of homeScores) {
    for (const fullAway of awayScores) {
      // These representatives cover all feasible half-time W/D/L outcomes for this full score.
      const halfScores = [[0, 0], ...(fullHome > 0 ? [[1, 0]] : []), ...(fullAway > 0 ? [[0, 1]] : [])];
      for (const [halfHome, halfAway] of halfScores) {
        const compatible = Object.entries(knownResults).every(([type, id]) => (
          !id || (type === "rqspf" && handicap === undefined)
          || winningOptionId(type as MarketType, fullHome, fullAway, halfHome, halfAway, handicap) === id
        ));
        if (!compatible) continue;
        const winning: Array<{ key: string; odds: number }> = [];
        match.markets.forEach((market) => {
          const id = winningOptionId(market.type, fullHome, fullAway, halfHome, halfAway, market.handicap);
          const key = `${market.type}:${id}`;
          const selected = selectedByKey.get(key);
          if (selected) winning.push({ key, odds: selected.odds });
        });
        winning.sort((left, right) => left.key.localeCompare(right.key));
        unique.set(winning.map((hit) => hit.key).join("|"), winning.map((hit) => hit.odds));
      }
    }
  }
  // Legacy/manual results can contradict one another: preserve confirmed hits without inventing others.
  return unique.size > 0 ? Array.from(unique.values()) : [selectedHitOdds(match, hits)];
}

export function calculateCurrentPrize(matches: MatchItem[], passes: number[], multiple: number, hits: CurrentHits): number {
  const chosen = selectedPricedMatches(matches);
  const marketCounts = chosen.map(selectedPricedMarketCount);
  const winning = chosen.map((match) => {
    const matchHits = hits[match.id] ?? {};
    return match.markets.flatMap((market) => {
      const hitId = matchHits[market.type];
      if (!hitId) return [];
      const hit = market.options.find((item) => item.selected && item.id === hitId);
      return hit && hit.odds > 0 ? [hit.odds] : [];
    });
  });
  return payoutForWinningOdds(winning, marketCounts, passes, multiple, true);
}

function pruneScenarios(items: number[][], maximize: boolean, pruneMinimum: boolean): number[][] {
  const unique = [...new Map(items.map((item) => {
    const sorted = [...item].sort((left, right) => right - left);
    return [sorted.join(","), sorted] as const;
  })).values()];
  const dominates = (left: number[], right: number[]) => left.length >= right.length
    && right.every((odds, index) => left[index] >= odds);
  return unique.filter((item, index) => !unique.some((other, otherIndex) => (
    index !== otherIndex
    // Keep losing scenarios separately when finding the minimum *positive* payout.
    && (maximize || (pruneMinimum && item.length > 0 && other.length > 0))
    && (maximize ? dominates(other, item) : dominates(item, other))
  ))).sort((left, right) => maximize ? sum(right) - sum(left) : sum(left) - sum(right));
}

type PayoutBounds = { min: number; max: number; uncappedMax: number; children: PayoutBounds[] };

export function calculatePrizeRange(
  matches: MatchItem[],
  passes: number[],
  multiple: number,
  hits: CurrentHits = {},
  context: PrizeRangeContext = {},
): PrizeRange {
  const chosen = selectedPricedMatches(matches);
  if (chosen.length === 0 || passes.length === 0) return { min: 0, max: 0, uncappedMax: 0 };
  const marketCounts = chosen.map(selectedPricedMarketCount);
  const scenarios = chosen.map((match) => scenarioWinningOdds(match, hits, context));
  const smallestOdds = chosen.map((match) => Math.min(...selectedPricedOptions(match).map((option) => option.odds)))
    .sort((left, right) => left - right);
  // If a low-odds ticket rounds to zero, a dominated higher-odds scenario may still
  // be the smallest positive payout and must remain in the minimum search.
  const pruneMinimum = passes.every((pass) => pass < 1 || pass > chosen.length
    || bankersRound(2 * smallestOdds.slice(0, pass).reduce((product, odds) => product * odds, 1)) > 0);
  let max = 0;
  let uncappedMax = 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (const maximize of [true, false]) {
    const candidates = scenarios.map((items) => pruneScenarios(items, maximize, pruneMinimum));
    // Cache each pass group's payout and conditional bounds once. Searching all matches then
    // only adds cached integer cents, instead of expanding the same tickets at every branch.
    const groups = passes.flatMap((pass) => combinations(chosen.map((_, index) => index), pass).map((indexes) => {
      const betCount = groupBetCount(marketCounts, indexes);
      const winning: number[][] = [];
      const build = (depth: number): PayoutBounds => {
        if (depth === indexes.length) {
          let capped = 0;
          let uncapped = 0;
          for (const odds of cartesianProduct(winning)) {
            const cents = Math.round(bankersRound(2 * odds.reduce((product, value) => product * value, 1)) * 100);
            capped += Math.min(cents, singlePrizeCap(pass) * 100) * betCount;
            uncapped += cents * betCount;
          }
          return { min: capped, max: capped, uncappedMax: uncapped, children: [] };
        }
        const children = candidates[indexes[depth]].map((item) => {
          winning.push(item);
          const result = build(depth + 1);
          winning.pop();
          return result;
        });
        return {
          min: Math.min(...children.map((child) => child.min)),
          max: Math.max(...children.map((child) => child.max)),
          uncappedMax: Math.max(...children.map((child) => child.uncappedMax)),
          children,
        };
      };
      return { indexes, root: build(0) };
    }));
    const visit = (index: number, bounds: PayoutBounds[]) => {
      const ceiling = bankersRound(sum(bounds.map((bound) => bound.max)) * multiple / 100);
      const uncappedCeiling = bankersRound(sum(bounds.map((bound) => bound.uncappedMax)) * multiple / 100);
      const floor = bankersRound(sum(bounds.map((bound) => bound.min)) * multiple / 100);
      if (maximize) {
        if (ceiling <= max && uncappedCeiling <= uncappedMax) return;
      } else {
        if (ceiling <= 0) return;
        if (floor > 0 && floor >= minimum) return;
      }
      if (index === candidates.length) {
        if (maximize) {
          max = Math.max(max, ceiling);
          uncappedMax = Math.max(uncappedMax, uncappedCeiling);
        } else if (floor > 0) minimum = Math.min(minimum, floor);
        return;
      }
      candidates[index].forEach((_, candidateIndex) => visit(index + 1, bounds.map((bound, groupIndex) => (
        groups[groupIndex].indexes.includes(index) ? bound.children[candidateIndex] : bound
      ))));
    };
    visit(0, groups.map((group) => group.root));
  }
  return { min: Number.isFinite(minimum) ? minimum : 0, max, uncappedMax };
}

export function calculateOrderPrizeRange(slip: SavedSlip): PrizeRange {
  if (slip.settledAt) {
    const prize = slip.settledPrize ?? calculateCurrentPrize(slip.matches, slip.passes, slip.multiple, slip.hits ?? {});
    return { min: prize, max: prize, uncappedMax: prize };
  }
  return calculatePrizeRange(slip.matches, slip.passes, slip.multiple, slip.hits ?? {}, slip);
}

export type OrderReferencePrizeRange = PrizeRange & {
  passes: number[];
  remainingMatchCount: number;
  excludedMatchCount: number;
};

/** Display-only value of the remaining selections; never use it to settle an order. */
export function calculateOrderReferencePrizeRange(slip: SavedSlip): OrderReferencePrizeRange {
  const chosen = selectedPricedMatches(slip.matches);
  const hits = slip.hits ?? {};
  const remaining = chosen.filter((match) => scenarioWinningOdds(match, hits, slip).some((odds) => odds.length > 0));
  const excludedMatchCount = chosen.length - remaining.length;
  const passes = [...new Set(slip.passes
    .filter((pass) => Number.isInteger(pass) && pass >= 1 && pass <= chosen.length)
    .map((pass) => Math.min(pass, remaining.length)))]
    .filter((pass) => pass >= 1)
    .sort((left, right) => left - right);
  return {
    ...calculatePrizeRange(remaining, passes, slip.multiple, hits, slip),
    passes,
    remainingMatchCount: remaining.length,
    excludedMatchCount,
  };
}
