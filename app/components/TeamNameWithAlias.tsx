"use client";

import { resolveTeamIcon, resolveTeamNameDisplay, type TeamNameAliasPosition, type TeamNameIndex } from "../team-aliases";

export function TeamNameWithAlias({
  name,
  index,
  aliasPosition = "auto",
}: {
  name: string;
  index: TeamNameIndex;
  aliasPosition?: TeamNameAliasPosition;
}) {
  const display = resolveTeamNameDisplay(name, index);
  if (!display.aliasName) return <>{display.normalName}</>;
  const alias = <small className="team-name-alias">({display.aliasName})</small>;
  const aliasBefore = aliasPosition === "before" || (aliasPosition === "auto" && display.aliasBefore);
  return aliasBefore
    ? <>{alias}{display.normalName}</>
    : <>{display.normalName}{alias}</>;
}

export function TeamNameWithIcon({
  name,
  index,
  iconPosition = "after",
  aliasPosition = "auto",
}: {
  name: string;
  index: TeamNameIndex;
  iconPosition?: "before" | "after";
  aliasPosition?: TeamNameAliasPosition;
}) {
  const icon = resolveTeamIcon(name, index);
  const label = <span className="team-name-with-icon-label"><TeamNameWithAlias name={name} index={index} aliasPosition={aliasPosition} /></span>;
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
