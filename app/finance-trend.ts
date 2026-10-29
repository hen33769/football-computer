import { calculateStake, getOrderStatus } from "./calculator";
import { isOrderPaid } from "./order-model";
import { afterTaxPrize, appliedOrderTax } from "./order-tax";
import type { SavedSlip } from "./types";

export type FinanceTrendDateRange = {
  startDate?: string;
  endDate?: string;
};

export type FinanceTrendPoint = {
  date: string;
  expense: number;
  orderExpense?: number;
  expenseCorrection?: number;
  tax: number;
  income: number;
  orderIncome?: number;
  incomeCorrection?: number;
  profit: number;
  cumulativeExpense: number;
  cumulativeTax: number;
  cumulativeIncome: number;
  cumulativeProfit: number;
};

export type FinanceTrendResponse = {
  points: FinanceTrendPoint[];
};

export type FinanceTrendCorrections = {
  expenseCorrection?: number;
  incomeCorrection?: number;
  date?: string;
};

export type FinanceTrendDailyAmount = {
  date: string;
  expense: number;
  orderExpense?: number;
  expenseCorrection?: number;
  tax?: number;
  income: number;
  orderIncome?: number;
  incomeCorrection?: number;
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const toCents = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100);
const fromCents = (value: number) => Math.round(value) / 100;
const MAX_TREND_DAYS = 5_000;

