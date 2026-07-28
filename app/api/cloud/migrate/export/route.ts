import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { routeError } from "../../../../cloud-server";

export const dynamic = "force-dynamic";

type ExportTable = {
  name: "users" | "user_states" | "user_orders" | "shared_matches";
  rows: Record<string, unknown>[];
};

async function readTable(name: ExportTable["name"]): Promise<ExportTable> {
  const result = await getD1().prepare(`SELECT * FROM ${name}`).all();
  return { name, rows: result.results };
}

export async function GET(request: Request) {
  try {
    const expectedToken = env.MIGRATION_EXPORT_TOKEN?.trim();
    const url = new URL(request.url);
    const authorization = request.headers.get("authorization");
    const suppliedToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : url.searchParams.get("token");

    if (!expectedToken || suppliedToken !== expectedToken) {
      return new Response("Not found", { status: 404 });
    }

    const tables = await Promise.all([
      readTable("users"),
      readTable("user_states"),
      readTable("user_orders"),
      readTable("shared_matches"),
    ]);

    return new Response(JSON.stringify({
      format: "smgr-d1-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      tables,
    }), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
