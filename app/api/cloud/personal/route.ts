import { getD1 } from "../../../../db";
import { normalizeAppSettings } from "../../../settings";
import type { SavedSlip } from "../../../types";
import { requireAuthenticatedCloudAccount, routeError } from "../../../cloud-server";

const MAX_ORDERS = 500;
const MAX_ORDER_BYTES = 1_500_000;
const ORDERS_PER_STATEMENT = 20;

function isOrder(value: unknown): value is SavedSlip {
  if (!value || typeof value !== "object") return false;
  const order = value as Partial<SavedSlip>;
  return typeof order.name === "string"
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

    const payload = await request.json() as {
      orders?: unknown;
      settings?: unknown;
      finance?: {
        expenseTotal?: unknown;
        incomeTotal?: unknown;
      };
    };
    if (!Array.isArray(payload.orders) || payload.orders.length > MAX_ORDERS || !payload.orders.every(isOrder)) {
      return Response.json({ error: `订单数据无效或超过 ${MAX_ORDERS} 个` }, { status: 400 });
    }
    if (!payload.settings || typeof payload.settings !== "object") {
      return Response.json({ error: "设置数据无效" }, { status: 400 });
    }
    const finance = payload.finance;
    const expenseTotal = finance?.expenseTotal;
    const incomeTotal = finance?.incomeTotal;
    if (!finiteNonNegative(expenseTotal) || !finiteNonNegative(incomeTotal)) {
      return Response.json({ error: "收支数据无效" }, { status: 400 });
    }

    const ordersById = new Map<string, SavedSlip>();
    payload.orders.forEach((rawOrder) => {
      const order = structuredClone(rawOrder);
      order.id = order.id?.trim() || crypto.randomUUID();
      const json = JSON.stringify(order);
      if (new TextEncoder().encode(json).byteLength > MAX_ORDER_BYTES) {
        throw new Error(`订单“${order.name}”的数据过大，无法同步`);
      }
      ordersById.set(order.id, order);
    });
    const orders = [...ordersById.values()];
    const userId = authenticated.value.account.id;
    const now = new Date().toISOString();
    const d1 = getD1();
    const statements = [
      d1.prepare(`
        INSERT INTO user_states (
          user_id, settings_json, expense_cents, income_cents, revision, updated_at
        ) VALUES (?1, ?2, ?3, ?4, 1, ?5)
        ON CONFLICT(user_id) DO UPDATE SET
          settings_json = excluded.settings_json,
          expense_cents = excluded.expense_cents,
          income_cents = excluded.income_cents,
          revision = user_states.revision + 1,
          updated_at = excluded.updated_at
      `).bind(
        userId,
        JSON.stringify(normalizeAppSettings(payload.settings)),
        Math.round(Number(expenseTotal) * 100),
        Math.round(Number(incomeTotal) * 100),
        now,
      ),
      d1.prepare("DELETE FROM user_orders WHERE user_id = ?1").bind(userId),
    ];

    for (let index = 0; index < orders.length; index += ORDERS_PER_STATEMENT) {
      const chunk = orders.slice(index, index + ORDERS_PER_STATEMENT);
      const placeholders = chunk.map((_, rowIndex) => {
        const offset = rowIndex * 5;
        return `(?${offset + 1}, ?${offset + 2}, ?${offset + 3}, ?${offset + 4}, ?${offset + 5})`;
      }).join(", ");
      const values = chunk.flatMap((order) => [
        userId,
        order.id!,
        order.savedAt,
        JSON.stringify(order),
        now,
      ]);
      statements.push(d1.prepare(`
        INSERT INTO user_orders (user_id, order_id, saved_at, data_json, updated_at)
        VALUES ${placeholders}
      `).bind(...values));
    }

    await d1.batch(statements);
    return Response.json({ ok: true, savedAt: now, orders });
  } catch (error) {
    return routeError(error);
  }
}