export function isFinanceTrendDate(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function normalizeFinanceTrendDateRange(range: FinanceTrendDateRange = {}) {
  const startDate = range.startDate?.trim() || undefined;
  const endDate = range.endDate?.trim() || undefined;
  if (startDate && !isFinanceTrendDate(startDate)) throw new Error("start_date 必须是有效的 yyyy-mm-dd 日期");
  if (endDate && !isFinanceTrendDate(endDate)) throw new Error("end_date 必须是有效的 yyyy-mm-dd 日期");
  if (startDate && endDate && startDate > endDate) throw new Error("start_date 不能晚于 end_date");
  return { startDate, endDate };
}

export function shanghaiDateKey(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return SHANGHAI_DATE_FORMATTER.format(parsed);
}

const addCalendarDays = (date: string, days: number) => {
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
};

export function buildCumulativeFinanceTrend(
  dailyAmounts: FinanceTrendDailyAmount[],
  corrections: FinanceTrendCorrections = {},
  rawRange: FinanceTrendDateRange = {},
): FinanceTrendPoint[] {
  const range = normalizeFinanceTrendDateRange(rawRange);
  const hasBreakdown = dailyAmounts.some((amount) => amount.orderExpense !== undefined
    || amount.expenseCorrection !== undefined
    || amount.orderIncome !== undefined
    || amount.incomeCorrection !== undefined);
  const amountsByDate = new Map<string, {
    expenseCents: number;
    orderExpenseCents: number;
    expenseCorrectionCents: number;
    taxCents: number;
    incomeCents: number;
    orderIncomeCents: number;
    incomeCorrectionCents: number;
  }>();
  for (const amount of dailyAmounts) {
    if (!isFinanceTrendDate(amount.date)) continue;
    const current = amountsByDate.get(amount.date) ?? {
      expenseCents: 0,
      orderExpenseCents: 0,
      expenseCorrectionCents: 0,
      taxCents: 0,
      incomeCents: 0,
      orderIncomeCents: 0,
      incomeCorrectionCents: 0,
    };
    const orderExpenseCents = toCents(amount.orderExpense ?? amount.expense);
    const expenseCorrectionCents = toCents(amount.expenseCorrection ?? 0);
    const orderIncomeCents = toCents(amount.orderIncome ?? amount.income);
    const incomeCorrectionCents = toCents(amount.incomeCorrection ?? 0);
    current.orderExpenseCents += orderExpenseCents;
    current.expenseCorrectionCents += expenseCorrectionCents;
    current.expenseCents += orderExpenseCents + expenseCorrectionCents;
    current.taxCents += toCents(amount.tax ?? 0);
    current.orderIncomeCents += orderIncomeCents;
    current.incomeCorrectionCents += incomeCorrectionCents;
    current.incomeCents += orderIncomeCents + incomeCorrectionCents;
    amountsByDate.set(amount.date, current);
  }

  const eventDates = [...amountsByDate.keys()].sort();
  const correctionDate = corrections.date && isFinanceTrendDate(corrections.date) ? corrections.date : undefined;
  if (eventDates.length === 0
    && toCents(corrections.expenseCorrection ?? 0) === 0
    && toCents(corrections.incomeCorrection ?? 0) === 0) return [];

  const startDate = range.startDate
    ?? (eventDates[0] ? addCalendarDays(eventDates[0], -1) : correctionDate);
  const endDate = range.endDate
    ?? eventDates.at(-1)
    ?? correctionDate;
  if (!startDate || !endDate || startDate > endDate) return [];

  let expenseCents = toCents(corrections.expenseCorrection ?? 0);
  let taxCents = 0;
  let incomeCents = toCents(corrections.incomeCorrection ?? 0);
  for (const date of eventDates) {
    if (date >= startDate) break;
    const amount = amountsByDate.get(date)!;
    expenseCents += amount.expenseCents;
    taxCents += amount.taxCents;
    incomeCents += amount.incomeCents;
  }

  const points: FinanceTrendPoint[] = [];
  for (let date = startDate, count = 0; date <= endDate; date = addCalendarDays(date, 1), count += 1) {
    if (count >= MAX_TREND_DAYS) throw new Error(`趋势日期范围最多支持 ${MAX_TREND_DAYS} 天`);
    const dailyExpenseCents = amountsByDate.get(date)?.expenseCents ?? 0;
    const dailyTaxCents = amountsByDate.get(date)?.taxCents ?? 0;
    const dailyIncomeCents = amountsByDate.get(date)?.incomeCents ?? 0;
    expenseCents += dailyExpenseCents;
    taxCents += dailyTaxCents;
    incomeCents += dailyIncomeCents;
    const breakdown = hasBreakdown ? {
      orderExpense: fromCents(amountsByDate.get(date)?.orderExpenseCents ?? 0),
      expenseCorrection: fromCents(amountsByDate.get(date)?.expenseCorrectionCents ?? 0),
      orderIncome: fromCents(amountsByDate.get(date)?.orderIncomeCents ?? 0),
      incomeCorrection: fromCents(amountsByDate.get(date)?.incomeCorrectionCents ?? 0),
    } : {};
    points.push({
      date,
      expense: fromCents(dailyExpenseCents),
      ...breakdown,
      tax: fromCents(dailyTaxCents),
      income: fromCents(dailyIncomeCents),
      profit: fromCents(dailyIncomeCents - dailyExpenseCents),
      cumulativeExpense: fromCents(expenseCents),
      cumulativeTax: fromCents(taxCents),
      cumulativeIncome: fromCents(incomeCents),
      cumulativeProfit: fromCents(incomeCents - expenseCents),
    });
  }
  return points;
}

export function buildFinanceTrendFromOrders(
  orders: SavedSlip[],
  corrections: FinanceTrendCorrections = {},
  rawRange: FinanceTrendDateRange = {},
  datedCorrections: Array<{
    kind: "expense" | "income";
    deltaCents: number;
    effectiveDate: string | null;
  }> = [],
): FinanceTrendPoint[] {
  const totals = new Map<string, {
    expenseCents: number;
    expenseCorrectionCents: number;
    taxCents: number;
    incomeCents: number;
    incomeCorrectionCents: number;
  }>();
  const totalsFor = (date: string) => {
    const current = totals.get(date) ?? {
      expenseCents: 0,
      expenseCorrectionCents: 0,
      taxCents: 0,
      incomeCents: 0,
      incomeCorrectionCents: 0,
    };
    totals.set(date, current);
    return current;
  };

  for (const order of orders) {
    if (isOrderPaid(order)) {
      const date = shanghaiDateKey(order.savedAt);
      if (date) totalsFor(date).expenseCents += toCents(calculateStake(order.matches, order.passes, order.multiple));
    }
    if (order.settledAt) {
      const date = shanghaiDateKey(order.settledAt);
      const status = getOrderStatus(order);
      const grossIncome = status === "success" ? order.settledPrize ?? 0 : 0;
      const tax = appliedOrderTax(order, status);
      if (date) {
        totalsFor(date).taxCents += toCents(tax);
        totalsFor(date).incomeCents += toCents(afterTaxPrize(grossIncome, tax));
      }
    }
  }

  for (const correction of datedCorrections) {
    if (!correction.effectiveDate || !isFinanceTrendDate(correction.effectiveDate)) continue;
    if (correction.kind === "expense") totalsFor(correction.effectiveDate).expenseCorrectionCents += correction.deltaCents;
    else totalsFor(correction.effectiveDate).incomeCorrectionCents += correction.deltaCents;
  }

  const includeBreakdown = datedCorrections.length > 0;
  return buildCumulativeFinanceTrend(
    [...totals.entries()].map(([date, values]) => ({
      date,
      expense: fromCents(values.expenseCents + values.expenseCorrectionCents),
      ...(includeBreakdown ? {
        orderExpense: fromCents(values.expenseCents),
        expenseCorrection: fromCents(values.expenseCorrectionCents),
        orderIncome: fromCents(values.incomeCents),
        incomeCorrection: fromCents(values.incomeCorrectionCents),
      } : {}),
      tax: fromCents(values.taxCents),
      income: fromCents(values.incomeCents + values.incomeCorrectionCents),
    })),
    corrections,
    rawRange,
  );
}
