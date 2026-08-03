"use client";

import type { AppSettings } from "../settings";
import { requestJson } from "./http";

export type SettingsResponse = {
  settings: AppSettings;
  revision: number;
  updatedAt: string;
};

export function getUserSettings() {
  return requestJson<SettingsResponse>("/api/users/me/settings");
}

export function updateUserSettings(settings: AppSettings, expectedRevision?: number) {
  return requestJson<SettingsResponse>("/api/users/me/settings", {
    method: "PATCH",
    body: JSON.stringify({ settings, expectedRevision }),
  });
}
