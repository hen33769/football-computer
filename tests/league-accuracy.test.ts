import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeagueAccuracyStats,
  formatLeagueHitRate,
  summarizeLeagueAccuracyStats,
} from "../app/league-accuracy";
import type { Market, MarketType, MatchItem, SavedSlip } from "../app/types";

const market = (type: MarketType, selectedIds: string[]): Market => ({
  type,
  options: ["win", "draw", "lose", "1:0", "2:0", "2", "3", "WW", "DD"].map((id) => ({
    id,
    label: id,
    odds: 2,
    selected: selectedIds.includes(id),
  })),
});

const match = (overrides: Partial<MatchItem> = {}): MatchItem => ({
  id: "2040001",
  date: "2026-09-10",
  weekday: "周四",
  code: "001",
  league: "英超",
  time: "20:00",
  home: "主队",
  away: "客队",
  markets: [market("spf", ["win"])],
  ...overrides,
});

const order = (matches: MatchItem[], overrides: Partial<SavedSlip> = {}): SavedSlip => ({
  id: "order-1",
  name: "测试订单",
  savedAt: "2026-09-10T00:00:00.000Z",
  matches,
  passes: [1],
  multiple: 1,
  ...overrides,
});

test("联赛正确率按已选玩法区分命中、未命中和未确认", () => {
  const target = match({
    markets: [
      market("spf", ["win"]),
      market("goals", ["2"]),
      market("halfFull", ["WW"]),
      market("score", ["1:0"]),
    ],
  });
  const targetOrder = order([target], {
    hits: { [target.id]: { spf: "win", score: "1:0" } },
    resultValues: { [target.id]: { spf: "win", goals: "3", score: "1:0" } },
  });

  assert.deepEqual(buildLeagueAccuracyStats([targetOrder], {
    excludeScore: true,
    countDuplicates: true,
  }), [{ league: "英超", hit: 1, miss: 1, unconfirmed: 1, accuracy: 50 }]);

  assert.deepEqual(buildLeagueAccuracyStats([targetOrder], {
    excludeScore: false,
    countDuplicates: true,
  }), [{ league: "英超", hit: 2, miss: 1, unconfirmed: 1, accuracy: 2 / 3 * 100 }]);
});

test("同一玩法选择多个选项仍只计一次预测", () => {
  const target = match({ markets: [market("spf", ["win", "draw"])] });
  const stats = buildLeagueAccuracyStats([order([target], {
    hits: { [target.id]: { spf: "draw" } },
    resultValues: { [target.id]: { spf: "draw" } },
  })], { excludeScore: false, countDuplicates: true });

  assert.deepEqual(stats, [{ league: "英超", hit: 1, miss: 0, unconfirmed: 0, accuracy: 100 }]);
});

test("手工失败场次把没有命中值的全部已选玩法计为未命中", () => {
  const target = match({
    markets: [market("spf", ["win"]), market("goals", ["2"]), market("score", ["1:0"])],
  });
  const stats = buildLeagueAccuracyStats([order([target], {
    failedMatches: [`sporttery-${target.id}`],
  })], { excludeScore: true, countDuplicates: true });

  assert.deepEqual(stats, [{ league: "英超", hit: 0, miss: 2, unconfirmed: 0, accuracy: 0 }]);
});

test("关闭重复计数后按标准比赛 ID、玩法和选项集合合并相同预测", () => {
  const first = match({ id: "2040001", markets: [market("spf", ["win"])] });
  const duplicate = match({ id: "sporttery-2040001", markets: [market("spf", ["win"])] });
  const differentPick = match({ id: "2040001", markets: [market("spf", ["draw"])] });
  const orders = [
    order([first], { id: "order-1", hits: { [first.id]: { spf: "win" } } }),
    order([duplicate], { id: "order-2", hits: { [duplicate.id]: { spf: "win" } } }),
    order([differentPick], { id: "order-3", resultValues: { [differentPick.id]: { spf: "win" } } }),
  ];

  assert.deepEqual(buildLeagueAccuracyStats(orders, {
    excludeScore: false,
    countDuplicates: true,
  }), [{ league: "英超", hit: 2, miss: 1, unconfirmed: 0, accuracy: 2 / 3 * 100 }]);

  assert.deepEqual(buildLeagueAccuracyStats(orders, {
    excludeScore: false,
    countDuplicates: false,
  }), [{ league: "英超", hit: 1, miss: 1, unconfirmed: 0, accuracy: 50 }]);
});

test("重复预测去重时优先采用命中或未命中的已确认状态", () => {
  const target = match();
  const stats = buildLeagueAccuracyStats([
    order([target], { id: "unconfirmed" }),
    order([target], { id: "miss", resultValues: { [target.id]: { spf: "lose" } } }),
    order([target], { id: "hit", hits: { [target.id]: { spf: "win" } } }),
  ], { excludeScore: false, countDuplicates: false });

  assert.deepEqual(stats, [{ league: "英超", hit: 1, miss: 0, unconfirmed: 0, accuracy: 100 }]);
});

test("无已确认结果时正确率为空，并忽略空联赛和未选择玩法", () => {
  const stats = buildLeagueAccuracyStats([
    order([match()]),
    order([match({ id: "blank-league", league: "  " })], { id: "order-2" }),
    order([match({ id: "no-selection", league: "西甲", markets: [market("spf", [])] })], { id: "order-3" }),
  ], { excludeScore: false, countDuplicates: true });

  assert.deepEqual(stats, [{ league: "英超", hit: 0, miss: 0, unconfirmed: 1, accuracy: null }]);
});

test("命中率汇总使用命中加未命中作为已确认分母", () => {
  const summary = summarizeLeagueAccuracyStats([
    { league: "英超", hit: 2, miss: 1, unconfirmed: 3, accuracy: 2 / 3 * 100 },
    { league: "西甲", hit: 1, miss: 1, unconfirmed: 4, accuracy: 50 },
  ]);

  assert.deepEqual(summary, { hit: 3, miss: 2, confirmed: 5, hitRate: 60 });
  assert.equal(formatLeagueHitRate(summary.hitRate), "60%");
  assert.equal(formatLeagueHitRate(2 / 3 * 100), "66.7%");
  assert.equal(formatLeagueHitRate(null), "—");
});
