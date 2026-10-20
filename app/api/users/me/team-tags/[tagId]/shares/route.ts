import { getD1 } from "../../../../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../../../../cloud-server";
import { createTeamTagShare } from "../../../../../../server/team-tags-service";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tagId: string }> | { tagId: string } };
const privateHeaders = { "Cache-Control": "private, no-store" };
const privateResponse = (response: Response) => { response.headers.set("Cache-Control", privateHeaders["Cache-Control"]); return response; };

export async function POST(request: Request, context: Context) {
  try {
    const auth = await requireAuthenticatedCloudAccount(request);
    if (!auth.value) return privateResponse(auth.response!);
    const params = await context.params;
    return Response.json(await createTeamTagShare(
      getD1(), auth.value.account.id, decodeURIComponent(params.tagId), await request.json(),
    ), { status: 201, headers: privateHeaders });
  } catch (error) { return privateResponse(routeError(error)); }
}
