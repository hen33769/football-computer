import assert from "node:assert/strict";
import test from "node:test";
import { cloneMatches, createEmptyMatch } from "../app/data";
import { collectCancelledOrderPaymentRisk } from "../app/order-payment";
import type { MatchItem, SavedSlip } from "../app/types";

const selectedMatch = (id: string): MatchItem => {
  const match = { ...createEmptyMatch(1), id, saleStatus: "selling" as const, home: `主队${id}`, away: `客队${id}` };
  match.markets[0].options[0].selected = true;
  return match;
};

const order = (id: string, matches: MatchItem[]): SavedSlip => ({
  id,
  name: `订单${id}`,
  savedAt: `2026-09-14T12:00:0${id}.000Z`,
  matches,
  passes: [1],
  multiple: 1,
  paymentStatus: "unpaid",
});

test("支付取消风险以当前共享比赛状态为准", () => {
  const embedded = selectedMatch("sporttery-2041458");
  const current = { ...cloneMatches([embedded])[0], id: "2041458", saleStatus: "cancelled" as const };
  const risk = collectCancelledOrderPaymentRisk([order("1", [embedded])], [current]);

  assert.deepEqual(risk.affectedOrders.map((item) => item.id), ["1"]);
  assert.deepEqual(risk.cancelledMatches.map((item) => item.id), ["2041458"]);
});

test("未选中的取消比赛不阻断支付确认", () => {
  const unselected = selectedMatch("2041458");
  unselected.markets.forEach((market) => market.options.forEach((option) => { option.selected = false; }));
  const current = { ...cloneMatches([unselected])[0], saleStatus: "cancelled" as const };
  const risk = collectCancelledOrderPaymentRisk([order("1", [unselected])], [current]);

  assert.deepEqual(risk.affectedOrders, []);
  assert.deepEqual(risk.cancelledMatches, []);
});

test("批量支付计算影响订单数并对取消比赛去重", () => {
  const first = selectedMatch("2041458");
  const second = cloneMatches([first])[0];
  const safe = selectedMatch("2041512");
  const current = [
    { ...cloneMatches([first])[0], saleStatus: "cancelled" as const },
    { ...cloneMatches([safe])[0], saleStatus: "pending" as const },
  ];
  const risk = collectCancelledOrderPaymentRisk([
    order("1", [first]),
    order("2", [second]),
    order("3", [safe]),
  ], current);

  assert.deepEqual(risk.affectedOrders.map((item) => item.id), ["1", "2"]);
  assert.deepEqual(risk.cancelledMatches.map((item) => item.id), ["2041458"]);
});
