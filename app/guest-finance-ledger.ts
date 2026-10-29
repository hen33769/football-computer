"use client";

import { localCache } from "./browser-storage";
import {
  isFinanceCorrectionKind,
  normalizeFinanceCorrectionAmounts,
  normalizeFinanceCorrectionDate,
  normalizeFinanceCorrectionNote,
  type CreateFinanceCorrectionInput,
  type FinanceCorrectionEntry,
  type FinanceCorrectionKind,
  type FinanceCorrectionPage,
  type FinanceLedgerSummary,
} from "./finance-corrections";
import {
  normalizeFullDataBackup,
  sha256Text,
  type BackupFinanceCorrectionEntry,
  type BackupImportPreview,
  type BackupImportStrategy,
  type BackupInitialBalanceStrategy,
  type FullDataBackupV7,
} from "./data-backup";
import { orderLedgerBreakdown, unionSavedOrders } from "./imports";
import { normalizeAppSettings, unionAppSettings, type AppSettings } from "./settings";
import type { MatchItem, SavedSlip } from "./types";

export const GUEST_FINANCE_LEDGER_KEY = "football-simulator-finance-ledger-v3";
const LEGACY_GUEST_FINANCE_LEDGER_KEY = "football-simulator-finance-ledger-v2";

export type GuestStoredEntry = FinanceCorrectionEntry & {
  originId: string;
  originEntryId: string;
  requestId: string | null;
};

const sourceKey = (entry: { originId: string; originEntryId: string }) => `${entry.originId}\u0000${entry.originEntryId}`;
const isLegacyInitial = (entry: { source: string; effectiveDate: string | null }) => entry.effectiveDate === null
  && ["legacy-migration", "legacy-backup", "imported-initial-balance"].includes(entry.source);

function backupContent(entry: Pick<BackupFinanceCorrectionEntry, "kind" | "deltaCents" | "taxDeltaCents" | "effectiveDate" | "note" | "source" | "adjusts">) {
  return JSON.stringify({
    kind: entry.kind,
    deltaCents: entry.deltaCents,
    taxDeltaCents: entry.taxDeltaCents,
    effectiveDate: entry.effectiveDate,
    note: entry.note,
    source: entry.source === "imported" ? "manual" : entry.source,
    adjusts: entry.adjusts,
  });
}

function guestEntryAsBackup(entry: GuestStoredEntry, byId: Map<string, GuestStoredEntry>): BackupFinanceCorrectionEntry {
  const adjusted = entry.adjustsEntryId ? byId.get(entry.adjustsEntryId) : undefined;
  return {
    originId: entry.originId,
    originEntryId: entry.originEntryId,
    kind: entry.kind,
    deltaCents: entry.deltaCents,
    taxDeltaCents: entry.taxDeltaCents,
    effectiveDate: entry.effectiveDate,
    note: entry.note,
    source: entry.source,
    createdAt: entry.sourceCreatedAt || entry.createdAt,
    adjusts: adjusted ? { originId: adjusted.originId, originEntryId: adjusted.originEntryId } : null,
  };
}

export function exportGuestFullDataBackup(
  state: GuestFinanceLedgerState,
  orders: SavedSlip[],
  settings: AppSettings,
  matches: MatchItem[],
): FullDataBackupV7 {
  const activeEntries = state.entries.filter((entry) => entry.ledgerId === state.activeLedgerId);
  const byId = new Map(activeEntries.map((entry) => [entry.id, entry]));
  const entries = activeEntries.map((entry) => guestEntryAsBackup(entry, byId));
  return {
    version: 7,
    kind: "full",
    exportedAt: new Date().toISOString(),
    originId: state.originId,
    dataRevision: state.revision,
    data: {
      orders: structuredClone(orders),
      settings: normalizeAppSettings(settings),
      finance: {
        ledgerSource: "guest-active",
        entries,
        expenseCorrectionCents: entries.filter((entry) => entry.kind === "expense").reduce((sum, entry) => sum + entry.deltaCents, 0),
        incomeCorrectionCents: entries.filter((entry) => entry.kind === "income").reduce((sum, entry) => sum + entry.deltaCents, 0),
        incomeTaxCorrectionCents: entries.filter((entry) => entry.kind === "income").reduce((sum, entry) => sum + entry.taxDeltaCents, 0),
      },
      matches: structuredClone(matches),
    },
  };
}

