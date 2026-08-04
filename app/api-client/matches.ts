"use client";

import type { SportteryMatchFetchMode, SportteryMatchSnapshot } from "../sporttery";
import type { MatchItem } from "../types";
import { requestJson } from "./http";

export type MatchRefreshMetadata = {
  mode: SportteryMatchFetchMode;
  source: "official" | "snapshot" | "cleanup";
  lastUpdateTime: string;
  fixedBonusFailureCount: number;
  savedAt: string;
  fromCache: boolean;
  error: string;
};

export type CurrentMatchesResponse = {
  matches: MatchItem[];
  metadata: MatchRefreshMetadata;
};

const toSportterySnapshot = (response: CurrentMatchesResponse): SportteryMatchSnapshot => ({
  mode: response.metadata.mode,
  matches: response.matches,
  matchDates: [],
  leagues: [],
  lastUpdateTime: response.metadata.lastUpdateTime || response.metadata.savedAt,
  fixedBonusFailureCount: response.metadata.fixedBonusFailureCount,
  fromCache: response.metadata.fromCache,
  refreshError: response.metadata.error,
});

export async function getCurrentMatches() {
  return toSportterySnapshot(await requestJson<CurrentMatchesResponse>("/api/matches/current"));
}

export async function refreshCurrentMatches() {
  return toSportterySnapshot(await requestJson<CurrentMatchesResponse>("/api/matches/refresh", { method: "POST" }));
}

export function getMatchesByIds(ids: string[]) {
  return requestJson<{ matches: MatchItem[] }>(`/api/matches?ids=${encodeURIComponent(ids.join(","))}`);
}

export async function saveMatchSnapshot(matches: MatchItem[]) {
  return toSportterySnapshot(await requestJson<CurrentMatchesResponse>("/api/matches/snapshot", {
    method: "POST",
    body: JSON.stringify({ matches }),
  }));
}
