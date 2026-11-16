import { MARKET_LABELS } from "./data";
import { isValidSportteryHandicap, normalizeSportteryMatchId } from "./sporttery";
import type { Market, MatchItem, OddsOption } from "./types";

const formatHandicap = (handicap: number) => `${handicap > 0 ? "+" : ""}${handicap}`;

export const formatOrderOptionLabel = (market: Market, option: OddsOption) => (
  market.type === "rqspf" && typeof market.handicap === "number"
    ? `(${formatHandicap(market.handicap)})${option.label}`
    : option.label
);

/** 恢复手动文本中的选择和盘口，避免重新打开选择器时覆盖手填内容。 */
export const restoreManualPickerMatch = (draft: MatchItem, parsed?: MatchItem): MatchItem => ({
  ...draft,
  markets: draft.markets.map((market) => {
    const parsedMarket = parsed?.markets.find((item) => item.type === market.type);
    const handicap = isValidSportteryHandicap(parsedMarket?.handicap) ? parsedMarket.handicap : market.handicap;
    return {
      ...market,
      ...(market.type === "rqspf" ? { handicap: isValidSportteryHandicap(handicap) ? handicap : undefined } : {}),
      options: market.options.map((option) => {
        const parsedOption = parsedMarket?.options.find((item) => item.id === option.id && item.selected);
        return parsedOption ? { ...option, odds: parsedOption.odds > 0 ? parsedOption.odds : option.odds, selected: true } : option;
      }),
    };
  }),
});

export const formatManualMatchText = (match: MatchItem) => {
  const selectionLines = match.markets.flatMap((market) => {
    const selected = market.options.filter((option) => option.selected);
    if (selected.length === 0) return [];
    const marketLabel = `${MARKET_LABELS[market.type]}${market.type === "rqspf" && typeof market.handicap === "number" ? `（${formatHandicap(market.handicap)}）` : ""}`;
    return [`${marketLabel} ${selected.map((option) => `${formatOrderOptionLabel(market, option)} @${option.odds.toFixed(2)}`).join(" | ")}`];
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
