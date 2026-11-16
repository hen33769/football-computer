import type { BrowserStorage } from "./browser-storage";

const savedAtKey = (accountId: string) => `football-simulator-manual-order-saved-at-v1:${encodeURIComponent(accountId)}`;

export function readManualOrderSavedAt(storage: BrowserStorage, accountId: string): string {
  const value = storage.getItem(savedAtKey(accountId));
  return value && Number.isFinite(Date.parse(value)) ? value : "";
}

export function writeManualOrderSavedAt(storage: BrowserStorage, accountId: string, value: string): void {
  if (value && Number.isFinite(Date.parse(value))) storage.setItem(savedAtKey(accountId), value);
  else storage.removeItem(savedAtKey(accountId));
}

export function firstEmptyManualOrderEntry<T extends { text: string }>(entries: T[]): T | undefined {
  return entries.find((entry) => entry.text.trim().length === 0);
}
