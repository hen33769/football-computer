import { selectedMatches } from "./calculator";
import type { MatchItem, SavedSlip } from "./types";

const normalizedTeamText = (value: string) => value
  .trim()
  .toLocaleLowerCase("zh-CN")
  .replace(/\s+/g, "");

export const matchPassesLeagueFilter = (
  match: Pick<MatchItem, "league">,
  selectedLeagues: ReadonlySet<string>,
) => selectedLeagues.size === 0 || selectedLeagues.has(match.league);

export const orderContainsTeam = (slip: SavedSlip, query: string) => {
  const normalizedQuery = normalizedTeamText(query);
  if (!normalizedQuery) return true;
  return selectedMatches(slip.matches).some((match) => (
    normalizedTeamText(`${match.home}${match.away}`).includes(normalizedQuery)
  ));
};

export const orderPassesLeagueFilter = (
  slip: SavedSlip,
  selectedLeagues: ReadonlySet<string>,
) => selectedLeagues.size === 0 || selectedMatches(slip.matches).some((match) => (
  selectedLeagues.has(match.league)
));
