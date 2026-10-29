import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGuestFullDataImport,
  createGuestFinanceCorrection,
  exportGuestFullDataBackup,
  guestCorrectionCents,
  guestGrossIncomeCorrectionCents,
  guestTaxCorrectionCents,
  loadGuestFinanceLedger,
  previewGuestFullDataImport,
  GUEST_FINANCE_LEDGER_KEY,
} from "../app/guest-finance-ledger";
import { localCache, type BrowserStorage } from "../app/browser-storage";
import { createDefaultSettings } from "../app/settings";

test("游客 v7 合并可保留或补齐旧初值，重复导入不重复累计", async () => {
  const sourceInitial = loadGuestFinanceLedger({ expenseCorrectionCents: 2_000, incomeCorrectionCents: 0 });
  const source = createGuestFinanceCorrection(sourceInitial, {
    kind: "expense",
    deltaCents: -200,
    effectiveDate: null,
    note: "备份补差",
    requestId: "guest-source-adjustment",
    expectedRevision: sourceInitial.revision,
    adjustsEntryId: sourceInitial.entries[0].id,
  }, { expense: 0, income: 0 }).state;
  const target = loadGuestFinanceLedger({ expenseCorrectionCents: 500, incomeCorrectionCents: 0 });
  const backup = exportGuestFullDataBackup(source, [], createDefaultSettings(), []);
  const preview = await previewGuestFullDataImport(target, [], createDefaultSettings(), backup, "merge");

  assert.equal(preview.finance.backupLegacyInitialCount, 1);
  assert.equal(preview.finance.skip, 1);
  const merged = applyGuestFullDataImport(
    target,
    [],
    createDefaultSettings(),
    backup,
    "merge",
    "use-backup",
    preview.expectedDataRevision,
    preview.backupDigest,
  );
  assert.equal(guestCorrectionCents(merged.state, "expense"), 1_800);
  assert.equal(merged.correctionsAdded, 2);
  assert.ok(merged.state.entries.find((entry) => entry.note === "备份补差")?.adjustsEntryId);

  const repeatedPreview = await previewGuestFullDataImport(merged.state, [], merged.settings, backup, "merge");
  const repeated = applyGuestFullDataImport(
    merged.state,
    [],
    merged.settings,
    backup,
    "merge",
    "use-backup",
    repeatedPreview.expectedDataRevision,
    repeatedPreview.backupDigest,
  );
  assert.equal(guestCorrectionCents(repeated.state, "expense"), 1_800);
  assert.equal(repeated.correctionsAdded, 0);
});

test("游客收入纠错保存税前与税额差值并写入 v7 备份", () => {
  const initial = loadGuestFinanceLedger({ expenseCorrectionCents: 0, incomeCorrectionCents: 0 });
  const created = createGuestFinanceCorrection(initial, {
    kind: "income",
    amountDeltaCents: 20_000,
    taxDeltaCents: 2_000,
    effectiveDate: "2026-10-20",
    note: "游客收入纠错",
    requestId: `guest-income-tax-${crypto.randomUUID()}`,
    expectedRevision: initial.revision,
  }, { expense: 0, income: 0, grossIncome: 0, tax: 0 }).state;

  assert.equal(guestGrossIncomeCorrectionCents(created), 20_000);
  assert.equal(guestTaxCorrectionCents(created), 2_000);
  assert.equal(guestCorrectionCents(created, "income"), 18_000);
  const backup = exportGuestFullDataBackup(created, [], createDefaultSettings(), []);
  assert.equal(backup.version, 7);
  assert.equal(backup.data.finance.incomeCorrectionCents, 18_000);
  assert.equal(backup.data.finance.incomeTaxCorrectionCents, 2_000);
  assert.deepEqual(
    backup.data.finance.entries.at(-1) && {
      deltaCents: backup.data.finance.entries.at(-1)!.deltaCents,
      taxDeltaCents: backup.data.finance.entries.at(-1)!.taxDeltaCents,
    },
    { deltaCents: 18_000, taxDeltaCents: 2_000 },
  );
});

test("游客覆盖恢复归档旧账本并激活新账本", async () => {
  const source = loadGuestFinanceLedger({ expenseCorrectionCents: 900, incomeCorrectionCents: 300 });
  const target = loadGuestFinanceLedger({ expenseCorrectionCents: 100, incomeCorrectionCents: 0 });
  const backup = exportGuestFullDataBackup(source, [], createDefaultSettings(), []);
  const preview = await previewGuestFullDataImport(target, [], createDefaultSettings(), backup, "replace");
  const restored = applyGuestFullDataImport(
    target,
    [],
    createDefaultSettings(),
    backup,
    "replace",
    "use-backup",
    preview.expectedDataRevision,
    preview.backupDigest,
  );

  assert.equal(guestCorrectionCents(restored.state, "expense"), 900);
  assert.equal(guestCorrectionCents(restored.state, "income"), 300);
  assert.equal(restored.state.ledgers.filter((ledger) => ledger.status === "archived").length, 1);
  assert.notEqual(restored.state.activeLedgerId, target.activeLedgerId);
});

test("游客 v2 账本幂等迁移到 v3 并给旧收入记录补税额 0", () => {
  const values = new Map<string, string>();
  const localStorage: BrowserStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
  Object.defineProperty(globalThis, "window", { value: { localStorage }, configurable: true });
  try {
    localCache.removeItem(GUEST_FINANCE_LEDGER_KEY);
    localCache.setItem("football-simulator-finance-ledger-v2", JSON.stringify({
      version: 2,
      originId: "guest-v2-origin",
      revision: 3,
      activeLedgerId: "guest-v2-ledger",
      ledgers: [{ id: "guest-v2-ledger", status: "active", source: "native", createdAt: "2026-10-01T00:00:00.000Z", archivedAt: null }],
      entries: [{
        id: "guest-v2-entry",
        ledgerId: "guest-v2-ledger",
        originId: "guest-v2-origin",
        originEntryId: "guest-v2-entry",
        requestId: null,
        kind: "income",
        deltaCents: 1_800,
        effectiveDate: null,
        note: "v2 收入",
        source: "manual",
        createdAt: "2026-10-01T00:00:00.000Z",
        sourceCreatedAt: null,
        correctionBeforeCents: 0,
        correctionAfterCents: 1_800,
        revisionAfter: 3,
        adjustsEntryId: null,
      }],
    }));

    const migrated = loadGuestFinanceLedger({ expenseCorrectionCents: 0, incomeCorrectionCents: 0 });
    assert.equal(migrated.version, 3);
    assert.equal(migrated.revision, 3);
    assert.deepEqual({
      amount: migrated.entries[0].amountDeltaCents,
      tax: migrated.entries[0].taxDeltaCents,
      net: migrated.entries[0].netDeltaCents,
      taxBefore: migrated.entries[0].taxCorrectionBeforeCents,
      taxAfter: migrated.entries[0].taxCorrectionAfterCents,
    }, { amount: 1_800, tax: 0, net: 1_800, taxBefore: 0, taxAfter: 0 });
    assert.ok(localCache.getItem(GUEST_FINANCE_LEDGER_KEY));
    assert.equal(loadGuestFinanceLedger({ expenseCorrectionCents: 0, incomeCorrectionCents: 0 }).entries.length, 1);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});
