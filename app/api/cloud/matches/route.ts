import { getD1 } from "../../../../db";
import { clearMatchSelections } from "../../../cloud";
import {
  mergeSportteryMatchOdds,
  normalizeSportteryMatchId,
  retainedSportteryMatchDateCutoff,
} from "../../../sporttery";
import type { MatchItem } from "../../../types";
import { parseJson, requireAuthenticatedCloudAccount, routeError } from "../../../cloud-server";

const MAX_MATCHES = 500;
const MATCHES_PER_STATEMENT = 20;

type SharedMatchRow = {
  match_id: string;
  data_json: string;
};

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
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;

    const payload = await request.json() as { matches?: unknown };
    if (!Array.isArray(payload.matches) || payload.matches.length > MAX_MATCHES || !payload.matches.every(isMatch)) {
      return Response.json({ error: `比赛数据无效或超过 ${MAX_MATCHES} 场` }, { status: 400 });
    }

    const uploadedMatches = [...new Map(
      clearMatchSelections(structuredClone(payload.matches))
        .map((match) => {
          const normalized = { ...match, id: normalizeSportteryMatchId(match.id) };
          return [normalized.id, normalized] as const;
        }),
    ).values()];
    const d1 = getD1();
    const now = new Date().toISOString();
    const userId = authenticated.value.account.id;
    const existingRows = await d1.prepare("SELECT match_id, data_json FROM shared_matches").all<SharedMatchRow>();
    const existingMatches = new Map((existingRows.results ?? []).flatMap((row) => {
      const match = parseJson<MatchItem | null>(row.data_json, null);
      return match ? [[normalizeSportteryMatchId(row.match_id), match] as const] : [];
    }));
    const matches = clearMatchSelections(uploadedMatches.map((match) => (
      mergeSportteryMatchOdds(match, existingMatches.get(match.id))
    )));
    const latestBusinessDate = matches.reduce<string | null>((latest, match) => (
      !latest || match.date > latest ? match.date : latest
    ), null);
    const statements = latestBusinessDate
      ? [d1.prepare("DELETE FROM shared_matches WHERE business_date < ?1").bind(retainedSportteryMatchDateCutoff(latestBusinessDate))]
      : [];

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
        ON CONFLICT(match_id) DO UPDATE SET
          business_date = excluded.business_date,
          data_json = excluded.data_json,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `).bind(...values));
    }

    if (statements.length > 0) await d1.batch(statements);
    return Response.json({ ok: true, savedAt: now, count: matches.length });
  } catch (error) {
    return routeError(error);
  }
}
