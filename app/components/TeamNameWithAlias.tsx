"use client";

import { resolveTeamNameDisplay, type TeamNameIndex } from "../team-aliases";

export function TeamNameWithAlias({ name, index }: { name: string; index: TeamNameIndex }) {
  const display = resolveTeamNameDisplay(name, index);
  if (!display.aliasName) return <>{display.normalName}</>;
  const alias = <small className="team-name-alias">({display.aliasName})</small>;
  return display.aliasBefore
    ? <>{alias}{display.normalName}</>
    : <>{display.normalName}{alias}</>;
}
