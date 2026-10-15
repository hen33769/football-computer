import { getD1 } from "../../../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../../../cloud-server";
import { updateUserMatchNote } from "../../../../../server/match-notes-service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ matchId: string }> | { matchId: string } };
const privateHeaders = { "Cache-Control": "private, no-store" };
const withPrivateHeaders = (response: Response) => {
  response.headers.set("Cache-Control", privateHeaders["Cache-Control"]);
  return response;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return withPrivateHeaders(authenticated.response!);
    const params = await context.params;
    const payload = await request.json() as unknown;
    return Response.json(await updateUserMatchNote(
      getD1(),
      authenticated.value.account.id,
      params.matchId,
      payload,
    ), { headers: privateHeaders });
  } catch (error) {
    return withPrivateHeaders(routeError(error));
  }
}
