import { getD1 } from "../../../../db";
import type { CloudOrderDelete, CloudPersonalMutation, CloudPersonalMutationResponse } from "../../../personal-sync";
import { normalizeAppSettings } from "../../../settings";
import type { SavedSlip } from "../../../types";
import { requireAuthenticatedCloudAccount, routeError } from "../../../cloud-server";

const MAX_ORDERS = 500;
const MAX_ORDER_BYTES = 1_500_000;
const ORDERS_PER_STATEMENT = 20;

function isOrder(value: unknown): value is SavedSlip {
  if (!value || typeof value !== "object") return false;
  const order = value as Partial<SavedSlip>;
  return typeof order.id === "string"
    && order.id.length > 0
    && order.id.length <= 128
    && typeof order.name === "string"
    && typeof order.savedAt === "string"
    && Array.isArray(order.matches)
    && Array.isArray(order.passes)
    && typeof order.multiple === "number"
    && Number.isFinite(order.multiple);
}

function isOrderDelete(value: unknown): value is CloudOrderDelete {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CloudOrderDelete>;
  return typeof item.id === "string"
    && item.id.length > 0
    && item.id.length <= 128
    && (item.updatedAt === undefined || typeof item.updatedAt === "string");
}

function finiteNonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export async function PUT(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;

    const payload = await request.json() as Partial<CloudPersonalMutation>;
    const expectedRevision = payload.expectedRevision;
    const rawUpserts = payload.upsertOrders;
    const rawDeleteOrders = Array.isArray(payload.deleteOrders)
      ? payload.deleteOrders
      : Array.isArray(payload.deleteOrderIds)
        ? payload.deleteOrderIds.map((id) => ({ id }))
        : null;
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || Number(expectedRevision) < 0)) {
      return Response.json({ error: "同步版本无效" }, { status: 400 });
    }
    if (!Array.isArray(rawUpserts) || rawUpserts.length > MAX_ORDERS || !rawUpserts.every(isOrder)) {
      return Response.json({ error: `订单数据无效或超过 ${MAX_ORDERS} 个` }, { status: 400 });
    }
    if (
      !rawDeleteOrders
      || rawDeleteOrders.length > MAX_ORDERS
      || !rawDeleteOrders.every(isOrderDelete)
    ) {
      return Response.json({ error: `删除订单 ID 无效或超过 ${MAX_ORDERS} 个` }, { status: 400 });
    }
    if (payload.finance && (
      !finiteNonNegative(payload.finance.expenseTotal)
      || !finiteNonNegative(payload.finance.incomeTotal)
    )) {
      return Response.json({ error: "收支数据无效" }, { status: 400 });
    }
    if (payload.settings !== undefined && (!payload.settings || typeof payload.settings !== "object")) {
      return Response.json({ error: "设置数据无效" }, { status: 400 });
    }

    const upsertsById = new Map<string, SavedSlip>();
    rawUpserts.forEach((rawOrder) => {
      const order = structuredClone(rawOrder);
      const json = JSON.stringify(order);
      if (new TextEncoder().encode(json).byteLength > MAX_ORDER_BYTES) {
        throw new Error(`订单“${order.name}”的数据过大，无法同步`);
      }
      upsertsById.set(order.id!, order);
    });
    const deleteOrdersById = new Map<string, CloudOrderDelete>();
    rawDeleteOrders.forEach((item) => deleteOrdersById.set(item.id, item));
    deleteOrdersById.forEach((_, id) => upsertsById.delete(id));
    const deleteOrders = [...deleteOrdersById.values()];
    const deleteOrderIds = deleteOrders.map((item) => item.id);
    const upsertOrders = [...upsertsById.values()];
    const hasOrderMutation = upsertOrders.length > 0 || deleteOrderIds.length > 0;
    const hasMutation = upsertOrders.length > 0
      || deleteOrderIds.length > 0
      || payload.finance !== undefined
      || payload.settings !== undefined;
    if (!hasMutation) {
      return Response.json({ error: "没有需要同步的数据" }, { status: 400 });
    }

    const userId = authenticated.value.account.id;
    const now = new Date().toISOString();
    const d1 = getD1();
    const orderMutationVersion = payload.orderMutationVersion === 2 ? 2 : 1;
    const currentOrderVersions = new Map<string, string>();
    if (orderMutationVersion === 2 && hasOrderMutation) {
      const targetOrderIds = [...new Set([
        ...upsertOrders.flatMap((order) => order.id ? [order.id] : []),
        ...deleteOrderIds,
      ])];
      if (targetOrderIds.length > 0) {
        const currentRows = await d1.prepare(`
          SELECT order_id AS orderId, updated_at AS updatedAt
          FROM user_orders
          WHERE user_id = ?1
            AND order_id IN (SELECT value FROM json_each(?2))
        `).bind(userId, JSON.stringify(targetOrderIds)).all<{ orderId: string; updatedAt: string }>();
        (currentRows.results ?? []).forEach((row) => currentOrderVersions.set(row.orderId, row.updatedAt));
      }

      const conflictOrderIds = new Set<string>();
      upsertOrders.forEach((order) => {
        if (!order.id) return;
        const currentUpdatedAt = currentOrderVersions.get(order.id);
        if (order.updatedAt) {
          if (!currentUpdatedAt || currentUpdatedAt !== order.updatedAt) conflictOrderIds.add(order.id);
        } else if (currentUpdatedAt) {
          conflictOrderIds.add(order.id);
        }
      });
      deleteOrders.forEach((item) => {
        const currentUpdatedAt = currentOrderVersions.get(item.id);
        if (!currentUpdatedAt) return;
        if (!item.updatedAt || currentUpdatedAt !== item.updatedAt) conflictOrderIds.add(item.id);
      });
      if (conflictOrderIds.size > 0) {
        const current = await d1.prepare(
          "SELECT revision FROM user_states WHERE user_id = ?1"
        ).bind(userId).first<{ revision: number }>();
        return Response.json({
          code: "ORDER_CONFLICT",
          error: "订单数据异常，请刷新获取最新数据",
          conflictOrderIds: [...conflictOrderIds],
          revision: current?.revision ?? 0,
        }, { status: 409 });
      }
    }

    const statements = [
      d1.prepare(`
        INSERT INTO user_states (
          user_id, settings_json, expense_cents, income_cents, revision, updated_at
        ) VALUES (?1, '{}', 0, 0, 0, ?2)
        ON CONFLICT(user_id) DO NOTHING
      `).bind(userId, now),
    ];

    const storedUpsertOrders = upsertOrders.map((order) => ({ ...order, updatedAt: now }));
    if (orderMutationVersion === 2) {
      for (const order of storedUpsertOrders) {
        const expectedOrderUpdatedAt = upsertsById.get(order.id!)?.updatedAt ?? null;
        statements.push(d1.prepare(`
          INSERT INTO user_orders (user_id, order_id, saved_at, data_json, updated_at)
          SELECT ?1, ?2, ?3, ?4, ?5
          WHERE ?6 IS NULL
            OR EXISTS (
              SELECT 1 FROM user_orders
              WHERE user_id = ?1 AND order_id = ?2 AND updated_at = ?6
            )
          ON CONFLICT(user_id, order_id) DO UPDATE SET
            saved_at = excluded.saved_at,
            data_json = excluded.data_json,
            updated_at = excluded.updated_at
          WHERE ?6 IS NOT NULL AND user_orders.updated_at = ?6
        `).bind(userId, order.id, order.savedAt, JSON.stringify(order), now, expectedOrderUpdatedAt));
      }
    } else {
      for (let index = 0; index < storedUpsertOrders.length; index += ORDERS_PER_STATEMENT) {
        const chunk = storedUpsertOrders.slice(index, index + ORDERS_PER_STATEMENT);
        statements.push(d1.prepare(`
          INSERT INTO user_orders (user_id, order_id, saved_at, data_json, updated_at)
          SELECT
            ?1,
            json_extract(value, '$.id'),
            json_extract(value, '$.savedAt'),
            value,
            ?2
          FROM json_each(?3)
          ON CONFLICT(user_id, order_id) DO UPDATE SET
            saved_at = excluded.saved_at,
            data_json = excluded.data_json,
            updated_at = excluded.updated_at
        `).bind(userId, now, JSON.stringify(chunk)));
      }
    }

    if (deleteOrderIds.length > 0) {
      if (orderMutationVersion === 2) {
        for (const item of deleteOrders) {
          statements.push(d1.prepare(`
            DELETE FROM user_orders
            WHERE user_id = ?1
              AND order_id = ?2
              AND ?3 IS NOT NULL
              AND updated_at = ?3
          `).bind(userId, item.id, item.updatedAt ?? null));
        }
      } else {
        statements.push(d1.prepare(`
          DELETE FROM user_orders
          WHERE user_id = ?1
            AND order_id IN (SELECT value FROM json_each(?2))
        `).bind(userId, JSON.stringify(deleteOrderIds)));
      }
    }

    const normalizedSettings = payload.settings ? JSON.stringify(normalizeAppSettings(payload.settings)) : "";
    const skipRevisionGuard = hasOrderMutation;
    statements.push(d1.prepare(`
      UPDATE user_states
      SET
        settings_json = CASE WHEN ?1 = 1 THEN ?2 ELSE settings_json END,
        expense_cents = CASE WHEN ?3 = 1 THEN ?4 ELSE expense_cents END,
        income_cents = CASE WHEN ?3 = 1 THEN ?5 ELSE income_cents END,
        revision = revision + 1,
        updated_at = ?6
      WHERE user_id = ?7
        AND (?9 = 1 OR revision = ?8)
    `).bind(
      payload.settings !== undefined ? 1 : 0,
      normalizedSettings,
      payload.finance !== undefined ? 1 : 0,
      Math.round(Number(payload.finance?.expenseTotal ?? 0) * 100),
      Math.round(Number(payload.finance?.incomeTotal ?? 0) * 100),
      now,
      userId,
      Number(expectedRevision ?? 0),
      skipRevisionGuard ? 1 : 0,
    ));

    const results = await d1.batch(statements);
    const revisionUpdate = results.at(-1);
    if ((revisionUpdate?.meta.changes ?? 0) === 0) {
      const current = await d1.prepare(
        "SELECT revision FROM user_states WHERE user_id = ?1"
      ).bind(userId).first<{ revision: number }>();
      return Response.json({
        error: "云端数据已被其他设备更新，请刷新后重试",
        revision: current?.revision ?? 0,
      }, { status: 409 });
    }

    if (orderMutationVersion === 2 && hasOrderMutation) {
      const touchedIds = [...new Set([
        ...storedUpsertOrders.flatMap((order) => order.id ? [order.id] : []),
        ...deleteOrderIds,
      ])];
      const currentRows = touchedIds.length > 0
        ? await d1.prepare(`
          SELECT order_id AS orderId, updated_at AS updatedAt
          FROM user_orders
          WHERE user_id = ?1
            AND order_id IN (SELECT value FROM json_each(?2))
        `).bind(userId, JSON.stringify(touchedIds)).all<{ orderId: string; updatedAt: string }>()
        : { results: [] };
      const currentById = new Map((currentRows.results ?? []).map((row) => [row.orderId, row.updatedAt] as const));
      const failedUpserts = storedUpsertOrders.flatMap((order) => (
        order.id && currentById.get(order.id) === now ? [] : order.id ? [order.id] : []
      ));
      const failedDeletes = deleteOrders.flatMap((item) => (
        currentOrderVersions.has(item.id) && currentById.has(item.id) ? [item.id] : []
      ));
      if (failedUpserts.length > 0 || failedDeletes.length > 0) {
        const current = await d1.prepare(
          "SELECT revision FROM user_states WHERE user_id = ?1"
        ).bind(userId).first<{ revision: number }>();
        return Response.json({
          code: "ORDER_CONFLICT",
          error: "订单数据异常，请刷新获取最新数据",
          conflictOrderIds: [...new Set([...failedUpserts, ...failedDeletes])],
          revision: current?.revision ?? 0,
        }, { status: 409 });
      }
    }

    const current = await d1.prepare(
      "SELECT revision FROM user_states WHERE user_id = ?1"
    ).bind(userId).first<{ revision: number }>();
    return Response.json({
      ok: true,
      savedAt: now,
      revision: current?.revision ?? Number(expectedRevision ?? 0) + 1,
      upsertedOrders: storedUpsertOrders,
      upsertedOrderIds: storedUpsertOrders.flatMap((order) => order.id ? [order.id] : []),
      deletedOrderIds: deleteOrderIds,
    } satisfies CloudPersonalMutationResponse);
  } catch (error) {
    return routeError(error);
  }
}
