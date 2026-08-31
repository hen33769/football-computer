import assert from "node:assert/strict";
import test from "node:test";
import type { CompactOrder } from "../app/order-model";
import { bulkUpdateOrders, financePreviewForOrders } from "../app/server/orders-service";

const order = (id: string, paymentStatus: "unpaid" | "paid" = "unpaid"): CompactOrder => ({
  id,
  name: `订单 ${id}`,
  savedAt: "2026-08-20T02:00:00.000Z",
  updatedAt: `version-${id}`,
  passes: [1],
  multiple: 1,
  paymentStatus,
  oddsLocked: paymentStatus === "paid",
  selections: [{
    matchId: "2040001",
    date: "2026-08-20",
    weekday: "周四",
    code: "001",
    league: "测试",
    time: "2026-08-20 20:00",
    home: "主队",
    away: "客队",
    marketType: "spf",
    optionId: "win",
    optionLabel: "主胜",
    odds: 2,
  }],
});

class FakeD1 {
  batchCalls = 0;
  readonly rows: Array<{ order_id: string; data_json: string; updated_at: string }>;

  constructor(orders: CompactOrder[]) {
    this.rows = orders.map((item) => ({
      order_id: item.id,
      data_json: JSON.stringify(item),
      updated_at: item.updatedAt!,
    }));
  }

  prepare(sql: string) {
    const statement = {
      sql,
      args: [] as unknown[],
      bind: (...args: unknown[]) => {
        statement.args = args;
        return statement;
      },
      all: async () => ({ results: this.rows }),
    };
    return statement;
  }

  async batch(statements: unknown[]) {
    this.batchCalls += 1;
    return statements.map(() => ({ success: true }));
  }
}

test("批量支付会先完整校验，再将整批订单标记为已支付并锁定倍率", async () => {
  const current = [order("a"), order("b")];
  const d1 = new FakeD1(current);
  const incoming = current.map((item, index) => ({
    ...item,
    selections: item.selections.map((selection) => ({ ...selection, odds: selection.odds + index + 0.1 })),
  }));

  const updated = await bulkUpdateOrders(d1 as unknown as D1Database, "user", incoming, "pay");

  assert.equal(d1.batchCalls, 1);
  assert.deepEqual(updated.map((item) => item.paymentStatus), ["paid", "paid"]);
  assert.deepEqual(updated.map((item) => item.oddsLocked), [true, true]);
  assert.deepEqual(updated.map((item) => item.selections[0].odds), [2.1, 3.1]);
});

test("批量支付任一订单不符合条件时整批不写入", async () => {
  const current = [order("a"), order("b", "paid")];
  const d1 = new FakeD1(current);

  await assert.rejects(
    bulkUpdateOrders(d1 as unknown as D1Database, "user", current, "pay"),
    /不属于未支付订单/,
  );
  assert.equal(d1.batchCalls, 0);
});

test("批量支付和判断赛果忽略手动补单往返产生的投注项顺序变化", async () => {
  const base = order("manual-order");
  const current: CompactOrder = {
    ...base,
    passes: [1, 2],
    selections: [
      base.selections[0],
      {
        ...base.selections[0],
        matchId: "2040002",
        code: "002",
        home: "乙队",
        away: "丙队",
        optionId: "draw",
        optionLabel: "平",
        odds: 3,
      },
    ],
  };
  const incoming: CompactOrder = {
    ...current,
    passes: [...current.passes].reverse(),
    selections: [...current.selections].reverse(),
  };

  const paid = await bulkUpdateOrders(
    new FakeD1([current]) as unknown as D1Database,
    "user",
    [incoming],
    "pay",
  );
  assert.equal(paid[0].paymentStatus, "paid");

  const judged = await bulkUpdateOrders(
    new FakeD1([current]) as unknown as D1Database,
    "user",
    [incoming],
    "judge",
  );
  assert.deepEqual(judged[0].selections.map((selection) => selection.matchId), ["2040002", "2040001"]);

  const changedOdds = {
    ...incoming,
    selections: incoming.selections.map((selection, index) => index === 0 ? { ...selection, odds: selection.odds + 1 } : selection),
  };
  await assert.rejects(
    bulkUpdateOrders(
      new FakeD1([current]) as unknown as D1Database,
      "user",
      [changedOdds],
      "judge",
    ),
    /不能在判断赛果时修改已选倍率/,
  );
});

test("普通批量编辑允许修改未支付订单的投注结构", async () => {
  const current = order("a");
  const d1 = new FakeD1([current]);
  const incoming: CompactOrder = {
    ...current,
    passes: [2],
    multiple: 3,
    selections: [
      ...current.selections,
      { ...current.selections[0], matchId: "2040002", optionId: "draw", optionLabel: "平", odds: 3 },
    ],
  };

  const [updated] = await bulkUpdateOrders(d1 as unknown as D1Database, "user", [incoming], "update");

  assert.equal(d1.batchCalls, 1);
  assert.deepEqual(updated.passes, [2]);
  assert.equal(updated.multiple, 3);
  assert.equal(updated.selections.length, 2);
});

test("账本预览只把已支付订单计入支出", () => {
  const preview = financePreviewForOrders([order("unpaid"), order("paid", "paid")]);
  assert.deepEqual(preview, { expense: 2, income: 0 });
});
