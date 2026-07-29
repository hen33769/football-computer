import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCurrentPrize,
  calculatePassMultipliers,
  calculatePrizeRange,
  calculatePrizeRangeMetrics,
  calculateStake,
  countBets,
  getOrderStatus,
  getPassLimit,
  getPassOptions,
  isOrderFailed,
  isNewMatchSelectionBlocked,
  isOrderSettleable,
  MAX_SELECTED_MATCHES,
} from "../app/calculator";
import { cloneMatches, initialMatches } from "../app/data";
import { unionSavedOrders } from "../app/imports";
import { appendOrderPassValue, inferOrderPasses, parseOrderPassValues } from "../app/order-passes";
import { judgeSlipWithResults, repairSlipHandicapResults } from "../app/results";
import type { SavedSlip } from "../app/types";

test("新增导入订单以新值更新同 ID 订单", () => {
  const existing: SavedSlip = { id: "order-1", name: "本地订单", savedAt: "2026-07-27T01:00:00.000Z", matches: [], passes: [], multiple: 1 };
  const duplicate: SavedSlip = { ...existing, name: "导入同 ID 订单" };
  const added: SavedSlip = { ...existing, id: "order-2", name: "新订单", savedAt: "2026-07-27T02:00:00.000Z", settledPrize: 12 };

  const result = unionSavedOrders([existing], [duplicate, added]);

  assert.equal(result.added, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.incomeDelta, 12);
  assert.deepEqual(result.nextOrders.map((order) => order.name), ["新订单", "导入同 ID 订单"]);
});

function select(matches = cloneMatches(initialMatches.slice(0, 2))) {
  matches[0].markets[0].options[0].selected = true;
  matches[0].markets[0].options[0].odds = 2;
  matches[1].markets[0].options[0].selected = true;
  matches[1].markets[0].options[0].odds = 3;
  return matches;
}

test("手动订单串关兼容单场别名及中阿数字写法", () => {
  assert.deepEqual(parseOrderPassValues(" 3 "), [3]);
  assert.deepEqual(parseOrderPassValues(" 四 "), [4]);
  assert.deepEqual(
    parseOrderPassValues("单 场、单 关、1 串 1、一 串 一、1串一、一串1"),
    [1],
  );
  assert.deepEqual(
    parseOrderPassValues("2 串 1、三 串 一、4 x 1、五 × 一、六 关、7 关、八 串 1"),
    [2, 3, 4, 5, 6, 7, 8],
  );
});

test("手动订单串关支持多个 n 关混写并受比赛场数限制", () => {
  const matches = cloneMatches(initialMatches.slice(0, 4));
  matches.forEach((match) => {
    match.markets[0].options[0].selected = true;
  });

  assert.deepEqual(parseOrderPassValues("2关、三关、4串1、五关"), [2, 3, 4, 5]);
  assert.deepEqual(parseOrderPassValues("单场、二串一、3 串 1、4"), [1, 2, 3, 4]);
  assert.deepEqual(parseOrderPassValues("单关、三串一、4"), [1, 3, 4]);
  assert.deepEqual(inferOrderPasses("单关、三关、4关、八关", matches), [1, 3, 4]);
  assert.deepEqual(inferOrderPasses("未填写串关", matches), [4]);
});

test("手动订单串关不从超出范围的连续数字中截取", () => {
  assert.deepEqual(parseOrderPassValues("11串1、13关、九关、十三关"), []);
  assert.deepEqual(parseOrderPassValues("比赛 ID 1234567，赔率 3.20"), []);
});

test("手动订单串关快捷填充会追加、排序、去重并统一格式", () => {
  assert.equal(appendOrderPassValue("", 4), "4串1");
  assert.equal(
    appendOrderPassValue("4、单关、三串一、4串1", 2),
    "单场、2串1、3串1、4串1",
  );
  assert.equal(
    appendOrderPassValue("单场、2串1、3串1、4串1", 3),
    "单场、2串1、3串1、4串1",
  );
  assert.equal(appendOrderPassValue("八关、2 串 1", 1), "单场、2串1、8串1");
});

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

test("中奖倍率范围按单注价格乘以倍数计算，不使用订单总投入", () => {
  const metrics = calculatePrizeRangeMetrics(
    { min: 24, max: 60, uncappedMax: 60 },
    24,
    3,
  );
  assert.deepEqual(metrics.prize, { min: 24, max: 60 });
  assert.deepEqual(metrics.profit, { min: 0, max: 36 });
  assert.deepEqual(metrics.multiplier, { min: 4, max: 10 });
});

test("各玩法串关上限与混合过关取最小值", () => {
  const limitFor = (...types: Array<"spf" | "rqspf" | "score" | "goals" | "halfFull">) => {
    const matches = cloneMatches(initialMatches.slice(0, 1));
    types.forEach((type) => {
      matches[0].markets.find((market) => market.type === type)!.options[0].selected = true;
    });
    return getPassLimit(matches);
  };
  assert.equal(limitFor("spf"), 8);
  assert.equal(limitFor("rqspf"), 8);
  assert.equal(limitFor("score"), 4);
  assert.equal(limitFor("goals"), 6);
  assert.equal(limitFor("halfFull"), 4);
  assert.equal(limitFor("spf", "goals"), 6);
  assert.equal(limitFor("rqspf", "halfFull"), 4);
  assert.equal(limitFor("spf", "rqspf", "score", "goals", "halfFull"), 4);
});

