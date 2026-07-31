import { getD1 } from "../../../../db";
import type { CloudPersonalMutation } from "../../../personal-sync";
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
    const rawDeletes = payload.deleteOrderIds;
    if (!Number.isInteger(expectedRevision) || Number(expectedRevision) < 0) {
      return Response.json({ error: "同步版本无效" }, { status: 400 });
    }
    if (!Array.isArray(rawUpserts) || rawUpserts.length > MAX_ORDERS || !rawUpserts.every(isOrder)) {
      return Response.json({ error: `订单数据无效或超过 ${MAX_ORDERS} 个` }, { status: 400 });
    }
    if (
      !Array.isArray(rawDeletes)
      || rawDeletes.length > MAX_ORDERS
      || !rawDeletes.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128)
    ) {
      return Response.json({ error: `删除订单 ID 无效或超过 ${MAX_ORDERS} 个` }, { status: 400 });
    }
    if ((rawUpserts.length > 0 || rawDeletes.length > 0) && payload.orderMutationVersion !== 1) {
      return Response.json({ error: "订单同步协议已升级，请刷新页面后重试" }, { status: 409 });
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
    const deleteOrderIds = [...new Set(rawDeletes)];
    deleteOrderIds.forEach((id) => upsertsById.delete(id));
    const upsertOrders = [...upsertsById.values()];
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
    const statements = [
      d1.prepare(`
        INSERT INTO user_states (
          user_id, settings_json, expense_cents, income_cents, revision, updated_at
        ) VALUES (?1, '{}', 0, 0, 0, ?2)
        ON CONFLICT(user_id) DO NOTHING
      `).bind(userId, now),
    ];

    for (let index = 0; index < upsertOrders.length; index += ORDERS_PER_STATEMENT) {
      const chunk = upsertOrders.slice(index, index + ORDERS_PER_STATEMENT);
      statements.push(d1.prepare(`
        INSERT INTO user_orders (user_id, order_id, saved_at, data_json, updated_at)
        SELECT
          ?1,
          json_extract(value, '$.id'),
          json_extract(value, '$.savedAt'),
          value,
          ?2
        FROM json_each(?3)
        WHERE EXISTS (
          SELECT 1 FROM user_states
          WHERE user_id = ?1 AND revision = ?4
        )
        ON CONFLICT(user_id, order_id) DO UPDATE SET
          saved_at = excluded.saved_at,
          data_json = excluded.data_json,
          updated_at = excluded.updated_at
      `).bind(userId, now, JSON.stringify(chunk), expectedRevision));
    }

    if (deleteOrderIds.length > 0) {
      statements.push(d1.prepare(`
        DELETE FROM user_orders
        WHERE user_id = ?1
          AND order_id IN (SELECT value FROM json_each(?2))
          AND EXISTS (
            SELECT 1 FROM user_states
            WHERE user_id = ?1 AND revision = ?3
          )
      `).bind(userId, JSON.stringify(deleteOrderIds), expectedRevision));
    }

    const normalizedSettings = payload.settings ? JSON.stringify(normalizeAppSettings(payload.settings)) : "";
    statements.push(d1.prepare(`
      UPDATE user_states
      SET
        settings_json = CASE WHEN ?1 = 1 THEN ?2 ELSE settings_json END,
        expense_cents = CASE WHEN ?3 = 1 THEN ?4 ELSE expense_cents END,
        income_cents = CASE WHEN ?3 = 1 THEN ?5 ELSE income_cents END,
        revision = revision + 1,
        updated_at = ?6
      WHERE user_id = ?7 AND revision = ?8
    `).bind(
      payload.settings !== undefined ? 1 : 0,
      normalizedSettings,
      payload.finance !== undefined ? 1 : 0,
      Math.round(Number(payload.finance?.expenseTotal ?? 0) * 100),
      Math.round(Number(payload.finance?.incomeTotal ?? 0) * 100),
      now,
      userId,
      expectedRevision,
    ));

    const results = await d1.batch(statements);
    const revisionUpdate = results.at(-1);
    if ((revisionUpdate?.meta.changes ?? 0) === 0) {
      const current = await d1.prepare(
        "SELECT revision FROM user_states WHERE user_id = ?1"
      ).bind(userId).first<{ revision: number }>();
      return Response.json({
        error: "云端数据已被其他设备更新，正在合并后重试",
        revision: current?.revision ?? 0,
      }, { status: 409 });
    }

    return Response.json({
      ok: true,
      savedAt: now,
      revision: Number(expectedRevision) + 1,
      upsertedOrderIds: upsertOrders.map((order) => order.id),
      deletedOrderIds: deleteOrderIds,
    });
  } catch (error) {
    return routeError(error);
  }
}
