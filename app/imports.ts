import { calculateCurrentPrize, calculateStake, getOrderStatus } from "./calculator";
import type { SavedSlip } from "./types";
import { isOrderPaid } from "./order-model";
import { afterTaxPrize, appliedOrderTax } from "./order-tax";

const paidStake = (order: SavedSlip) => isOrderPaid(order)
  ? calculateStake(order.matches, order.passes, order.multiple)
  : 0;

export const orderStakeTotal = (orders: SavedSlip[]) => orders.reduce(
  (total, order) => total + calculateStake(order.matches, order.passes, order.multiple),
  0,
);

export const sortSavedOrders = (orders: SavedSlip[]) => [...orders].sort((left, right) => {
  const leftTime = new Date(left.savedAt).getTime();
  const rightTime = new Date(right.savedAt).getTime();
  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);
  if (leftValid && rightValid && leftTime !== rightTime) return rightTime - leftTime;
  if (leftValid !== rightValid) return rightValid ? 1 : -1;
  return right.savedAt.localeCompare(left.savedAt);
});

export const orderLedgerIncome = (order: SavedSlip) => {
  const status = getOrderStatus(order);
  const grossIncome = order.settledAt && status === "success" ? order.settledPrize ?? 0 : 0;
  const tax = appliedOrderTax(order, status);
  return afterTaxPrize(grossIncome, tax);
};

export const orderLedgerBreakdown = (orders: SavedSlip[]) => orders.reduce((totals, order) => {
  const status = getOrderStatus(order);
  const grossIncome = order.settledAt && status === "success" ? order.settledPrize ?? 0 : 0;
  const tax = appliedOrderTax(order, status);
  totals.expense += paidStake(order);
  totals.grossIncome += grossIncome;
  totals.tax += tax;
  totals.income += afterTaxPrize(grossIncome, tax);
  return totals;
}, { expense: 0, grossIncome: 0, tax: 0, income: 0 });

export const orderLedgerTotals = (orders: SavedSlip[]) => {
  const totals = orderLedgerBreakdown(orders);
  return { expense: totals.expense, income: totals.income };
};

const orderFilterIncome = (order: SavedSlip) => Math.max(
  order.settledPrize ?? 0,
  calculateCurrentPrize(order.matches, order.passes, order.multiple, order.hits ?? {}),
);

export const orderFilterIncomeBreakdown = (orders: SavedSlip[]) => orders.reduce((totals, order) => {
  if (!isOrderPaid(order) || getOrderStatus(order) !== "success") return totals;
  const grossIncome = orderFilterIncome(order);
  const tax = appliedOrderTax({ ...order, settledPrize: grossIncome }, "success");
  totals.grossIncome += grossIncome;
  totals.tax += tax;
  totals.income += afterTaxPrize(grossIncome, tax);
  return totals;
}, { grossIncome: 0, tax: 0, income: 0 });

/** 订单页筛选摘要的收入：只把筛选结果中的已支付成功订单计入，包括未结账订单。 */
export const orderFilterIncomeTotal = (orders: SavedSlip[]) => orders.reduce(
  (total, order) => total + orderFilterIncomeBreakdown([order]).income,
  0,
);

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
      incomeDelta += orderLedgerIncome(mergedOrder) - orderLedgerIncome(currentOrder);
      updated += 1;
      return;
    }
    nextOrders.push(order);
    expenseDelta += paidStake(order);
    incomeDelta += orderLedgerIncome(order);
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
