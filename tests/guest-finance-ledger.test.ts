import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGuestFullDataImport,
  createGuestFinanceCorrection,
  exportGuestFullDataBackup,
  guestCorrectionCents,
  loadGuestFinanceLedger,
  previewGuestFullDataImport,
} from "../app/guest-finance-ledger";
import { createDefaultSettings } from "../app/settings";

test("游客 v6 合并可保留或补齐旧初值，重复导入不重复累计", async () => {
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
