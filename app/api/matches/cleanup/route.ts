import { getD1 } from "../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../cloud-server";
import { cleanupOldMatches } from "../../../server/matches-service";

export async function POST(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    if (authenticated.value.account.role !== "admin") {
      return Response.json({ error: "没有清理比赛数据的权限" }, { status: 403 });
    }
    return Response.json(await cleanupOldMatches(getD1()));
  } catch (error) {
    return routeError(error);
  }
}