export async function previewGuestFullDataImport(
  state: GuestFinanceLedgerState,
  orders: SavedSlip[],
  settings: AppSettings,
  raw: unknown,
  strategy: BackupImportStrategy,
): Promise<BackupImportPreview> {
  const serialized = JSON.stringify(raw);
  if (new TextEncoder().encode(serialized).byteLength > 20_000_000) throw new Error("完整备份文件过大");
  const digest = await sha256Text(serialized);
  const backup = normalizeFullDataBackup(raw, `legacy-v5:${digest}`);
  const activeEntries = state.entries.filter((entry) => entry.ledgerId === state.activeLedgerId);
  const byId = new Map(activeEntries.map((entry) => [entry.id, entry]));
  const current = activeEntries.map((entry) => guestEntryAsBackup(entry, byId));
  const currentBySource = new Map(current.map((entry) => [sourceKey(entry), entry]));
  const initialBalanceAdjustments = (["expense", "income"] as const).filter((kind) => {
    const currentValue = current.filter((entry) => entry.kind === kind && isLegacyInitial(entry)).reduce((sum, entry) => sum + entry.deltaCents, 0);
    const backupValue = backup.data.finance.entries.filter((entry) => entry.kind === kind && isLegacyInitial(entry)).reduce((sum, entry) => sum + entry.deltaCents, 0);
    const currentTax = current.filter((entry) => entry.kind === kind && isLegacyInitial(entry)).reduce((sum, entry) => sum + entry.taxDeltaCents, 0);
    const backupTax = backup.data.finance.entries.filter((entry) => entry.kind === kind && isLegacyInitial(entry)).reduce((sum, entry) => sum + entry.taxDeltaCents, 0);
    return currentValue !== backupValue || currentTax !== backupTax;
  }).length;
  let add = 0;
  let skip = 0;
  let conflicts = 0;
  for (const entry of backup.data.finance.entries) {
    if (strategy === "merge" && isLegacyInitial(entry)) {
      skip += 1;
      continue;
    }
    const existing = currentBySource.get(sourceKey(entry));
    if (!existing) add += 1;
    else if (backupContent(existing) === backupContent(entry)) skip += 1;
    else conflicts += 1;
  }
  const currentOrderIds = new Set(orders.map((order) => order.id));
  const backupOrderIds = new Set(backup.data.orders.map((order) => order.id));
  const targetSettings = strategy === "merge" ? unionAppSettings(settings, backup.data.settings) : backup.data.settings;
  return {
    backupDigest: digest,
    version: Number((raw as { version?: unknown })?.version ?? 0),
    strategy,
    expectedDataRevision: state.revision,
    orders: {
      add: backup.data.orders.filter((order) => !currentOrderIds.has(order.id)).length,
      update: backup.data.orders.filter((order) => currentOrderIds.has(order.id)).length,
      remove: strategy === "replace" ? orders.filter((order) => !backupOrderIds.has(order.id)).length : 0,
    },
    settingsChanged: JSON.stringify(settings) !== JSON.stringify(targetSettings),
    finance: {
      add: strategy === "replace" ? backup.data.finance.entries.length : add,
      skip: strategy === "replace" ? 0 : skip,
      conflicts: strategy === "replace" ? 0 : conflicts,
      backupLegacyInitialCount: backup.data.finance.entries.filter(isLegacyInitial).length,
      initialBalanceAdjustments: strategy === "merge" ? initialBalanceAdjustments : 0,
      expenseCorrectionCents: backup.data.finance.expenseCorrectionCents,
      incomeCorrectionCents: backup.data.finance.incomeCorrectionCents,
      incomeTaxCorrectionCents: backup.data.finance.incomeTaxCorrectionCents,
    },
    matches: { count: backup.data.matches.length, separateScope: false },
    warnings: [
      ...(Number((raw as { version?: unknown })?.version) === 5
        ? ["旧版备份没有纠错明细；合并默认保留当前初值，覆盖会恢复为无日期初值。"]
        : []),
      ...(Number((raw as { version?: unknown })?.version) === 6
        ? ["v6 备份没有收入纠错税额字段，导入时按税额差值 0 处理。"]
        : []),
    ],
  };
}

