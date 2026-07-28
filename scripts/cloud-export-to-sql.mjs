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

const primaryKeyColumns = {
  users: ["id"],
  user_states: ["user_id"],
  user_orders: ["user_id", "order_id"],
  shared_matches: ["match_id"],
};

const chunkableColumns = new Set(["settings_json", "data_json"]);
const MAX_RAW_CHUNK_BYTES = 35_000;

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

function splitUtf8(value) {
  const chunks = [];
  let current = "";
  let currentBytes = 0;

  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (current && currentBytes + characterBytes > MAX_RAW_CHUNK_BYTES) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }

  if (current || value === "") chunks.push(current);
  return chunks;
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
    const chunkedValues = new Map();
    const values = columns.map((column) => {
      const value = row[column];
      if (
        chunkableColumns.has(column)
        && typeof value === "string"
        && Buffer.byteLength(value) > MAX_RAW_CHUNK_BYTES
      ) {
        chunkedValues.set(column, splitUtf8(value));
        return "''";
      }
      return sqlValue(value);
    });
    statements.push(
      `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${values.join(", ")});`,
    );

    const keyPredicate = primaryKeyColumns[tableName]
      .map((column) => `${column} = ${sqlValue(row[column])}`)
      .join(" AND ");
    for (const [column, chunks] of chunkedValues) {
      for (const chunk of chunks) {
        statements.push(
          `UPDATE ${tableName} SET ${column} = ${column} || ${sqlValue(chunk)} WHERE ${keyPredicate};`,
        );
      }
    }
  }
}

statements.push("");
await writeFile(outputPath, statements.join("\n"), "utf8");

const counts = Object.fromEntries(
  Object.keys(allowedColumns).map((tableName) => [tableName, tables.get(tableName).length]),
);
console.log(JSON.stringify({ outputPath, counts }));
