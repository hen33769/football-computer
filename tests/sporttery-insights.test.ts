import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSportteryHistoryUrl,
  buildSportteryRecentUrl,
  getSportteryStandingsUrl,
} from "../app/sporttery-insights";

test("赛事前瞻筛选参数使用比赛 ID 和固定 20 场", () => {
  const historyUrl = buildSportteryHistoryUrl("sporttery-2040638", {
    tournamentFlag: 0,
    homeAwayFlag: 1,
  });
  assert.equal(historyUrl.searchParams.get("sportteryMatchId"), "2040638");
  assert.equal(historyUrl.searchParams.get("termLimits"), "20");
  assert.equal(historyUrl.searchParams.get("tournamentFlag"), "0");
  assert.equal(historyUrl.searchParams.get("homeAwayFlag"), "1");

  const recentUrl = buildSportteryRecentUrl("2040638", {
    tournamentFlag: 1,
    homeAwayFlag: 0,
  });
  assert.equal(recentUrl.searchParams.get("sportteryMatchId"), "2040638");
  assert.equal(recentUrl.searchParams.get("termLimits"), "20");
  assert.equal(recentUrl.searchParams.get("tournamentFlag"), "1");
  assert.equal(recentUrl.searchParams.get("homeAwayFlag"), "0");
});

test("积分榜查看更多使用接口返回的赛事 ID", () => {
  const url = new URL(getSportteryStandingsUrl(133));
  assert.equal(url.origin, "https://www.sporttery.cn");
  assert.equal(url.pathname, "/zqlszl/");
  assert.equal(url.searchParams.get("tournamentId"), "133");
  assert.equal(url.searchParams.get("showType"), "2");
});
