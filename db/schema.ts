import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  authSubject: text("auth_subject").notNull().unique(),
  account: text("account").notNull(),
  normalizedAccount: text("normalized_account").notNull().unique(),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const accountSessions = sqliteTable("account_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  index("account_sessions_user_idx").on(table.userId),
  index("account_sessions_expires_idx").on(table.expiresAt),
]);

export const userOrders = sqliteTable("user_orders", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orderId: text("order_id").notNull(),
  name: text("name").notNull().default(""),
  savedAt: text("saved_at").notNull(),
  settledAt: text("settled_at"),
  settledPrizeCents: integer("settled_prize_cents"),
  taxCents: integer("tax_cents"),
  confirmedAt: text("confirmed_at"),
  paymentStatus: text("payment_status", { enum: ["unpaid", "paid"] }).notNull().default("unpaid"),
  stakeCents: integer("stake_cents").notNull().default(0),
  status: text("status", { enum: ["success", "hopeful", "failed"] }).notNull().default("hopeful"),
  matchIdsJson: text("match_ids_json").notNull().default("[]"),
  dataJson: text("data_json").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.userId, table.orderId] }),
  index("user_orders_user_saved_idx").on(table.userId, table.savedAt),
  index("user_orders_user_progress_idx").on(table.userId, table.settledAt, table.savedAt),
  index("user_orders_user_status_idx").on(table.userId, table.status, table.savedAt),
]);

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  settingsJson: text("settings_json").notNull().default("{}"),
  revision: integer("revision").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const userFinanceCorrections = sqliteTable("user_finance_corrections", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  expenseCorrectionCents: integer("expense_correction_cents").notNull().default(0),
  incomeCorrectionCents: integer("income_correction_cents").notNull().default(0),
  revision: integer("revision").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  activeLedgerId: text("active_ledger_id"),
});

export const userPersonalDataRevisions = sqliteTable("user_personal_data_revisions", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(0),
  originId: text("origin_id").notNull().unique(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const userFinanceLedgers = sqliteTable("user_finance_ledgers", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  source: text("source").notNull().default("native"),
  restoreOperationId: text("restore_operation_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  archivedAt: text("archived_at"),
}, (table) => [
  index("user_finance_ledgers_user_status_idx").on(table.userId, table.status, table.createdAt),
  uniqueIndex("user_finance_ledgers_active_unique").on(table.userId).where(sql`${table.status} = 'active'`),
]);

export const userFinanceCorrectionEntries = sqliteTable("user_finance_correction_entries", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ledgerId: text("ledger_id").notNull().references(() => userFinanceLedgers.id, { onDelete: "cascade" }),
  originId: text("origin_id").notNull(),
  originEntryId: text("origin_entry_id").notNull(),
  kind: text("kind", { enum: ["expense", "income"] }).notNull(),
  deltaCents: integer("delta_cents").notNull(),
  effectiveDate: text("effective_date"),
  note: text("note").notNull().default(""),
  source: text("source").notNull().default("manual"),
  requestId: text("request_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  sourceCreatedAt: text("source_created_at"),
  correctionBeforeCents: integer("correction_before_cents").notNull(),
  correctionAfterCents: integer("correction_after_cents").notNull(),
  revisionAfter: integer("revision_after").notNull(),
  adjustsEntryId: text("adjusts_entry_id").references(
    (): AnySQLiteColumn => userFinanceCorrectionEntries.id,
    { onDelete: "restrict" },
  ),
}, (table) => [
  uniqueIndex("user_finance_entries_origin_unique").on(table.ledgerId, table.originId, table.originEntryId),
  uniqueIndex("user_finance_entries_request_unique").on(table.userId, table.requestId).where(sql`${table.requestId} IS NOT NULL`),
  index("user_finance_entries_history_idx").on(table.userId, table.ledgerId, table.createdAt, table.id),
  index("user_finance_entries_trend_idx").on(table.ledgerId, table.effectiveDate, table.kind),
]);

export const userDataImportOperations = sqliteTable("user_data_import_operations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestId: text("request_id").notNull(),
  payloadDigest: text("payload_digest").notNull(),
  strategy: text("strategy", { enum: ["merge", "replace"] }).notNull(),
  expectedDataRevision: integer("expected_data_revision").notNull(),
  status: text("status", { enum: ["staging", "completed", "failed"] }).notNull().default("staging"),
  resultJson: text("result_json"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("user_data_import_operations_request_unique").on(table.userId, table.requestId),
  index("user_data_import_operations_status_idx").on(table.status, table.updatedAt),
]);

export const userDataImportStaging = sqliteTable("user_data_import_staging", {
  operationId: text("operation_id").notNull().references(() => userDataImportOperations.id, { onDelete: "cascade" }),
  recordKind: text("record_kind").notNull(),
  recordKey: text("record_key").notNull(),
  payloadJson: text("payload_json").notNull(),
}, (table) => [
  primaryKey({ columns: [table.operationId, table.recordKind, table.recordKey] }),
  index("user_data_import_staging_operation_idx").on(table.operationId, table.recordKind),
]);

export const userMatchNotes = sqliteTable("user_match_notes", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  matchId: text("match_id").notNull(),
  note: text("note").notNull().default(""),
  revision: integer("revision").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.userId, table.matchId] }),
]);

