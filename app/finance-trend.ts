import { calculateStake } from "./calculator";
import { isOrderPaid } from "./order-model";
import type { SavedSlip } from "./types";

export type FinanceTrendDateRange = {
  startDate?: string;
  endDate?: string;
};

export type FinanceTrendPoint = {
  date: string;
  expense: number;
  income: number;
  profit: number;
};

export type FinanceTrendResponse = {
  points: FinanceTrendPoint[];
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

export function buildFinanceTrendFromOrders(
  orders: SavedSlip[],
  rawRange: FinanceTrendDateRange = {},
): FinanceTrendPoint[] {
  const range = normalizeFinanceTrendDateRange(rawRange);
  const totals = new Map<string, { expenseCents: number; incomeCents: number }>();
  const inRange = (date: string) => (
    (!range.startDate || date >= range.startDate)
    && (!range.endDate || date <= range.endDate)
  );
  const totalsFor = (date: string) => {
    const current = totals.get(date) ?? { expenseCents: 0, incomeCents: 0 };
    totals.set(date, current);
    return current;
  };

  for (const order of orders) {
    if (isOrderPaid(order)) {
      const date = shanghaiDateKey(order.savedAt);
      if (date && inRange(date)) totalsFor(date).expenseCents += toCents(calculateStake(order.matches, order.passes, order.multiple));
    }
    if (order.settledAt) {
      const date = shanghaiDateKey(order.settledAt);
      if (date && inRange(date)) totalsFor(date).incomeCents += toCents(order.settledPrize ?? 0);
    }
  }

  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({
      date,
      expense: fromCents(values.expenseCents),
      income: fromCents(values.incomeCents),
      profit: fromCents(values.incomeCents - values.expenseCents),
    }));
}
