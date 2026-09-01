import { getD1 } from "../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../cloud-server";
import { deleteTeamNameGroup, updateTeamNameGroup } from "../../../server/team-aliases-service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ groupId: string }> | { groupId: string } };

async function groupIdFromContext(context: RouteContext) {
  const params = await context.params;
  return decodeURIComponent(params.groupId);
}

function isAdmin(request: Request) {
  return requireAuthenticatedCloudAccount(request).then((authenticated) => {
    if (!authenticated.value) return { response: authenticated.response!, userId: null };
    if (authenticated.value.account.role !== "admin") {
      return { response: Response.json({ error: "没有设置队伍名称的权限" }, { status: 403 }), userId: null };
    }
    return { response: null, userId: authenticated.value.account.id };
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const authenticated = await isAdmin(request);
    if (authenticated.response) return authenticated.response;
    const payload = await request.json() as unknown;
    return Response.json(await updateTeamNameGroup(
      getD1(),
      authenticated.userId!,
      await groupIdFromContext(context),
      payload,
    ));
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const authenticated = await isAdmin(request);
    if (authenticated.response) return authenticated.response;
    const url = new URL(request.url);
    const expectedRevisionValue = url.searchParams.get("expectedRevision");
    if (expectedRevisionValue !== null && !/^\d+$/.test(expectedRevisionValue)) {
      return Response.json({ error: "版本号无效" }, { status: 400 });
    }
    const expectedRevision = expectedRevisionValue === null ? undefined : Number(expectedRevisionValue);
    if (expectedRevision !== undefined && !Number.isSafeInteger(expectedRevision)) {
      return Response.json({ error: "版本号无效" }, { status: 400 });
    }
    return Response.json(await deleteTeamNameGroup(getD1(), await groupIdFromContext(context), expectedRevision));
  } catch (error) {
    return routeError(error);
  }
}
