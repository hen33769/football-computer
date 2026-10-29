import {
  normalizeFullDataBackup,
  sha256Text,
  type BackupFinanceCorrectionEntry,
  type BackupImportPreview,
  type BackupImportStrategy,
  type BackupInitialBalanceStrategy,
  type FullDataBackupV7,
} from "../data-backup";
import { orderLedgerBreakdown, unionSavedOrders } from "../imports";
import { compactOrderSummary, normalizeCompactOrder, savedSlipToCompactOrder } from "../order-model";
import { normalizeAppSettings, unionAppSettings } from "../settings";
import type { MatchItem, SavedSlip } from "../types";
import { compactOrdersToSavedSlips, listOrders } from "./orders-service";
import { ensureFinanceCorrections, getFinanceState } from "./finance-service";
import { getPersonalDataRevision } from "./personal-data-revision-service";
import { ensureUserSettings, getUserSettings } from "./settings-service";
import { httpError } from "./errors";
import { toCents } from "./money";

type StoredEntryRow = {
  id: string;
  origin_id: string;
  origin_entry_id: string;
  kind: "expense" | "income";
  delta_cents: number;
  tax_delta_cents: number;
  effective_date: string | null;
  note: string;
  source: string;
  created_at: string;
  source_created_at: string | null;
  adjusts_entry_id: string | null;
};

type StoredCorrectionSummary = {
  active_ledger_id: string;
  expense_correction_cents: number;
  income_correction_cents: number;
  income_tax_correction_cents: number;
  revision: number;
};

type ImportOperationRow = {
  id: string;
  payload_digest: string;
  strategy: BackupImportStrategy;
  status: "staging" | "completed" | "failed";
  result_json: string | null;
};

const MAX_BACKUP_ORDERS = 2_000;
const MAX_BACKUP_CORRECTIONS = 10_000;
const MAX_BACKUP_JSON_BYTES = 20_000_000;
const STAGING_BATCH_SIZE = 50;

const sourceKey = (entry: Pick<BackupFinanceCorrectionEntry, "originId" | "originEntryId">) => `${entry.originId}\u0000${entry.originEntryId}`;
const isLegacyInitialEntry = (entry: Pick<BackupFinanceCorrectionEntry, "source" | "effectiveDate">) => entry.effectiveDate === null
  && ["legacy-migration", "legacy-backup", "imported-initial-balance"].includes(entry.source);

