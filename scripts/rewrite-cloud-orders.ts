#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  compactOrderSummary,
  isCompactOrder,
  isSavedSlipLike,
  normalizeCompactOrder,
  savedSlipToCompactOrder,
  type CompactOrder,
} from "../app/order-model";

type D1JsonResponse<T> = Array<{
  results?: T[];
  success?: boolean;
}>;

type OrderRow = {
  user_id: string;
  order_id: string;
  saved_at: string;
  data_json: string;
  updated_at: string;
};

type StateRow = {
  user_id: string;
  expense_cents: number;
  income_cents: number;
};

const args = new Set(process.argv.slice(2));
const remote = args.has("--remote");
const database = process.env.D1_DATABASE || "smgr-cloud";
const backupDir = process.env.ORDER_REWRITE_BACKUP_DIR || ".wrangler/order-rewrite-backups";
const now = new Date().toISOString();

const wrangler = (extraArgs: string[]) => execFileSync("npx", [
  "wrangler",
  "d1",
  "execute",
  database,
  ...(remote ? ["--remote"] : []),
  "--json",
  ...extraArgs,
], {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 128 * 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
});

const query = <T>(sql: string): T[] => {
  const output = wrangler(["--command", sql]);
  const parsed = JSON.parse(output) as D1JsonResponse<T>;
  return parsed.flatMap((item) => item.results ?? []);
};

const quote = (value: string | null | undefined) => (
  value === null || value === undefined ? "NULL" : `'${value.replace(/'/g, "''")}'`
);

const numberValue = (value: number | null | undefined) => (
  value === null || value === undefined ? "NULL" : String(Math.round(value))
);

const toCents = (value: number) => Math.round(Number(value || 0) * 100);

const states = query<StateRow>(`
SELECT
  user_id,
  expense_correction_cents AS expense_cents,
  income_correction_cents AS income_cents
FROM user_finance_corrections
ORDER BY user_id
`);
const orders = query<OrderRow>("SELECT user_id, order_id, saved_at, data_json, updated_at FROM user_orders ORDER BY user_id, saved_at, order_id");

mkdirSync(backupDir, { recursive: true });
const backupFile = join(backupDir, `${remote ? "remote" : "local"}-${now.replace(/[:.]/g, "-")}.json`);
writeFileSync(backupFile, JSON.stringify({ exportedAt: now, states, orders }, null, 2));

const financeByUser = new Map<string, { expenseCents: number; incomeCents: number }>();
const updateStatements: string[] = [];
let legacyOrderCount = 0;

orders.forEach((row) => {
  const parsed = JSON.parse(row.data_json) as unknown;
  let compact: CompactOrder;
  if (isCompactOrder(parsed)) {
    compact = normalizeCompactOrder(parsed);
  } else if (isSavedSlipLike(parsed)) {
    legacyOrderCount += 1;
    compact = savedSlipToCompactOrder({ ...parsed, id: row.order_id, updatedAt: row.updated_at });
  } else {
    throw new Error(`订单 ${row.user_id}/${row.order_id} 数据结构无法转换`);
  }
  compact = normalizeCompactOrder({
    ...compact,
    id: compact.id || row.order_id,
    savedAt: compact.savedAt || row.saved_at,
    updatedAt: row.updated_at,
  });
  const summary = compactOrderSummary(compact);
  const userFinance = financeByUser.get(row.user_id) ?? { expenseCents: 0, incomeCents: 0 };
  userFinance.expenseCents += toCents(summary.stake);
  if (compact.settledAt) userFinance.incomeCents += toCents(compact.settledPrize ?? 0);
  financeByUser.set(row.user_id, userFinance);
  const matchIdsJson = JSON.stringify([...new Set(compact.selections.map((selection) => selection.matchId))]);
  updateStatements.push(`
UPDATE user_orders
SET name = ${quote(compact.name)},
    saved_at = ${quote(compact.savedAt)},
    settled_at = ${quote(compact.settledAt)},
    settled_prize_cents = ${numberValue(compact.settledAt ? toCents(compact.settledPrize ?? 0) : null)},
    stake_cents = ${numberValue(toCents(summary.stake))},
    status = ${quote(summary.status)},
    match_ids_json = ${quote(matchIdsJson)},
    data_json = ${quote(JSON.stringify(compact))},
    updated_at = ${quote(row.updated_at)}
WHERE user_id = ${quote(row.user_id)} AND order_id = ${quote(row.order_id)};
`);
});

if (legacyOrderCount > 0) {
  states.forEach((state) => {
    const totals = financeByUser.get(state.user_id) ?? { expenseCents: 0, incomeCents: 0 };
    updateStatements.push(`
UPDATE user_finance_corrections
SET expense_correction_cents = ${numberValue(Math.round(Number(state.expense_cents ?? 0)) - totals.expenseCents)},
    income_correction_cents = ${numberValue(Math.round(Number(state.income_cents ?? 0)) - totals.incomeCents)},
    updated_at = ${quote(now)}
WHERE user_id = ${quote(state.user_id)};
`);
  });
}

const migrationSql = updateStatements.length > 0
  ? updateStatements.join("\n")
  : "-- No order rewrite needed.\n";

const sqlFile = join(backupDir, `${remote ? "remote" : "local"}-${now.replace(/[:.]/g, "-")}.sql`);
writeFileSync(sqlFile, migrationSql);

if (args.has("--dry-run")) {
  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    backupFile,
    sqlFile,
    orders: orders.length,
    legacyOrders: legacyOrderCount,
    users: states.length,
  }, null, 2));
  process.exit(0);
}

wrangler(["--file", sqlFile]);

const rewritten = query<{ total: number }>("SELECT COUNT(*) AS total FROM user_orders WHERE data_json LIKE '%\"selections\"%'");
const rewrittenCount = Number(rewritten[0]?.total ?? 0);
if (rewrittenCount !== orders.length) {
  throw new Error(`订单重写校验失败：期望 ${orders.length}，实际 ${rewrittenCount}`);
}

console.log(JSON.stringify({
  ok: true,
  backupFile,
  sqlFile,
  orders: orders.length,
  legacyOrders: legacyOrderCount,
  users: states.length,
}, null, 2));
