import {
  calculateStake,
  getOrderStatus,
  selectedMatches,
  selectedOptions,
  type OrderStatus,
} from "./calculator";
import type { CurrentHits, Market, MarketType, MatchItem, OddsOption, SavedSlip } from "./types";

export type CompactOrderSelection = {
  matchId: string;
  date: string;
  weekday: string;
  code: string;
  league: string;
  time: string;
  home: string;
  away: string;
  marketType: MarketType;
  optionId: string;
  optionLabel: string;
  odds: number;
  handicap?: number;
  singleAvailable?: boolean;
  passAvailable?: boolean;
};

export type CompactOrder = {
  id: string;
  name: string;
  savedAt: string;
  updatedAt?: string;
  passes: number[];
  multiple: number;
  oddsLocked?: boolean;
  hits?: CurrentHits;
  resultValues?: CurrentHits;
  failedMatchIds?: string[];
  settledAt?: string;
  settledPrize?: number;
  oddsLockedBeforeSettlement?: boolean;
  selections: CompactOrderSelection[];
};

export type OrderSummary = {
  stake: number;
  income: number;
  status: OrderStatus;
  progress: "settled" | "unsettled";
};

const MARKET_ORDER: MarketType[] = ["spf", "rqspf", "score", "goals", "halfFull"];

const compactMarketRank = (type: MarketType) => {
  const index = MARKET_ORDER.indexOf(type);
  return index >= 0 ? index : MARKET_ORDER.length;
};

const cloneHits = (hits: CurrentHits | undefined): CurrentHits | undefined => (
  hits ? Object.fromEntries(Object.entries(hits).map(([matchId, values]) => [matchId, { ...values }])) : undefined
);

const createCompactOption = (selection: CompactOrderSelection): OddsOption => ({
  id: selection.optionId,
  label: selection.optionLabel,
  odds: selection.odds,
  selected: true,
});

const selectionMatchKey = (selection: CompactOrderSelection) => selection.matchId;

export function savedSlipToCompactOrder(slip: SavedSlip): CompactOrder {
  const id = slip.id ?? globalThis.crypto?.randomUUID?.() ?? `${slip.savedAt}-${slip.name}`;
  return {
    id,
    name: slip.name,
    savedAt: slip.savedAt,
    updatedAt: slip.updatedAt,
    passes: [...slip.passes],
    multiple: slip.multiple,
    ...(slip.oddsLocked !== undefined ? { oddsLocked: slip.oddsLocked } : {}),
    ...(slip.hits ? { hits: cloneHits(slip.hits) } : {}),
    ...(slip.resultValues ? { resultValues: cloneHits(slip.resultValues) } : {}),
    ...(slip.failedMatches ? { failedMatchIds: [...slip.failedMatches] } : {}),
    ...(slip.settledAt ? { settledAt: slip.settledAt } : {}),
    ...(typeof slip.settledPrize === "number" ? { settledPrize: slip.settledPrize } : {}),
    ...(slip.oddsLockedBeforeSettlement !== undefined
      ? { oddsLockedBeforeSettlement: slip.oddsLockedBeforeSettlement }
      : {}),
    selections: selectedMatches(slip.matches).flatMap((match) => (
      match.markets.flatMap((market) => (
        selectedOptions({
          ...match,
          markets: [market],
        }).map((option) => ({
          matchId: match.id,
          date: match.date,
          weekday: match.weekday,
          code: match.code,
          league: match.league,
          time: match.time,
          home: match.home,
          away: match.away,
          marketType: market.type,
          optionId: option.id,
          optionLabel: option.label,
          odds: option.odds,
          ...(typeof market.handicap === "number" ? { handicap: market.handicap } : {}),
          ...(typeof market.singleAvailable === "boolean" ? { singleAvailable: market.singleAvailable } : {}),
          ...(typeof market.passAvailable === "boolean" ? { passAvailable: market.passAvailable } : {}),
        } satisfies CompactOrderSelection))
      ))
    )),
  };
}

