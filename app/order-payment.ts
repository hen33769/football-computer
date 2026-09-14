import { selectedMatches } from "./calculator";
import { normalizeSportteryMatchId } from "./sporttery";
import type { MatchItem, SavedSlip } from "./types";

export type CancelledOrderPaymentRisk = {
  affectedOrders: SavedSlip[];
  cancelledMatches: MatchItem[];
};

/**
 * 订单内嵌的比赛状态可能已过期；支付风险始终以当前共享比赛为准。
 */
export function collectCancelledOrderPaymentRisk(
  orders: SavedSlip[],
  currentMatches: MatchItem[],
): CancelledOrderPaymentRisk {
  const cancelledById = new Map(currentMatches.flatMap((match) => (
    match.saleStatus === "cancelled"
      ? [[normalizeSportteryMatchId(match.id), match] as const]
      : []
  )));
  const affectedOrders: SavedSlip[] = [];
  const cancelledMatchIds = new Set<string>();

  orders.forEach((order) => {
    const orderCancelledIds = selectedMatches(order.matches).flatMap((match) => {
      const matchId = normalizeSportteryMatchId(match.id);
      return cancelledById.has(matchId) ? [matchId] : [];
    });
    if (orderCancelledIds.length === 0) return;
    affectedOrders.push(order);
    orderCancelledIds.forEach((matchId) => cancelledMatchIds.add(matchId));
  });

  return {
    affectedOrders,
    cancelledMatches: [...cancelledMatchIds]
      .map((matchId) => cancelledById.get(matchId))
      .filter((match): match is MatchItem => Boolean(match)),
  };
}
