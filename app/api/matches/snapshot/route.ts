import { getD1 } from "../../../../db";
import { routeError } from "../../../cloud-server";
import { saveClientMatchSnapshot } from "../../../server/matches-service";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { matches?: unknown };
    return Response.json(await saveClientMatchSnapshot(getD1(), payload.matches));
  } catch (error) {
    return routeError(error);
  }
}
