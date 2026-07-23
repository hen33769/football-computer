import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCurrentPrize,
  calculatePassMultipliers,
  calculatePrizeRange,
  calculateStake,
  countBets,
  getOrderStatus,
  getPassLimit,
  isOrderFailed,
  isOrderSettleable,
} from "../app/calculator";
import { cloneMatches, initialMatches } from "../app/data";
import { judgeSlipWithResults } from "../app/results";
import type { SavedSlip } from "../app/types";

function select(matches = cloneMatches(initialMatches.slice(0, 2))) {
  matches[0].markets[0].options[0].selected = true;
  matches[0].markets[0].options[0].odds = 2;
  matches[1].markets[0].options[0].selected = true;
  matches[1].markets[0].options[0].odds = 3;
  return matches;
}

test("2 串 1 的注数、投入和命中奖金", () => {
  const matches = select();
  assert.equal(countBets(matches, [2]), 1);
  assert.equal(calculateStake(matches, [2], 5), 10);
  assert.equal(calculateCurrentPrize(matches, [2], 1, {
    [matches[0].id]: { spf: "win" },
    [matches[1].id]: { spf: "win" },
  }), 12);
});

test("同一场多选作为多个备选项计注", () => {
  const matches = select();
  matches[0].markets[0].options[1].selected = true;
  assert.equal(countBets(matches, [2]), 2);
  assert.equal(calculateStake(matches, [2], 1), 4);
});

test("串关倍数明细标记完整命中与单项命中", () => {
  const matches = select();
  matches[0].markets[0].options[1].selected = true;
  matches[0].markets[0].options[1].odds = 4;
  const details = calculatePassMultipliers(matches, [2], {
    [matches[0].id]: { spf: "win" },
    [matches[1].id]: { spf: "win" },
  });
  assert.equal(details.length, 2);
  assert.equal(details[0].multiplier, 6);
  assert.equal(details[0].hitMultiplier, 6);
  assert.equal(details[0].fullyHit, true);
  assert.deepEqual(details[0].factors.map((factor) => factor.hit), [true, true]);
  assert.equal(details[1].multiplier, 12);
  assert.equal(details[1].hitMultiplier, 3);
  assert.equal(details[1].fullyHit, false);
  assert.deepEqual(details[1].factors.map((factor) => factor.hit), [false, true]);
});

test("4 串 1 明细分别计算当前命中与完整赔率积", () => {
  const matches = cloneMatches(initialMatches.slice(0, 4));
  [7.5, 8, 3.25, 7.5].forEach((odds, index) => {
    matches[index].markets[0].options[0].selected = true;
    matches[index].markets[0].options[0].odds = odds;
  });
  const details = calculatePassMultipliers(matches, [4], {
    [matches[1].id]: { spf: "win" },
    [matches[2].id]: { spf: "win" },
  });
  assert.equal(details.length, 1);
  assert.equal(details[0].hitMultiplier, 26);
  assert.equal(details[0].multiplier, 1462.5);
  assert.equal(details[0].fullyHit, false);
  assert.deepEqual(details[0].factors.map((factor) => factor.hit), [false, true, true, false]);
});

test("理论奖金范围排除 0 并保持有序", () => {
  const matches = select();
  const range = calculatePrizeRange(matches, [2], 1);
  assert.ok(range.min > 0);
  assert.ok(range.max >= range.min);
});

test("包含比分玩法时最高只能 4 关", () => {
  const matches = cloneMatches(initialMatches);
  matches.forEach((match) => { match.markets[0].options[0].selected = true; });
  matches[0].markets.find((market) => market.type === "score")!.options[0].selected = true;
  assert.equal(getPassLimit(matches), 4);
});

test("失败比赛不足以组成任一串关时订单才失败", () => {
  const matches = cloneMatches(initialMatches.slice(0, 3));
  matches.forEach((match) => { match.markets[0].options[0].selected = true; });
  assert.equal(isOrderFailed({ matches, passes: [2], failedMatches: [matches[0].id] }), false);
  assert.equal(isOrderFailed({ matches, passes: [3], failedMatches: [matches[0].id] }), true);
  assert.equal(isOrderFailed({ matches, passes: [2, 3], failedMatches: [matches[0].id] }), false);
});

test("赛果判断写入命中；全部已选玩法均未中才标记比赛失败", () => {
  const matches = cloneMatches(initialMatches.slice(0, 2));
  matches.forEach((match) => {
    match.id = match.id === "sample-1" ? "2040594" : "2040595";
    match.markets[0].options[0].selected = true;
  });
  const slip: SavedSlip = { name: "测试", savedAt: new Date(0).toISOString(), matches, passes: [2], multiple: 1 };
  const judged = judgeSlipWithResults(slip, {
    "2040594": { matchId: "2040594", updatedAt: new Date(0).toISOString(), source: "manual", values: { spf: "win" } },
    "2040595": { matchId: "2040595", updatedAt: new Date(0).toISOString(), source: "manual", values: { spf: "lose" } },
  });
  assert.equal(judged.hits?.["2040594"]?.spf, "win");
  assert.deepEqual(judged.failedMatches, ["2040595"]);
  assert.equal(isOrderFailed(judged), true);
});

test("订单状态区分成功、有希望和失败", () => {
  const hopefulMatches = select();
  const hopeful: SavedSlip = { name: "有希望", savedAt: new Date(0).toISOString(), matches: hopefulMatches, passes: [2], multiple: 1 };
  assert.equal(getOrderStatus(hopeful), "hopeful");

  const success: SavedSlip = {
    ...hopeful,
    name: "成功",
    hits: {
      [hopefulMatches[0].id]: { spf: "win" },
      [hopefulMatches[1].id]: { spf: "win" },
    },
  };
  assert.equal(getOrderStatus(success), "success");

  const failed: SavedSlip = {
    ...hopeful,
    name: "失败",
    failedMatches: [hopefulMatches[0].id],
  };
  assert.equal(getOrderStatus(failed), "failed");
  assert.equal(isOrderSettleable(hopeful), false);
  assert.equal(isOrderSettleable(success), true);
  assert.equal(isOrderSettleable(failed), true);
  assert.equal(isOrderSettleable({ ...success, settledAt: new Date(0).toISOString() }), false);
});

test("缺少半全场赛果时跳过失败判断，补齐后再判断", () => {
  const matches = cloneMatches(initialMatches.slice(0, 1));
  const match = matches[0];
  match.id = "2040588";
  match.markets.find((market) => market.type === "spf")!.options.find((option) => option.id === "win")!.selected = true;
  match.markets.find((market) => market.type === "halfFull")!.options.find((option) => option.id === "WW")!.selected = true;
  const slip: SavedSlip = { name: "待补半全场", savedAt: new Date(0).toISOString(), matches, passes: [1], multiple: 1 };

  const partial = judgeSlipWithResults(slip, {
    "2040588": { matchId: "2040588", updatedAt: new Date(0).toISOString(), source: "api", values: { spf: "lose" } },
  });
  assert.deepEqual(partial.failedMatches, []);
  assert.equal(getOrderStatus(partial), "hopeful");

  const complete = judgeSlipWithResults(partial, {
    "2040588": { matchId: "2040588", updatedAt: new Date(0).toISOString(), source: "api", values: { spf: "lose", halfFull: "LL" } },
  });
  assert.deepEqual(complete.failedMatches, ["2040588"]);
  assert.equal(getOrderStatus(complete), "failed");
});