export function applyGuestFullDataImport(
  state: GuestFinanceLedgerState,
  currentOrders: SavedSlip[],
  currentSettings: AppSettings,
  raw: unknown,
  strategy: BackupImportStrategy,
  initialBalanceStrategy: BackupInitialBalanceStrategy,
  expectedRevision: number,
  backupDigest: string,
) {
  if (state.revision !== expectedRevision) throw new Error("游客数据已在其他标签页更新，请重新预览");
  const backup = normalizeFullDataBackup(raw, `legacy-v5:${backupDigest}`);
  const targetOrders = strategy === "merge"
    ? unionSavedOrders(currentOrders, backup.data.orders).nextOrders
    : backup.data.orders;
  const targetSettings = strategy === "merge"
    ? unionAppSettings(currentSettings, backup.data.settings)
    : normalizeAppSettings(backup.data.settings);
  const createdAt = new Date().toISOString();
  const targetLedgerId = strategy === "replace" ? crypto.randomUUID() : state.activeLedgerId;
  const activeEntries = state.entries.filter((entry) => entry.ledgerId === state.activeLedgerId);
  const currentById = new Map(activeEntries.map((entry) => [entry.id, entry]));
  const currentBackupEntries = activeEntries.map((entry) => guestEntryAsBackup(entry, currentById));
  const currentBySource = new Map(currentBackupEntries.map((entry) => [sourceKey(entry), entry]));
  const targetIdBySource = new Map(activeEntries.map((entry) => [sourceKey(entry), entry.id]));
  const importCandidates = backup.data.finance.entries.filter((entry) => {
    if (strategy === "replace") return true;
    if (isLegacyInitial(entry)) return false;
    const existing = currentBySource.get(sourceKey(entry));
    if (existing && backupContent(existing) !== backupContent(entry)) throw new Error("备份中存在同 ID 但内容不同的纠错记录");
    return !existing;
  });
  if (strategy === "merge" && initialBalanceStrategy === "use-backup") {
    for (const kind of ["expense", "income"] as const) {
      const currentInitial = activeEntries.filter((entry) => entry.kind === kind && isLegacyInitial(entry)).reduce((sum, entry) => sum + entry.deltaCents, 0);
      const backupInitial = backup.data.finance.entries.filter((entry) => entry.kind === kind && isLegacyInitial(entry)).reduce((sum, entry) => sum + entry.deltaCents, 0);
      const deltaCents = backupInitial - currentInitial;
      const currentInitialTax = activeEntries.filter((entry) => entry.kind === kind && isLegacyInitial(entry)).reduce((sum, entry) => sum + entry.taxDeltaCents, 0);
      const backupInitialTax = backup.data.finance.entries.filter((entry) => entry.kind === kind && isLegacyInitial(entry)).reduce((sum, entry) => sum + entry.taxDeltaCents, 0);
      const taxDeltaCents = backupInitialTax - currentInitialTax;
      const backupInitialSource = backup.data.finance.entries.find((entry) => entry.kind === kind && isLegacyInitial(entry));
      if (deltaCents === 0 && taxDeltaCents === 0) continue;
      const initialEntry: BackupFinanceCorrectionEntry = {
        originId: backupInitialSource?.originId ?? backup.originId,
        originEntryId: backupInitialSource?.originEntryId ?? `imported-initial-balance:${kind}:${backup.dataRevision}`,
        kind,
        deltaCents,
        taxDeltaCents,
        effectiveDate: null,
        note: "合并备份时补齐历史初值",
        source: "imported-initial-balance",
        createdAt: backup.exportedAt,
        adjusts: null,
      };
      const existing = currentBySource.get(sourceKey(initialEntry));
      if (!existing) importCandidates.push(initialEntry);
      else if (backupContent(existing) !== backupContent(initialEntry)) throw new Error("历史初值调整记录冲突");
    }
  }
  for (const entry of importCandidates) targetIdBySource.set(sourceKey(entry), crypto.randomUUID());
  for (const legacyEntry of backup.data.finance.entries.filter((entry) => isLegacyInitial(entry))) {
    if (targetIdBySource.has(sourceKey(legacyEntry))) continue;
    const importedInitial = importCandidates.find((entry) => entry.kind === legacyEntry.kind && entry.source === "imported-initial-balance");
    const currentInitial = activeEntries.find((entry) => entry.kind === legacyEntry.kind && isLegacyInitial(entry));
    const replacementId = importedInitial
      ? targetIdBySource.get(sourceKey(importedInitial))
      : currentInitial?.id;
    if (replacementId) targetIdBySource.set(sourceKey(legacyEntry), replacementId);
  }
  for (const entry of importCandidates) {
    if (entry.adjusts && !targetIdBySource.has(sourceKey(entry.adjusts))) {
      throw new Error("补差关联目标未导入，无法保留审计关系");
    }
  }
  let expense = strategy === "replace" ? 0 : guestCorrectionCents(state, "expense");
  let income = strategy === "replace" ? 0 : guestCorrectionCents(state, "income");
  let incomeTax = strategy === "replace" ? 0 : guestTaxCorrectionCents(state);
  const imported: GuestStoredEntry[] = importCandidates.map((entry, index) => {
    const before = entry.kind === "expense" ? expense : income;
    const after = before + entry.deltaCents;
    const taxBefore = entry.kind === "income" ? incomeTax : 0;
    const taxAfter = taxBefore + entry.taxDeltaCents;
    if (entry.kind === "expense") expense = after;
    else {
      income = after;
      incomeTax = taxAfter;
    }
    const id = targetIdBySource.get(sourceKey(entry))!;
    return {
      id,
      ledgerId: targetLedgerId,
      originId: entry.originId,
      originEntryId: entry.originEntryId,
      requestId: null,
      kind: entry.kind,
      amountDeltaCents: entry.kind === "income" ? entry.deltaCents + entry.taxDeltaCents : entry.deltaCents,
      taxDeltaCents: entry.taxDeltaCents,
      netDeltaCents: entry.deltaCents,
      deltaCents: entry.deltaCents,
      effectiveDate: entry.effectiveDate,
      note: entry.note,
      source: entry.source === "manual" ? "imported" : entry.source,
      createdAt: new Date(Date.parse(createdAt) + index).toISOString(),
      sourceCreatedAt: entry.createdAt || null,
      correctionBeforeCents: before,
      correctionAfterCents: after,
      taxCorrectionBeforeCents: taxBefore,
      taxCorrectionAfterCents: taxAfter,
      revisionAfter: state.revision + 1,
      adjustsEntryId: entry.adjusts ? targetIdBySource.get(sourceKey(entry.adjusts)) ?? null : null,
    };
  });
  const ledgers = strategy === "replace"
    ? [
        ...state.ledgers.map((ledger) => ledger.status === "active" ? { ...ledger, status: "archived" as const, archivedAt: createdAt } : ledger),
        { id: targetLedgerId, status: "active" as const, source: "backup-restore", createdAt, archivedAt: null },
      ]
    : state.ledgers;
  const next: GuestFinanceLedgerState = {
    ...state,
    revision: state.revision + 1,
    activeLedgerId: targetLedgerId,
    ledgers,
    entries: strategy === "replace" ? [...state.entries, ...imported] : [...state.entries, ...imported],
  };
  const orderTotals = orderLedgerBreakdown(targetOrders);
  if (Math.round(orderTotals.expense * 100) + expense < 0
    || Math.round(orderTotals.grossIncome * 100) + income + incomeTax < 0
    || Math.round(orderTotals.tax * 100) + incomeTax < 0
    || Math.round(orderTotals.income * 100) + income < 0) {
    throw new Error("恢复后的最终支出、税前收入、税额或税后收入不能小于 0");
  }
  saveGuestFinanceLedger(next);
  return {
    state: next,
    orders: targetOrders,
    settings: targetSettings,
    matches: backup.data.matches,
    correctionsAdded: imported.length,
  };
}

