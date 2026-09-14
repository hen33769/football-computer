import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyMatch } from "../app/data";
import { applyTrustedMatchUpdate, parseTrustedMatchUpdate } from "../app/match-updates";
import type { MatchItem } from "../app/types";

const storedMatch = (id: string): MatchItem => {
  const match = {
    ...createEmptyMatch(1),
    id,
    date: "2026-09-14",
    time: "2026-09-15 03:00",
    home: `主队${id}`,
    away: `客队${id}`,
    league: "测试联赛",
    remark: "官方备注",
    saleStatus: "selling" as const,
  };
  match.markets[0].options[0].selected = true;
  return match;
};

test("取消更新只修改终态并清除投注选择", () => {
  const original = storedMatch("2041458");
  const update = parseTrustedMatchUpdate({
    ...original,
    saleStatus: "cancelled",
    home: "不应覆盖的队名",
    remark: "不应覆盖的备注",
    markets: [],
  });
  assert.ok(update);
  const updated = applyTrustedMatchUpdate(original, update);

  assert.equal(updated.saleStatus, "cancelled");
  assert.equal(updated.home, original.home);
  assert.equal(updated.remark, "官方备注");
  assert.equal(updated.markets[0].options[0].odds, original.markets[0].options[0].odds);
  assert.equal(updated.markets.some((market) => market.options.some((option) => option.selected)), false);
});

test("按 ID 更新拒绝非取消状态和非官方赛果", () => {
  const match = storedMatch("2041458");
  assert.equal(parseTrustedMatchUpdate({ ...match, saleStatus: "stopped", result: undefined }), null);
  assert.equal(parseTrustedMatchUpdate({
    ...match,
    result: { matchId: match.id, updatedAt: new Date().toISOString(), source: "manual", values: { spf: "win" } },
  }), null);
  assert.equal(parseTrustedMatchUpdate({
    ...match,
    result: { matchId: "2041512", updatedAt: new Date().toISOString(), source: "api", values: { spf: "win" } },
  }), null);
});

test("官方赛果更新仅替换 result 并校验目标 ID", () => {
  const match = storedMatch("2041458");
  const result = {
    matchId: match.id,
    updatedAt: "2026-09-14T15:00:00.000Z",
    source: "api" as const,
    values: { spf: "win" },
    fullScore: { home: 2, away: 1 },
  };
  const update = parseTrustedMatchUpdate({ ...match, result });
  assert.ok(update);
  assert.deepEqual(applyTrustedMatchUpdate(match, update).result, result);
  assert.throws(() => applyTrustedMatchUpdate({ ...match, id: "2041512" }, update), /比赛 ID 不匹配/);
});
