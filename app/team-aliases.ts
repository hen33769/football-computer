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
  activeNames: [TeamNameEntry, TeamNameEntry];
  iconDataUrl: string | null;
};

export type TeamNameIndex = Map<string, TeamNameResolution>;

/** 与比赛名称匹配时忽略全角差异、大小写和空白差异。 */
export function normalizeTeamName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
}

export function activeTeamNames(group: TeamNameGroup): TeamNameEntry[] {
  return group.names
    .filter((entry) => entry.activeSlot === 1 || entry.activeSlot === 2)
    .sort((left, right) => (left.activeSlot ?? 0) - (right.activeSlot ?? 0));
}

/** 只有两个激活槽位完整时才生成展示索引，避免半配置状态影响比赛页面。 */
export function buildTeamNameIndex(groups: TeamNameGroup[]): TeamNameIndex {
  const index: TeamNameIndex = new Map();
  groups.forEach((group) => {
    const activeNames = activeTeamNames(group);
    if (activeNames.length !== 2 || activeNames[0].activeSlot !== 1 || activeNames[1].activeSlot !== 2) return;
    const resolution: TeamNameResolution = {
      groupId: group.id,
      activeNames: [activeNames[0], activeNames[1]],
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
  if (currentKey === normalizeTeamName(firstActive.name)) {
    return { normalName: name, aliasName: secondActive.name, aliasBefore: true };
  }
  if (currentKey === normalizeTeamName(secondActive.name)) {
    return { normalName: firstActive.name, aliasName: name, aliasBefore: false };
  }
  return { normalName: name, aliasName: firstActive.name, aliasBefore: true };
}
