import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("游客订单趋势按中国时区分别归集下单日支出和结账日收入", () => {
  const points = buildFinanceTrendFromOrders([
    paidOrder(),
    paidOrder({ id: "order-2", settledAt: undefined, settledPrize: undefined }),
  ]);

  assert.deepEqual(points, [
    { date: "2026-08-21", expense: 4, income: 0, profit: -4 },
    { date: "2026-08-22", expense: 0, income: 5.5, profit: 5.5 },
  ]);
});

test("游客订单趋势过滤日期范围且不计入未支付订单支出", () => {
  const points = buildFinanceTrendFromOrders([
    paidOrder({ paymentStatus: "unpaid" }),
  ], { startDate: "2026-08-22", endDate: "2026-08-22" });

  assert.deepEqual(points, [
    { date: "2026-08-22", expense: 0, income: 5.5, profit: 5.5 },
  ]);
});

test("云端趋势查询绑定用户和日期，并以元返回精确利润", async () => {
  let sql = "";
  let args: unknown[] = [];
  const d1 = {
    prepare: (value: string) => {
      sql = value;
      const statement = {
        bind: (...values: unknown[]) => {
          args = values;
          return statement;
        },
        all: async () => ({ results: [{ date: "2026-08-25", expense_cents: 1234, income_cents: 5678 }] }),
      };
      return statement;
    },
  };

  const response = await getFinanceTrend(d1 as unknown as D1Database, "user-1", {
    startDate: "2026-08-01",
    endDate: "2026-08-31",
  });

  assert.match(sql, /date\(saved_at, '\+8 hours'\)/);
  assert.match(sql, /date\(settled_at, '\+8 hours'\)/);
  assert.deepEqual(args, ["user-1", "2026-08-01", "2026-08-31"]);
  assert.deepEqual(response, {
    points: [{ date: "2026-08-25", expense: 12.34, income: 56.78, profit: 44.44 }],
  });
});