export const userTeamTags = sqliteTable("user_team_tags", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  shortText: text("short_text").notNull().default(""),
  color: text("color").notNull(),
  dateBasis: text("date_basis", { enum: ["current", "match"] }).notNull().default("current"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  displayOrder: integer("display_order").notNull().default(0),
  revision: integer("revision").notNull().default(0),
  mutationToken: text("mutation_token").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("user_team_tags_user_order_idx").on(table.userId, table.displayOrder, table.id)]);

export const userTeamTagMembers = sqliteTable("user_team_tag_members", {
  id: text("id").primaryKey(),
  tagId: text("tag_id").notNull().references(() => userTeamTags.id, { onDelete: "cascade" }),
  sourceName: text("source_name").notNull(),
  sourceNameKey: text("source_name_key").notNull(),
  teamGroupId: text("team_group_id"),
  note: text("note").notNull().default(""),
  displayOrder: integer("display_order").notNull().default(0),
  revision: integer("revision").notNull().default(0),
  mutationToken: text("mutation_token").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("user_team_tag_members_name_unique").on(table.tagId, table.sourceNameKey),
  index("user_team_tag_members_tag_order_idx").on(table.tagId, table.displayOrder, table.id),
]);

export const teamTagShares = sqliteTable("team_tag_shares", {
  id: text("id").primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sourceTagId: text("source_tag_id"),
  snapshotVersion: integer("snapshot_version").notNull().default(1),
  snapshotJson: text("snapshot_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  index("team_tag_shares_owner_created_idx").on(table.ownerId, table.createdAt),
  index("team_tag_shares_expires_idx").on(table.expiresAt),
]);

export const userTeamTagImports = sqliteTable("user_team_tag_imports", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  shareId: text("share_id").notNull().references(() => teamTagShares.id, { onDelete: "cascade" }),
  requestId: text("request_id").notNull(),
  targetTagId: text("target_tag_id").references(() => userTeamTags.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("user_team_tag_imports_share_unique").on(table.userId, table.shareId),
  uniqueIndex("user_team_tag_imports_request_unique").on(table.userId, table.requestId),
]);

export const teamTagImportRateLimits = sqliteTable("team_tag_import_rate_limits", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  windowStart: text("window_start").notNull(),
  attempts: integer("attempts").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.userId, table.windowStart] }),
  index("team_tag_import_rate_limits_window_idx").on(table.windowStart),
]);

export const sharedMatches = sqliteTable("shared_matches", {
  matchId: text("match_id").primaryKey(),
  businessDate: text("business_date").notNull(),
  dataJson: text("data_json").notNull(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("shared_matches_date_idx").on(table.businessDate),
]);

export const matchRefreshStates = sqliteTable("match_refresh_states", {
  id: text("id").primaryKey(),
  mode: text("mode", { enum: ["morning", "standard"] }).notNull().default("standard"),
  source: text("source", { enum: ["official", "snapshot", "cleanup"] }).notNull().default("official"),
  lastUpdateTime: text("last_update_time").notNull().default(""),
  fixedBonusFailureCount: integer("fixed_bonus_failure_count").notNull().default(0),
  lastRefreshStartedAt: text("last_refresh_started_at"),
  lastRefreshFinishedAt: text("last_refresh_finished_at"),
  refreshLockUntil: text("refresh_lock_until"),
  error: text("error"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sharedTeamNameGroups = sqliteTable("shared_team_name_groups", {
  id: text("id").primaryKey(),
  iconDataUrl: text("icon_data_url"),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  displayOrder: integer("display_order").notNull().default(0),
}, (table) => [
  index("shared_team_name_groups_order_idx").on(table.displayOrder),
]);

export const sharedTeamNames = sqliteTable("shared_team_names", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => sharedTeamNameGroups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull(),
  activeSlot: integer("active_slot"),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("shared_team_names_group_idx").on(table.groupId),
  uniqueIndex("shared_team_names_group_slot_unique").on(table.groupId, table.activeSlot),
]);
