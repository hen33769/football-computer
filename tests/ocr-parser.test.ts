import assert from "node:assert/strict";
import test from "node:test";
import { parseRecognizedText } from "../app/ocr";

test("解析常见体彩已选项截图文本", () => {
  const parsed = parseRecognizedText(`
    周五201 瓦萨 VS 塞伊奈
    胜平负 主胜 1.87
    让球 (-1) 平 3.51
    周六099 挪威 VS 英格兰
    让球 (+1) 主胜 1.85
  `);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].home, "瓦萨");
  assert.equal(parsed[0].markets.find((market) => market.type === "spf")!.options.find((item) => item.label === "主胜")!.selected, true);
  assert.equal(parsed[0].markets.find((market) => market.type === "rqspf")!.handicap, -1);
  assert.equal(parsed[0].markets.find((market) => market.type === "rqspf")!.options.find((item) => item.label === "平")!.selected, true);
});

test("解析带官方比赛 ID、元数据和多选倍率的手动订单文本", () => {
  const parsed = parseRecognizedText(`
    比赛 ID：2040585
    比赛日期：2026-07-23
    联赛：挪超
    开赛时间：2026-07-23 01:00
    周四204 博德闪耀 VS 汉坎
    总进球数 2 @3.12 | 3 @4.00
  `);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "2040585");
  assert.equal(parsed[0].date, "2026-07-23");
  assert.equal(parsed[0].league, "挪超");
  assert.equal(parsed[0].time, "2026-07-23 01:00");
  const goals = parsed[0].markets.find((market) => market.type === "goals")!;
  assert.deepEqual(goals.options.filter((item) => item.selected).map((item) => [item.label, item.odds]), [["2", 3.12], ["3", 4]]);
});

test("解析完整五玩法手动订单格式", () => {
  const parsed = parseRecognizedText(`
    比赛 ID：2040594
    比赛日期：2026-07-23
    联赛：巴甲
    开赛时间：2026-07-24 06:30
    周四201 科林蒂安 VS 里莫
    胜平负 主胜 @2.25 | 主负 @2.46
    让球胜平负（-1） 主胜 @2.28
    比分 3:1 @10.50 | 3:2 @25.00
    总进球数 1 @4.65 | 6 @20.00
    半全场胜平负 胜平 @19.00 | 胜负 @60.00
  `);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "2040594");
  assert.deepEqual(parsed[0].markets.map((market) => market.options.filter((option) => option.selected).length), [2, 1, 2, 2, 2]);
  assert.equal(parsed[0].markets.find((market) => market.type === "rqspf")?.handicap, -1);
  assert.equal(parsed[0].markets.find((market) => market.type === "halfFull")?.options.find((option) => option.id === "WD")?.odds, 19);
});

test("手动订单缺少让球数时不再静默使用默认 -1", () => {
  const parsed = parseRecognizedText(`
    比赛 ID：2040594
    周四201 科林蒂安 VS 里莫
    让球胜平负 平 @3.20
  `, { emptyOdds: true });
  const rqspf = parsed[0].markets.find((market) => market.type === "rqspf");
  assert.equal(rqspf?.handicap, undefined);
  assert.equal(rqspf?.options.find((option) => option.id === "draw")?.selected, true);
});
