import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createFinanceCorrectionEntry,
  getFinanceState,
  listFinanceCorrectionEntries,
} from "../app/server/finance-service";
import { SqliteD1 } from "./helpers/sqlite-d1";

function setup() {
  const db = new SqliteD1();
  db.database.exec(`
    INSERT INTO users (id, auth_subject, account, normalized_account) VALUES
      ('user-a','subject-a','user-a','user-a'),('user-b','subject-b','user-b','user-b')
  `);
  return db;
}

test("纠错按差值追加并保留日期、备注和补差关系", async () => {
  const db = setup();
  const d1 = db.asD1();
  const first = await createFinanceCorrectionEntry(d1, "user-a", {
    kind: "income",
    deltaCents: 20_000,
    effectiveDate: "2026-10-20",
    note: "首次记录",
    requestId: "request-1",
    expectedRevision: 0,
  }, new Date("2026-10-28T01:00:00.000Z"));
  const second = await createFinanceCorrectionEntry(d1, "user-a", {
    kind: "income",
    deltaCents: -2_000,
    effectiveDate: "2026-10-20",
    note: "补差",
    requestId: "request-2",
    expectedRevision: first.finance.revision,
    adjustsEntryId: first.entry.id,
  }, new Date("2026-10-28T02:00:00.000Z"));

  assert.equal(second.finance.income.correction, 180);
  assert.equal(second.finance.income.total, 180);
  assert.equal(second.entry.adjustsEntryId, first.entry.id);
  assert.equal(second.entry.correctionBeforeCents, 20_000);
  assert.equal(second.entry.correctionAfterCents, 18_000);
  const page = await listFinanceCorrectionEntries(d1, "user-a");
  assert.deepEqual(page.entries.map((entry) => entry.note), ["补差", "首次记录"]);
  assert.equal(page.entries[0].effectiveDate, "2026-10-20");
});

test("相同 requestId 只入账一次且不同内容冲突", async () => {
  const db = setup();
  const input = {
    kind: "expense" as const,
    deltaCents: 500,
    effectiveDate: null,
    note: "初值",
    requestId: "same-request",
    expectedRevision: 0,
  };
  const first = await createFinanceCorrectionEntry(db.asD1(), "user-a", input);
  const repeated = await createFinanceCorrectionEntry(db.asD1(), "user-a", input);
  assert.equal(repeated.entry.id, first.entry.id);
  assert.equal(repeated.finance.expense.correction, 5);
  await assert.rejects(
    createFinanceCorrectionEntry(db.asD1(), "user-a", { ...input, deltaCents: 600 }),
    (error: Error & { status?: number }) => error.status === 409,
  );
});

test("纠错校验未来日期、全局负余额、用户隔离和 revision", async () => {
  const db = setup();
  const d1 = db.asD1();
  await assert.rejects(createFinanceCorrectionEntry(d1, "user-a", {
    kind: "income", deltaCents: 100, effectiveDate: "2026-10-29", note: "", requestId: "future", expectedRevision: 0,
  }, new Date("2026-10-28T00:00:00.000Z")), /不能晚于今天/);
  await assert.rejects(createFinanceCorrectionEntry(d1, "user-a", {
    kind: "expense", deltaCents: -1, effectiveDate: null, note: "", requestId: "negative", expectedRevision: 0,
  }), /不能小于 0/);
  const saved = await createFinanceCorrectionEntry(d1, "user-a", {
    kind: "expense", deltaCents: 100, effectiveDate: null, note: "", requestId: "valid", expectedRevision: 0,
  });
  await assert.rejects(createFinanceCorrectionEntry(d1, "user-a", {
    kind: "expense", deltaCents: 100, effectiveDate: null, note: "", requestId: "stale", expectedRevision: 0,
  }), (error: Error & { status?: number }) => error.status === 409);
  assert.equal((await getFinanceState(d1, "user-b")).expense.correction, 0);
  assert.equal(saved.finance.dataRevision, 1);
});

test("0013 迁移把旧非零纠错保存为无日期初值记录", () => {
  const database = new DatabaseSync(":memory:");
  for (const migration of [
    "0000_white_iron_lad",
    "0001_colorful_franklin_richards",
    "0002_modular_cloud_data",
    "0003_order_payment_status",
    "0004_shared_team_names",
    "0005_team_group_icons",
    "0006_team_group_display_order",
    "0007_user_match_notes",
    "0008_user_team_tags",
    "0009_team_tag_import_rate_limits",
    "0010_team_tag_mutation_tokens",
    "0011_order_tax",
    "0012_order_confirmation",
  ]) database.exec(readFileSync(new URL(`../drizzle/${migration}.sql`, import.meta.url), "utf8"));
  database.exec(`
    INSERT INTO users (id, auth_subject, account, normalized_account)
    VALUES ('legacy-user','legacy-subject','legacy','legacy');
    INSERT INTO user_finance_corrections
      (user_id, expense_correction_cents, income_correction_cents, revision, updated_at)
    VALUES ('legacy-user', 125, -50, 2, '2026-10-01T00:00:00Z');
  `);
  database.exec(readFileSync(new URL("../drizzle/0013_finance_correction_ledger.sql", import.meta.url), "utf8"));

  const rows = (database.prepare(`
    SELECT kind, delta_cents, effective_date, source, source_created_at
    FROM user_finance_correction_entries
    WHERE user_id = 'legacy-user'
    ORDER BY kind
  `).all() as Array<Record<string, unknown>>).map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { kind: "expense", delta_cents: 125, effective_date: null, source: "legacy-migration", source_created_at: "2026-10-01T00:00:00Z" },
    { kind: "income", delta_cents: -50, effective_date: null, source: "legacy-migration", source_created_at: "2026-10-01T00:00:00Z" },
  ]);
});
