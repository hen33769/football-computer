import { calculateCurrentPrize } from "../calculator";
import {
  compactOrderSummary,
  compactOrderToSavedSlip,
  isCompactOrder,
  isOrderPaid,
  normalizeCompactOrder,
  savedSlipToCompactOrder,
  type BulkOrderOperation,
  type CompactOrder,
} from "../order-model";
import type { SavedSlip } from "../types";
import { refreshSelectedOdds } from "../sporttery";
import type { MatchItem } from "../types";
import { httpError, orderConflict } from "./errors";
import { fromCents, toCents } from "./money";

export type OrderProgressQuery = "settled" | "unsettled" | "unpaid" | null;
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
const MAX_BULK_ORDER_UPDATES = 500;
const VALID_STATUSES = new Set(["success", "hopeful", "failed"]);
const PAID_STATUS = "paid";

const unique = <T,>(values: T[]) => [...new Set(values)];

const parseStoredJson = <T,>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export function parseOrderJson(value: string): CompactOrder | null {
  const parsed = parseStoredJson<unknown>(value, null);
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

type FingerprintSelection = {
  matchId: string;
  marketType: CompactOrder["selections"][number]["marketType"];
  optionId: string;
  odds?: number;
};

const compareFingerprintText = (left: string, right: string) => (
  left < right ? -1 : left > right ? 1 : 0
);

const FINGERPRINT_MARKET_ORDER: CompactOrder["selections"][number]["marketType"][] = [
  "spf",
  "rqspf",
  "score",
  "goals",
  "halfFull",
];

const fingerprintMarketRank = (type: CompactOrder["selections"][number]["marketType"]) => {
  const index = FINGERPRINT_MARKET_ORDER.indexOf(type);
  return index >= 0 ? index : FINGERPRINT_MARKET_ORDER.length;
};

const compareFingerprintSelections = (left: FingerprintSelection, right: FingerprintSelection) => (
  compareFingerprintText(left.matchId, right.matchId)
  || fingerprintMarketRank(left.marketType) - fingerprintMarketRank(right.marketType)
  || compareFingerprintText(left.optionId, right.optionId)
  || (typeof left.odds === "number" && typeof right.odds === "number" ? left.odds - right.odds : 0)
);

/** 订单比赛在手动录入、云端压缩和前端展示之间可能改变数组顺序，比较时只看投注集合。 */
const fingerprintSelections = (order: CompactOrder, includeOdds = false): FingerprintSelection[] => order.selections
  .map((selection) => ({
    matchId: selection.matchId,
    marketType: selection.marketType,
    optionId: selection.optionId,
    ...(includeOdds ? { odds: selection.odds } : {}),
  }))
  .sort(compareFingerprintSelections);

const wagerShape = (order: CompactOrder) => ({
  passes: [...order.passes].sort((left, right) => left - right),
  multiple: order.multiple,
  selections: fingerprintSelections(order),
});

const wagerShapeFingerprint = (order: CompactOrder) => JSON.stringify(wagerShape(order));

const wagerFingerprint = (order: CompactOrder) => JSON.stringify({
  shape: wagerShape(order),
  selections: fingerprintSelections(order, true),
});

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
      payment_status, stake_cents, status, match_ids_json, data_json, updated_at
    )
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    ON CONFLICT(user_id, order_id) DO UPDATE SET
      name = excluded.name,
      saved_at = excluded.saved_at,
      settled_at = excluded.settled_at,
      settled_prize_cents = excluded.settled_prize_cents,
      payment_status = excluded.payment_status,
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
    order.paymentStatus === "paid" ? "paid" : "unpaid",
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
  const version = await currentOrderVersion(d1, userId, orderId);
  if (!version || !expectedUpdatedAt || version.updatedAt !== expectedUpdatedAt) {
    throw orderConflict([orderId]);
  }
  const existing = await getOrder(d1, userId, orderId);
  if (isOrderPaid(existing) && wagerFingerprint(existing) !== wagerFingerprint(order)) {
    throw httpError("已支付订单的投注项、串关、倍数和倍率均已冻结", 409);
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
    conditions.push("date(saved_at, '+8 hours') >= ?");
    params.push(query.from);
  }
  if (query.to) {
    conditions.push("date(saved_at, '+8 hours') <= ?");
    params.push(query.to);
  }
  if (query.progress === "settled") conditions.push("settled_at IS NOT NULL");
  if (query.progress === "unsettled") conditions.push("settled_at IS NULL");
  if (query.progress === "unpaid") conditions.push("payment_status = 'unpaid'");
  const requestedStatuses = unique(query.statuses ?? []);
  const paidSelected = requestedStatuses.includes(PAID_STATUS);
  const statuses = requestedStatuses.filter((status) => VALID_STATUSES.has(status));
  if (paidSelected && statuses.length > 0) {
    conditions.push("(payment_status = 'paid' OR status IN (SELECT value FROM json_each(?)))");
    params.push(JSON.stringify(statuses));
  } else if (paidSelected) {
    conditions.push("payment_status = 'paid'");
  } else if (statuses.length > 0) {
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

function finalizeBulkOrder(current: CompactOrder, incoming: CompactOrder, operation: BulkOrderOperation, now: string) {
  const sameShape = wagerShapeFingerprint(current) === wagerShapeFingerprint(incoming);
  const sameWager = wagerFingerprint(current) === wagerFingerprint(incoming);

  if (operation === "pay") {
    if (isOrderPaid(current) || current.settledAt) throw httpError(`订单“${current.name}”不属于未支付订单`, 409);
    if (!sameShape) throw httpError(`订单“${current.name}”的投注内容与当前版本不一致`, 409);
    return normalizeCompactOrder({
      ...incoming,
      paymentStatus: "paid",
      oddsLocked: true,
      settledAt: undefined,
      settledPrize: undefined,
    });
  }
  if (operation === "settle") {
    if (!isOrderPaid(current) || current.settledAt) throw httpError(`订单“${current.name}”不符合结账条件`, 409);
    if (!sameWager) throw httpError(`订单“${current.name}”的已支付倍率已冻结`, 409);
    const slip = compactOrderToSavedSlip(current);
    return normalizeCompactOrder({
      ...current,
      settledAt: now,
      settledPrize: calculateCurrentPrize(slip.matches, slip.passes, slip.multiple, slip.hits ?? {}),
      oddsLockedBeforeSettlement: Boolean(current.oddsLocked),
      oddsLocked: true,
    });
  }
  if (operation === "lock-odds") {
    if (isOrderPaid(current) || current.settledAt) throw httpError(`订单“${current.name}”的倍率已经冻结`, 409);
    if (!sameWager) throw httpError(`订单“${current.name}”不能在锁定时修改倍率`, 409);
    return normalizeCompactOrder({ ...current, oddsLocked: true });
  }
  if (operation === "refresh-odds") {
    if (isOrderPaid(current) || current.oddsLocked || current.settledAt) {
      throw httpError(`订单“${current.name}”不属于可更新倍率订单`, 409);
    }
    if (!sameShape) throw httpError(`订单“${current.name}”的投注内容与当前版本不一致`, 409);
    return normalizeCompactOrder({ ...incoming, paymentStatus: "unpaid", oddsLocked: false });
  }
  if (operation === "judge") {
    if (!sameWager) throw httpError(`订单“${current.name}”不能在判断赛果时修改已选倍率`, 409);
    return normalizeCompactOrder(incoming);
  }
  if (isOrderPaid(current) && !sameWager) {
    throw httpError(`订单“${current.name}”的投注项、串关、倍数和倍率均已冻结`, 409);
  }
  return normalizeCompactOrder(incoming);
}

export async function bulkUpdateOrders(
  d1: D1Database,
  userId: string,
  rawOrders: unknown,
  operation: BulkOrderOperation,
) {
  if (!Array.isArray(rawOrders) || rawOrders.length === 0) throw httpError("请传入需要更新的订单数组", 400);
  if (rawOrders.length > MAX_BULK_ORDER_UPDATES) {
    throw httpError(`单次最多更新 ${MAX_BULK_ORDER_UPDATES} 个订单`, 400);
  }
  if (!rawOrders.every(isCompactOrder)) throw httpError("批量订单数据结构无效", 400);
  const incoming = rawOrders.map((order) => normalizeCompactOrder(order));
  if (new Set(incoming.map((order) => order.id)).size !== incoming.length) {
    throw httpError("批量订单中包含重复 ID", 400);
  }
  const refs = incoming.map((order) => ({ id: order.id, updatedAt: order.updatedAt }));
  const current = await getOrdersByRefs(d1, userId, refs);
  const currentById = new Map(current.map((order) => [order.id, order]));
  const now = new Date().toISOString();
  const prepared = incoming.map((order) => prepareStoredOrder(
    finalizeBulkOrder(currentById.get(order.id)!, order, operation, now),
    now,
  ));
  const guards = refs.map((ref) => d1.prepare(`
    SELECT CASE
      WHEN EXISTS (
        SELECT 1 FROM user_orders
        WHERE user_id = ?1 AND order_id = ?2 AND updated_at = ?3
      ) THEN json('null')
      ELSE json('')
    END
  `).bind(userId, ref.id, ref.updatedAt ?? ""));
  const updates = prepared.map(({ order, json, summary, matchIdsJson }, index) => d1.prepare(`
    UPDATE user_orders
    SET name = ?1,
        saved_at = ?2,
        settled_at = ?3,
        settled_prize_cents = ?4,
        payment_status = ?5,
        stake_cents = ?6,
        status = ?7,
        match_ids_json = ?8,
        data_json = ?9,
        updated_at = ?10
    WHERE user_id = ?11 AND order_id = ?12 AND updated_at = ?13
  `).bind(
    order.name,
    order.savedAt,
    order.settledAt ?? null,
    typeof order.settledPrize === "number" ? toCents(order.settledPrize) : null,
    order.paymentStatus === "paid" ? "paid" : "unpaid",
    toCents(summary.stake),
    summary.status,
    matchIdsJson,
    json,
    order.updatedAt ?? now,
    userId,
    order.id,
    refs[index].updatedAt ?? "",
  ));
  await d1.batch([...guards, ...updates]);
  return prepared.map((item) => item.order);
}

export async function settleOrders(d1: D1Database, userId: string, refs: OrderRef[]) {
  const now = new Date().toISOString();
  const orders = await getOrdersByRefs(d1, userId, refs);
  const settled: CompactOrder[] = [];
  for (const order of orders) {
    if (!isOrderPaid(order) || order.settledAt) continue;
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
    if (isOrderPaid(order) || order.oddsLocked || order.settledAt) continue;
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
    if (isOrderPaid(order) || order.oddsLocked || order.settledAt) continue;
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
    if (isOrderPaid(order)) totals.expense += summary.stake;
    if (order.settledAt) totals.income += fromCents(toCents(order.settledPrize ?? 0));
    return totals;
  }, { expense: 0, income: 0 });
}
