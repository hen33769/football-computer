"use client";

import { Fragment, type ReactNode } from "react";
import { splitTeamNameByQuery, teamNameMatchesQuery } from "../order-filters";
import { normalizeTeamName, resolveTeamIcon, resolveTeamNameDisplay, type TeamNameIndex } from "../team-aliases";

type TeamPosition = "home" | "away";

const highlightedName = (name: string, query: string) => splitTeamNameByQuery(name, query).map((segment, index) => (
  segment.highlighted
    ? <mark className="team-name-query-highlight" key={`${index}-${segment.text}`}>{segment.text}</mark>
    : <Fragment key={`${index}-${segment.text}`}>{segment.text}</Fragment>
));

export function TeamNameWithAlias({
  name,
  index,
  teamPosition,
  highlightQuery = "",
  betweenNames = null,
}: {
  name: string;
  index: TeamNameIndex;
  teamPosition: TeamPosition;
  highlightQuery?: string;
  betweenNames?: ReactNode;
}) {
  const display = resolveTeamNameDisplay(name, index);
  const normalSegments = splitTeamNameByQuery(display.normalName, highlightQuery);
  const aliasSegments = display.aliasName ? splitTeamNameByQuery(display.aliasName, highlightQuery) : [];
  const hasVisibleHighlight = [...normalSegments, ...aliasSegments].some((segment) => segment.highlighted);
  const hiddenAliasHit = Boolean(normalizeTeamName(highlightQuery))
    && teamNameMatchesQuery(name, highlightQuery, index)
    && !hasVisibleHighlight;
  const normalName = <span className="team-name-normal">{highlightedName(display.normalName, highlightQuery)}</span>;
  const alias = display.aliasName
    ? <small className="team-name-alias">({highlightedName(display.aliasName, highlightQuery)})</small>
    : null;
  const isHome = teamPosition === "home";
  const label = <span className={`team-name-alias-layout ${isHome ? "alias-before" : "alias-after"}`}>
    {isHome && alias}
    {!isHome && normalName}
    {betweenNames}
    {!isHome && alias}
    {isHome && normalName}
  </span>;
  return hiddenAliasHit ? <mark className="team-name-query-alias-hit">{label}</mark> : label;
}

export function TeamNameWithIcon({
  name,
  index,
  teamPosition,
  highlightQuery = "",
  betweenNames = null,
}: {
  name: string;
  index: TeamNameIndex;
  teamPosition: TeamPosition;
  highlightQuery?: string;
  betweenNames?: ReactNode;
}) {
  const icon = resolveTeamIcon(name, index);
  const label = <span className="team-name-with-icon-label"><TeamNameWithAlias name={name} index={index} teamPosition={teamPosition} highlightQuery={highlightQuery} betweenNames={betweenNames} /></span>;
  if (!icon) return label;
  const image = <img className="team-name-icon" src={icon} alt="" aria-hidden="true" />;
  return (
    <span className="team-name-with-icon">
      {teamPosition === "away" && image}
      {label}
      {teamPosition === "home" && image}
    </span>
  );
}
