import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFullDataBackup } from "../app/data-backup";
import { createFinanceCorrectionEntry, getFinanceState, listFinanceCorrectionEntries } from "../app/server/finance-service";
import { commitFullDataImport, exportFullDataBackup, previewFullDataImport } from "../app/server/data-backup-service";
import { createOrder } from "../app/server/orders-service";
import type { SavedSlip } from "../app/types";
import { SqliteD1 } from "./helpers/sqlite-d1";

const order = (id: string): SavedSlip => ({
  id,
  name: `订单 ${id}`,
  savedAt: "2026-10-20T01:00:00.000Z",
  paymentStatus: "paid",
  passes: [1],
  multiple: 1,
  matches: [{
    id: "2040001", date: "2026-10-20", weekday: "周二", code: "001", league: "测试",
    time: "2026-10-20 20:00", home: "主队", away: "客队",
    markets: [{ type: "spf", options: [{ id: "win", label: "主胜", odds: 2, selected: true }] }],
  }],
});

function setup() {
  const db = new SqliteD1();
  db.database.exec(`INSERT INTO users (id,auth_subject,account,normalized_account)
    VALUES ('user-a','subject-a','user-a','user-a')`);
  return db;
}

test("v7 完整备份导出收入纠错税额并可重复合并去重", async () => {
  const db = setup();
  await createOrder(db.asD1(), "user-a", order("order-1"));
  await createFinanceCorrectionEntry(db.asD1(), "user-a", {
    kind: "income", amountDeltaCents: 20_000, taxDeltaCents: 2_000,
    effectiveDate: "2026-10-20", note: "奖金修正",
    requestId: "correction-1", expectedRevision: 0,
  }, new Date("2026-10-28T01:00:00.000Z"));
  const backup = await exportFullDataBackup(db.asD1(), "user-a");
  assert.equal(backup.version, 7);
  assert.equal(backup.data.orders.length, 1);
  assert.equal(backup.data.finance.entries.length, 1);
  assert.equal(backup.data.finance.entries[0].deltaCents, 18_000);
  assert.equal(backup.data.finance.entries[0].taxDeltaCents, 2_000);
  assert.equal(backup.data.finance.incomeTaxCorrectionCents, 2_000);

  const preview = await previewFullDataImport(db.asD1(), "user-a", backup, "merge");
  assert.equal(preview.finance.add, 0);
  assert.equal(preview.finance.skip, 1);
  const result = await commitFullDataImport(db.asD1(), "user-a", {
    backup,
    strategy: "merge",
    initialBalanceStrategy: "keep-current",
    requestId: "import-merge-1",
    expectedDataRevision: preview.expectedDataRevision,
    backupDigest: preview.backupDigest,
  });
  assert.equal(result.correctionsAdded, 0);
  assert.equal((await listFinanceCorrectionEntries(db.asD1(), "user-a")).entries.length, 1);
  const repeated = await commitFullDataImport(db.asD1(), "user-a", {
    backup,
    strategy: "merge",
    initialBalanceStrategy: "keep-current",
    requestId: "import-merge-1",
    expectedDataRevision: preview.expectedDataRevision,
    backupDigest: preview.backupDigest,
  });
  assert.deepEqual(repeated, result);
});

test("覆盖恢复归档旧账本并激活备份账本", async () => {
  const db = setup();
  await createFinanceCorrectionEntry(db.asD1(), "user-a", {
    kind: "expense", deltaCents: 1_000, effectiveDate: null, note: "旧账本",
    requestId: "old", expectedRevision: 0,
  });
  const backup = await exportFullDataBackup(db.asD1(), "user-a");
  backup.data.finance.entries[0] = {
    ...backup.data.finance.entries[0],
    originEntryId: "replacement",
    deltaCents: 500,
    note: "恢复账本",
  };
  backup.data.finance.expenseCorrectionCents = 500;
  const preview = await previewFullDataImport(db.asD1(), "user-a", backup, "replace");
  await commitFullDataImport(db.asD1(), "user-a", {
    backup,
    strategy: "replace",
    initialBalanceStrategy: "use-backup",
    requestId: "replace-1",
    expectedDataRevision: preview.expectedDataRevision,
    backupDigest: preview.backupDigest,
  });
  const finance = await getFinanceState(db.asD1(), "user-a");
  assert.equal(finance.expense.correction, 5);
  const page = await listFinanceCorrectionEntries(db.asD1(), "user-a");
  assert.equal(page.ledgers.filter((ledger) => ledger.status === "archived").length, 1);
  assert.equal(page.entries[0].note, "恢复账本");
});

