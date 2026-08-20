import { calculateStake } from "./calculator";
import type { SavedSlip } from "./types";
import { isOrderPaid } from "./order-model";

const paidStake = (order: SavedSlip) => isOrderPaid(order)
  ? calculateStake(order.matches, order.passes, order.multiple)
  : 0;

export const sortSavedOrders = (orders: SavedSlip[]) => [...orders].sort((left, right) => {
  const leftTime = new Date(left.savedAt).getTime();
  const rightTime = new Date(right.savedAt).getTime();
  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);
  if (leftValid && rightValid && leftTime !== rightTime) return rightTime - leftTime;
  if (leftValid !== rightValid) return rightValid ? 1 : -1;
  return right.savedAt.localeCompare(left.savedAt);
});

export const orderLedgerTotals = (orders: SavedSlip[]) => ({
  expense: orders.reduce((total, order) => total + paidStake(order), 0),
  income: orders.reduce((total, order) => total + (order.settledPrize ?? 0), 0),
});

/** 以导入订单更新同 ID 订单，并保留导入对象未提供的现有可选字段。 */
export function unionSavedOrders(current: SavedSlip[], incoming: SavedSlip[]) {
  const nextOrders = [...current];
  let added = 0;
  let updated = 0;
  let expenseDelta = 0;
  let incomeDelta = 0;

  incoming.forEach((order) => {
    const currentIndex = order.id ? nextOrders.findIndex((item) => item.id === order.id) : -1;
    if (currentIndex >= 0) {
      const currentOrder = nextOrders[currentIndex];
      const mergedOrder = { ...currentOrder, ...order };
      nextOrders[currentIndex] = mergedOrder;
      expenseDelta += paidStake(mergedOrder) - paidStake(currentOrder);
      incomeDelta += (mergedOrder.settledPrize ?? 0) - (currentOrder.settledPrize ?? 0);
      updated += 1;
      return;
    }
    nextOrders.push(order);
    expenseDelta += paidStake(order);
    incomeDelta += order.settledPrize ?? 0;
    added += 1;
  });

  return {
    nextOrders: sortSavedOrders(nextOrders),
    added,
    updated,
    expenseDelta,
    incomeDelta,
  };
}
