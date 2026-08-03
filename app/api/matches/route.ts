import { getD1 } from "../../../db";
import { routeError } from "../../cloud-server";
import { getCurrentMatches, getMatchesByIds } from "../../server/matches-service";

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
