export const APP_SETTINGS_KEY = "football-simulator-settings-v1";

export const DEFAULT_LEAGUE_TAG_COLORS: Record<string, string> = {
  欧冠: "#faad14",
  巴甲: "#d5ec76",
  韩职: "#7be5da",
  瑞超: "#108ee9",
  芬超: "#2db7f5",
  世界杯: "#f50",
  美职联: "#660033",
  挪超: "#d9d9d9",
  欧罗巴: "#ffbb96",
};

const LEAGUE_SETTING_ALIASES: Record<string, string> = {
  美职: "美职联",
};

export type AppSettings = {
  schemaVersion: 1;
  appearance: {
    leagueTagColors: Record<string, string>;
  };
};

export type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

export const leagueColorSettingKey = (leagueName: string) => LEAGUE_SETTING_ALIASES[leagueName] ?? leagueName;

export const normalizeHexColor = (value: unknown) => {
  if (typeof value !== "string") return null;
  const color = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(color) || /^#[0-9a-f]{6}$/.test(color)) return color;
  return null;
};

export function createDefaultSettings(): AppSettings {
  return {
    schemaVersion: 1,
    appearance: {
      leagueTagColors: { ...DEFAULT_LEAGUE_TAG_COLORS },
    },
  };
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const defaults = createDefaultSettings();
  if (!value || typeof value !== "object") return defaults;
  const raw = value as Partial<AppSettings>;
  const colors = raw.appearance?.leagueTagColors;
  if (!colors || typeof colors !== "object" || Array.isArray(colors)) return defaults;

  const validColors = Object.fromEntries(Object.entries(colors).flatMap(([league, color]) => {
    const normalized = normalizeHexColor(color);
    return league.trim() && normalized ? [[leagueColorSettingKey(league.trim()), normalized]] : [];
  }));

  return {
    schemaVersion: 1,
    appearance: {
      leagueTagColors: { ...defaults.appearance.leagueTagColors, ...validColors },
    },
  };
}

export function loadAppSettings(storage: SettingsStorage = window.localStorage): AppSettings {
  try {
    const raw = storage.getItem(APP_SETTINGS_KEY);
    return raw ? normalizeAppSettings(JSON.parse(raw) as unknown) : createDefaultSettings();
  } catch {
    return createDefaultSettings();
  }
}

export function saveAppSettings(settings: AppSettings, storage: SettingsStorage = window.localStorage) {
  const normalized = normalizeAppSettings(settings);
  storage.setItem(APP_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

export function withLeagueTagColor(settings: AppSettings, leagueName: string, color: string): AppSettings {
  const normalizedColor = normalizeHexColor(color);
  if (!normalizedColor) return settings;
  return {
    ...settings,
    appearance: {
      ...settings.appearance,
      leagueTagColors: {
        ...settings.appearance.leagueTagColors,
        [leagueColorSettingKey(leagueName)]: normalizedColor,
      },
    },
  };
}

export function getLeagueTagColor(settings: AppSettings, leagueName: string) {
  return settings.appearance.leagueTagColors[leagueColorSettingKey(leagueName)] ?? "#108a83";
}

export function readableTagTextColor(color: string) {
  const normalized = normalizeHexColor(color) ?? "#108a83";
  const expanded = normalized.length === 4
    ? normalized.slice(1).split("").map((part) => `${part}${part}`).join("")
    : normalized.slice(1);
  const [red, green, blue] = [0, 2, 4].map((index) => Number.parseInt(expanded.slice(index, index + 2), 16));
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance >= 160 ? "#26383d" : "#ffffff";
}
