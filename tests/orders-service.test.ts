import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  compactOrderToSavedSlip,
  isCompactOrder,
  isOrderPendingSettlement,
  isOrderProgressFilterValue,
  isOrderUnpaidHopeful,
  normalizeCompactOrder,
  savedSlipToCompactOrder,
  type CompactOrder,
} from "../app/order-model";
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

test("待结账状态要求订单已支付且尚未结账", () => {
  assert.equal(isOrderPendingSettlement(order("unpaid")), false);
  assert.equal(isOrderPendingSettlement(order("paid", "paid")), true);
  assert.equal(isOrderPendingSettlement({ ...order("settled", "paid"), settledAt: "2026-09-14T10:00:00.000Z" }), false);
});

test("具体赛果比分和赔率经云端紧凑模型往返不丢失，旧确认字段不再保留", () => {
  const compact: CompactOrder & { confirmedAt?: string } = {
    ...order("score-result"),
    resultValues: { "2040001": { score: "winOther" } },
    resultScores: { "2040001": { home: 6, away: 0 } },
    resultOdds: { "2040001": { score: 250, halfFull: 16.5 } },
    settledAt: "2026-08-21T00:00:00.000Z",
    settledPrize: 500,
    confirmedAt: "2026-08-22T00:00:00.000Z",
  };

  const roundTripped = savedSlipToCompactOrder(compactOrderToSavedSlip(compact));

  assert.equal("confirmedAt" in normalizeCompactOrder(compact), false);
  assert.deepEqual(roundTripped.resultValues, compact.resultValues);
  assert.deepEqual(roundTripped.resultScores, compact.resultScores);
  assert.notEqual(roundTripped.resultScores, compact.resultScores);
  assert.notEqual(roundTripped.resultScores?.["2040001"], compact.resultScores?.["2040001"]);
  assert.deepEqual(roundTripped.resultOdds, compact.resultOdds);
  assert.equal("confirmedAt" in roundTripped, false);
  assert.notEqual(roundTripped.resultOdds, compact.resultOdds);
  assert.notEqual(roundTripped.resultOdds?.["2040001"], compact.resultOdds?.["2040001"]);
  assert.equal(isCompactOrder(roundTripped), true);
  assert.equal(isCompactOrder({ ...roundTripped, resultScores: { "2040001": { home: -1, away: 0 } } }), false);
  assert.equal(isCompactOrder({ ...roundTripped, resultOdds: { "2040001": { score: 0 } } }), false);
});

test("未支付且有希望状态排除已支付和已有中奖结果的订单", () => {
  assert.equal(isOrderUnpaidHopeful(order("hopeful")), true);
  assert.equal(isOrderUnpaidHopeful(order("paid", "paid")), false);
  assert.equal(isOrderUnpaidHopeful({ ...order("success"), hits: { "2040001": { spf: "win" } } }), false);
});

class FakeD1 {
  batchCalls = 0;
  readonly rows: Array<{ order_id: string; data_json: string; tax_cents: number | null; updated_at: string }>;

