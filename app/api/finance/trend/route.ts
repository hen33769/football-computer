import { getD1 } from "../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../cloud-server";
import { httpError } from "../../../server/errors";
import { getFinanceTrend } from "../../../server/finance-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const url = new URL(request.url);
    try {
      return Response.json(await getFinanceTrend(getD1(), authenticated.value.account.id, {
        startDate: url.searchParams.get("start_date") ?? undefined,
        endDate: url.searchParams.get("end_date") ?? undefined,
      }));
    } catch (error) {
      if (error instanceof Error && /^(start_date|end_date)/.test(error.message)) {
        throw httpError(error.message, 400);
      }
      throw error;
    }
  } catch (error) {
    return routeError(error);
  }
}
