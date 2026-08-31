import type { MatchItem } from "./types";

export const compareManualOrderMatches = (left: MatchItem, right: MatchItem) => {
  const dateOrder = right.date.localeCompare(left.date);
  if (dateOrder !== 0) return dateOrder;

  return left.weekday.localeCompare(right.weekday, "zh-CN", { numeric: true, sensitivity: "base" })
    || left.code.localeCompare(right.code, "zh-CN", { numeric: true, sensitivity: "base" })
    || left.id.localeCompare(right.id, "zh-CN", { numeric: true, sensitivity: "base" });
};

export const sortMatchesForManualOrder = (items: MatchItem[]) => [...items].sort(compareManualOrderMatches);

const leaguePriority = (leagueName: string) => (
  leagueName === "世界杯" ? 0 : leagueName === "欧冠" ? 1 : 2
);

export const prioritizeLeagueNames = (leagueNames: string[]) => leagueNames
  .map((leagueName, index) => ({ leagueName, index }))
  .sort((left, right) => (
    leaguePriority(left.leagueName) - leaguePriority(right.leagueName)
    || left.index - right.index
  ))
  .map(({ leagueName }) => leagueName);
