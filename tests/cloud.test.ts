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
  createPersonalMetadataSyncIntent,
  emptyPersonalSyncIntent,
  migrateLegacyPersonalSyncIntent,
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

test("新增和编辑订单通过明确 ID upsert，不影响其它订单", () => {
  const first = savedOrder("order-1");
  const added = savedOrder("order-2");
  const afterAdd = applyPersonalSyncIntent(personalState([first]), {
    upsertOrders: [added],
    deleteOrderIds: [],
  });
  const edited = { ...first, name: "已编辑" };
  const afterEdit = applyPersonalSyncIntent(afterAdd, {
    upsertOrders: [edited],
    deleteOrderIds: [],
  });

  assert.deepEqual(afterEdit.orders.map((order) => order.id).sort(), ["order-1", "order-2"]);
  assert.equal(afterEdit.orders.find((order) => order.id === "order-1")?.name, "已编辑");
});

test("删除订单只应用调用方明确提交的订单 ID", () => {
  const first = savedOrder("order-1");
  const second = savedOrder("order-2");
  const third = savedOrder("order-3");
  const next = applyPersonalSyncIntent(personalState([first, second, third]), {
    upsertOrders: [],
    deleteOrderIds: ["order-1"],
  });

  assert.deepEqual(next.orders.map((order) => order.id).sort(), ["order-2", "order-3"]);
});

test("页面订单快照即使只剩筛选子集，也不会推断云端删除", () => {
  const first = savedOrder("order-1");
  const second = savedOrder("order-2");
  const previous = personalState([first, second]);
  const filteredSnapshot = {
    ...previous,
    orders: [first],
    finance: { expenseTotal: 20, incomeTotal: 0 },
  };
  const intent = createPersonalMetadataSyncIntent(previous, filteredSnapshot);

  assert.deepEqual(intent.upsertOrders, []);
  assert.deepEqual(intent.deleteOrderIds, []);
  assert.deepEqual(intent.finance, filteredSnapshot.finance);
});

test("旧版待同步队列升级时不重放无法证明来源的订单或账本修改", () => {
  const migrated = migrateLegacyPersonalSyncIntent();

  assert.deepEqual(migrated, emptyPersonalSyncIntent());
});

test("十个订单中过滤出五个再更新一单，云端仍保留全部十个 ID", () => {
  const remoteOrders = Array.from({ length: 10 }, (_, index) => savedOrder(`order-${index + 1}`));
  const filteredOrders = remoteOrders.slice(0, 5);
  const edited = { ...filteredOrders[0], name: "已替换本菲卡投注" };
  const metadataIntent = createPersonalMetadataSyncIntent(
    personalState(remoteOrders),
    personalState(filteredOrders),
  );
  const pending = mergePersonalSyncIntents(metadataIntent, {
    upsertOrders: [edited],
    deleteOrderIds: [],
  });
  const merged = applyPersonalSyncIntent(personalState(remoteOrders), pending);

  assert.equal(merged.orders.length, 10);
  assert.deepEqual(merged.orders.map((order) => order.id).sort(), remoteOrders.map((order) => order.id).sort());
  assert.equal(merged.orders.find((order) => order.id === edited.id)?.name, edited.name);
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
  const localIntent = { upsertOrders: [localEdited], deleteOrderIds: [] };
  const merged = applyPersonalSyncIntent(personalState([original, remoteAdded]), localIntent);

  assert.deepEqual(merged.orders.map((order) => order.id).sort(), ["order-1", "remote-order"]);
  assert.equal(merged.orders.find((order) => order.id === "order-1")?.name, "本机编辑");
});

test("同步失败期间的多次操作会合并为最后一次明确意图", () => {
  const first = savedOrder("order-1");
  const edited = { ...first, name: "第二版" };
  const firstIntent = { upsertOrders: [first], deleteOrderIds: [] };
  const secondIntent = { upsertOrders: [edited], deleteOrderIds: [] };
  const deleteIntent = { upsertOrders: [], deleteOrderIds: ["order-1"] };
  const pending = mergePersonalSyncIntents(
    mergePersonalSyncIntents(firstIntent, secondIntent),
    deleteIntent,
  );

  assert.deepEqual(pending.upsertOrders, []);
  assert.deepEqual(pending.deleteOrderIds, ["order-1"]);
});
