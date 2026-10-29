import { orderLedgerTotals } from "./imports";
import { isCompactOrder, savedSlipToCompactOrder } from "./order-model";
import { normalizeAppSettings, type AppSettings } from "./settings";
import type { FinanceCorrectionKind } from "./finance-corrections";
import type { MatchItem, SavedSlip } from "./types";

export const FULL_DATA_BACKUP_VERSION = 6;

export type BackupCorrectionRef = { originId: string; originEntryId: string };

export type BackupFinanceCorrectionEntry = {
  originId: string;
  originEntryId: string;
  kind: FinanceCorrectionKind;
  deltaCents: number;
  effectiveDate: string | null;
  note: string;
  source: string;
  createdAt: string;
  adjusts: BackupCorrectionRef | null;
};

export type FullDataBackupV6 = {
  version: 6;
  kind: "full";
  exportedAt: string;
  originId: string;
  dataRevision: number;
  data: {
    orders: SavedSlip[];
    settings: AppSettings;
    finance: {
      ledgerSource: string;
      entries: BackupFinanceCorrectionEntry[];
      expenseCorrectionCents: number;
      incomeCorrectionCents: number;
    };
    matches: MatchItem[];
  };
};

export type BackupImportStrategy = "merge" | "replace";
export type BackupInitialBalanceStrategy = "keep-current" | "use-backup";

export type BackupImportPreview = {
  backupDigest: string;
  version: number;
  strategy: BackupImportStrategy;
  expectedDataRevision: number;
  orders: { add: number; update: number; remove: number };
  settingsChanged: boolean;
  finance: {
    add: number;
    skip: number;
    conflicts: number;
    backupLegacyInitialCount: number;
    initialBalanceAdjustments: number;
    expenseCorrectionCents: number;
    incomeCorrectionCents: number;
  };
  matches: { count: number; separateScope: boolean };
  warnings: string[];
};

function isSavedSlip(value: unknown): value is SavedSlip {
  if (!value || typeof value !== "object") return false;
  const order = value as Partial<SavedSlip>;
  if (!(typeof order.id === "string"
    && typeof order.savedAt === "string"
    && Array.isArray(order.matches)
    && Array.isArray(order.passes)
    && Number.isFinite(order.multiple))) return false;
  try {
    return isCompactOrder(savedSlipToCompactOrder(order as SavedSlip));
  } catch {
    return false;
  }
}

function isMatchItem(value: unknown): value is MatchItem {
  return Boolean(value && typeof value === "object" && typeof (value as MatchItem).id === "string");
}

function safeInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label}无效`);
  return parsed;
}

function isRealIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function correctionEntry(value: unknown): BackupFinanceCorrectionEntry {
  if (!value || typeof value !== "object") throw new Error("纠错记录结构无效");
  const entry = value as Partial<BackupFinanceCorrectionEntry>;
  if (typeof entry.originId !== "string" || !entry.originId.trim() || typeof entry.originEntryId !== "string" || !entry.originEntryId.trim()) {
    throw new Error("纠错记录缺少稳定来源标识");
  }
  if (entry.kind !== "expense" && entry.kind !== "income") throw new Error("纠错记录类型无效");
  const deltaCents = safeInteger(entry.deltaCents, "纠错差值");
  if (deltaCents === 0) throw new Error("纠错差值不能为 0");
  const effectiveDate = entry.effectiveDate == null ? null : String(entry.effectiveDate);
  if (effectiveDate !== null && (!isRealIsoDate(effectiveDate) || effectiveDate > shanghaiToday())) throw new Error("纠错归属日期无效");
  const note = String(entry.note ?? "").normalize("NFKC").trim();
  if (note.length > 200) throw new Error("纠错备注最多 200 字");
  const createdAt = String(entry.createdAt ?? "");
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) throw new Error("纠错记录来源时间无效");
  const source = String(entry.source ?? "imported").trim();
  if (!source || source.length > 100) throw new Error("纠错记录来源无效");
  const adjusts = entry.adjusts == null ? null : {
    originId: String(entry.adjusts.originId ?? ""),
    originEntryId: String(entry.adjusts.originEntryId ?? ""),
  };
  if (adjusts && (!adjusts.originId || !adjusts.originEntryId)) throw new Error("补差关联记录无效");
  return {
    originId: String(entry.originId),
    originEntryId: String(entry.originEntryId),
    kind: entry.kind,
    deltaCents,
    effectiveDate,
    note,
    source,
    createdAt,
    adjusts,
  };
}

function validateEntries(entries: BackupFinanceCorrectionEntry[]) {
  const byKey = new Map(entries.map((entry) => [`${entry.originId}\u0000${entry.originEntryId}`, entry]));
  if (byKey.size !== entries.length) throw new Error("备份中包含重复纠错记录 ID");
  for (const entry of entries) {
    if (!entry.adjusts) continue;
    const target = byKey.get(`${entry.adjusts.originId}\u0000${entry.adjusts.originEntryId}`);
    if (!target || target.kind !== entry.kind) throw new Error("备份中的补差关联缺失或类型不一致");
  }
}

export function normalizeFullDataBackup(value: unknown, legacyOriginId = crypto.randomUUID()): FullDataBackupV6 {
  if (!value || typeof value !== "object") throw new Error("完整备份结构无效");
  const backup = value as Record<string, unknown>;
  const data = backup.data && typeof backup.data === "object" ? backup.data as Record<string, unknown> : null;
  if (backup.kind !== "full") throw new Error("完整备份 kind 无效");
  if (!data || !Array.isArray(data.orders) || !data.orders.every(isSavedSlip)) throw new Error("完整备份中的订单无效");
  const orderIds = (data.orders as SavedSlip[]).map((order) => order.id);
  if (orderIds.some((id) => !id) || new Set(orderIds).size !== orderIds.length) throw new Error("完整备份中包含空或重复订单 ID");
  if (!data.settings || typeof data.settings !== "object") throw new Error("完整备份中的设置无效");
  const matches = Array.isArray(data.matches) && data.matches.every(isMatchItem) ? data.matches : [];
  if (backup.version === 6) {
    const finance = data.finance && typeof data.finance === "object" ? data.finance as Record<string, unknown> : null;
    if (!finance || !Array.isArray(finance.entries)) throw new Error("完整备份中的纠错记录无效");
    const entries = finance.entries.map(correctionEntry);
    validateEntries(entries);
    const expenseCorrectionCents = safeInteger(finance.expenseCorrectionCents, "支出纠错汇总");
    const incomeCorrectionCents = safeInteger(finance.incomeCorrectionCents, "收入纠错汇总");
    const calculatedExpense = entries.filter((entry) => entry.kind === "expense").reduce((total, entry) => total + entry.deltaCents, 0);
    const calculatedIncome = entries.filter((entry) => entry.kind === "income").reduce((total, entry) => total + entry.deltaCents, 0);
    if (calculatedExpense !== expenseCorrectionCents || calculatedIncome !== incomeCorrectionCents) {
      throw new Error("完整备份中的纠错汇总与记录不一致");
    }
    const originId = String(backup.originId ?? "").trim();
    if (!originId) throw new Error("完整备份缺少来源标识");
    const exportedAt = String(backup.exportedAt ?? "");
    if (!exportedAt || Number.isNaN(Date.parse(exportedAt))) throw new Error("完整备份导出时间无效");
    return {
      version: 6,
      kind: "full",
      exportedAt,
      originId,
      dataRevision: safeInteger(backup.dataRevision ?? 0, "备份版本"),
      data: {
        orders: structuredClone(data.orders as SavedSlip[]),
        settings: normalizeAppSettings(data.settings),
        finance: {
          ledgerSource: String(finance.ledgerSource ?? "backup-v6"),
          entries,
          expenseCorrectionCents,
          incomeCorrectionCents,
        },
        matches: structuredClone(matches),
      },
    };
  }
  if (backup.version !== 5) throw new Error("不支持的完整备份版本");
  const exportedAt = String(backup.exportedAt ?? "");
  if (!exportedAt || Number.isNaN(Date.parse(exportedAt))) throw new Error("旧版完整备份导出时间无效");
  const finance = data.finance && typeof data.finance === "object" ? data.finance as Record<string, unknown> : null;
  const expenseTotal = Number(finance?.expenseTotal);
  const incomeTotal = Number(finance?.incomeTotal);
  if (!Number.isFinite(expenseTotal) || !Number.isFinite(incomeTotal) || expenseTotal < 0 || incomeTotal < 0) {
    throw new Error("旧版完整备份中的账本无效");
  }
  const orders = structuredClone(data.orders as SavedSlip[]);
  const orderTotals = orderLedgerTotals(orders);
  const expenseCorrectionCents = Math.round((expenseTotal - orderTotals.expense) * 100);
  const incomeCorrectionCents = Math.round((incomeTotal - orderTotals.income) * 100);
  const entries: BackupFinanceCorrectionEntry[] = [];
  if (expenseCorrectionCents !== 0) entries.push({
    originId: legacyOriginId,
    originEntryId: "legacy-expense",
    kind: "expense",
    deltaCents: expenseCorrectionCents,
    effectiveDate: null,
    note: "旧版备份累计值，原始明细不可追溯",
    source: "legacy-backup",
    createdAt: exportedAt,
    adjusts: null,
  });
  if (incomeCorrectionCents !== 0) entries.push({
    originId: legacyOriginId,
    originEntryId: "legacy-income",
    kind: "income",
    deltaCents: incomeCorrectionCents,
    effectiveDate: null,
    note: "旧版备份累计值，原始明细不可追溯",
    source: "legacy-backup",
    createdAt: exportedAt,
    adjusts: null,
  });
  return {
    version: 6,
    kind: "full",
    exportedAt,
    originId: legacyOriginId,
    dataRevision: 0,
    data: {
      orders,
      settings: normalizeAppSettings(data.settings),
      finance: { ledgerSource: "legacy-backup", entries, expenseCorrectionCents, incomeCorrectionCents },
      matches: structuredClone(matches),
    },
  };
}

export async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
