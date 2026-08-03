import { calculateCurrentPrize } from "../calculator";
import {
  compactOrderSummary,
  compactOrderToSavedSlip,
  isCompactOrder,
  normalizeCompactOrder,
  savedSlipToCompactOrder,
  type CompactOrder,
} from "../order-model";
import type { SavedSlip } from "../types";
import { refreshSelectedOdds } from "../sporttery";
import type { MatchItem } from "../types";
import { parseJson } from "../cloud-server";
import { httpError, orderConflict } from "./errors";
import { fromCents, toCents } from "./money";

export type OrderProgressQuery = "settled" | "unsettled" | null;
export type OrdersQuery = {
  from?: string | null;
  to?: string | null;
  progress?: OrderProgressQuery;
  statuses?: string[];
  limit?: number;
  offset?: number;
};

export type OrderRef = {
  id: string;
  updatedAt?: string;
};

export type OrdersListResponse = {
  orders: CompactOrder[];
  total: number;
  unsettledCount: number;
};

type OrderRow = {
  order_id: string;
  data_json: string;
  updated_at: string;
};

type CountRow = {
  total: number;
};

const MAX_ORDER_BYTES = 1_500_000;
const MAX_ORDER_LIMIT = 500;
const VALID_STATUSES = new Set(["success", "hopeful", "failed"]);

const unique = <T,>(values: T[]) => [...new Set(values)];

export function parseOrderJson(value: string): CompactOrder | null {
  const parsed = parseJson<unknown>(value, null);
  if (isCompactOrder(parsed)) return normalizeCompactOrder(parsed);
  if (parsed && typeof parsed === "object" && "matches" in parsed) {
    return savedSlipToCompactOrder(parsed as SavedSlip);
  }
  return null;
}

function prepareStoredOrder(order: CompactOrder, now = new Date().toISOString()) {
  const stored = normalizeCompactOrder({ ...order, updatedAt: now });
  const json = JSON.stringify(stored);
  if (new TextEncoder().encode(json).byteLength > MAX_ORDER_BYTES) {
    throw httpError(`订单“${stored.name}”的数据过大，无法保存`, 400);
  }
  const summary = compactOrderSummary(stored);
  return {
    order: stored,
    json,
    summary,
    matchIdsJson: JSON.stringify(unique(stored.selections.map((selection) => selection.matchId))),
  };
}

async function currentOrderVersion(d1: D1Database, userId: string, orderId: string) {
  return d1.prepare(`
    SELECT updated_at AS updatedAt
    FROM user_orders
    WHERE user_id = ?1 AND order_id = ?2
  `).bind(userId, orderId).first<{ updatedAt: string }>();
}

async function writePreparedOrder(
  d1: D1Database,
  userId: string,
  prepared: ReturnType<typeof prepareStoredOrder>,
) {
  const { order, json, summary, matchIdsJson } = prepared;
  await d1.prepare(`
    INSERT INTO user_orders (
      user_id, order_id, name, saved_at, settled_at, settled_prize_cents,
      stake_cents, status, match_ids_json, data_json, updated_at
    )
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    ON CONFLICT(user_id, order_id) DO UPDATE SET
      name = excluded.name,
      saved_at = excluded.saved_at,
      settled_at = excluded.settled_at,
      settled_prize_cents = excluded.settled_prize_cents,
      stake_cents = excluded.stake_cents,
      status = excluded.status,
      match_ids_json = excluded.match_ids_json,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
  `).bind(
    userId,
    order.id,
    order.name,
    order.savedAt,
    order.settledAt ?? null,
    typeof order.settledPrize === "number" ? toCents(order.settledPrize) : null,
    toCents(summary.stake),
    summary.status,
    matchIdsJson,
    json,
    order.updatedAt ?? new Date().toISOString(),
  ).run();
  return order;
}

export async function createOrder(d1: D1Database, userId: string, rawOrder: CompactOrder | SavedSlip) {
  const order = normalizeCompactOrder(rawOrder);
  const existing = await currentOrderVersion(d1, userId, order.id);
  if (existing) throw orderConflict([order.id]);
  return writePreparedOrder(d1, userId, prepareStoredOrder(order));
}

export async function updateOrder(
  d1: D1Database,
  userId: string,
  orderId: string,
  rawOrder: CompactOrder | SavedSlip,
  expectedUpdatedAt?: string,
) {
  const order = normalizeCompactOrder({ ...rawOrder, id: orderId } as CompactOrder);
  const existing = await currentOrderVersion(d1, userId, orderId);
  if (!existing || !expectedUpdatedAt || existing.updatedAt !== expectedUpdatedAt) {
    throw orderConflict([orderId]);
  }
  return writePreparedOrder(d1, userId, prepareStoredOrder(order));
}