export type GuestFinanceLedgerState = {
  version: 3;
  originId: string;
  revision: number;
  activeLedgerId: string;
  ledgers: FinanceLedgerSummary[];
  entries: GuestStoredEntry[];
};

const emptyState = (): GuestFinanceLedgerState => {
  const originId = crypto.randomUUID();
  const activeLedgerId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  return {
    version: 3,
    originId,
    revision: 0,
    activeLedgerId,
    ledgers: [{ id: activeLedgerId, status: "active", source: "native", createdAt, archivedAt: null }],
    entries: [],
  };
};

function normalizeStoredState(value: unknown): GuestFinanceLedgerState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<GuestFinanceLedgerState> & { version?: number; entries?: Array<Partial<GuestStoredEntry>> };
  if (!([2, 3].includes(Number(state.version)))
    || typeof state.originId !== "string"
    || !Number.isSafeInteger(state.revision)
    || typeof state.activeLedgerId !== "string"
    || !Array.isArray(state.ledgers)
    || !Array.isArray(state.entries)) return null;
  return {
    version: 3,
    originId: state.originId,
    revision: Number(state.revision),
    activeLedgerId: state.activeLedgerId,
    ledgers: state.ledgers,
    entries: state.entries.map((entry) => {
      const netDeltaCents = Math.round(Number(entry.netDeltaCents ?? entry.deltaCents ?? 0));
      const taxDeltaCents = Math.round(Number(entry.taxDeltaCents ?? 0));
      return {
        ...(entry as GuestStoredEntry),
        amountDeltaCents: entry.kind === "income" ? netDeltaCents + taxDeltaCents : netDeltaCents,
        taxDeltaCents,
        netDeltaCents,
        deltaCents: netDeltaCents,
        taxCorrectionBeforeCents: Math.round(Number(entry.taxCorrectionBeforeCents ?? 0)),
        taxCorrectionAfterCents: Math.round(Number(entry.taxCorrectionAfterCents ?? 0)),
      };
    }),
  };
}

