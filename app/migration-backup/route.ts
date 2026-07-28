import { env } from "cloudflare:workers";
import { getD1 } from "../../db";
import { routeError } from "../cloud-server";

export const dynamic = "force-dynamic";

type ExportTableName = "users" | "user_states" | "user_orders" | "shared_matches";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function readTable(name: ExportTableName) {
  const result = await getD1().prepare(`SELECT * FROM ${name}`).all();
  return { name, rows: result.results };
}

export async function GET(request: Request) {
  try {
    const expectedToken = env.MIGRATION_EXPORT_TOKEN?.trim();
    const suppliedToken = new URL(request.url).searchParams.get("token");

    if (!expectedToken || suppliedToken !== expectedToken) {
      return new Response("Not found", { status: 404 });
    }

    const tables = await Promise.all([
      readTable("users"),
      readTable("user_states"),
      readTable("user_orders"),
      readTable("shared_matches"),
    ]);
    const payload = JSON.stringify({
      format: "smgr-d1-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      tables,
    });

    return new Response(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>SMGR 数据迁移备份</title></head>
<body><pre id="payload">${escapeHtml(payload)}</pre></body>
</html>`, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'",
        "Content-Type": "text/html; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
