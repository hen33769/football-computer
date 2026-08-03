import { getD1 } from "../../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../../cloud-server";
import { withdrawOrderSettlement } from "../../../../server/orders-service";

type RouteContext = { params: Promise<{ orderId: string }> | { orderId: string } };

export async function POST(request: Request, context: RouteContext) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const params = await context.params;
    const payload = await request.json().catch(() => ({})) as { expectedUpdatedAt?: unknown };
    return Response.json({
      order: await withdrawOrderSettlement(getD1(), authenticated.value.account.id, {
        id: decodeURIComponent(params.orderId),
        updatedAt: typeof payload.expectedUpdatedAt === "string" ? payload.expectedUpdatedAt : undefined,
      }),
    });
  } catch (error) {
    return routeError(error);
  }
}