export function saveGuestFinanceLedger(state: GuestFinanceLedgerState) {
  localCache.setItem(GUEST_FINANCE_LEDGER_KEY, JSON.stringify(state));
}

export function loadGuestFinanceLedger(initial: { expenseCorrectionCents: number; incomeCorrectionCents: number }) {
  const raw = localCache.getItem(GUEST_FINANCE_LEDGER_KEY) ?? localCache.getItem(LEGACY_GUEST_FINANCE_LEDGER_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const normalized = normalizeStoredState(parsed);
      if (normalized) {
        saveGuestFinanceLedger(normalized);
        return normalized;
      }
    } catch {
      // 旧值损坏时以现有累计总额重新建立迁移基线。
    }
  }
  const state = emptyState();
  const createdAt = new Date().toISOString();
  const appendLegacy = (kind: FinanceCorrectionKind, deltaCents: number) => {
    if (deltaCents === 0) return;
    const id = crypto.randomUUID();
    state.entries.push({
      id,
      ledgerId: state.activeLedgerId,
      originId: state.originId,
      originEntryId: id,
      requestId: null,
      kind,
      amountDeltaCents: deltaCents,
      taxDeltaCents: 0,
      netDeltaCents: deltaCents,
      deltaCents,
      effectiveDate: null,
      note: "升级前累计值，原始明细不可追溯",
      source: "legacy-migration",
      createdAt,
      sourceCreatedAt: null,
      correctionBeforeCents: 0,
      correctionAfterCents: deltaCents,
      taxCorrectionBeforeCents: 0,
      taxCorrectionAfterCents: 0,
      revisionAfter: 0,
      adjustsEntryId: null,
    });
  };
  appendLegacy("expense", Math.round(initial.expenseCorrectionCents));
  appendLegacy("income", Math.round(initial.incomeCorrectionCents));
  saveGuestFinanceLedger(state);
  return state;
}

export function guestCorrectionCents(state: GuestFinanceLedgerState, kind: FinanceCorrectionKind) {
  return state.entries
    .filter((entry) => entry.ledgerId === state.activeLedgerId && entry.kind === kind)
    .reduce((total, entry) => total + entry.deltaCents, 0);
}

export function guestTaxCorrectionCents(state: GuestFinanceLedgerState) {
  return state.entries
    .filter((entry) => entry.ledgerId === state.activeLedgerId && entry.kind === "income")
    .reduce((total, entry) => total + entry.taxDeltaCents, 0);
}

export function guestGrossIncomeCorrectionCents(state: GuestFinanceLedgerState) {
  return guestCorrectionCents(state, "income") + guestTaxCorrectionCents(state);
}

export function listGuestFinanceCorrections(
  state: GuestFinanceLedgerState,
  query: { kind?: FinanceCorrectionKind; ledgerId?: string; cursor?: string; limit?: number } = {},
): FinanceCorrectionPage {
  const ledgerId = query.ledgerId || state.activeLedgerId;
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const offset = Math.max(0, Number(query.cursor ?? 0) || 0);
  const filtered = state.entries
    .filter((entry) => entry.ledgerId === ledgerId && (!query.kind || entry.kind === query.kind))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  return {
    entries: filtered.slice(offset, offset + limit).map((entry) => ({
      id: entry.id,
      ledgerId: entry.ledgerId,
      kind: entry.kind,
      amountDeltaCents: entry.amountDeltaCents,
      taxDeltaCents: entry.taxDeltaCents,
      netDeltaCents: entry.netDeltaCents,
      deltaCents: entry.deltaCents,
      effectiveDate: entry.effectiveDate,
      note: entry.note,
      source: entry.source,
      createdAt: entry.createdAt,
      sourceCreatedAt: entry.sourceCreatedAt,
      correctionBeforeCents: entry.correctionBeforeCents,
      correctionAfterCents: entry.correctionAfterCents,
      taxCorrectionBeforeCents: entry.taxCorrectionBeforeCents,
      taxCorrectionAfterCents: entry.taxCorrectionAfterCents,
      revisionAfter: entry.revisionAfter,
      adjustsEntryId: entry.adjustsEntryId,
    })),
    nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
    activeLedgerId: state.activeLedgerId,
    ledgers: state.ledgers,
  };
}

