import assert from "node:assert/strict";
import test from "node:test";
import {
  accountNameError,
  clearMatchSelections,
  ensureOrderIds,
  normalizeAccountName,
  type CloudPersonalData,
} from "../app/cloud";
import {
  applyPersonalSyncIntent,
  createPersonalSyncIntent,
  emptyPersonalSyncIntent,
  mergePersonalSyncIntents,
  resolvePersonalBootstrapState,
} from "../app/personal-sync";
import { createDefaultSettings } from "../app/settings";
import type { MatchItem, SavedSlip } from "../app/types";

test("账号标准化保证大小写与全角字符不会绕过唯一约束", () => {
  assert.equal(normalizeAccountName("  ＦootBall88  "), "football88");
  assert.equal(normalizeAccountName("玩家Ａ"), "玩家a");
});

test("账号仅接受受支持字符和长度", () => {
  assert.equal(accountNameError("球迷_88"), null);
  assert.match(accountNameError("a") ?? "", /2 至 24/);
  assert.match(accountNameError("球迷 88") ?? "", /只能使用/);
});

test("旧订单同步前会补充稳定 ID", () => {
  const order: SavedSlip = {
    name: "旧订单",
    savedAt: "2026-07-27T10:00:00.000Z",
    matches: [],
    passes: [],
    multiple: 1,
  };
  const [normalized] = ensureOrderIds([order]);
  assert.ok(normalized.id);
  assert.equal(order.id, undefined);
});

test("公共比赛同步会清除所有账号私有的选择状态", () => {
  const match: MatchItem = {
    id: "match-1",
    date: "2026-07-27",
    weekday: "周一",
    code: "001",
    league: "测试",
    time: "12:00",
    home: "主队",
    away: "客队",
    markets: [{
      type: "spf",
      options: [{ id: "W", label: "胜", odds: 2, selected: true }],
    }],
  };
  const [shared] = clearMatchSelections([match]);
  assert.equal(shared.markets[0].options[0].selected, false);
  assert.equal(match.markets[0].options[0].selected, true);
});

function personalState(orders: SavedSlip[]): CloudPersonalData {
  return {
    orders,
    finance: { expenseTotal: 10, incomeTotal: 0 },
    settings: createDefaultSettings(),
  };
}

function savedOrder(id: string, name = id): SavedSlip {
  return {
    id,
    name,
    savedAt: "2026-07-28T10:00:00.000Z",
    matches: [],
    passes: [],
    multiple: 1,
  };
}

test("新增和编辑订单只生成对应订单的 upsert，不替换整张订单表", () => {
  const first = savedOrder("order-1");
  const added = savedOrder("order-2");
  const addIntent = createPersonalSyncIntent(personalState([first]), personalState([first, added]));
  assert.deepEqual(addIntent.upsertOrders.map((order) => order.id), ["order-2"]);
  assert.deepEqual(addIntent.deleteOrderIds, []);

  const edited = { ...first, name: "已编辑" };
  const editIntent = createPersonalSyncIntent(personalState([first, added]), personalState([edited, added]));
  assert.deepEqual(editIntent.upsertOrders.map((order) => order.id), ["order-1"]);
  assert.deepEqual(editIntent.deleteOrderIds, []);
});

test("删除订单只生成明确的订单 ID", () => {
  const first = savedOrder("order-1");
  const second = savedOrder("order-2");
  const intent = createPersonalSyncIntent(personalState([first, second]), personalState([second]));
  assert.deepEqual(intent.upsertOrders, []);
  assert.deepEqual(intent.deleteOrderIds, ["order-1"]);
});

test("页面启动没有明确增量意图时严格使用远端订单", () => {
  const remoteJudged = {
    ...savedOrder("order-1"),
    hits: { "match-1": { spf: "win" as const } },
    resultValues: { "match-1": { spf: "win" as const } },
  };
  const staleLocal = savedOrder("order-1");
  const { intent, personal } = resolvePersonalBootstrapState(
    personalState([remoteJudged]),
    true,
    null,
    personalState([staleLocal]),
  );

  assert.deepEqual(intent, emptyPersonalSyncIntent());
  assert.deepEqual(personal.orders, [remoteJudged]);
  assert.notDeepEqual(personal.orders, [staleLocal]);
});

test("页面启动只叠加已经持久化的指定订单增量", () => {
  const remoteJudged = {
    ...savedOrder("order-1"),
    hits: { "match-1": { spf: "win" as const } },
  };
  const remoteOther = savedOrder("order-2", "远端其他订单");
  const pendingOrder = { ...remoteJudged, name: "本机明确修改" };
  const pendingIntent = {
    upsertOrders: [pendingOrder],
    deleteOrderIds: [],
  };
  const { personal } = resolvePersonalBootstrapState(
    personalState([remoteJudged, remoteOther]),
    true,
    pendingIntent,
  );

  assert.deepEqual(personal.orders, [pendingOrder, remoteOther]);
});

test("首次进入空账号时仍允许明确迁移本地订单", () => {
  const localOrder = savedOrder("local-order", "首次迁移订单");
  const { intent, personal } = resolvePersonalBootstrapState(
    personalState([]),
    false,
    null,
    personalState([localOrder]),
  );

  assert.deepEqual(intent.upsertOrders, [localOrder]);
  assert.deepEqual(personal.orders, [localOrder]);
});

test("并发设备新增的未知订单不会被旧设备的增量同步删除", () => {
  const original = savedOrder("order-1");
  const remoteAdded = savedOrder("remote-order");
  const localEdited = { ...original, name: "本机编辑" };
  const localIntent = createPersonalSyncIntent(personalState([original]), personalState([localEdited]));
  const merged = applyPersonalSyncIntent(personalState([original, remoteAdded]), localIntent);

  assert.deepEqual(merged.orders.map((order) => order.id).sort(), ["order-1", "remote-order"]);
  assert.equal(merged.orders.find((order) => order.id === "order-1")?.name, "本机编辑");
});

test("同步失败期间的多次操作会合并为最后一次明确意图", () => {
  const first = savedOrder("order-1");
  const edited = { ...first, name: "第二版" };
  const firstIntent = createPersonalSyncIntent(personalState([]), personalState([first]));
  const secondIntent = createPersonalSyncIntent(personalState([first]), personalState([edited]));
  const deleteIntent = createPersonalSyncIntent(personalState([edited]), personalState([]));
  const pending = mergePersonalSyncIntents(
    mergePersonalSyncIntents(firstIntent, secondIntent),
    deleteIntent,
  );

  assert.deepEqual(pending.upsertOrders, []);
  assert.deepEqual(pending.deleteOrderIds, ["order-1"]);
});
