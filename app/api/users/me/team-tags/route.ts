import { getD1 } from "../../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../../cloud-server";
import { createUserTeamTag, listUserTeamTags } from "../../../../server/team-tags-service";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };
const privateResponse = (response: Response) => { response.headers.set("Cache-Control", privateHeaders["Cache-Control"]); return response; };

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedCloudAccount(request);
    if (!auth.value) return privateResponse(auth.response!);
    return Response.json(await listUserTeamTags(getD1(), auth.value.account.id), { headers: privateHeaders });
  } catch (error) { return privateResponse(routeError(error)); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedCloudAccount(request);
    if (!auth.value) return privateResponse(auth.response!);
    return Response.json(await createUserTeamTag(getD1(), auth.value.account.id, await request.json()), { status: 201, headers: privateHeaders });
  } catch (error) { return privateResponse(routeError(error)); }
}
