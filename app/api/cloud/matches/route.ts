import { getD1 } from "../../../../db";
import { clearMatchSelections } from "../../../cloud";
import type { MatchItem } from "../../../types";
import { requireAuthenticatedCloudAccount, routeError } from "../../../cloud-server";

const MAX_MATCHES = 500;
const MATCHES_PER_STATEMENT = 20;

function isMatch(value: unknown): value is MatchItem {
  if (!value || typeof value !== "object") return false;
  const match = value as Partial<MatchItem>;
  return typeof match.id === "string"
    && typeof match.date === "string"
    && typeof match.home === "string"
    && typeof match.away === "string"
    && Array.isArray(match.markets);
}

export async function PUT(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount();
    if (!authenticated.value) return authenticated.response!;
    if (authenticated.value.account.role !== "admin") {
      return Response.json({ error: "只有管理员可以更新公共比赛数据" }, { status: 403 });
    }

    const payload = await request.json() as { matches?: unknown };
    if (!Array.isArray(payload.matches) || payload.matches.length > MAX_MATCHES || !payload.matches.every(isMatch)) {
      return Response.json({ error: `比赛数据无效或超过 ${MAX_MATCHES} 场` }, { status: 400 });
    }

    const matches = [...new Map(
      clearMatchSelections(structuredClone(payload.matches))
        .map((match) => [match.id, match] as const),
    ).values()];
    const d1 = getD1();
    const now = new Date().toISOString();
    const userId = authenticated.value.account.id;
    const statements = [
      d1.prepare("DELETE FROM shared_matches"),
    ];

    for (let index = 0; index < matches.length; index += MATCHES_PER_STATEMENT) {
      const chunk = matches.slice(index, index + MATCHES_PER_STATEMENT);
      const placeholders = chunk.map((_, rowIndex) => {
        const offset = rowIndex * 5;
        return `(?${offset + 1}, ?${offset + 2}, ?${offset + 3}, ?${offset + 4}, ?${offset + 5})`;
      }).join(", ");
      const values = chunk.flatMap((match) => [
        match.id,
        match.date,
        JSON.stringify(match),
        userId,
        now,
      ]);
      statements.push(d1.prepare(`
        INSERT INTO shared_matches (match_id, business_date, data_json, updated_by, updated_at)
        VALUES ${placeholders}
      `).bind(...values));
    }

    await d1.batch(statements);
    return Response.json({ ok: true, savedAt: now, count: matches.length });
  } catch (error) {
    return routeError(error);
  }
}
