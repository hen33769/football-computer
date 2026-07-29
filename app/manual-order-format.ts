import { MARKET_LABELS } from "./data";
import { normalizeSportteryMatchId } from "./sporttery";
import type { Market, MatchItem, OddsOption } from "./types";

const formatHandicap = (handicap: number) => `${handicap > 0 ? "+" : ""}${handicap}`;

const formatManualOptionLabel = (market: Market, option: OddsOption) => (
  market.type === "rqspf" && typeof market.handicap === "number"
    ? `(${formatHandicap(market.handicap)})${option.label}`
    : option.label
);

export const formatManualMatchText = (match: MatchItem) => {
  const selectionLines = match.markets.flatMap((market) => {
    const selected = market.options.filter((option) => option.selected);
    if (selected.length === 0) return [];
    const marketLabel = `${MARKET_LABELS[market.type]}${market.type === "rqspf" && typeof market.handicap === "number" ? `（${formatHandicap(market.handicap)}）` : ""}`;
    return [`${marketLabel} ${selected.map((option) => `${formatManualOptionLabel(market, option)} @${option.odds.toFixed(2)}`).join(" | ")}`];
  });
  return [
    `比赛 ID：${normalizeSportteryMatchId(match.id)}`,
    `比赛日期：${match.date}`,
    `联赛：${match.league || "未填写"}`,
    `开赛时间：${match.time || match.date}`,
    `${match.weekday}${match.code}  ${match.home} VS ${match.away}`,
    ...selectionLines,
  ].join("\n");
};

export const formatManualOrderText = (matches: MatchItem[]) => matches
  .filter((match) => match.markets.some((market) => market.options.some((option) => option.selected)))
  .map(formatManualMatchText)
  .join("\n\n");
