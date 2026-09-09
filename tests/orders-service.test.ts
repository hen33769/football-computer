import assert from "node:assert/strict";
import test from "node:test";
import { compactOrderToSavedSlip, savedSlipToCompactOrder, type CompactOrder } from "../app/order-model";
import { bulkUpdateOrders, createOrder, financePreviewForOrders, getOrder, listOrders } from "../app/server/orders-service";
import { getOrderFinanceCents } from "../app/server/finance-service";
import { SqliteD1 } from "./helpers/sqlite-d1";

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

test("撤回操作根据当前状态先撤回结账并保留支付状态", async () => {
  const settled: CompactOrder = {
    ...order("settled", "paid"),
    settledAt: "2026-09-09T02:00:00.000Z",
    settledPrize: 4,
    oddsLockedBeforePayment: false,
    oddsLockedBeforeSettlement: true,
  };
  const d1 = new FakeD1([settled]);

  const [withdrawn] = await bulkUpdateOrders(d1 as unknown as D1Database, "user", [settled], "withdraw");

  assert.equal(d1.batchCalls, 1);
  assert.equal(withdrawn.paymentStatus, "paid");
  assert.equal(withdrawn.settledAt, undefined);
  assert.equal(withdrawn.settledPrize, undefined);
  assert.equal(withdrawn.oddsLocked, true);
  assert.equal(withdrawn.oddsLockedBeforePayment, false);
  assert.equal(withdrawn.oddsLockedBeforeSettlement, undefined);
});

test("撤回操作对已支付未结账订单撤回支付并恢复支付前倍率锁定状态", async () => {
  const unlockedBeforePayment: CompactOrder = {
    ...order("unlocked", "paid"),
    oddsLockedBeforePayment: false,
  };
  const lockedBeforePayment: CompactOrder = {
    ...order("locked", "paid"),
    oddsLockedBeforePayment: true,
  };
  const d1 = new FakeD1([unlockedBeforePayment, lockedBeforePayment]);

  const withdrawn = await bulkUpdateOrders(
    d1 as unknown as D1Database,
    "user",
    [unlockedBeforePayment, lockedBeforePayment],
    "withdraw",
  );

  assert.equal(d1.batchCalls, 1);
  assert.deepEqual(withdrawn.map((item) => item.paymentStatus), ["unpaid", "unpaid"]);
  assert.deepEqual(withdrawn.map((item) => item.oddsLocked), [false, true]);
  assert.deepEqual(withdrawn.map((item) => item.oddsLockedBeforePayment), [undefined, undefined]);
});

test("撤回操作包含未支付订单时整批不写入", async () => {
  const current = [order("paid", "paid"), order("unpaid")];
  const d1 = new FakeD1(current);

  await assert.rejects(
    bulkUpdateOrders(d1 as unknown as D1Database, "user", current, "withdraw"),
    /没有可撤回的结账或支付/,
  );
  assert.equal(d1.batchCalls, 0);
});

test("支付锁定快照经过云端转换和结账撤回后仍可恢复，账本逐步回滚", async (t) => {
  const db = new SqliteD1();
  t.after(() => db.database.close());
  db.database.exec("INSERT INTO users (id, auth_subject, account, normalized_account) VALUES ('user', 'user', 'user', 'user')");
  const d1 = db.asD1();
  const saved = await createOrder(d1, "user", {
    ...order("lifecycle"),
    oddsLocked: true,
    hits: { "2040001": { spf: "win" } },
  });
  const [paid] = await bulkUpdateOrders(d1, "user", [saved], "pay");
  const roundTripped = savedSlipToCompactOrder(compactOrderToSavedSlip(paid));
  assert.equal(roundTripped.oddsLockedBeforePayment, true);
  const [settled] = await bulkUpdateOrders(d1, "user", [roundTripped], "settle");
  assert.deepEqual(await getOrderFinanceCents(d1, "user"), { expenseCents: 200, incomeCents: 400 });

  // 客户端即使附带其它变更，撤回也必须只使用服务端现有内容。
  const [unsettled] = await bulkUpdateOrders(d1, "user", [{ ...settled, name: "不应写入", multiple: 50, paymentStatus: "unpaid" }], "withdraw");
  assert.equal(unsettled.paymentStatus, "paid");
  assert.equal(unsettled.name, saved.name);
  assert.equal(unsettled.multiple, 1);
  assert.deepEqual(unsettled.hits, saved.hits);
  assert.deepEqual(await getOrderFinanceCents(d1, "user"), { expenseCents: 200, incomeCents: 0 });

  const [unpaid] = await bulkUpdateOrders(d1, "user", [unsettled], "withdraw");
  assert.equal(unpaid.paymentStatus, "unpaid");
  assert.equal(unpaid.oddsLocked, true);
  assert.equal(unpaid.oddsLockedBeforePayment, undefined);
  assert.deepEqual(await getOrderFinanceCents(d1, "user"), { expenseCents: 0, incomeCents: 0 });
  assert.deepEqual(await getOrder(d1, "user", unpaid.id), JSON.parse(JSON.stringify(unpaid)));
});

