import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  authSubject: text("auth_subject").notNull().unique(),
  account: text("account").notNull(),
  normalizedAccount: text("normalized_account").notNull().unique(),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const userStates = sqliteTable("user_states", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  settingsJson: text("settings_json").notNull().default("{}"),
  expenseCents: integer("expense_cents").notNull().default(0),
  incomeCents: integer("income_cents").notNull().default(0),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const userOrders = sqliteTable("user_orders", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orderId: text("order_id").notNull(),
  savedAt: text("saved_at").notNull(),
  dataJson: text("data_json").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.userId, table.orderId] }),
  index("user_orders_user_saved_idx").on(table.userId, table.savedAt),
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
