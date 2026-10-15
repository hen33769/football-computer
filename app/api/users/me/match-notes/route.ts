import { getD1 } from "../../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../../cloud-server";
import { getUserMatchNotes } from "../../../../server/match-notes-service";

export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "private, no-store" };
const withPrivateHeaders = (response: Response) => {
  response.headers.set("Cache-Control", privateHeaders["Cache-Control"]);
  return response;
};

export async function GET(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return withPrivateHeaders(authenticated.response!);
    const ids = new URL(request.url).searchParams.getAll("ids");
    return Response.json(
      await getUserMatchNotes(getD1(), authenticated.value.account.id, ids),
      { headers: privateHeaders },
    );
  } catch (error) {
    return withPrivateHeaders(routeError(error));
  }
}
