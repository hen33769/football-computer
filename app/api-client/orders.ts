"use client";

import {
  compactOrderToSavedSlip,
  savedSlipToCompactOrder,
  type CompactOrder,
} from "../order-model";
import type { CurrentHits, SavedSlip } from "../types";
import { requestJson } from "./http";

export type OrderProgressFilter = "settled" | "unsettled" | null;
export type OrderStatusFilter = "success" | "hopeful" | "failed";

export type OrderQuery = {
  from?: string | null;
  to?: string | null;
  progress?: OrderProgressFilter;
  statuses?: OrderStatusFilter[];
  limit?: number;
  offset?: number;
};

export type OrdersResponse = {
  orders: SavedSlip[];
  total: number;
  unsettledCount: number;
};

export type OrderRef = {
  id: string;
  updatedAt?: string;
};

const asSaved = (order: CompactOrder) => compactOrderToSavedSlip(order);
const asCompact = (order: SavedSlip) => savedSlipToCompactOrder(order);

const queryString = (query: OrderQuery = {}) => {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.progress) params.set("progress", query.progress);
  if (query.statuses?.length) params.set("status", query.statuses.join(","));
  if (query.limit) params.set("limit", String(query.limit));
  if (query.offset) params.set("offset", String(query.offset));
  const value = params.toString();
  return value ? `?${value}` : "";
};

export async function fetchOrders(query: OrderQuery = {}): Promise<OrdersResponse> {
  const response = await requestJson<{ orders: CompactOrder[]; total: number; unsettledCount: number }>(`/api/orders${queryString(query)}`);
  return {
    ...response,
    orders: response.orders.map(asSaved),
  };
}

export async function createOrder(order: SavedSlip) {
  const response = await requestJson<{ order: CompactOrder }>("/api/orders", {
    method: "POST",
    body: JSON.stringify({ order: asCompact(order) }),
  });
  return asSaved(response.order);
}

export async function updateOrder(order: SavedSlip) {
  if (!order.id) throw new Error("订单缺少 ID");
  const response = await requestJson<{ order: CompactOrder }>(`/api/orders/${encodeURIComponent(order.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ order: asCompact(order), expectedUpdatedAt: order.updatedAt }),
  });
  return asSaved(response.order);
}

export async function deleteOrder(order: SavedSlip) {
  if (!order.id) throw new Error("订单缺少 ID");
  const response = await requestJson<{ deletedOrderId: string }>(
    `/api/orders/${encodeURIComponent(order.id)}?updatedAt=${encodeURIComponent(order.updatedAt ?? "")}`,
    { method: "DELETE" },
  );
  return response.deletedOrderId;
}

export async function settleOrder(order: SavedSlip) {
  if (!order.id) throw new Error("订单缺少 ID");
  const response = await requestJson<{ order: CompactOrder }>(`/api/orders/${encodeURIComponent(order.id)}/settle`, {
    method: "POST",
    body: JSON.stringify({ expectedUpdatedAt: order.updatedAt }),
  });
  return asSaved(response.order);
}

export async function withdrawOrderSettlement(order: SavedSlip) {
  if (!order.id) throw new Error("订单缺少 ID");
  const response = await requestJson<{ order: CompactOrder }>(`/api/orders/${encodeURIComponent(order.id)}/withdraw-settlement`, {
    method: "POST",
    body: JSON.stringify({ expectedUpdatedAt: order.updatedAt }),
  });
  return asSaved(response.order);
}

export async function saveOrderResults(order: SavedSlip, payload: {
  hits?: CurrentHits;
  resultValues?: CurrentHits;
  failedMatchIds?: string[];
}) {
  if (!order.id) throw new Error("订单缺少 ID");
  const response = await requestJson<{ order: CompactOrder }>(`/api/orders/${encodeURIComponent(order.id)}/results`, {
    method: "PUT",
    body: JSON.stringify({ ...payload, expectedUpdatedAt: order.updatedAt }),
  });
  return asSaved(response.order);
}

export const orderRefs = (orders: SavedSlip[]): OrderRef[] => orders.flatMap((order) => (
  order.id ? [{ id: order.id, updatedAt: order.updatedAt }] : []
));

export async function bulkSettleOrders(orders: SavedSlip[]) {
  const response = await requestJson<{ orders: CompactOrder[] }>("/api/orders/bulk/settle", {
    method: "POST",
    body: JSON.stringify({ expectedOrders: orderRefs(orders) }),
  });
  return response.orders.map(asSaved);
}

export async function bulkLockOrderOdds(orders: SavedSlip[]) {
  const response = await requestJson<{ orders: CompactOrder[] }>("/api/orders/bulk/lock-odds", {
    method: "POST",
    body: JSON.stringify({ expectedOrders: orderRefs(orders) }),
  });
  return response.orders.map(asSaved);
}

export async function bulkRefreshOrderOdds(orders: SavedSlip[]) {
  const response = await requestJson<{
    orders: CompactOrder[];
    matchedOptionCount: number;
    changedOptionCount: number;
    unmatchedOptionCount: number;
  }>("/api/orders/bulk/refresh-odds", {
    method: "POST",
    body: JSON.stringify({ expectedOrders: orderRefs(orders) }),
  });
  return {
    ...response,
    orders: response.orders.map(asSaved),
  };
}

export async function bulkSaveJudgedOrders(orders: SavedSlip[]) {
  const response = await requestJson<{ orders: CompactOrder[] }>("/api/orders/bulk/judge", {
    method: "POST",
    body: JSON.stringify({
      expectedOrders: orderRefs(orders),
      orders: orders.map(asCompact),
    }),
  });
  return response.orders.map(asSaved);
}
