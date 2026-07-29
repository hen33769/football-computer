import type { AppSettings } from "./settings";
import type { MatchItem, SavedSlip } from "./types";

export const CLOUD_STORAGE_KEYS = {
  orders: "football-simulator-saved-slips-v1",
  expense: "football-simulator-total-expense-v1",
  income: "football-simulator-total-income-v1",
  settings: "football-simulator-settings-v1",
  matches: "football-simulator-match-cache-v1",
  accountId: "football-simulator-cloud-account-id-v1",
  pendingPersonal: "football-simulator-cloud-pending-personal-v1",
  pendingPersonalChanges: "football-simulator-cloud-pending-personal-changes-v2",
  pendingMigration: "football-simulator-cloud-pending-migration-v1",
  loginBetDraft: "football-simulator-cloud-login-bet-draft-v1",
} as const;

export type CloudRole = "admin" | "user";
export type CloudSyncStatus = "saved" | "saving" | "error";

export type CloudAccount = {
  id: string;
  account: string;
  role: CloudRole;
};

export type CloudPersonalData = {
  orders: SavedSlip[];
  finance: {
    expenseTotal: number;
    incomeTotal: number;
  };
  settings: AppSettings;
};

export type CloudPersonalState = CloudPersonalData & {
  revision: number;
};

export type CloudBootstrapResponse = {
  requiresAccount: boolean;
  account?: CloudAccount;
  hasPersonalData?: boolean;
  personal?: CloudPersonalState;
  matches?: MatchItem[];
};

export function normalizeAccountName(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

export function accountNameError(value: string) {
  const account = value.normalize("NFKC").trim();
  if (account.length < 2 || account.length > 24) return "账号需要包含 2 至 24 个字符";
  if (!/^[\p{L}\p{N}_.-]+$/u.test(account)) return "账号只能使用中文、字母、数字、点、横线或下划线";
  return null;
}

export function ensureOrderIds(orders: SavedSlip[]) {
  return orders.map((order) => order.id
    ? order
    : { ...order, id: globalThis.crypto.randomUUID() });
}

export function clearMatchSelections(matches: MatchItem[]) {
  return matches.map((match) => ({
    ...match,
    markets: match.markets.map((market) => ({
      ...market,
      options: market.options.map((option) => ({ ...option, selected: false })),
    })),
  }));
}
