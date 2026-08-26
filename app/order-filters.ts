import { selectedMatches } from "./calculator";
import type { MatchItem, SavedSlip } from "./types";

const normalizedTeamText = (value: string) => value
  .trim()
  .toLocaleLowerCase("zh-CN")
  .replace(/\s+/g, "");

export type TeamNameSegment = {
  text: string;
  highlighted: boolean;
};

export const splitTeamNameByQuery = (teamName: string, query: string): TeamNameSegment[] => {
  const normalizedQuery = normalizedTeamText(query);
  if (!teamName || !normalizedQuery) {
    return teamName ? [{ text: teamName, highlighted: false }] : [];
  }

  const sourceRanges: Array<{ start: number; end: number }> = [];
  let normalizedName = "";
  let sourceIndex = 0;

  for (const character of teamName) {
    const start = sourceIndex;
    sourceIndex += character.length;
    const normalizedCharacter = normalizedTeamText(character);
    normalizedName += normalizedCharacter;
    for (let index = 0; index < normalizedCharacter.length; index += 1) {
      sourceRanges.push({ start, end: sourceIndex });
    }
  }

  const segments: TeamNameSegment[] = [];
  let normalizedStart = 0;
  let sourceStart = 0;

  while (normalizedStart < normalizedName.length) {
    const matchStart = normalizedName.indexOf(normalizedQuery, normalizedStart);
    if (matchStart < 0) break;
    const matchEnd = matchStart + normalizedQuery.length - 1;
    const sourceMatchStart = sourceRanges[matchStart]?.start;
    const sourceMatchEnd = sourceRanges[matchEnd]?.end;
    if (sourceMatchStart === undefined || sourceMatchEnd === undefined || sourceMatchStart < sourceStart) {
      normalizedStart = matchStart + normalizedQuery.length;
      continue;
    }
    if (sourceMatchStart > sourceStart) {
      segments.push({ text: teamName.slice(sourceStart, sourceMatchStart), highlighted: false });
    }
    segments.push({ text: teamName.slice(sourceMatchStart, sourceMatchEnd), highlighted: true });
    sourceStart = sourceMatchEnd;
    normalizedStart = matchStart + normalizedQuery.length;
  }

  if (segments.length === 0) return [{ text: teamName, highlighted: false }];
  if (sourceStart < teamName.length) {
    segments.push({ text: teamName.slice(sourceStart), highlighted: false });
  }
  return segments;
};

export const matchPassesLeagueFilter = (
  match: Pick<MatchItem, "league">,
  selectedLeagues: ReadonlySet<string>,
) => selectedLeagues.size === 0 || selectedLeagues.has(match.league);

export const retainAvailableLeagueNames = (
  selectedLeagues: string[],
  availableLeagues: ReadonlySet<string>,
) => {
  const retainedLeagues = selectedLeagues.filter((league) => availableLeagues.has(league));
  return retainedLeagues.length === selectedLeagues.length ? selectedLeagues : retainedLeagues;
};

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
