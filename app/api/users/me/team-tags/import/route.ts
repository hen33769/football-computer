import { getD1 } from "../../../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../../../cloud-server";
import { importTeamTagShare } from "../../../../../server/team-tags-service";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };
const privateResponse = (response: Response) => { response.headers.set("Cache-Control", privateHeaders["Cache-Control"]); return response; };

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedCloudAccount(request);
    if (!auth.value) return privateResponse(auth.response!);
    return Response.json(await importTeamTagShare(getD1(), auth.value.account.id, await request.json()), { headers: privateHeaders });
  } catch (error) { return privateResponse(routeError(error)); }
}
