import { getD1 } from "../../../../db";
import { routeError } from "../../../cloud-server";
import { refreshMatchesFromOfficial } from "../../../server/matches-service";

export async function POST() {
  try {
    return Response.json(await refreshMatchesFromOfficial(getD1(), { manual: true }));
  } catch (error) {
    return routeError(error);
  }
}
