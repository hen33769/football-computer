"use client";

import { resolveTeamIcon, resolveTeamNameDisplay, type TeamNameIndex } from "../team-aliases";

export function TeamNameWithAlias({ name, index }: { name: string; index: TeamNameIndex }) {
  const display = resolveTeamNameDisplay(name, index);
  if (!display.aliasName) return <>{display.normalName}</>;
  const alias = <small className="team-name-alias">({display.aliasName})</small>;
  return display.aliasBefore
    ? <>{alias}{display.normalName}</>
    : <>{display.normalName}{alias}</>;
}

export function TeamNameWithIcon({
  name,
  index,
  iconPosition = "after",
}: {
  name: string;
  index: TeamNameIndex;
  iconPosition?: "before" | "after";
}) {
  const icon = resolveTeamIcon(name, index);
  const label = <span className="team-name-with-icon-label"><TeamNameWithAlias name={name} index={index} /></span>;
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
