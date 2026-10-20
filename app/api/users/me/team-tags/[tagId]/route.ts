import { getD1 } from "../../../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../../../cloud-server";
import { deleteUserTeamTag, updateUserTeamTag } from "../../../../../server/team-tags-service";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tagId: string }> | { tagId: string } };
const privateHeaders = { "Cache-Control": "private, no-store" };
const privateResponse = (response: Response) => { response.headers.set("Cache-Control", privateHeaders["Cache-Control"]); return response; };
const tagId = async (context: Context) => decodeURIComponent((await context.params).tagId);

export async function PATCH(request: Request, context: Context) {
  try {
    const auth = await requireAuthenticatedCloudAccount(request);
    if (!auth.value) return privateResponse(auth.response!);
    return Response.json(await updateUserTeamTag(getD1(), auth.value.account.id, await tagId(context), await request.json()), { headers: privateHeaders });
  } catch (error) { return privateResponse(routeError(error)); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const auth = await requireAuthenticatedCloudAccount(request);
    if (!auth.value) return privateResponse(auth.response!);
    const raw = new URL(request.url).searchParams.get("expectedRevision");
    const revision = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
    return Response.json(await deleteUserTeamTag(getD1(), auth.value.account.id, await tagId(context), revision), { headers: privateHeaders });
  } catch (error) { return privateResponse(routeError(error)); }
}
