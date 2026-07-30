import type { MatchItem } from "./types";

const matchKickoffTimestamp = (match: Pick<MatchItem, "date" | "time">) => {
  const time = match.time.trim();
  if (!time) return null;
  const source = /^\d{1,2}:\d{2}$/.test(time)
    ? `${match.date}T${time.padStart(5, "0")}:00`
    : time.replace(" ", "T");
  const timestamp = new Date(source).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const compareManualOrderMatches = (left: MatchItem, right: MatchItem) => {
  const dateOrder = right.date.localeCompare(left.date);
  if (dateOrder !== 0) return dateOrder;

  const leftKickoff = matchKickoffTimestamp(left);
  const rightKickoff = matchKickoffTimestamp(right);
  if (leftKickoff !== null && rightKickoff !== null && leftKickoff !== rightKickoff) {
    return leftKickoff - rightKickoff;
  }
  if (leftKickoff !== null) return -1;
  if (rightKickoff !== null) return 1;

  return left.time.localeCompare(right.time, "zh-CN", { numeric: true, sensitivity: "base" })
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
