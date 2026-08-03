import { getD1 } from "../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../cloud-server";
import { getFinanceState } from "../../server/finance-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    return Response.json(await getFinanceState(getD1(), authenticated.value.account.id));
  } catch (error) {
    return routeError(error);
  }
}
