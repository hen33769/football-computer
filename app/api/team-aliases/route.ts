import { getD1 } from "../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../cloud-server";
import { createTeamNameGroup, listTeamNameGroups } from "../../server/team-aliases-service";

export const dynamic = "force-dynamic";

const publicHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

function publicJson(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: { ...publicHeaders, ...init.headers },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: publicHeaders });
}

export async function GET() {
  try {
    return publicJson(await listTeamNameGroups(getD1()));
  } catch (error) {
    return publicJson({ error: error instanceof Error ? error.message : "队伍名称配置读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    if (authenticated.value.account.role !== "admin") {
      return Response.json({ error: "没有设置队伍名称的权限" }, { status: 403 });
    }
    const payload = await request.json() as unknown;
    return Response.json(await createTeamNameGroup(getD1(), authenticated.value.account.id, payload), { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