test("合并可用稳定差额切换旧版历史初值且重复导入不叠加", async () => {
  const db = setup();
  const initial = await getFinanceState(db.asD1(), "user-a");
  const origin = db.database.prepare(`SELECT origin_id FROM user_personal_data_revisions WHERE user_id = 'user-a'`).get() as { origin_id: string };
  db.database.exec(`
    INSERT INTO user_finance_correction_entries (
      id, user_id, ledger_id, origin_id, origin_entry_id, kind, delta_cents,
      effective_date, note, source, request_id, created_at, source_created_at,
      correction_before_cents, correction_after_cents, revision_after, adjusts_entry_id
    ) VALUES (
      'current-legacy', 'user-a', '${initial.activeLedgerId}', '${origin.origin_id}', 'legacy-expense',
      'expense', 500, NULL, '旧初值', 'legacy-migration', NULL, '2026-10-01T00:00:00Z',
      '2026-10-01T00:00:00Z', 0, 500, 0, NULL
    );
    UPDATE user_finance_corrections SET expense_correction_cents = 500 WHERE user_id = 'user-a';
  `);
  const backup = await exportFullDataBackup(db.asD1(), "user-a");
  backup.originId = "backup-origin";
  backup.data.finance.entries = [
    {
      originId: "backup-origin",
      originEntryId: "legacy-expense",
      kind: "expense",
      deltaCents: 2_000,
      taxDeltaCents: 0,
      effectiveDate: null,
      note: "备份初值",
      source: "legacy-migration",
      createdAt: "2026-10-02T00:00:00Z",
      adjusts: null,
    },
    {
      originId: "backup-origin",
      originEntryId: "legacy-adjustment",
      kind: "expense",
      deltaCents: -200,
      taxDeltaCents: 0,
      effectiveDate: null,
      note: "备份补差",
      source: "manual",
      createdAt: "2026-10-03T00:00:00Z",
      adjusts: { originId: "backup-origin", originEntryId: "legacy-expense" },
    },
  ];
  backup.data.finance.expenseCorrectionCents = 1_800;
  const preview = await previewFullDataImport(db.asD1(), "user-a", backup, "merge");
  const first = await commitFullDataImport(db.asD1(), "user-a", {
    backup,
    strategy: "merge",
    initialBalanceStrategy: "use-backup",
    requestId: "initial-use-backup-1",
    expectedDataRevision: preview.expectedDataRevision,
    backupDigest: preview.backupDigest,
  });
  assert.equal(first.correctionsAdded, 2);
  assert.equal((await getFinanceState(db.asD1(), "user-a")).expense.correction, 18);
  const importedEntries = await listFinanceCorrectionEntries(db.asD1(), "user-a");
  assert.ok(importedEntries.entries.find((entry) => entry.note === "备份补差")?.adjustsEntryId);

  const repeatedPreview = await previewFullDataImport(db.asD1(), "user-a", backup, "merge");
  const repeated = await commitFullDataImport(db.asD1(), "user-a", {
    backup,
    strategy: "merge",
    initialBalanceStrategy: "use-backup",
    requestId: "initial-use-backup-2",
    expectedDataRevision: repeatedPreview.expectedDataRevision,
    backupDigest: repeatedPreview.backupDigest,
  });
  assert.equal(repeated.correctionsAdded, 0);
  assert.equal((await getFinanceState(db.asD1(), "user-a")).expense.correction, 18);
});

test("预览后个人数据变化会阻止提交且不覆盖新纠错", async () => {
  const db = setup();
  const backup = await exportFullDataBackup(db.asD1(), "user-a");
  const preview = await previewFullDataImport(db.asD1(), "user-a", backup, "replace");
  await createFinanceCorrectionEntry(db.asD1(), "user-a", {
    kind: "expense", deltaCents: 100, effectiveDate: null, note: "预览后新增",
    requestId: "after-preview", expectedRevision: 0,
  });

  await assert.rejects(commitFullDataImport(db.asD1(), "user-a", {
    backup,
    strategy: "replace",
    initialBalanceStrategy: "use-backup",
    requestId: "stale-preview",
    expectedDataRevision: preview.expectedDataRevision,
    backupDigest: preview.backupDigest,
  }), (error: Error & { status?: number }) => error.status === 409);
  assert.equal((await getFinanceState(db.asD1(), "user-a")).expense.correction, 1);
});