export function createGuestFinanceCorrection(
  state: GuestFinanceLedgerState,
  rawInput: CreateFinanceCorrectionInput,
  orderCents: { expense: number; income: number; grossIncome?: number; tax?: number },
  now = new Date(),
) {
  if (!isFinanceCorrectionKind(rawInput.kind)) throw new Error("纠错类型无效");
  const { amountDeltaCents, taxDeltaCents, netDeltaCents } = normalizeFinanceCorrectionAmounts(rawInput.kind, rawInput);
  const effectiveDate = normalizeFinanceCorrectionDate(rawInput.effectiveDate, now);
  const note = normalizeFinanceCorrectionNote(rawInput.note);
  const requestId = rawInput.requestId.trim();
  if (!requestId || requestId.length > 100) throw new Error("纠错请求标识无效");
  const repeated = state.entries.find((entry) => entry.requestId === requestId);
  if (repeated) {
    const same = repeated.kind === rawInput.kind
      && repeated.amountDeltaCents === amountDeltaCents
      && repeated.taxDeltaCents === taxDeltaCents
      && repeated.netDeltaCents === netDeltaCents
      && repeated.effectiveDate === effectiveDate
      && repeated.note === note
      && repeated.adjustsEntryId === (rawInput.adjustsEntryId ?? null);
    if (!same) throw new Error("纠错请求标识已用于其他内容");
    return { state, entry: repeated };
  }
  if (state.revision !== rawInput.expectedRevision) throw new Error("游客账本已在其他标签页更新，请刷新后重试");
  const adjustsEntryId = rawInput.adjustsEntryId ?? null;
  if (adjustsEntryId) {
    const adjusted = state.entries.find((entry) => entry.id === adjustsEntryId
      && entry.ledgerId === state.activeLedgerId
      && entry.kind === rawInput.kind);
    if (!adjusted) throw new Error("补差关联的原纠错记录无效");
  }
  const beforeCents = guestCorrectionCents(state, rawInput.kind);
  const afterCents = beforeCents + netDeltaCents;
  const taxBeforeCents = rawInput.kind === "income" ? guestTaxCorrectionCents(state) : 0;
  const taxAfterCents = taxBeforeCents + taxDeltaCents;
  if (rawInput.kind === "expense" && orderCents.expense + afterCents < 0) {
    throw new Error("纠错后的最终支出不能小于 0");
  }
  if (rawInput.kind === "income") {
    const orderGrossIncomeCents = orderCents.grossIncome ?? orderCents.income;
    const orderTaxCents = orderCents.tax ?? 0;
    const grossAfterCents = beforeCents + taxBeforeCents + amountDeltaCents;
    if (orderGrossIncomeCents + grossAfterCents < 0
      || orderTaxCents + taxAfterCents < 0
      || orderCents.income + afterCents < 0) {
      throw new Error("纠错后的最终税前收入、税额或税后收入不能小于 0");
    }
  }
  const id = crypto.randomUUID();
  const createdAt = now.toISOString();
  const entry: GuestStoredEntry = {
    id,
    ledgerId: state.activeLedgerId,
    originId: state.originId,
    originEntryId: id,
    requestId,
    kind: rawInput.kind,
    amountDeltaCents,
    taxDeltaCents,
    netDeltaCents,
    deltaCents: netDeltaCents,
    effectiveDate,
    note,
    source: "manual",
    createdAt,
    sourceCreatedAt: null,
    correctionBeforeCents: beforeCents,
    correctionAfterCents: afterCents,
    taxCorrectionBeforeCents: taxBeforeCents,
    taxCorrectionAfterCents: taxAfterCents,
    revisionAfter: state.revision + 1,
    adjustsEntryId,
  };
  const next = { ...state, revision: state.revision + 1, entries: [...state.entries, entry] };
  saveGuestFinanceLedger(next);
  return { state: next, entry };
}