export async function deleteOrder(
  d1: D1Database,
  userId: string,
  orderId: string,
  expectedUpdatedAt?: string,
) {
  const existing = await currentOrderVersion(d1, userId, orderId);
  if (!existing) return { deletedOrderId: orderId };
  if (!expectedUpdatedAt || existing.updatedAt !== expectedUpdatedAt) throw orderConflict([orderId]);
  await d1.prepare(`
    DELETE FROM user_orders
    WHERE user_id = ?1 AND order_id = ?2
  `).bind(userId, orderId).run();
  return { deletedOrderId: orderId };
}

export async function getOrder(d1: D1Database, userId: string, orderId: string) {
  const row = await d1.prepare(`
    SELECT order_id, data_json, updated_at
    FROM user_orders
    WHERE user_id = ?1 AND order_id = ?2
  `).bind(userId, orderId).first<OrderRow>();
  if (!row) throw httpError("找不到订单", 404);
  const order = parseOrderJson(row.data_json);
  if (!order) throw httpError("订单数据结构异常", 500);
  return { ...order, id: order.id || row.order_id, updatedAt: row.updated_at };
}

function ordersWhereClause(query: OrdersQuery) {
  const conditions = ["user_id = ?"];
  const params: unknown[] = [];
  if (query.from) {
    conditions.push("substr(saved_at, 1, 10) >= ?");
    params.push(query.from);
  }
  if (query.to) {
    conditions.push("substr(saved_at, 1, 10) <= ?");
    params.push(query.to);
  }
  if (query.progress === "settled") conditions.push("settled_at IS NOT NULL");
  if (query.progress === "unsettled") conditions.push("settled_at IS NULL");
  const statuses = unique((query.statuses ?? []).filter((status) => VALID_STATUSES.has(status)));
  if (statuses.length > 0) {
    conditions.push("status IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(statuses));
  }
  return {
    clause: conditions.join(" AND "),
    params,
  };
}

export async function listOrders(d1: D1Database, userId: string, query: OrdersQuery = {}): Promise<OrdersListResponse> {
  const limit = Math.min(Math.max(Math.round(Number(query.limit ?? MAX_ORDER_LIMIT)), 1), MAX_ORDER_LIMIT);
  const offset = Math.max(Math.round(Number(query.offset ?? 0)), 0);
  const where = ordersWhereClause(query);
  const rows = await d1.prepare(`
    SELECT order_id, data_json, updated_at
    FROM user_orders
    WHERE ${where.clause}
    ORDER BY saved_at DESC, order_id DESC
    LIMIT ? OFFSET ?
  `).bind(userId, ...where.params, limit, offset).all<OrderRow>();
  const total = await d1.prepare(`
    SELECT COUNT(*) AS total
    FROM user_orders
    WHERE ${where.clause}
  `).bind(userId, ...where.params).first<CountRow>();
  const unsettled = await d1.prepare(`
    SELECT COUNT(*) AS total
    FROM user_orders
    WHERE user_id = ?1 AND settled_at IS NULL
  `).bind(userId).first<CountRow>();
  return {
    orders: (rows.results ?? []).flatMap((row) => {
      const order = parseOrderJson(row.data_json);
      return order ? [{ ...order, id: order.id || row.order_id, updatedAt: row.updated_at }] : [];
    }),
    total: Number(total?.total ?? 0),
    unsettledCount: Number(unsettled?.total ?? 0),
  };
}

async function getOrdersByRefs(d1: D1Database, userId: string, refs: OrderRef[]): Promise<CompactOrder[]> {
  const ids = unique(refs.map((ref) => ref.id).filter(Boolean));
  if (ids.length === 0) return [];
  const rows = await d1.prepare(`
    SELECT order_id, data_json, updated_at
    FROM user_orders
    WHERE user_id = ?1
      AND order_id IN (SELECT value FROM json_each(?2))
  `).bind(userId, JSON.stringify(ids)).all<OrderRow>();
  const found = new Map<string, CompactOrder>();
  for (const row of rows.results ?? []) {
    const order = parseOrderJson(row.data_json);
    if (order) found.set(row.order_id, { ...order, id: order.id || row.order_id, updatedAt: row.updated_at });
  }
  const conflicts = refs.flatMap((ref) => {
    const order = found.get(ref.id);
    if (!order) return [ref.id];
    return ref.updatedAt && order.updatedAt === ref.updatedAt ? [] : [ref.id];
  });
  if (conflicts.length > 0) throw orderConflict(conflicts);
  const ordered: CompactOrder[] = [];
  for (const ref of refs) {
    const order = found.get(ref.id);
    if (order) ordered.push(order);
  }
  return ordered;
}

export async function settleOrders(d1: D1Database, userId: string, refs: OrderRef[]) {
  const now = new Date().toISOString();
  const orders = await getOrdersByRefs(d1, userId, refs);
  const settled: CompactOrder[] = [];
  for (const order of orders) {
    if (order.settledAt) continue;
    const slip = compactOrderToSavedSlip(order);
    const settledPrize = calculateCurrentPrize(slip.matches, slip.passes, slip.multiple, slip.hits ?? {});
    const next: CompactOrder = {
      ...order,
      settledAt: now,
      settledPrize,
      oddsLockedBeforeSettlement: Boolean(order.oddsLocked),
      oddsLocked: true,
    };
    settled.push(await writePreparedOrder(d1, userId, prepareStoredOrder(next, now)));
  }
  return settled;
}

export async function withdrawOrderSettlement(d1: D1Database, userId: string, ref: OrderRef) {
  const [order] = await getOrdersByRefs(d1, userId, [ref]);
  if (!order) throw httpError("找不到订单", 404);
  if (!order.settledAt) return order;
  const next: CompactOrder = {
    ...order,
    settledAt: undefined,
    settledPrize: undefined,
    oddsLocked: order.oddsLockedBeforeSettlement ?? false,
    oddsLockedBeforeSettlement: undefined,
  };
  return writePreparedOrder(d1, userId, prepareStoredOrder(next));
}

export async function saveOrderResults(
  d1: D1Database,
  userId: string,
  orderId: string,
  payload: {
    hits?: CompactOrder["hits"];
    resultValues?: CompactOrder["resultValues"];
    failedMatchIds?: string[];
    expectedUpdatedAt?: string;
  },
) {
  const [order] = await getOrdersByRefs(d1, userId, [{ id: orderId, updatedAt: payload.expectedUpdatedAt }]);
  if (!order) throw httpError("找不到订单", 404);
  if (order.settledAt) throw httpError("该订单已结账，命中结果已锁定", 409);
  const next: CompactOrder = {
    ...order,
    ...(payload.hits ? { hits: payload.hits } : {}),
    ...(payload.resultValues ? { resultValues: payload.resultValues } : {}),
    failedMatchIds: [...new Set(payload.failedMatchIds ?? [])],
  };
  return writePreparedOrder(d1, userId, prepareStoredOrder(next));
}

export async function lockOrders(d1: D1Database, userId: string, refs: OrderRef[]) {
  const orders = await getOrdersByRefs(d1, userId, refs);
  const updated: CompactOrder[] = [];
  for (const order of orders) {
    if (order.oddsLocked || order.settledAt) continue;
    updated.push(await writePreparedOrder(d1, userId, prepareStoredOrder({ ...order, oddsLocked: true })));
  }
  return updated;
}

export async function refreshOrderOdds(
  d1: D1Database,
  userId: string,
  refs: OrderRef[],
  latestMatches: MatchItem[],
) {
  const orders = await getOrdersByRefs(d1, userId, refs);
  let matchedOptionCount = 0;
  let changedOptionCount = 0;
  let unmatchedOptionCount = 0;
  const updated: CompactOrder[] = [];
  for (const order of orders) {
    if (order.oddsLocked || order.settledAt) continue;
    const slip = compactOrderToSavedSlip(order);
    const refreshed = refreshSelectedOdds(slip.matches, latestMatches);
    matchedOptionCount += refreshed.matchedOptionCount;
    changedOptionCount += refreshed.changedOptionCount;
    unmatchedOptionCount += refreshed.unmatchedOptionCount;
    if (refreshed.matches === slip.matches) continue;
    updated.push(await writePreparedOrder(d1, userId, prepareStoredOrder(
      savedSlipToCompactOrder({ ...slip, matches: refreshed.matches }),
    )));
  }
  return {
    orders: updated,
    matchedOptionCount,
    changedOptionCount,
    unmatchedOptionCount,
  };
}

export function compactOrdersToSavedSlips(orders: CompactOrder[]) {
  return orders.map(compactOrderToSavedSlip);
}

export function financePreviewForOrders(orders: CompactOrder[]) {
  return orders.reduce((totals, order) => {
    const summary = compactOrderSummary(order);
    totals.expense += summary.stake;
    if (order.settledAt) totals.income += fromCents(toCents(order.settledPrize ?? 0));
    return totals;
  }, { expense: 0, income: 0 });
}