function backupEntryContent(entry: BackupFinanceCorrectionEntry) {
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

async function runInBatches<T>(items: T[], size: number, run: (chunk: T[]) => Promise<unknown>) {
  for (let index = 0; index < items.length; index += size) {
    await run(items.slice(index, index + size));
  }
}

async function allSavedOrders(d1: D1Database, userId: string) {
  const orders: SavedSlip[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await listOrders(d1, userId, { limit: 500, offset });
    orders.push(...compactOrdersToSavedSlips(page.orders));
    if (orders.length >= page.total || page.orders.length === 0) return orders;
  }
}

async function activeStoredEntries(d1: D1Database, userId: string) {
  const rows = await d1.prepare(`
    SELECT e.id, e.origin_id, e.origin_entry_id, e.kind, e.delta_cents, e.tax_delta_cents, e.effective_date,
           e.note, e.source, e.created_at, e.source_created_at, e.adjusts_entry_id
    FROM user_finance_correction_entries e
    JOIN user_finance_corrections c ON c.user_id = e.user_id AND c.active_ledger_id = e.ledger_id
    WHERE e.user_id = ?1
    ORDER BY e.created_at ASC, e.id ASC
  `).bind(userId).all<StoredEntryRow>();
  return rows.results ?? [];
}

function entriesForBackup(rows: StoredEntryRow[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return rows.map((row): BackupFinanceCorrectionEntry => {
    const adjusted = row.adjusts_entry_id ? byId.get(row.adjusts_entry_id) : undefined;
    return {
      originId: row.origin_id,
      originEntryId: row.origin_entry_id,
      kind: row.kind,
      deltaCents: Math.round(Number(row.delta_cents)),
      taxDeltaCents: Math.round(Number(row.tax_delta_cents)),
      effectiveDate: row.effective_date,
      note: row.note,
      source: row.source,
      createdAt: row.source_created_at || row.created_at,
      adjusts: adjusted ? { originId: adjusted.origin_id, originEntryId: adjusted.origin_entry_id } : null,
    };
  });
}

async function sharedMatches(d1: D1Database) {
  const rows = await d1.prepare(`SELECT data_json FROM shared_matches ORDER BY business_date ASC, match_id ASC`)
    .all<{ data_json: string }>();
  return (rows.results ?? []).flatMap((row) => {
    try { return [JSON.parse(row.data_json) as MatchItem]; } catch { return []; }
  });
}

export async function exportFullDataBackup(d1: D1Database, userId: string): Promise<FullDataBackupV7> {
  await ensureFinanceCorrections(d1, userId);
  await ensureUserSettings(d1, userId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await getPersonalDataRevision(d1, userId);
    const [orders, settings, entries, finance, matches] = await Promise.all([
      allSavedOrders(d1, userId),
      getUserSettings(d1, userId),
      activeStoredEntries(d1, userId),
      getFinanceState(d1, userId),
      sharedMatches(d1),
    ]);
    const after = await getPersonalDataRevision(d1, userId);
    if (before.revision !== after.revision) continue;
    const backupEntries = entriesForBackup(entries);
    const expenseCorrectionCents = backupEntries.filter((entry) => entry.kind === "expense").reduce((total, entry) => total + entry.deltaCents, 0);
    const incomeCorrectionCents = backupEntries.filter((entry) => entry.kind === "income").reduce((total, entry) => total + entry.deltaCents, 0);
    const incomeTaxCorrectionCents = backupEntries.filter((entry) => entry.kind === "income").reduce((total, entry) => total + entry.taxDeltaCents, 0);
    if (expenseCorrectionCents !== toCents(finance.expense.correction)
      || incomeCorrectionCents !== toCents(finance.income.correction)
      || incomeTaxCorrectionCents !== toCents(finance.income.taxCorrection)) {
      throw httpError("财务纠错汇总与当前账本流水不一致，请先检查数据", 409);
    }
    return {
      version: 7,
      kind: "full",
      exportedAt: new Date().toISOString(),
      originId: before.originId,
      dataRevision: before.revision,
      data: {
        orders,
        settings: settings.settings,
        finance: {
          ledgerSource: "cloud-active",
          entries: backupEntries,
          expenseCorrectionCents,
          incomeCorrectionCents,
          incomeTaxCorrectionCents,
        },
        matches,
      },
    };
  }
  throw httpError("导出期间个人数据发生变化，请重试", 409);
}

async function parseBackup(raw: unknown) {
  const serialized = JSON.stringify(raw);
  if (new TextEncoder().encode(serialized).byteLength > MAX_BACKUP_JSON_BYTES) throw httpError("完整备份文件过大", 413);
  const digest = await sha256Text(serialized);
  const backup = normalizeFullDataBackup(raw, `legacy-v5:${digest}`);
  if (backup.data.orders.length > MAX_BACKUP_ORDERS) throw httpError(`完整备份最多包含 ${MAX_BACKUP_ORDERS} 个订单`, 413);
  if (backup.data.finance.entries.length > MAX_BACKUP_CORRECTIONS) throw httpError(`完整备份最多包含 ${MAX_BACKUP_CORRECTIONS} 条纠错记录`, 413);
  return { backup, digest };
}

function storedEntriesAsBackup(rows: StoredEntryRow[]) {
  return entriesForBackup(rows);
}

export async function previewFullDataImport(
  d1: D1Database,
  userId: string,
  raw: unknown,
  strategy: BackupImportStrategy,
): Promise<BackupImportPreview> {
  if (strategy !== "merge" && strategy !== "replace") throw httpError("完整备份导入策略无效", 400);
  const { backup, digest } = await parseBackup(raw);
  await ensureFinanceCorrections(d1, userId);
  await ensureUserSettings(d1, userId);
  const [currentOrders, currentSettings, currentRows, revision] = await Promise.all([
    allSavedOrders(d1, userId),
    getUserSettings(d1, userId),
    activeStoredEntries(d1, userId),
    getPersonalDataRevision(d1, userId),
  ]);
  const currentOrderIds = new Set(currentOrders.map((order) => order.id));
  const backupOrderIds = new Set(backup.data.orders.map((order) => order.id));
  const currentEntries = storedEntriesAsBackup(currentRows);
  const currentBySource = new Map(currentEntries.map((entry) => [sourceKey(entry), entry]));
  const legacyInitialDifferenceCount = (["expense", "income"] as const).filter((kind) => {
    const currentValue = currentEntries.filter((entry) => entry.kind === kind && isLegacyInitialEntry(entry)).reduce((total, entry) => total + entry.deltaCents, 0);
    const backupValue = backup.data.finance.entries.filter((entry) => entry.kind === kind && isLegacyInitialEntry(entry)).reduce((total, entry) => total + entry.deltaCents, 0);
    const currentTax = currentEntries.filter((entry) => entry.kind === kind && isLegacyInitialEntry(entry)).reduce((total, entry) => total + entry.taxDeltaCents, 0);
    const backupTax = backup.data.finance.entries.filter((entry) => entry.kind === kind && isLegacyInitialEntry(entry)).reduce((total, entry) => total + entry.taxDeltaCents, 0);
    return currentValue !== backupValue || currentTax !== backupTax;
  }).length;
  let add = 0;
  let skip = 0;
  let conflicts = 0;
  for (const entry of backup.data.finance.entries) {
    if (strategy === "merge" && isLegacyInitialEntry(entry)) {
      skip += 1;
      continue;
    }
    const current = currentBySource.get(sourceKey(entry));
    if (!current) add += 1;
    else if (backupEntryContent(current) === backupEntryContent(entry)) skip += 1;
    else conflicts += 1;
  }
  const mergedSettings = strategy === "merge"
    ? unionAppSettings(currentSettings.settings, backup.data.settings)
    : normalizeAppSettings(backup.data.settings);
  return {
    backupDigest: digest,
    version: Number((raw as { version?: unknown })?.version ?? 0),
    strategy,
    expectedDataRevision: revision.revision,
    orders: {
      add: backup.data.orders.filter((order) => !currentOrderIds.has(order.id)).length,
      update: backup.data.orders.filter((order) => currentOrderIds.has(order.id)).length,
      remove: strategy === "replace" ? currentOrders.filter((order) => !backupOrderIds.has(order.id)).length : 0,
    },
    settingsChanged: JSON.stringify(currentSettings.settings) !== JSON.stringify(mergedSettings),
    finance: {
      add: strategy === "replace" ? backup.data.finance.entries.length : add,
      skip: strategy === "replace" ? 0 : skip,
      conflicts: strategy === "replace" ? 0 : conflicts,
      backupLegacyInitialCount: backup.data.finance.entries.filter(isLegacyInitialEntry).length,
      initialBalanceAdjustments: strategy === "merge" ? legacyInitialDifferenceCount : 0,
      expenseCorrectionCents: backup.data.finance.expenseCorrectionCents,
      incomeCorrectionCents: backup.data.finance.incomeCorrectionCents,
      incomeTaxCorrectionCents: backup.data.finance.incomeTaxCorrectionCents,
    },
    matches: { count: backup.data.matches.length, separateScope: true },
    warnings: [
      ...(Number((raw as { version?: unknown })?.version) === 5 ? ["旧版备份没有纠错明细；合并不会叠加旧账本初值，覆盖会恢复为无日期初值。"] : []),
      ...(Number((raw as { version?: unknown })?.version) === 6 ? ["v6 备份没有收入纠错税额字段，导入时按税额差值 0 处理。"] : []),
      ...(backup.data.matches.length > 0 ? ["公共比赛使用独立恢复范围，将单独报告结果。"] : []),
    ],
  };
}

type PreparedStagedEntry = {
  id: string;
  originId: string;
  originEntryId: string;
  kind: "expense" | "income";
  deltaCents: number;
  taxDeltaCents: number;
  effectiveDate: string | null;
  note: string;
  source: string;
  createdAt: string;
  sourceCreatedAt: string;
  correctionBeforeCents: number;
  correctionAfterCents: number;
  taxCorrectionBeforeCents: number;
  taxCorrectionAfterCents: number;
  revisionAfter: number;
  adjustsEntryId: string | null;
};

function stagedOrderPayload(order: SavedSlip, now: string) {
  const compact = normalizeCompactOrder({ ...savedSlipToCompactOrder(order), updatedAt: order.updatedAt || now });
  const summary = compactOrderSummary(compact);
  return {
    name: compact.name,
    savedAt: compact.savedAt,
    settledAt: compact.settledAt ?? null,
    settledPrizeCents: typeof compact.settledPrize === "number" ? toCents(compact.settledPrize) : null,
    taxCents: typeof compact.taxAmount === "number" ? toCents(compact.taxAmount) : null,
    paymentStatus: compact.paymentStatus === "paid" ? "paid" : "unpaid",
    stakeCents: toCents(summary.stake),
    status: summary.status,
    matchIdsJson: JSON.stringify([...new Set(compact.selections.map((selection) => selection.matchId))]),
    dataJson: JSON.stringify(compact),
    updatedAt: compact.updatedAt || now,
  };
}

export async function commitFullDataImport(
  d1: D1Database,
  userId: string,
  input: {
    backup: unknown;
    strategy: BackupImportStrategy;
    initialBalanceStrategy: BackupInitialBalanceStrategy;
    requestId: string;
    expectedDataRevision: number;
    backupDigest: string;
  },
) {
  const requestId = input.requestId.trim();
  if (!requestId || requestId.length > 100) throw httpError("导入请求标识无效", 400);
  if (input.initialBalanceStrategy !== "keep-current" && input.initialBalanceStrategy !== "use-backup") {
    throw httpError("历史初值策略无效", 400);
  }
  const { backup, digest } = await parseBackup(input.backup);
  if (digest !== input.backupDigest) throw httpError("备份内容已变化，请重新预览", 409);
  const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await d1.prepare(`
    DELETE FROM user_data_import_operations
    WHERE user_id = ?1 AND status <> 'completed' AND updated_at < ?2
  `).bind(userId, staleBefore).run();
  const completed = await d1.prepare(`
    SELECT id, payload_digest, strategy, status, result_json
    FROM user_data_import_operations WHERE user_id = ?1 AND request_id = ?2
  `).bind(userId, requestId).first<ImportOperationRow>();
  if (completed?.status === "completed") {
    if (completed.payload_digest !== digest || completed.strategy !== input.strategy) throw httpError("导入请求标识已用于其他内容", 409);
    return JSON.parse(completed.result_json ?? "{}") as Record<string, unknown>;
  }
  const preview = await previewFullDataImport(d1, userId, input.backup, input.strategy);
  if (preview.backupDigest !== digest) throw httpError("备份摘要校验失败", 400);
  if (preview.finance.conflicts > 0) throw httpError("备份中存在同 ID 但内容不同的纠错记录", 409);
  if (preview.expectedDataRevision !== input.expectedDataRevision) throw httpError("个人数据已更新，请重新预览后导入", 409);
  const [currentOrders, currentSettings, currentRows, currentSummary] = await Promise.all([
    allSavedOrders(d1, userId),
    getUserSettings(d1, userId),
    activeStoredEntries(d1, userId),
    d1.prepare(`
      SELECT active_ledger_id, expense_correction_cents, income_correction_cents,
             income_tax_correction_cents, revision
      FROM user_finance_corrections WHERE user_id = ?1
    `).bind(userId).first<StoredCorrectionSummary>(),
  ]);
  if (!currentSummary) throw new Error("财务汇总不存在");
  const currentExpenseSum = currentRows.filter((row) => row.kind === "expense").reduce((total, row) => total + Math.round(Number(row.delta_cents)), 0);
  const currentIncomeSum = currentRows.filter((row) => row.kind === "income").reduce((total, row) => total + Math.round(Number(row.delta_cents)), 0);
  const currentIncomeTaxSum = currentRows.filter((row) => row.kind === "income").reduce((total, row) => total + Math.round(Number(row.tax_delta_cents)), 0);
  if (currentExpenseSum !== Math.round(Number(currentSummary.expense_correction_cents))
    || currentIncomeSum !== Math.round(Number(currentSummary.income_correction_cents))
    || currentIncomeTaxSum !== Math.round(Number(currentSummary.income_tax_correction_cents))) {
    throw httpError("当前财务纠错汇总与账本流水不一致，不能导入", 409);
  }
  const now = new Date().toISOString();
  const operationId = completed?.id ?? crypto.randomUUID();
  const targetLedgerId = input.strategy === "replace" ? crypto.randomUUID() : currentSummary.active_ledger_id;
  const targetOrders = input.strategy === "merge"
    ? unionSavedOrders(currentOrders, backup.data.orders).nextOrders
    : backup.data.orders;
  const targetSettings = input.strategy === "merge"
    ? unionAppSettings(currentSettings.settings, backup.data.settings)
    : normalizeAppSettings(backup.data.settings);
  const currentBackupEntries = storedEntriesAsBackup(currentRows);
  const currentBySource = new Map(currentBackupEntries.map((entry) => [sourceKey(entry), entry]));
  const currentRowBySource = new Map(currentRows.map((row) => [`${row.origin_id}\u0000${row.origin_entry_id}`, row]));
  let expenseBefore = input.strategy === "replace" ? 0 : Math.round(Number(currentSummary.expense_correction_cents));
  let incomeBefore = input.strategy === "replace" ? 0 : Math.round(Number(currentSummary.income_correction_cents));
  let incomeTaxBefore = input.strategy === "replace" ? 0 : Math.round(Number(currentSummary.income_tax_correction_cents));
  const stagedEntries: PreparedStagedEntry[] = [];
  const targetIdBySource = new Map<string, string>();
  currentRows.forEach((row) => targetIdBySource.set(`${row.origin_id}\u0000${row.origin_entry_id}`, row.id));
  const importCandidates = backup.data.finance.entries.filter((entry) => {
    if (input.strategy === "replace") return true;
    if (isLegacyInitialEntry(entry)) return false;
    return !currentBySource.has(sourceKey(entry));
  });
  if (input.strategy === "merge" && input.initialBalanceStrategy === "use-backup") {
    for (const kind of ["expense", "income"] as const) {
      const currentInitial = currentBackupEntries
        .filter((entry) => entry.kind === kind && isLegacyInitialEntry(entry))
        .reduce((total, entry) => total + entry.deltaCents, 0);
      const backupInitial = backup.data.finance.entries
        .filter((entry) => entry.kind === kind && isLegacyInitialEntry(entry))
        .reduce((total, entry) => total + entry.deltaCents, 0);
      const currentInitialTax = currentBackupEntries
        .filter((entry) => entry.kind === kind && isLegacyInitialEntry(entry))
        .reduce((total, entry) => total + entry.taxDeltaCents, 0);
      const backupInitialTax = backup.data.finance.entries
        .filter((entry) => entry.kind === kind && isLegacyInitialEntry(entry))
        .reduce((total, entry) => total + entry.taxDeltaCents, 0);
      const deltaCents = backupInitial - currentInitial;
      const taxDeltaCents = backupInitialTax - currentInitialTax;
      if (deltaCents === 0 && taxDeltaCents === 0) continue;
      const backupInitialSource = backup.data.finance.entries.find((entry) => entry.kind === kind && isLegacyInitialEntry(entry));
      const initialEntry: BackupFinanceCorrectionEntry = {
        originId: backupInitialSource?.originId ?? backup.originId,
        originEntryId: backupInitialSource?.originEntryId ?? `imported-initial-balance:${kind}:${digest}`,
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
      else if (backupEntryContent(existing) !== backupEntryContent(initialEntry)) {
        throw httpError("历史初值调整记录冲突", 409);
      }
    }
  }
  for (const entry of importCandidates) targetIdBySource.set(sourceKey(entry), crypto.randomUUID());
  for (const legacyEntry of backup.data.finance.entries.filter(isLegacyInitialEntry)) {
    if (targetIdBySource.has(sourceKey(legacyEntry))) continue;
    const importedInitial = importCandidates.find((entry) => entry.kind === legacyEntry.kind && entry.source === "imported-initial-balance");
    const currentInitial = currentRows.find((row) => row.kind === legacyEntry.kind
      && row.effective_date === null
      && ["legacy-migration", "legacy-backup", "imported-initial-balance"].includes(row.source));
    const replacementId = importedInitial
      ? targetIdBySource.get(sourceKey(importedInitial))
      : currentInitial?.id;
    if (replacementId) targetIdBySource.set(sourceKey(legacyEntry), replacementId);
  }
  for (const entry of importCandidates) {
    if (entry.adjusts && !targetIdBySource.has(sourceKey(entry.adjusts))) {
      throw httpError("补差关联目标未导入，无法保留审计关系", 400);
    }
  }
  for (const [index, entry] of importCandidates.entries()) {
    const before = entry.kind === "expense" ? expenseBefore : incomeBefore;
    const after = before + entry.deltaCents;
    const taxBefore = entry.kind === "income" ? incomeTaxBefore : 0;
    const taxAfter = taxBefore + entry.taxDeltaCents;
    if (entry.kind === "expense") expenseBefore = after;
    else {
      incomeBefore = after;
      incomeTaxBefore = taxAfter;
    }
    stagedEntries.push({
      id: targetIdBySource.get(sourceKey(entry))!,
      originId: entry.originId,
      originEntryId: entry.originEntryId,
      kind: entry.kind,
      deltaCents: entry.deltaCents,
      taxDeltaCents: entry.taxDeltaCents,
      effectiveDate: entry.effectiveDate,
      note: entry.note,
      source: entry.source === "manual" ? "imported" : entry.source,
      createdAt: new Date(Date.parse(now) + index).toISOString(),
      sourceCreatedAt: entry.createdAt,
      correctionBeforeCents: before,
      correctionAfterCents: after,
      taxCorrectionBeforeCents: taxBefore,
      taxCorrectionAfterCents: taxAfter,
      revisionAfter: currentSummary.revision + 1,
      adjustsEntryId: entry.adjusts ? targetIdBySource.get(sourceKey(entry.adjusts)) ?? currentRowBySource.get(sourceKey(entry.adjusts))?.id ?? null : null,
    });
  }
  const finalExpenseCorrectionCents = input.strategy === "replace" ? backup.data.finance.expenseCorrectionCents : expenseBefore;
  const finalIncomeCorrectionCents = input.strategy === "replace" ? backup.data.finance.incomeCorrectionCents : incomeBefore;
  const finalIncomeTaxCorrectionCents = input.strategy === "replace" ? backup.data.finance.incomeTaxCorrectionCents : incomeTaxBefore;
  const targetOrderTotals = orderLedgerBreakdown(targetOrders);
  if (toCents(targetOrderTotals.expense) + finalExpenseCorrectionCents < 0
    || toCents(targetOrderTotals.grossIncome) + finalIncomeCorrectionCents + finalIncomeTaxCorrectionCents < 0
    || toCents(targetOrderTotals.tax) + finalIncomeTaxCorrectionCents < 0
    || toCents(targetOrderTotals.income) + finalIncomeCorrectionCents < 0) {
    throw httpError("恢复后的最终支出、税前收入、税额或税后收入不能小于 0", 400);
  }
  const operationStatements = completed ? [
    d1.prepare(`DELETE FROM user_data_import_staging WHERE operation_id = ?1`).bind(operationId),
    d1.prepare(`
      UPDATE user_data_import_operations
      SET payload_digest = ?1, strategy = ?2, expected_data_revision = ?3,
          status = 'staging', result_json = NULL, updated_at = ?4
      WHERE id = ?5 AND user_id = ?6
    `).bind(digest, input.strategy, input.expectedDataRevision, now, operationId, userId),
  ] : [
    d1.prepare(`
      INSERT INTO user_data_import_operations (
        id, user_id, request_id, payload_digest, strategy, expected_data_revision, status, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'staging', ?7, ?7)
    `).bind(operationId, userId, requestId, digest, input.strategy, input.expectedDataRevision, now),
  ];
  await d1.batch(operationStatements);
  const orderStageStatements = targetOrders.map((order) => d1.prepare(`
      INSERT INTO user_data_import_staging (operation_id, record_kind, record_key, payload_json)
      VALUES (?1, 'order', ?2, ?3)
    `).bind(operationId, order.id, JSON.stringify(stagedOrderPayload(order, now))));
  await runInBatches(orderStageStatements, STAGING_BATCH_SIZE, (statements) => d1.batch(statements));
  await d1.prepare(`
      INSERT INTO user_data_import_staging (operation_id, record_kind, record_key, payload_json)
      VALUES (?1, 'settings', 'settings', ?2)
    `).bind(operationId, JSON.stringify(targetSettings)).run();
  const financeStageStatements = stagedEntries.map((entry) => d1.prepare(`
      INSERT INTO user_data_import_staging (operation_id, record_kind, record_key, payload_json)
      VALUES (?1, 'finance-entry', ?2, ?3)
    `).bind(operationId, entry.id, JSON.stringify(entry)));
  await runInBatches(financeStageStatements, STAGING_BATCH_SIZE, (statements) => d1.batch(statements));
  const result = {
    ok: true,
    strategy: input.strategy,
    orders: targetOrders.length,
    correctionsAdded: stagedEntries.length,
    matches: backup.data.matches,
    backupDigest: digest,
  };
  const finalStatements = [
    d1.prepare(`
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM user_personal_data_revisions WHERE user_id = ?1 AND revision = ?2
      ) THEN json('null') ELSE json('') END
    `).bind(userId, input.expectedDataRevision),
    d1.prepare(`DELETE FROM user_orders WHERE user_id = ?1`).bind(userId),
    d1.prepare(`
      INSERT INTO user_orders (
        user_id, order_id, name, saved_at, settled_at, settled_prize_cents, tax_cents,
        payment_status, stake_cents, status, match_ids_json, data_json, updated_at
      )
      SELECT ?1, record_key,
        json_extract(payload_json, '$.name'), json_extract(payload_json, '$.savedAt'),
        json_extract(payload_json, '$.settledAt'), json_extract(payload_json, '$.settledPrizeCents'),
        json_extract(payload_json, '$.taxCents'), json_extract(payload_json, '$.paymentStatus'),
        json_extract(payload_json, '$.stakeCents'), json_extract(payload_json, '$.status'),
        json_extract(payload_json, '$.matchIdsJson'), json_extract(payload_json, '$.dataJson'),
        json_extract(payload_json, '$.updatedAt')
      FROM user_data_import_staging WHERE operation_id = ?2 AND record_kind = 'order'
    `).bind(userId, operationId),
    d1.prepare(`
      UPDATE user_settings
      SET settings_json = (SELECT payload_json FROM user_data_import_staging
        WHERE operation_id = ?1 AND record_kind = 'settings' AND record_key = 'settings'),
          revision = revision + 1, updated_at = ?2
      WHERE user_id = ?3
    `).bind(operationId, now, userId),
  ];
  if (input.strategy === "replace") {
    finalStatements.push(
      d1.prepare(`UPDATE user_finance_ledgers SET status = 'archived', archived_at = ?1 WHERE user_id = ?2 AND status = 'active'`).bind(now, userId),
      d1.prepare(`
        INSERT INTO user_finance_ledgers (id, user_id, status, source, restore_operation_id, created_at)
        VALUES (?1, ?2, 'active', 'backup-restore', ?3, ?4)
      `).bind(targetLedgerId, userId, operationId, now),
    );
  }
  if (stagedEntries.length > 0) {
    finalStatements.push(d1.prepare(`
      INSERT INTO user_finance_correction_entries (
        id, user_id, ledger_id, origin_id, origin_entry_id, kind, delta_cents, tax_delta_cents, effective_date,
        note, source, request_id, created_at, source_created_at, correction_before_cents,
        correction_after_cents, tax_correction_before_cents, tax_correction_after_cents,
        revision_after, adjusts_entry_id
      )
      SELECT record_key, ?1, ?2,
        json_extract(payload_json, '$.originId'), json_extract(payload_json, '$.originEntryId'),
        json_extract(payload_json, '$.kind'), json_extract(payload_json, '$.deltaCents'),
        json_extract(payload_json, '$.taxDeltaCents'), json_extract(payload_json, '$.effectiveDate'),
        json_extract(payload_json, '$.note'),
        json_extract(payload_json, '$.source'), NULL, json_extract(payload_json, '$.createdAt'),
        json_extract(payload_json, '$.sourceCreatedAt'), json_extract(payload_json, '$.correctionBeforeCents'),
        json_extract(payload_json, '$.correctionAfterCents'), json_extract(payload_json, '$.taxCorrectionBeforeCents'),
        json_extract(payload_json, '$.taxCorrectionAfterCents'), json_extract(payload_json, '$.revisionAfter'),
        json_extract(payload_json, '$.adjustsEntryId')
      FROM user_data_import_staging WHERE operation_id = ?3 AND record_kind = 'finance-entry'
    `).bind(userId, targetLedgerId, operationId));
  }
  finalStatements.push(
    d1.prepare(`
      UPDATE user_finance_corrections
      SET active_ledger_id = ?1, expense_correction_cents = ?2, income_correction_cents = ?3,
          income_tax_correction_cents = ?4, revision = revision + 1, updated_at = ?5
      WHERE user_id = ?6
    `).bind(targetLedgerId, finalExpenseCorrectionCents, finalIncomeCorrectionCents,
      finalIncomeTaxCorrectionCents, now, userId),
    d1.prepare(`
      UPDATE user_personal_data_revisions
      SET revision = revision + 1, updated_at = ?1
      WHERE user_id = ?2 AND revision = ?3
    `).bind(now, userId, input.expectedDataRevision),
    d1.prepare(`
      UPDATE user_data_import_operations
      SET status = 'completed', result_json = ?1, updated_at = ?2
      WHERE id = ?3 AND user_id = ?4
    `).bind(JSON.stringify(result), now, operationId, userId),
    d1.prepare(`DELETE FROM user_data_import_staging WHERE operation_id = ?1`).bind(operationId),
  );
  try {
    await d1.batch(finalStatements);
  } catch (error) {
    const latest = await getPersonalDataRevision(d1, userId);
    if (latest.revision !== input.expectedDataRevision) throw httpError("个人数据已更新，请重新预览后导入", 409);
    throw error;
  }
  return result;
}
