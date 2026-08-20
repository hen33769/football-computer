import { getD1 } from "../../../db";
import { routeError } from "../../cloud-server";
import { getCurrentMatches, getMatchesByIds, updateMatchesById } from "../../server/matches-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const ids = (url.searchParams.get("ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length > 0) return Response.json(await getMatchesByIds(getD1(), ids));
    return Response.json(await getCurrentMatches(getD1()));
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as { matches?: unknown };
    return Response.json(await updateMatchesById(getD1(), payload.matches));
  } catch (error) {
    return routeError(error);
  }
}