test("最终提交失败不改变在线账本，原 requestId 可安全重试", async () => {
  const db = setup();
  await createFinanceCorrectionEntry(db.asD1(), "user-a", {
    kind: "expense", deltaCents: 100, effectiveDate: null, note: "当前账本",
    requestId: "current-ledger", expectedRevision: 0,
  });
  const before = await getFinanceState(db.asD1(), "user-a");
  const backup = await exportFullDataBackup(db.asD1(), "user-a");
  backup.data.finance.entries[0] = {
    ...backup.data.finance.entries[0],
    originEntryId: "restored-entry",
    deltaCents: 500,
    note: "恢复目标",
  };
  backup.data.finance.expenseCorrectionCents = 500;
  const preview = await previewFullDataImport(db.asD1(), "user-a", backup, "replace");
  let batchNumber = 0;
  db.beforeBatch = () => {
    batchNumber += 1;
    if (batchNumber === 3) throw new Error("模拟最终提交失败");
  };
  const input = {
    backup,
    strategy: "replace" as const,
    initialBalanceStrategy: "use-backup" as const,
    requestId: "retry-after-final-failure",
    expectedDataRevision: preview.expectedDataRevision,
    backupDigest: preview.backupDigest,
  };
  await assert.rejects(commitFullDataImport(db.asD1(), "user-a", input), /模拟最终提交失败/);
  const unchanged = await getFinanceState(db.asD1(), "user-a");
  assert.equal(unchanged.activeLedgerId, before.activeLedgerId);
  assert.equal(unchanged.expense.correction, 1);

  db.beforeBatch = undefined;
  const retried = await commitFullDataImport(db.asD1(), "user-a", input);
  assert.equal(retried.correctionsAdded, 1);
  const restored = await getFinanceState(db.asD1(), "user-a");
  assert.equal(restored.expense.correction, 5);
  assert.notEqual(restored.activeLedgerId, before.activeLedgerId);
});

test("同稳定 ID 内容冲突时整批拒绝", async () => {
  const db = setup();
  await createFinanceCorrectionEntry(db.asD1(), "user-a", {
    kind: "income", deltaCents: 100, effectiveDate: null, note: "原值",
    requestId: "conflict-source", expectedRevision: 0,
  });
  const backup = await exportFullDataBackup(db.asD1(), "user-a");
  backup.data.finance.entries[0].deltaCents = 200;
  backup.data.finance.incomeCorrectionCents = 200;
  const preview = await previewFullDataImport(db.asD1(), "user-a", backup, "merge");
  assert.equal(preview.finance.conflicts, 1);
  await assert.rejects(commitFullDataImport(db.asD1(), "user-a", {
    backup,
    strategy: "merge",
    initialBalanceStrategy: "keep-current",
    requestId: "conflict-import",
    expectedDataRevision: preview.expectedDataRevision,
    backupDigest: preview.backupDigest,
  }), (error: Error & { status?: number }) => error.status === 409);
  assert.equal((await getFinanceState(db.asD1(), "user-a")).income.correction, 1);
});

test("覆盖恢复拒绝让最终收入或支出变成负数的账本", async () => {
  const db = setup();
  const backup = await exportFullDataBackup(db.asD1(), "user-a");
  backup.data.finance.entries = [{
    originId: backup.originId,
    originEntryId: "negative-expense",
    kind: "expense",
    deltaCents: -100,
    taxDeltaCents: 0,
    effectiveDate: null,
    note: "非法最终余额",
    source: "manual",
    createdAt: backup.exportedAt,
    adjusts: null,
  }];
  backup.data.finance.expenseCorrectionCents = -100;
  const preview = await previewFullDataImport(db.asD1(), "user-a", backup, "replace");
  await assert.rejects(commitFullDataImport(db.asD1(), "user-a", {
    backup,
    strategy: "replace",
    initialBalanceStrategy: "use-backup",
    requestId: "negative-final-balance",
    expectedDataRevision: preview.expectedDataRevision,
    backupDigest: preview.backupDigest,
  }), /不能小于 0/);
  assert.equal((await listFinanceCorrectionEntries(db.asD1(), "user-a")).entries.length, 0);
});

test("v6 备份导入按纠错税额 0 升级为 v7", () => {
  const converted = normalizeFullDataBackup({
    version: 6,
    kind: "full",
    exportedAt: "2026-10-01T00:00:00.000Z",
    originId: "v6-origin",
    dataRevision: 1,
    data: {
      orders: [],
      settings: {},
      finance: {
        ledgerSource: "cloud-active",
        entries: [{
          originId: "v6-origin",
          originEntryId: "v6-income",
          kind: "income",
          deltaCents: 1_800,
          effectiveDate: null,
          note: "旧收入纠错",
          source: "manual",
          createdAt: "2026-10-01T00:00:00.000Z",
          adjusts: null,
        }],
        expenseCorrectionCents: 0,
        incomeCorrectionCents: 1_800,
      },
      matches: [],
    },
  });
  assert.equal(converted.version, 7);
  assert.equal(converted.data.finance.entries[0].taxDeltaCents, 0);
  assert.equal(converted.data.finance.incomeTaxCorrectionCents, 0);
});

test("v5 覆盖兼容把最终总额还原成无日期初值", () => {
  const converted = normalizeFullDataBackup({
    version: 5,
    kind: "full",
    exportedAt: "2026-10-01T00:00:00.000Z",
    data: {
      orders: [order("legacy")],
      settings: {},
      finance: { expenseTotal: 6, incomeTotal: 3 },
      matches: [],
    },
  }, "legacy-origin");
  assert.equal(converted.data.finance.entries.every((entry) => entry.effectiveDate === null), true);
  assert.equal(converted.data.finance.expenseCorrectionCents, 400);
  assert.equal(converted.data.finance.incomeCorrectionCents, 300);
});
