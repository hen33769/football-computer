import assert from "node:assert/strict";
import test from "node:test";
import {
  accountNameError,
  clearMatchSelections,
  ensureOrderIds,
  normalizeAccountName,
} from "../app/cloud";
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
