import { getD1 } from "../../../../db";
import { routeError } from "../../../cloud-server";
import { getCurrentMatches } from "../../../server/matches-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getCurrentMatches(getD1()));
  } catch (error) {
    return routeError(error);
  }
}
