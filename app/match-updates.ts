import { clearMatchSelections } from "./cloud";
import { isMatchResult } from "./results";
import { normalizeSportteryMatchId } from "./sporttery";
import type { MatchItem } from "./types";

export type TrustedMatchUpdate =
  | { id: string; kind: "result"; result: NonNullable<MatchItem["result"]> }
  | { id: string; kind: "cancelled" };

/** 客户端只能提交官方赛果或取消终态，其它比赛字段一律忽略。 */
export function parseTrustedMatchUpdate(value: unknown): TrustedMatchUpdate | null {
  if (!value || typeof value !== "object") return null;
  const match = value as Partial<MatchItem>;
  const id = typeof match.id === "string" ? normalizeSportteryMatchId(match.id) : "";
  if (!id) return null;
  if (match.saleStatus === "cancelled") return { id, kind: "cancelled" };
  if (!isMatchResult(match.result) || match.result.source !== "api" || normalizeSportteryMatchId(match.result.matchId) !== id) return null;
  return { id, kind: "result", result: structuredClone(match.result) };
}

export function applyTrustedMatchUpdate(existing: MatchItem, update: TrustedMatchUpdate): MatchItem {
  if (normalizeSportteryMatchId(existing.id) !== update.id) {
    throw new Error(`比赛 ID 不匹配：${update.id}`);
  }
  if (update.kind === "result") return { ...existing, result: structuredClone(update.result) };
  return clearMatchSelections([{ ...existing, saleStatus: "cancelled" }])[0];
}
