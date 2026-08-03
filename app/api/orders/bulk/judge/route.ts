import { getD1 } from "../../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../../cloud-server";
import { updateOrder, type OrderRef } from "../../../../server/orders-service";

const parseRefs = (value: unknown): OrderRef[] => Array.isArray(value)
  ? value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const ref = item as Partial<OrderRef>;
    return typeof ref.id === "string" ? [{ id: ref.id, updatedAt: ref.updatedAt }] : [];
  })
  : [];

export async function POST(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const payload = await request.json() as { expectedOrders?: unknown; orders?: unknown };
    const refs = parseRefs(payload.expectedOrders);
    const orders = Array.isArray(payload.orders) ? payload.orders : [];
    if (refs.length === 0 || orders.length === 0) {
      return Response.json({ error: "请传入当前可见订单 ID 与判断后的订单数据" }, { status: 400 });
    }
    const refById = new Map(refs.map((ref) => [ref.id, ref] as const));
    const d1 = getD1();
    const saved = [];
    for (const order of orders) {
      if (!order || typeof order !== "object") continue;
      const id = String((order as { id?: unknown }).id ?? "");
      const ref = refById.get(id);
      if (!ref) continue;
      saved.push(await updateOrder(
        d1,
        authenticated.value.account.id,
        id,
        order as Parameters<typeof updateOrder>[3],
        ref.updatedAt,
      ));
    }
    return Response.json({ orders: saved });
  } catch (error) {
    return routeError(error);
  }
}
