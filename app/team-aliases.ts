export type TeamNameActiveSlot = 1 | 2 | null;

export type TeamNameEntry = {
  id: string;
  groupId: string;
  name: string;
  nameKey: string;
  activeSlot: TeamNameActiveSlot;
};

export type TeamNameGroup = {
  id: string;
  iconDataUrl: string | null;
  names: TeamNameEntry[];
  revision: number;
  updatedAt: string;
};

export type TeamNameEntryDraft = {
  id?: string;
  name: string;
  activeSlot: TeamNameActiveSlot;
};

export type TeamNameGroupDraft = {
  id?: string;
  iconDataUrl?: string | null;
  names: TeamNameEntryDraft[];
  expectedRevision?: number;
};

export type TeamNameAliasesResponse = {
  groups: TeamNameGroup[];
  updatedAt: string;
};

export type TeamNameResolution = {
  groupId: string;
  activeNames: [TeamNameEntry, TeamNameEntry?];
  iconDataUrl: string | null;
};

export type TeamNameIndex = Map<string, TeamNameResolution>;
export type TeamNameAliasPosition = "before" | "after" | "auto";

/** 与比赛名称匹配时忽略全角差异、大小写和空白差异。 */
export function normalizeTeamName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
}

export function activeTeamNames(group: TeamNameGroup): TeamNameEntry[] {
  return group.names
    .filter((entry) => entry.activeSlot === 1 || entry.activeSlot === 2)
    .sort((left, right) => (left.activeSlot ?? 0) - (right.activeSlot ?? 0));
}

/** 编辑队伍组时替换原位置；新建队伍组沿用当前行为放在列表顶部。 */
export function upsertTeamNameGroupAtPosition(groups: TeamNameGroup[], saved: TeamNameGroup): TeamNameGroup[] {
  const existingIndex = groups.findIndex((group) => group.id === saved.id);
  if (existingIndex < 0) return [saved, ...groups];
  return groups.map((group, index) => index === existingIndex ? saved : group);
}

/** 有名称即可生成展示索引；激活名称 1/2 用于展示主名和别名，没有激活名称时使用首个名称。 */
export function buildTeamNameIndex(groups: TeamNameGroup[]): TeamNameIndex {
  const index: TeamNameIndex = new Map();
  groups.forEach((group) => {
    const activeNames = activeTeamNames(group);
    const firstActive = activeNames.find((entry) => entry.activeSlot === 1) ?? group.names[0];
    const secondActive = activeNames.find((entry) => entry.activeSlot === 2);
    if (!firstActive) return;
    const resolution: TeamNameResolution = {
      groupId: group.id,
      activeNames: [firstActive, secondActive],
      iconDataUrl: group.iconDataUrl ?? null,
    };
    group.names.forEach((entry) => {
      const key = normalizeTeamName(entry.name);
      if (key) index.set(key, resolution);
    });
  });
  return index;
}

export function resolveTeamIcon(name: string, index: TeamNameIndex) {
  return index.get(normalizeTeamName(name))?.iconDataUrl ?? null;
}

export function resolveTeamNameDisplay(name: string, index: TeamNameIndex) {
  const currentKey = normalizeTeamName(name);
  const resolution = index.get(currentKey);
  if (!resolution) {
    return { normalName: name, aliasName: null as string | null, aliasBefore: false };
  }

  const [firstActive, secondActive] = resolution.activeNames;
  return { normalName: firstActive.name, aliasName: secondActive?.name ?? null, aliasBefore: true };
}