function compactSelectionsToMatches(selections: CompactOrderSelection[]): MatchItem[] {
  const grouped = new Map<string, CompactOrderSelection[]>();
  selections.forEach((selection) => {
    const key = selectionMatchKey(selection);
    grouped.set(key, [...(grouped.get(key) ?? []), selection]);
  });

  return [...grouped.values()].map((items) => {
    const first = items[0];
    const marketGroups = new Map<MarketType, CompactOrderSelection[]>();
    items.forEach((selection) => {
      marketGroups.set(selection.marketType, [...(marketGroups.get(selection.marketType) ?? []), selection]);
    });
    const markets: Market[] = [...marketGroups.entries()]
      .sort(([left], [right]) => compactMarketRank(left) - compactMarketRank(right))
      .map(([type, marketSelections]) => {
        const sample = marketSelections[0];
        return {
          type,
          ...(typeof sample.handicap === "number" ? { handicap: sample.handicap } : {}),
          ...(typeof sample.singleAvailable === "boolean" ? { singleAvailable: sample.singleAvailable } : {}),
          ...(typeof sample.passAvailable === "boolean" ? { passAvailable: sample.passAvailable } : {}),
          options: marketSelections.map(createCompactOption),
        };
      });
    return {
      id: first.matchId,
      date: first.date,
      weekday: first.weekday,
      code: first.code,
      league: first.league,
      time: first.time,
      home: first.home,
      away: first.away,
      markets,
    };
  }).sort((left, right) => (
    left.date.localeCompare(right.date)
    || left.code.localeCompare(right.code, "zh-CN", { numeric: true, sensitivity: "base" })
  ));
}

export function compactOrderToSavedSlip(order: CompactOrder): SavedSlip {
  return {
    id: order.id,
    name: order.name,
    savedAt: order.savedAt,
    updatedAt: order.updatedAt,
    matches: compactSelectionsToMatches(order.selections),
    passes: [...order.passes],
    multiple: order.multiple,
    ...(order.oddsLocked !== undefined ? { oddsLocked: order.oddsLocked } : {}),
    ...(order.hits ? { hits: cloneHits(order.hits) } : {}),
    ...(order.resultValues ? { resultValues: cloneHits(order.resultValues) } : {}),
    ...(order.failedMatchIds ? { failedMatches: [...order.failedMatchIds] } : {}),
    ...(order.settledAt ? { settledAt: order.settledAt } : {}),
    ...(typeof order.settledPrize === "number" ? { settledPrize: order.settledPrize } : {}),
    ...(order.oddsLockedBeforeSettlement !== undefined
      ? { oddsLockedBeforeSettlement: order.oddsLockedBeforeSettlement }
      : {}),
  };
}

export function normalizeCompactOrder(input: CompactOrder | SavedSlip): CompactOrder {
  if ("selections" in input && Array.isArray(input.selections)) return {
    ...input,
    passes: [...input.passes],
    selections: input.selections.map((selection) => ({ ...selection })),
    ...(input.hits ? { hits: cloneHits(input.hits) } : {}),
    ...(input.resultValues ? { resultValues: cloneHits(input.resultValues) } : {}),
    ...(input.failedMatchIds ? { failedMatchIds: [...input.failedMatchIds] } : {}),
  };
  return savedSlipToCompactOrder(input as SavedSlip);
}

export function compactOrderSummary(order: CompactOrder): OrderSummary {
  const slip = compactOrderToSavedSlip(order);
  return {
    stake: calculateStake(slip.matches, slip.passes, slip.multiple),
    income: order.settledAt ? order.settledPrize ?? 0 : 0,
    status: getOrderStatus(slip),
    progress: order.settledAt ? "settled" : "unsettled",
  };
}

const isMarketType = (value: unknown): value is MarketType => (
  typeof value === "string" && (MARKET_ORDER as string[]).includes(value)
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
);

export function isCompactOrder(value: unknown): value is CompactOrder {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && value.id.length > 0
    && value.id.length <= 128
    && typeof value.name === "string"
    && typeof value.savedAt === "string"
    && Array.isArray(value.passes)
    && value.passes.every((pass) => Number.isInteger(pass) && pass >= 1 && pass <= 8)
    && typeof value.multiple === "number"
    && Number.isFinite(value.multiple)
    && value.multiple >= 1
    && Array.isArray(value.selections)
    && value.selections.every((selection) => {
      if (!isRecord(selection)) return false;
      return typeof selection.matchId === "string"
        && typeof selection.date === "string"
        && typeof selection.weekday === "string"
        && typeof selection.code === "string"
        && typeof selection.league === "string"
        && typeof selection.time === "string"
        && typeof selection.home === "string"
        && typeof selection.away === "string"
        && isMarketType(selection.marketType)
        && typeof selection.optionId === "string"
        && typeof selection.optionLabel === "string"
        && typeof selection.odds === "number"
        && Number.isFinite(selection.odds);
    })
    && (value.updatedAt === undefined || typeof value.updatedAt === "string")
    && (value.settledAt === undefined || typeof value.settledAt === "string")
    && (value.settledPrize === undefined || (typeof value.settledPrize === "number" && Number.isFinite(value.settledPrize)));
}

export function isSavedSlipLike(value: unknown): value is SavedSlip {
  if (!isRecord(value)) return false;
  return typeof value.name === "string"
    && typeof value.savedAt === "string"
    && Array.isArray(value.matches)
    && Array.isArray(value.passes)
    && typeof value.multiple === "number"
    && Number.isFinite(value.multiple);
}