test("撤回拒绝旧版本和其他账号订单，SQL 执行失败或并发修改时整批回滚", async (t) => {
  const db = new SqliteD1();
  t.after(() => db.database.close());
  db.database.exec("INSERT INTO users (id, auth_subject, account, normalized_account) VALUES ('user', 'user', 'user', 'user')");
  const d1 = db.asD1();
  const saved = await Promise.all([createOrder(d1, "user", order("a", "paid")), createOrder(d1, "user", order("b", "paid"))]);
  const conflict = { status: 409, code: "ORDER_CONFLICT" };
  await assert.rejects(bulkUpdateOrders(d1, "other-user", saved, "withdraw"), conflict);
  await assert.rejects(bulkUpdateOrders(d1, "user", [{ ...saved[0], updatedAt: "stale" }], "withdraw"), conflict);
  await assert.rejects(bulkUpdateOrders(d1, "user", [{ ...saved[0], updatedAt: undefined }], "withdraw"), conflict);

  // 第二条更新失败，第一条已经执行的更新也必须撤销。
  db.database.exec("CREATE TRIGGER reject_second BEFORE UPDATE ON user_orders WHEN OLD.order_id = 'b' BEGIN SELECT RAISE(ABORT, 'test write failure'); END");
  await assert.rejects(bulkUpdateOrders(d1, "user", saved, "withdraw"), /test write failure/);
  assert.equal((await getOrder(d1, "user", "a")).paymentStatus, "paid");
  assert.equal((await getOrder(d1, "user", "b")).paymentStatus, "paid");
  db.database.exec("DROP TRIGGER reject_second");

  // 模拟读取版本后、提交事务前，另一请求更新了第二张订单。
  db.beforeBatch = () => db.database.exec("UPDATE user_orders SET updated_at = 'concurrent-version' WHERE order_id = 'b'");
  await assert.rejects(bulkUpdateOrders(d1, "user", saved, "withdraw"), /malformed JSON/);
  assert.equal((await getOrder(d1, "user", "a")).paymentStatus, "paid");
  assert.equal((await getOrder(d1, "user", "b")).updatedAt, "concurrent-version");
  assert.deepEqual(await getOrderFinanceCents(d1, "user"), { expenseCents: 400, incomeCents: 0 });
});

test("历史支付订单缺少锁定快照时可以撤回，历史未支付结账订单不会被标记为已支付", async () => {
  const legacyPaid = order("legacy-paid", "paid");
  const legacySettled = { ...order("legacy-settled"), settledAt: "2026-08-20T10:00:00.000Z", settledPrize: 0 };
  const current = [legacyPaid, legacySettled];
  const result = await bulkUpdateOrders(new FakeD1(current) as unknown as D1Database, "user", current, "withdraw");
  assert.equal(result[0].paymentStatus, "unpaid");
  assert.equal(result[0].oddsLocked, false);
  assert.equal(result[1].paymentStatus, "unpaid");
  assert.equal(result[1].settledAt, undefined);
  assert.equal(result[1].settledPrize, undefined);
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

test("订单列表的已支付状态可单独筛选并与订单状态按 OR 组合", async () => {
  const preparedSql: string[] = [];
  const boundArgs: unknown[][] = [];
  const d1 = {
    prepare: (sql: string) => {
      preparedSql.push(sql);
      const statement = {
        bind: (...args: unknown[]) => {
          boundArgs.push(args);
          return statement;
        },
        all: async () => ({ results: [] }),
        first: async () => ({ total: 0 }),
      };
      return statement;
    },
  };

  await listOrders(d1 as unknown as D1Database, "user", {
    statuses: ["paid", "success"],
    limit: 10,
  });

  assert.match(preparedSql[0], /\(payment_status = 'paid' OR status IN \(SELECT value FROM json_each\(\?\)\)\)/);
  assert.deepEqual(boundArgs[0], ["user", JSON.stringify(["success"]), 10, 0]);
});

test("订单列表的订单进度支持筛选已支付并与订单状态按 AND 组合", async () => {
  const preparedSql: string[] = [];
  const boundArgs: unknown[][] = [];
  const d1 = {
    prepare: (sql: string) => {
      preparedSql.push(sql);
      const statement = {
        bind: (...args: unknown[]) => {
          boundArgs.push(args);
          return statement;
        },
        all: async () => ({ results: [] }),
        first: async () => ({ total: 0 }),
      };
      return statement;
    },
  };

  await listOrders(d1 as unknown as D1Database, "user", {
    progress: "paid",
    statuses: ["success"],
    limit: 10,
  });

  assert.match(preparedSql[0], /WHERE user_id = \? AND payment_status = 'paid' AND status IN \(SELECT value FROM json_each\(\?\)\)/);
  assert.deepEqual(boundArgs[0], ["user", JSON.stringify(["success"]), 10, 0]);
});
