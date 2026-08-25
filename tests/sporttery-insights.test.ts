import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSportteryHistoryUrl,
  buildSportteryRecentUrl,
  filterNonFriendlyTournamentRows,
  getSportteryStandingsUrl,
} from "../app/sporttery-insights";

test("非友谊赛筛选只在前端排除俱乐部赛", () => {
  const rows = [
    { matchId: "1", tournamentShortName: "俱乐部赛" },
    { matchId: "2", tournamentShortName: " 俱乐部赛 " },
    { matchId: "3", tournamentShortName: "国际友谊" },
    { matchId: "4", tournamentShortName: "英超" },
    { matchId: "5" },
  ];

  assert.deepEqual(
    filterNonFriendlyTournamentRows(rows, true).map((row) => row.matchId),
    ["3", "4", "5"],
  );
  assert.equal(filterNonFriendlyTournamentRows(rows, false), rows);
  assert.equal(rows.length, 5);
});

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
