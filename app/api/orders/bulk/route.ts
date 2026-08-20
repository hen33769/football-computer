import { getD1 } from "../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../cloud-server";
import { bulkUpdateOrders } from "../../../server/orders-service";
import type { BulkOrderOperation } from "../../../order-model";

const OPERATIONS = new Set<BulkOrderOperation>([
  "update",
  "judge",
  "refresh-odds",
  "lock-odds",
  "pay",
  "settle",
]);

export async function PATCH(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const payload = await request.json() as { operation?: unknown; orders?: unknown };
    const operation = String(payload.operation ?? "") as BulkOrderOperation;
    if (!OPERATIONS.has(operation)) {
      return Response.json({ error: "批量订单操作类型无效" }, { status: 400 });
    }
    return Response.json({
      orders: await bulkUpdateOrders(getD1(), authenticated.value.account.id, payload.orders, operation),
    });
  } catch (error) {
    return routeError(error);
  }
}
