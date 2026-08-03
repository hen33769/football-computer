"use client";

import type { CloudAccount } from "../cloud";
import { requestJson } from "./http";

export type CurrentUserResponse = {
  authenticated: boolean;
  account: CloudAccount | null;
};

export function getCurrentUser() {
  return requestJson<CurrentUserResponse>("/api/users/me");
}

export function loginAccount(account: string) {
  return requestJson<{ account: CloudAccount; created: boolean }>("/api/users/session", {
    method: "POST",
    body: JSON.stringify({ account }),
  });
}

export function logoutAccount() {
  return requestJson<{ ok: true }>("/api/users/session", { method: "DELETE" });
}
