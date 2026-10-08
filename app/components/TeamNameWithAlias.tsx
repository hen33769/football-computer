"use client";

import { Fragment } from "react";
import { splitTeamNameByQuery, teamNameMatchesQuery } from "../order-filters";
import { normalizeTeamName, resolveTeamIcon, resolveTeamNameDisplay, type TeamNameAliasPosition, type TeamNameIndex } from "../team-aliases";

const highlightedName = (name: string, query: string) => splitTeamNameByQuery(name, query).map((segment, index) => (
  segment.highlighted
    ? <mark className="team-name-query-highlight" key={`${index}-${segment.text}`}>{segment.text}</mark>
    : <Fragment key={`${index}-${segment.text}`}>{segment.text}</Fragment>
));

export function TeamNameWithAlias({
  name,
  index,
  aliasPosition = "auto",
  highlightQuery = "",
}: {
  name: string;
  index: TeamNameIndex;
  aliasPosition?: TeamNameAliasPosition;
  highlightQuery?: string;
}) {
  const display = resolveTeamNameDisplay(name, index);
  const normalSegments = splitTeamNameByQuery(display.normalName, highlightQuery);
  const aliasSegments = display.aliasName ? splitTeamNameByQuery(display.aliasName, highlightQuery) : [];
  const hasVisibleHighlight = [...normalSegments, ...aliasSegments].some((segment) => segment.highlighted);
  const hiddenAliasHit = Boolean(normalizeTeamName(highlightQuery))
    && teamNameMatchesQuery(name, highlightQuery, index)
    && !hasVisibleHighlight;
  const normalName = highlightedName(display.normalName, highlightQuery);
  const alias = display.aliasName
    ? <small className="team-name-alias">({highlightedName(display.aliasName, highlightQuery)})</small>
    : null;
  const aliasBefore = aliasPosition === "before" || (aliasPosition === "auto" && display.aliasBefore);
  const label = alias
    ? aliasBefore ? <>{alias}{normalName}</> : <>{normalName}{alias}</>
    : <>{normalName}</>;
  return hiddenAliasHit ? <mark className="team-name-query-alias-hit">{label}</mark> : label;
}

export function TeamNameWithIcon({
  name,
  index,
  iconPosition = "after",
  aliasPosition = "auto",
  highlightQuery = "",
}: {
  name: string;
  index: TeamNameIndex;
  iconPosition?: "before" | "after";
  aliasPosition?: TeamNameAliasPosition;
  highlightQuery?: string;
}) {
  const icon = resolveTeamIcon(name, index);
  const label = <span className="team-name-with-icon-label"><TeamNameWithAlias name={name} index={index} aliasPosition={aliasPosition} highlightQuery={highlightQuery} /></span>;
  if (!icon) return label;
  const image = <img className="team-name-icon" src={icon} alt="" aria-hidden="true" />;
  return (
    <span className="team-name-with-icon">
      {iconPosition === "before" && image}
      {label}
      {iconPosition === "after" && image}
    </span>
  );
}
