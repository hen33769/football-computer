import { getD1 } from "../../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../../cloud-server";
import { saveOrderResults } from "../../../../server/orders-service";

type RouteContext = { params: Promise<{ orderId: string }> | { orderId: string } };

export async function PUT(request: Request, context: RouteContext) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const params = await context.params;
    const payload = await request.json() as {
      hits?: unknown;
      resultValues?: unknown;
      failedMatchIds?: unknown;
      expectedUpdatedAt?: unknown;
    };
    return Response.json({
      order: await saveOrderResults(getD1(), authenticated.value.account.id, decodeURIComponent(params.orderId), {
        hits: payload.hits as Parameters<typeof saveOrderResults>[3]["hits"],
        resultValues: payload.resultValues as Parameters<typeof saveOrderResults>[3]["resultValues"],
        failedMatchIds: Array.isArray(payload.failedMatchIds) ? payload.failedMatchIds.filter((id): id is string => typeof id === "string") : [],
        expectedUpdatedAt: typeof payload.expectedUpdatedAt === "string" ? payload.expectedUpdatedAt : undefined,
      }),
    });
  } catch (error) {
    return routeError(error);
  }
}