  constructor(orders: CompactOrder[]) {
    this.rows = orders.map((item) => ({
      order_id: item.id,
      data_json: JSON.stringify(item),
      tax_cents: typeof item.taxAmount === "number" ? Math.round(item.taxAmount * 100) : null,
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
      run: async () => ({ success: true, meta: { changes: 0 } }),
    };
    return statement;
  }

  async batch(statements: unknown[]) {
    this.batchCalls += 1;
    return statements.map(() => ({ success: true }));
  }
}

test("批量支付会先完整校验，再将整批订单标记为已支付并保留手动锁定状态", async () => {
  const current = [order("a"), { ...order("b"), oddsLocked: true }];
  const d1 = new FakeD1(current);
  const incoming = current.map((item, index) => ({
    ...item,
    selections: item.selections.map((selection) => ({ ...selection, odds: selection.odds + index + 0.1 })),
  }));

  const updated = await bulkUpdateOrders(d1 as unknown as D1Database, "user", incoming, "pay");

  assert.equal(d1.batchCalls, 1);
  assert.deepEqual(updated.map((item) => item.paymentStatus), ["paid", "paid"]);
  assert.deepEqual(updated.map((item) => item.oddsLocked), [false, true]);
  assert.deepEqual(updated.map((item) => item.oddsLockedBeforePayment), [undefined, undefined]);
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

test("撤回支付保留当前手动锁定状态并清理历史支付锁定快照", async () => {
  const unlocked: CompactOrder = {
    ...order("unlocked", "paid"),
    oddsLocked: false,
    oddsLockedBeforePayment: false,
  };
  const locked: CompactOrder = {
    ...order("locked", "paid"),
    oddsLocked: true,
    oddsLockedBeforePayment: true,
  };
  const d1 = new FakeD1([unlocked, locked]);

  const withdrawn = await bulkUpdateOrders(
    d1 as unknown as D1Database,
    "user",
    [unlocked, locked],
    "withdraw",
  );

  assert.equal(d1.batchCalls, 1);
  assert.deepEqual(withdrawn.map((item) => item.paymentStatus), ["unpaid", "unpaid"]);
  assert.deepEqual(withdrawn.map((item) => item.oddsLocked), [false, true]);
  assert.deepEqual(withdrawn.map((item) => item.oddsLockedBeforePayment), [undefined, undefined]);
});

test("已支付未结账订单可更新倍率和手动锁定状态，但投注结构保持冻结", async () => {
  const current = { ...order("paid-edit", "paid"), oddsLocked: true };
  const d1 = new FakeD1([current]);
  const editedOdds = {
    ...current,
    oddsLocked: false,
    selections: current.selections.map((selection) => ({ ...selection, odds: 2.5 })),
  };

  const [updated] = await bulkUpdateOrders(d1 as unknown as D1Database, "user", [editedOdds], "update");

  assert.equal(d1.batchCalls, 1);
  assert.equal(updated.paymentStatus, "paid");
  assert.equal(updated.oddsLocked, false);
  assert.equal(updated.selections[0].odds, 2.5);

  const changedStructure = { ...current, multiple: 2 };
  const rejectedD1 = new FakeD1([current]);
  await assert.rejects(
    bulkUpdateOrders(rejectedD1 as unknown as D1Database, "user", [changedStructure], "update"),
    /投注项、串关和倍数均已冻结/,
  );
  assert.equal(rejectedD1.batchCalls, 0);
});

test("批量倍率更新支持已支付未结账订单并保留支付状态", async () => {
  const current = { ...order("paid-refresh", "paid"), oddsLocked: false };
  const incoming = {
    ...current,
    selections: current.selections.map((selection) => ({ ...selection, odds: 2.8 })),
  };
  const d1 = new FakeD1([current]);

  const [updated] = await bulkUpdateOrders(d1 as unknown as D1Database, "user", [incoming], "refresh-odds");

  assert.equal(updated.paymentStatus, "paid");
  assert.equal(updated.oddsLocked, false);
  assert.equal(updated.selections[0].odds, 2.8);
});

test("已结账订单不能修改倍率或解除锁定", async () => {
  const current = {
    ...order("settled", "paid"),
    settledAt: "2026-10-08T02:00:00.000Z",
    oddsLocked: true,
  };
  const incoming = {
    ...current,
    oddsLocked: false,
    selections: current.selections.map((selection) => ({ ...selection, odds: 2.5 })),
  };
  const d1 = new FakeD1([current]);

  await assert.rejects(
    bulkUpdateOrders(d1 as unknown as D1Database, "user", [incoming], "update"),
    /投注项、串关、倍数和倍率均已冻结/,
  );
  assert.equal(d1.batchCalls, 0);
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

test("手动锁定状态经过支付、结账和两次撤回后仍可恢复，账本逐步回滚", async (t) => {
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
  assert.equal(roundTripped.oddsLockedBeforePayment, undefined);
  const [settled] = await bulkUpdateOrders(d1, "user", [roundTripped], "settle");
  assert.deepEqual(await getOrderFinanceCents(d1, "user"), { expenseCents: 200, grossIncomeCents: 400, taxCents: 0, incomeCents: 400 });

  // 客户端即使附带其它变更，撤回也必须只使用服务端现有内容。
  const [unsettled] = await bulkUpdateOrders(d1, "user", [{ ...settled, name: "不应写入", multiple: 50, paymentStatus: "unpaid" }], "withdraw");
  assert.equal(unsettled.paymentStatus, "paid");
  assert.equal(unsettled.name, saved.name);
  assert.equal(unsettled.multiple, 1);
  assert.deepEqual(unsettled.hits, saved.hits);
  assert.deepEqual(await getOrderFinanceCents(d1, "user"), { expenseCents: 200, grossIncomeCents: 0, taxCents: 0, incomeCents: 0 });

  const [unpaid] = await bulkUpdateOrders(d1, "user", [unsettled], "withdraw");
  assert.equal(unpaid.paymentStatus, "unpaid");
  assert.equal(unpaid.oddsLocked, true);
  assert.equal(unpaid.oddsLockedBeforePayment, undefined);
  assert.deepEqual(await getOrderFinanceCents(d1, "user"), { expenseCents: 0, grossIncomeCents: 0, taxCents: 0, incomeCents: 0 });
  assert.deepEqual(await getOrder(d1, "user", unpaid.id), JSON.parse(JSON.stringify(unpaid)));
});

test("高额成功订单结账自动计税，结账后可手动改税且再次判断会覆盖", async (t) => {
  const db = new SqliteD1();
  t.after(() => db.database.close());
  db.database.exec("INSERT INTO users (id, auth_subject, account, normalized_account) VALUES ('user', 'user', 'user', 'user')");
  const d1 = db.asD1();
  const highPrize = {
    ...order("high-prize"),
    selections: order("high-prize").selections.map((selection) => ({ ...selection, odds: 6_000 })),
    hits: { "2040001": { spf: "win" as const } },
  };

  const saved = await createOrder(d1, "user", highPrize);
  const [paid] = await bulkUpdateOrders(d1, "user", [saved], "pay");
  const [settled] = await bulkUpdateOrders(d1, "user", [paid], "settle");
  assert.equal(settled.settledPrize, 12_000);
  assert.equal(settled.taxAmount, 2_400);
  assert.deepEqual(await getOrderFinanceCents(d1, "user"), {
    expenseCents: 200,
    grossIncomeCents: 1_200_000,
    taxCents: 240_000,
    incomeCents: 960_000,
  });

  const [manuallyAdjusted] = await bulkUpdateOrders(d1, "user", [{ ...settled, taxAmount: 1_000 }], "update");
  assert.equal(manuallyAdjusted.taxAmount, 1_000);
  assert.deepEqual(await getOrderFinanceCents(d1, "user"), {
    expenseCents: 200,
    grossIncomeCents: 1_200_000,
    taxCents: 100_000,
    incomeCents: 1_100_000,
  });

  const [rejudged] = await bulkUpdateOrders(d1, "user", [manuallyAdjusted], "judge");
  assert.equal(rejudged.taxAmount, 2_400);
  await assert.rejects(
    bulkUpdateOrders(d1, "user", [{ ...rejudged, taxAmount: 12_000.01 }], "update"),
    /税额不能大于订单奖金/,
  );
});

test("税额迁移只回填超过一万元的历史已结账成功订单并同步 JSON", () => {
  const database = new DatabaseSync(":memory:");
  try {
    for (const migration of ["0000_white_iron_lad", "0002_modular_cloud_data", "0003_order_payment_status"]) {
      database.exec(readFileSync(new URL(`../drizzle/${migration}.sql`, import.meta.url), "utf8"));
    }
    database.exec("INSERT INTO users (id, auth_subject, account, normalized_account) VALUES ('user', 'user', 'user', 'user')");
    const insert = database.prepare(`
      INSERT INTO user_orders (
        user_id, order_id, saved_at, settled_at, settled_prize_cents,
        payment_status, status, data_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'paid', 'success', ?, ?)
    `);
    const legacyJson = (id: string, prize: number) => JSON.stringify({ id, name: id, settledPrize: prize });
    insert.run("user", "taxed", "2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z", 1_200_000, legacyJson("taxed", 12_000), "v1");
    insert.run("user", "threshold", "2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z", 1_000_000, legacyJson("threshold", 10_000), "v1");

    database.exec(readFileSync(new URL("../drizzle/0011_order_tax.sql", import.meta.url), "utf8"));

    const rows = database.prepare(`
      SELECT order_id, tax_cents, json_extract(data_json, '$.taxAmount') AS json_tax
      FROM user_orders
      ORDER BY order_id
    `).all().map((row) => ({ ...row }));
    assert.deepEqual(rows, [
      { order_id: "taxed", tax_cents: 240_000, json_tax: 2_400 },
      { order_id: "threshold", tax_cents: null, json_tax: null },
    ]);
  } finally {
    database.close();
  }
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
  assert.deepEqual(await getOrderFinanceCents(d1, "user"), { expenseCents: 400, grossIncomeCents: 0, taxCents: 0, incomeCents: 0 });
});

test("历史支付订单缺少锁定快照时保留当前锁定状态，历史未支付结账订单不会被标记为已支付", async () => {
  const legacyPaid = order("legacy-paid", "paid");
  const legacySettled = { ...order("legacy-settled"), settledAt: "2026-08-20T10:00:00.000Z", settledPrize: 0 };
  const current = [legacyPaid, legacySettled];
  const result = await bulkUpdateOrders(new FakeD1(current) as unknown as D1Database, "user", current, "withdraw");
  assert.equal(result[0].paymentStatus, "unpaid");
  assert.equal(result[0].oddsLocked, true);
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

test("订单列表忽略状态参数中的已支付伪状态", async () => {
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

  assert.doesNotMatch(preparedSql[0], /payment_status = 'paid'/);
  assert.match(preparedSql[0], /status IN \(SELECT value FROM json_each\(\?\)\)/);
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

test("订单列表的待结账进度只筛选已支付且未结账订单", async () => {
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
    progress: "pending-settlement",
    statuses: ["success"],
    limit: 10,
  });

  assert.match(preparedSql[0], /WHERE user_id = \? AND payment_status = 'paid' AND settled_at IS NULL AND status IN \(SELECT value FROM json_each\(\?\)\)/);
  assert.deepEqual(boundArgs[0], ["user", JSON.stringify(["success"]), 10, 0]);
});

test("订单进度不再接受未确认筛选", () => {
  assert.equal(isOrderProgressFilterValue("unconfirmed"), false);
});

test("订单列表响应独立统计未支付有希望和待结账订单", async () => {
  const preparedSql: string[] = [];
  const d1 = {
    prepare: (sql: string) => {
      preparedSql.push(sql);
      const statement = {
        bind: () => statement,
        all: async () => ({ results: [] }),
        first: async () => sql.includes("AS unpaidHopefulCount")
          ? { unsettledCount: 4, unpaidHopefulCount: 3, pendingSettlementCount: 2 }
          : { total: 0 },
      };
      return statement;
    },
  };

  const result = await listOrders(d1 as unknown as D1Database, "user", { limit: 10 });

  assert.equal(result.unsettledCount, 4);
  assert.equal(result.unpaidHopefulCount, 3);
  assert.equal(result.pendingSettlementCount, 2);
  assert.match(preparedSql[2], /payment_status = 'unpaid' AND status = 'hopeful'/);
  assert.match(preparedSql[2], /payment_status = 'paid' AND settled_at IS NULL/);
});

test("订单单笔与批量成功各增加一次个人数据版本，失败不增加", async () => {
  const db = new SqliteD1();
  db.database.exec(`INSERT INTO users (id,auth_subject,account,normalized_account)
    VALUES ('revision-user','revision-subject','revision','revision')`);
  const created = await createOrder(db.asD1(), "revision-user", order("revision-order"));
  const afterCreate = db.database.prepare(`SELECT revision FROM user_personal_data_revisions WHERE user_id = 'revision-user'`).get() as { revision: number };
  assert.equal(afterCreate.revision, 1);

  await bulkUpdateOrders(db.asD1(), "revision-user", [created], "pay");
  const afterPay = db.database.prepare(`SELECT revision FROM user_personal_data_revisions WHERE user_id = 'revision-user'`).get() as { revision: number };
  assert.equal(afterPay.revision, 2);
  await assert.rejects(bulkUpdateOrders(db.asD1(), "revision-user", [created], "pay"));
  const afterFailure = db.database.prepare(`SELECT revision FROM user_personal_data_revisions WHERE user_id = 'revision-user'`).get() as { revision: number };
  assert.equal(afterFailure.revision, 2);
});
