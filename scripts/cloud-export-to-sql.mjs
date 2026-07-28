#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [, , inputArgument, outputArgument] = process.argv;

if (!inputArgument || !outputArgument) {
  console.error("Usage: node scripts/cloud-export-to-sql.mjs <export.json> <output.sql>");
  process.exit(1);
}

const allowedColumns = {
  users: [
    "id",
    "auth_subject",
    "account",
    "normalized_account",
    "role",
    "created_at",
    "updated_at",
  ],
  user_states: [
    "user_id",
    "settings_json",
    "expense_cents",
    "income_cents",
    "revision",
    "updated_at",
  ],
  user_orders: [
    "user_id",
    "order_id",
    "saved_at",
    "data_json",
    "updated_at",
  ],
  shared_matches: [
    "match_id",
    "business_date",
    "data_json",
    "updated_by",
    "updated_at",
  ],
};

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Export contains a non-finite number");
    return String(value);
  }
  if (typeof value !== "string") {
    throw new Error(`Unsupported exported value type: ${typeof value}`);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

const inputPath = resolve(inputArgument);
const outputPath = resolve(outputArgument);
const payload = JSON.parse(await readFile(inputPath, "utf8"));

if (payload?.format !== "smgr-d1-export" || payload?.version !== 1 || !Array.isArray(payload.tables)) {
  throw new Error("Invalid SMGR D1 export");
}

const tables = new Map(payload.tables.map((table) => [table.name, table.rows]));
const statements = [];

for (const [tableName, columns] of Object.entries(allowedColumns)) {
  const rows = tables.get(tableName);
  if (!Array.isArray(rows)) throw new Error(`Export is missing table: ${tableName}`);

  for (const row of rows) {
    const values = columns.map((column) => sqlValue(row[column]));
    statements.push(
      `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${values.join(", ")});`,
    );
  }
}

statements.push("");
await writeFile(outputPath, statements.join("\n"), "utf8");

const counts = Object.fromEntries(
  Object.keys(allowedColumns).map((tableName) => [tableName, tables.get(tableName).length]),
);
console.log(JSON.stringify({ outputPath, counts }));
