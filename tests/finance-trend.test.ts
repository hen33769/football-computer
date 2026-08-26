import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCumulativeFinanceTrend,
  buildFinanceTrendFromOrders,
  isFinanceTrendDate,
  normalizeFinanceTrendDateRange,
} from "../app/finance-trend";
import { getFinanceTrend } from "../app/server/finance-service";
import type { SavedSlip } from "../app/types";

const paidOrder = (overrides: Partial<SavedSlip> = {}): SavedSlip => ({
  id: "order-1",
  name: "测试订单",
  savedAt: "2026-08-20T16:30:00.000Z",
  paymentStatus: "paid",
  settledAt: "2026-08-21T17:00:00.000Z",
  settledPrize: 5.5,
  passes: [1],
  multiple: 1,
  matches: [{
    id: "2040001",
    date: "2026-08-21",
    weekday: "周五",
    code: "001",
    league: "测试联赛",
    time: "2026-08-21 20:00",
    home: "主队",
    away: "客队",
    markets: [{
      type: "spf",
      options: [{ id: "win", label: "主胜", odds: 2.5, selected: true }],
    }],
  }],
  ...overrides,
});

test("财务趋势日期参数严格校验真实日期和先后顺序", () => {
  assert.equal(isFinanceTrendDate("2026-02-28"), true);
  assert.equal(isFinanceTrendDate("2026-02-29"), false);
  assert.equal(isFinanceTrendDate("2026-8-25"), false);
  assert.deepEqual(normalizeFinanceTrendDateRange({ startDate: " 2026-08-01 ", endDate: "2026-08-31" }), {
    startDate: "2026-08-01",
    endDate: "2026-08-31",
  });
  assert.throws(() => normalizeFinanceTrendDateRange({ startDate: "2026-09-01", endDate: "2026-08-31" }), /不能晚于/);
});

test("游客订单趋势以纠错值为累计初值并按中国时区归集每日收支", () => {
  const points = buildFinanceTrendFromOrders([
    paidOrder(),
    paidOrder({ id: "order-2", settledAt: undefined, settledPrize: undefined }),
  ], { expenseCorrection: 1.25, incomeCorrection: 2.75 });

  assert.deepEqual(points, [
    {
      date: "2026-08-20",
      expense: 0,
      income: 0,
      profit: 0,
      cumulativeExpense: 1.25,
      cumulativeIncome: 2.75,
      cumulativeProfit: 1.5,
    },
    {
      date: "2026-08-21",
      expense: 4,
      income: 0,
      profit: -4,
      cumulativeExpense: 5.25,
      cumulativeIncome: 2.75,
      cumulativeProfit: -2.5,
    },
    {
      date: "2026-08-22",
      expense: 0,
      income: 5.5,
      profit: 5.5,
      cumulativeExpense: 5.25,
      cumulativeIncome: 8.25,
      cumulativeProfit: 3,
    },
  ]);
});

test("游客订单趋势过滤日期范围且不计入未支付订单支出", () => {
  const points = buildFinanceTrendFromOrders([
    paidOrder({ paymentStatus: "unpaid" }),
  ], { expenseCorrection: 1, incomeCorrection: 2 }, { startDate: "2026-08-22", endDate: "2026-08-22" });

  assert.deepEqual(points, [
    {
      date: "2026-08-22",
      expense: 0,
      income: 5.5,
      profit: 5.5,
      cumulativeExpense: 1,
      cumulativeIncome: 7.5,
      cumulativeProfit: 6.5,
    },
  ]);
});

test("趋势补齐没有收支事件的自然日，保证每个日期都有 tooltip 数据点", () => {
  const points = buildFinanceTrendFromOrders([
    paidOrder({ settledAt: "2026-08-23T17:00:00.000Z" }),
  ]);

  assert.deepEqual(points.map((point) => point.date), [
    "2026-08-20",
    "2026-08-21",
    "2026-08-22",
    "2026-08-23",
    "2026-08-24",
  ]);
  assert.deepEqual(points[2], {
    date: "2026-08-22",
    expense: 0,
    income: 0,
    profit: 0,
    cumulativeExpense: 2,
    cumulativeIncome: 0,
    cumulativeProfit: -2,
  });
});

test("仅有纠错值时也返回累计初始点", () => {
  assert.deepEqual(buildCumulativeFinanceTrend([], {
    expenseCorrection: 12,
    incomeCorrection: 5,
    date: "2026-08-25",
  }), [{
    date: "2026-08-25",
    expense: 0,
    income: 0,
    profit: 0,
    cumulativeExpense: 12,
    cumulativeIncome: 5,
    cumulativeProfit: -7,
  }]);
});

test("云端趋势查询绑定用户和截止日期，并把纠错值计入累计初值", async () => {
  let eventSql = "";
  const boundArgs: unknown[][] = [];
  const d1 = {
    prepare: (value: string) => {
      const isCorrection = value.includes("FROM user_finance_corrections");
      if (!isCorrection) eventSql = value;
      const statement = {
        bind: (...values: unknown[]) => {
          boundArgs.push(values);
          return statement;
        },
        all: async () => ({ results: [{ date: "2026-08-25", expense_cents: 1234, income_cents: 5678 }] }),
        first: async () => ({
          expense_correction_cents: 125,
          income_correction_cents: 275,
          revision: 1,
          updated_at: "2026-08-24T16:00:00.000Z",
        }),
      };
      return statement;
    },
  };

  const response = await getFinanceTrend(d1 as unknown as D1Database, "user-1", {
    startDate: "2026-08-25",
    endDate: "2026-08-25",
  });

  assert.match(eventSql, /date\(saved_at, '\+8 hours'\)/);
  assert.match(eventSql, /date\(settled_at, '\+8 hours'\)/);
  assert.doesNotMatch(eventSql, /event_date >=/);
  assert.deepEqual(boundArgs, [["user-1", "2026-08-25"], ["user-1"]]);
  assert.deepEqual(response, {
    points: [{
      date: "2026-08-25",
      expense: 12.34,
      income: 56.78,
      profit: 44.44,
      cumulativeExpense: 13.59,
      cumulativeIncome: 59.53,
      cumulativeProfit: 45.94,
    }],
  });
});