test("多场均支持单场时同时提供单场与串关选项", () => {
  const matches = select();
  assert.deepEqual(getPassOptions(matches), [1, 2]);

  matches[0].markets[0].singleAvailable = false;
  assert.deepEqual(getPassOptions(matches), [2]);

  matches[0].markets[0].singleAvailable = true;
  matches[0].markets[0].passAvailable = false;
  assert.deepEqual(getPassOptions(matches), [1]);

  matches[0].markets[0].singleAvailable = false;
  assert.deepEqual(getPassOptions(matches), []);
});

test("最多选择八场比赛，同场追加选项不受限制", () => {
  const matches = Array.from({ length: MAX_SELECTED_MATCHES + 1 }, (_, index) => {
    const match = cloneMatches(initialMatches.slice(0, 1))[0];
    match.id = `limit-${index}`;
    match.code = String(index + 1);
    if (index < MAX_SELECTED_MATCHES) match.markets[0].options[0].selected = true;
    return match;
  });
  assert.equal(isNewMatchSelectionBlocked(matches, matches[MAX_SELECTED_MATCHES].id), true);
  assert.equal(isNewMatchSelectionBlocked(matches, matches[0].id), false);
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
    "2040594": { matchId: "2040594", updatedAt: new Date(0).toISOString(), source: "manual", values: { spf: "win", score: "2:0", halfFull: "WW" } },
    "2040595": { matchId: "2040595", updatedAt: new Date(0).toISOString(), source: "manual", values: { spf: "lose", score: "0:1", halfFull: "DL" } },
  });
  assert.equal(judged.hits?.["2040594"]?.spf, "win");
  assert.deepEqual(judged.resultValues?.["2040594"], { spf: "win", score: "2:0", halfFull: "WW" });
  assert.deepEqual(judged.resultValues?.["2040595"], { spf: "lose", score: "0:1", halfFull: "DL" });
  assert.deepEqual(judged.failedMatches, ["2040595"]);
  assert.equal(isOrderFailed(judged), true);
});

test("同场比赛统一按赛果接口重新取得的固定让球数判断并修正订单快照", () => {
  const createSlip = (handicap: number, selectedOptionId: string): SavedSlip => {
    const matches = cloneMatches(initialMatches.slice(0, 1));
    const match = matches[0];
    match.id = "2040594";
    const rqspf = match.markets.find((market) => market.type === "rqspf")!;
    rqspf.handicap = handicap;
    rqspf.options.find((option) => option.id === selectedOptionId)!.selected = true;
    return { name: `${handicap}`, savedAt: new Date(0).toISOString(), matches, passes: [1], multiple: 1 };
  };
  const sharedResult = {
    "2040594": {
      matchId: "2040594",
      updatedAt: new Date(0).toISOString(),
      source: "api" as const,
      values: { rqspf: "draw", score: "2:1" },
      rqspfHandicap: 1,
      fullScore: { home: 2, away: 1 },
    },
  };

  const receivingOne = judgeSlipWithResults(createSlip(1, "win"), sharedResult);
  assert.equal(receivingOne.hits?.["2040594"]?.rqspf, "win");
  assert.equal(receivingOne.resultValues?.["2040594"]?.rqspf, "win");
  assert.equal(receivingOne.matches[0].markets.find((market) => market.type === "rqspf")?.handicap, 1);
  assert.deepEqual(receivingOne.failedMatches, []);

  const staleSnapshot = judgeSlipWithResults(createSlip(-1, "draw"), sharedResult);
  assert.equal(staleSnapshot.hits?.["2040594"]?.rqspf, undefined);
  assert.equal(staleSnapshot.resultValues?.["2040594"]?.rqspf, "win");
  assert.equal(staleSnapshot.matches[0].markets.find((market) => market.type === "rqspf")?.handicap, 1);
  assert.deepEqual(staleSnapshot.failedMatches, ["2040594"]);
});

test("没有取得固定让球数时不判断让球胜平负", () => {
  const matches = cloneMatches(initialMatches.slice(0, 1));
  matches[0].id = "2040594";
  const rqspf = matches[0].markets.find((market) => market.type === "rqspf")!;
  rqspf.options.find((option) => option.id === "draw")!.selected = true;
  const judged = judgeSlipWithResults(
    { name: "待盘口", savedAt: new Date(0).toISOString(), matches, passes: [1], multiple: 1 },
    {
      "2040594": {
        matchId: "2040594",
        updatedAt: new Date(0).toISOString(),
        source: "api",
        values: { rqspf: "draw", score: "2:1" },
        fullScore: { home: 2, away: 1 },
      },
    },
  );
  assert.equal(judged.resultValues?.["2040594"]?.rqspf, undefined);
  assert.equal(judged.failedMatches?.length, 0);
});

test("加载订单时修复按其它让球数保存的历史命中结果", () => {
  const matches = cloneMatches(initialMatches.slice(0, 1));
  const match = matches[0];
  match.id = "2040594";
  const rqspf = match.markets.find((market) => market.type === "rqspf")!;
  rqspf.handicap = 1;
  rqspf.options.find((option) => option.id === "draw")!.selected = true;
  rqspf.options.find((option) => option.id === "lose")!.selected = true;
  const repaired = repairSlipHandicapResults({
    name: "历史误判",
    savedAt: new Date(0).toISOString(),
    matches,
    passes: [1],
    multiple: 1,
    hits: { "2040594": { rqspf: "draw" } },
    resultValues: { "2040594": { rqspf: "draw", score: "2:1" } },
    failedMatches: [],
  });

  assert.equal(repaired.resultValues?.["2040594"]?.rqspf, "win");
  assert.equal(repaired.hits?.["2040594"]?.rqspf, undefined);
  assert.deepEqual(repaired.failedMatches, ["2040594"]);
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
