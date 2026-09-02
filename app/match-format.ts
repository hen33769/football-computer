import type { MatchItem } from "./types";

export function formatMatchCopyLine(match: MatchItem): string {
  const handicap = match.markets.find((market) => market.type === "rqspf")?.handicap;
  let handicapLabel = "";
  if (typeof handicap === "number" && Number.isFinite(handicap)) {
    handicapLabel = handicap < 0
      ? `（主让 ${Math.abs(handicap)}）`
      : handicap > 0
        ? `（客让 ${Math.abs(handicap)}）`
        : "（平手）";
  }
  return `${match.home} VS ${match.away}${handicapLabel}`;
}
