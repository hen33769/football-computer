import { calculateStake } from "./calculator";
import type { SavedSlip } from "./types";

export const sortSavedOrders = (orders: SavedSlip[]) => [...orders].sort(
  (left, right) => new Date(right.savedAt).getTime() - new Date(left.savedAt).getTime(),
);

export const orderLedgerTotals = (orders: SavedSlip[]) => ({
  expense: orders.reduce((total, order) => total + calculateStake(order.matches, order.passes, order.multiple), 0),
  income: orders.reduce((total, order) => total + (order.settledPrize ?? 0), 0),
});

/** 保留现有同 ID 订单，只补入新的导入订单。 */
export function unionSavedOrders(current: SavedSlip[], incoming: SavedSlip[]) {
  const nextOrders = [...current];
  const existingIds = new Set(nextOrders.flatMap((order) => order.id ? [order.id] : []));
  let added = 0;
  let expenseDelta = 0;
  let incomeDelta = 0;

  incoming.forEach((order) => {
    if (order.id && existingIds.has(order.id)) return;
    nextOrders.push(order);
    if (order.id) existingIds.add(order.id);
    expenseDelta += calculateStake(order.matches, order.passes, order.multiple);
    incomeDelta += order.settledPrize ?? 0;
    added += 1;
  });

  return {
    nextOrders: sortSavedOrders(nextOrders),
    added,
    skipped: incoming.length - added,
    expenseDelta,
    incomeDelta,
  };
}
