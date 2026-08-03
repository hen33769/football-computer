import { getD1 } from "../../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../../cloud-server";
import { getUserSettings, updateUserSettings } from "../../../../server/settings-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    return Response.json(await getUserSettings(getD1(), authenticated.value.account.id));
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const payload = await request.json() as { settings?: unknown; expectedRevision?: unknown };
    if (!payload.settings || typeof payload.settings !== "object") {
      return Response.json({ error: "设置数据无效" }, { status: 400 });
    }
    const expectedRevision = Number.isInteger(payload.expectedRevision) ? Number(payload.expectedRevision) : undefined;
    return Response.json(await updateUserSettings(
      getD1(),
      authenticated.value.account.id,
      payload.settings as Parameters<typeof updateUserSettings>[2],
      expectedRevision,
    ));
  } catch (error) {
    return routeError(error);
  }
}
