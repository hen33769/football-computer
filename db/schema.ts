import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
});

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
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

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
