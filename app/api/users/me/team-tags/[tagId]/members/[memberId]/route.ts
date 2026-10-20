import { getD1 } from "../../../../../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../../../../../cloud-server";
import { updateUserTeamTagMemberNote } from "../../../../../../../server/team-tags-service";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tagId: string; memberId: string }> | { tagId: string; memberId: string } };
const privateHeaders = { "Cache-Control": "private, no-store" };
const privateResponse = (response: Response) => { response.headers.set("Cache-Control", privateHeaders["Cache-Control"]); return response; };

export async function PATCH(request: Request, context: Context) {
  try {
    const auth = await requireAuthenticatedCloudAccount(request);
    if (!auth.value) return privateResponse(auth.response!);
    const params = await context.params;
    return Response.json(await updateUserTeamTagMemberNote(
      getD1(), auth.value.account.id, decodeURIComponent(params.tagId), decodeURIComponent(params.memberId), await request.json(),
    ), { headers: privateHeaders });
  } catch (error) { return privateResponse(routeError(error)); }
}
