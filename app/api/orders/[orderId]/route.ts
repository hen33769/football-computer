import { getD1 } from "../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../cloud-server";
import { deleteOrder, getOrder, updateOrder } from "../../../server/orders-service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ orderId: string }> | { orderId: string } };

async function orderIdFromContext(context: RouteContext) {
  const params = await context.params;
  return decodeURIComponent(params.orderId);
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const orderId = await orderIdFromContext(context);
    return Response.json({ order: await getOrder(getD1(), authenticated.value.account.id, orderId) });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const orderId = await orderIdFromContext(context);
    const payload = await request.json() as { order?: unknown; expectedUpdatedAt?: unknown };
    if (!payload.order) return Response.json({ error: "订单数据无效" }, { status: 400 });
    return Response.json({
      order: await updateOrder(
        getD1(),
        authenticated.value.account.id,
        orderId,
        payload.order as Parameters<typeof updateOrder>[3],
        typeof payload.expectedUpdatedAt === "string" ? payload.expectedUpdatedAt : undefined,
      ),
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const orderId = await orderIdFromContext(context);
    const url = new URL(request.url);
    return Response.json(await deleteOrder(
      getD1(),
      authenticated.value.account.id,
      orderId,
      url.searchParams.get("updatedAt") ?? undefined,
    ));
  } catch (error) {
    return routeError(error);
  }
}
