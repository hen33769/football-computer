import assert from "node:assert/strict";
import test from "node:test";
import { cloneMatches, createEmptyMatch } from "../app/data";
import {
  convertSportteryMorningMatches,
  convertSportteryMatches,
  getNextSportteryAutoRefreshDelay,
  getSportteryRefreshPolicy,
  getSportteryMatchPhaseTc,
  hasMatchStarted,
  isSportteryRegularTimeFinished,
  isMatchSellable,
  mergeSportteryMatchCache,
  parseSportteryMatchScore,
  parseSportteryMatchScoreDetails,
  parseSportteryMatchHandicap,
  parseSportteryFixedBonus,
  refreshSelectedOdds,
  replaceSportteryMatches,
  type SportteryMatchCalculatorResponse,
  type SportteryMatchListResponse,
} from "../app/sporttery";

const beforeKickoff = new Date("2026-07-23T00:30:00");

const payload: SportteryMatchCalculatorResponse = {
  success: true,
  errorCode: "0",
  errorMessage: "处理成功",
  value: {
    totalCount: 1,
    lastUpdateTime: "2026-07-22 11:58:14",
    vtoolsConfig: { onLineSaleStatus: 1 },
    matchInfoList: [{
      businessDate: "2026-07-22",
      subMatchList: [{
        matchId: 2040585,
        matchNum: 3202,
        matchNumStr: "周三202",
        businessDate: "2026-07-22",
        matchDate: "2026-07-23",
        matchTime: "01:30:00",
        matchWeek: "周三",
        homeTeamAbbName: "富川FC",
        awayTeamAbbName: "安养FC",
        leagueAbbName: "韩职",
        matchStatus: "Selling",
        had: { h: "2.94", hf: "1", d: "2.82", df: "0", a: "2.30", af: "-1" },
        hhad: { h: "1.48", hf: "-1", d: "3.62", df: "0", a: "5.65", af: "1", goalLine: "+1" },
        crs: { s01s00: "8.00", s01s00f: "1", s1sh: "200.0", s1shf: "-1", s1sd: "500.0", s1sa: "150.0" },
        ttg: { s0: "8.50", s0f: "-1", s7: "40.00", s7f: "1" },
        hafu: { hh: "5.10", hhf: "1", da: "5.40", daf: "-1", aa: "4.00", aaf: "0" },
        poolList: [
          { poolCode: "HAD", poolStatus: "Selling", single: 0, allUp: 1 },
          { poolCode: "HHAD", poolStatus: "Selling", single: 0, allUp: 1 },
          { poolCode: "CRS", poolStatus: "Selling", single: 1, allUp: 1 },
          { poolCode: "TTG", poolStatus: "Selling", single: 1, allUp: 1 },
          { poolCode: "HAFU", poolStatus: "Selling", single: 1, allUp: 1 },
        ],
      }],
    }],
  },
};

const market = (match: ReturnType<typeof convertSportteryMatches>[number], type: "spf" | "rqspf" | "score" | "goals" | "halfFull") => (
  match.markets.find((item) => item.type === type)!
);

test("体彩接口五类玩法完整转换为投注页比赛结构", () => {
  const [match] = convertSportteryMatches(payload, beforeKickoff);
  assert.equal(match.id, "2040585");
  assert.equal(match.saleStatus, "selling");
  assert.equal(isMatchSellable(match, beforeKickoff), true);
  assert.equal(hasMatchStarted(match, beforeKickoff), false);
  assert.equal(hasMatchStarted(match, new Date("2026-07-23T01:30:00")), true);
  assert.equal(isMatchSellable(match, new Date("2026-07-23T01:30:00")), false);
  assert.equal(match.date, "2026-07-22");
  assert.equal(match.weekday, "周三");
  assert.equal(match.code, "202");
  assert.equal(match.time, "2026-07-23 01:30");
  assert.deepEqual(market(match, "spf").options.map((item) => item.odds), [2.94, 2.82, 2.3]);
  assert.deepEqual(market(match, "spf").options.map((item) => item.oddsTrend), [1, 0, -1]);
  assert.equal(market(match, "spf").singleAvailable, false);
  assert.equal(market(match, "rqspf").handicap, 1);
  assert.equal(market(match, "score").options.find((item) => item.id === "1:0")?.odds, 8);
  assert.equal(market(match, "score").options.find((item) => item.id === "winOther")?.odds, 200);
  assert.equal(market(match, "goals").options.find((item) => item.id === "7+")?.odds, 40);
  assert.equal(market(match, "halfFull").options.find((item) => item.id === "WW")?.odds, 5.1);
  assert.equal(market(match, "halfFull").options.find((item) => item.id === "DL")?.odds, 5.4);
  assert.equal(market(match, "halfFull").options.find((item) => item.id === "LL")?.odds, 4);
});

test("订单只更新匹配且仍可售的已选项倍率", () => {
  const latest = convertSportteryMatches(payload, beforeKickoff);
  const orderMatches = cloneMatches(latest);
  const spf = market(orderMatches[0], "spf");
  spf.options[0].selected = true;
  spf.options[0].odds = 9.99;
  spf.options[1].selected = true;
  market(latest[0], "spf").options[1].odds = 0;

  const refreshed = refreshSelectedOdds(orderMatches, latest);
  assert.equal(market(refreshed.matches[0], "spf").options[0].odds, 2.94);
  assert.equal(market(refreshed.matches[0], "spf").options[0].oddsTrend, 1);
  assert.equal(market(refreshed.matches[0], "spf").options[1].odds, 2.82);
  assert.equal(refreshed.matchedOptionCount, 1);
  assert.equal(refreshed.changedOptionCount, 1);
  assert.equal(refreshed.unmatchedOptionCount, 1);
});

test("同步时仅保留接口比赛和仍可用的已选项", () => {
  const incoming = convertSportteryMatches(payload, beforeKickoff);
  const previousOfficial = cloneMatches(incoming)[0];
  market(previousOfficial, "spf").options[0].selected = true;
  market(previousOfficial, "spf").options[0].odds = 9.99;
  const staleOfficial = { ...createEmptyMatch(9, true), id: "sporttery-old" };
  const local = { ...createEmptyMatch(8, true), id: "match-local", home: "本地主队", away: "本地客队" };

  const replaced = replaceSportteryMatches([local, staleOfficial, previousOfficial], incoming);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].id, "2040585");
  assert.equal(market(replaced[0], "spf").options[0].selected, true);
  assert.equal(market(replaced[0], "spf").options[0].odds, 2.94);
});

test("比赛缓存覆盖最新数据、停售旧比赛并清除五天前数据", () => {
  const incoming = convertSportteryMatches(payload, beforeKickoff);
  const previous = cloneMatches(incoming)[0];
  previous.id = "sporttery-2040585";
  market(previous, "spf").options[0].selected = true;
  market(previous, "spf").options[0].odds = 9.99;
  const stale = { ...createEmptyMatch(2), id: "2040001", date: "2026-07-20", saleStatus: "selling" as const };
  market(stale, "spf").options[0].selected = true;
  const expired = { ...createEmptyMatch(3), id: "2039999", date: "2026-07-17", saleStatus: "selling" as const };

  const cached = mergeSportteryMatchCache([previous, stale, expired], incoming, "2026-07-23");
  assert.equal(cached.length, 2);
  assert.equal(cached[0].id, "2040001");
  assert.equal(cached[0].saleStatus, "stopped");
  assert.equal(isMatchSellable(cached[0]), false);
  assert.equal(market(cached[0], "spf").options[0].selected, false);
  assert.equal(cached[1].id, "2040585");
  assert.equal(market(cached[1], "spf").options[0].selected, true);
  assert.equal(market(cached[1], "spf").options[0].odds, 2.94);
});

test("固定奖金接口按比分和半场比分解析五类赛果", () => {
  const [match] = convertSportteryMatches(payload, beforeKickoff);
  const result = parseSportteryFixedBonus({
    success: true,
    value: {
      sectionsNo999: "3:1",
      sectionsNo1: "1:0",
      matchResultList: [
        { code: "HAD", combination: "H" },
        { code: "HHAD", combination: "H" },
        { code: "CRS", combination: "3:1" },
        { code: "TTG", combination: "4" },
        { code: "HAFU", combination: "H:H" },
      ],
    },
  }, match);
  assert.deepEqual(result, {
    spf: "win",
    rqspf: "win",
    score: "3:1",
    goals: "4",
    halfFull: "WW",
  });
});

test("固定奖金接口可解析按 poolCode 返回的玩法结果", () => {
  const [match] = convertSportteryMatches(payload, beforeKickoff);
  const result = parseSportteryFixedBonus({ value: { matchResultList: [
    { poolCode: "HAD", poolResult: "H" },
    { poolCode: "HHAD", poolResult: "D" },
    { poolCode: "CRS", poolResult: "s03s02" },
    { poolCode: "TTG", poolResult: "s5" },
    { poolCode: "HAFU", poolResult: "hd" },
  ] } }, match);
  assert.deepEqual(result, { spf: "win", rqspf: "draw", score: "3:2", goals: "5", halfFull: "WD" });
});

test("固定奖金接口按真实 code 和 combination 结构解析已完赛赛果", () => {
  const [match] = convertSportteryMatches(payload, beforeKickoff);
  const result = parseSportteryFixedBonus({ value: {
    sectionsNo999: "2:3",
    matchResultList: [
      { code: "HHAD", combination: "D", goalLine: "+1" },
      { code: "HAFU", combination: "D:A" },
      { code: "CRS", combination: "2:3" },
      { code: "TTG", combination: "5" },
      { code: "HAD", combination: "A" },
    ],
  } }, match);
  assert.deepEqual(result, { spf: "lose", rqspf: "draw", score: "2:3", goals: "5", halfFull: "DL" });
});

test("matchResultList 为空时仍可从全场比分推导四类赛果", () => {
  const [match] = convertSportteryMatches(payload, beforeKickoff);
  const result = parseSportteryFixedBonus({
    success: true,
    value: {
      sectionsNo999: "2:1",
      sectionsNo1: "1:0",
      matchResultList: [],
    },
  }, match);
  assert.deepEqual(result, {
    spf: "win",
    rqspf: "win",
    score: "2:1",
    goals: "3",
  });
});

test("没有全场比分和玩法结果时保持赛果为空", () => {
  const [match] = convertSportteryMatches(payload, beforeKickoff);
  assert.deepEqual(parseSportteryFixedBonus({ value: { sectionsNo999: "", matchResultList: [] } }, match), {});
});

test("matchPhaseTc 按常规时间规则判断比赛阶段", () => {
  [1, 2, 10, 16].forEach((phase) => assert.equal(isSportteryRegularTimeFinished({ value: { matchPhaseTc: String(phase) } }), false));
  [3, 4, 5, 11, 12, 13, 14].forEach((phase) => assert.equal(isSportteryRegularTimeFinished({ value: { matchPhaseTc: String(phase) } }), true));
  assert.equal(getSportteryMatchPhaseTc({ value: { matchPhaseTc: "14" } }), 14);
  assert.equal(getSportteryMatchPhaseTc({ value: {} }), null);
  assert.equal(isSportteryRegularTimeFinished({ value: {} }), false);
});

test("比分接口从 sectionNo 1 和 2 推导五类常规时间赛果", () => {
  const [match] = convertSportteryMatches(payload, beforeKickoff);
  const scorePayload = {
    success: true,
    value: {
      matchPhaseTc: "14",
      sectionsNo999: "4:0",
      sectionsNos: [
        { score: "2:0", sectionNo: 1 },
        { score: "3:0", sectionNo: 2 },
      ],
    },
  };
  const result = parseSportteryMatchScore(scorePayload, match);
  assert.deepEqual(result, {
    spf: "win",
    rqspf: "win",
    score: "3:0",
    goals: "3",
    halfFull: "WW",
  });
  assert.deepEqual(parseSportteryMatchScoreDetails(scorePayload, match).fullScore, { home: 3, away: 0 });
});

test("按 matchId 返回的固定奖金数据提取最新让球数", () => {
  assert.equal(parseSportteryMatchHandicap({
    value: {
      matchResultList: [
        { code: "HHAD", combination: "D", goalLine: "+1" },
      ],
    },
  }), 1);
  assert.equal(parseSportteryMatchHandicap({
    value: {
      oddsHistory: {
        hhadList: [
          { goalLine: "-1" },
          { goalLine: "+1" },
        ],
      },
    },
  }), 1);
  assert.equal(parseSportteryMatchHandicap({ value: { oddsHistory: { hhadList: [] } } }), undefined);
});

test("比分存在但没有取得让球数时不生成让球胜平负赛果", () => {
  const [match] = convertSportteryMatches(payload, beforeKickoff);
  const rqspf = match.markets.find((market) => market.type === "rqspf");
  if (rqspf) rqspf.handicap = undefined;
  const result = parseSportteryMatchScore({
    value: {
      sectionsNos: [
        { score: "1:0", sectionNo: 1 },
        { score: "2:1", sectionNo: 2 },
      ],
    },
  }, match);
  assert.equal(result.rqspf, undefined);
  assert.equal(result.score, "2:1");
  assert.equal(result.halfFull, "WW");
});

test("进入加时后仍使用 sectionNo 2 的常规时间比分", () => {
  const [match] = convertSportteryMatches(payload, beforeKickoff);
  const result = parseSportteryMatchScore({
    value: {
      matchPhaseTc: "3",
      sectionsNo999: "2:1",
      sectionsNos: [
        { score: "0:0", sectionNo: 1 },
        { score: "1:1", sectionNo: 2 },
      ],
    },
  }, match);
  assert.equal(result.spf, "draw");
  assert.equal(result.score, "1:1");
  assert.equal(result.goals, "2");
  assert.equal(result.halfFull, "DD");
});

test("早间比赛使用 oddsHistory 各玩法最后一条记录", () => {
  const morningPayload = structuredClone(payload) as SportteryMatchListResponse;
  const morningMatch = morningPayload.value!.matchInfoList![0].subMatchList[0];
  delete morningMatch.had;
  delete morningMatch.hhad;
  delete morningMatch.crs;
  delete morningMatch.ttg;
  delete morningMatch.hafu;
  morningMatch.poolList = morningMatch.poolList!.map((pool) => ({
    poolCode: pool.poolCode,
    poolStatus: "Selling",
    cbtSingle: pool.poolCode === "HAD" ? 1 : 0,
    cbtAllUp: 1,
  }));
  const fixedPayloads = new Map<string, Record<string, unknown>>([["2040585", {
    value: {
      oddsHistory: {
        hadList: [
          { h: "9.99", hf: "1", d: "8.88", a: "7.77" },
          { h: "2.25", hf: "-1", d: "3.12", df: "0", a: "2.46", af: "1" },
        ],
        hhadList: [{ h: "2.28", hf: "1", d: "3.20", a: "2.88", goalLine: "-1" }],
        crsList: [{ s03s01: "10.50", s03s01f: "1" }],
        ttgList: [{ s2: "3.12", s2f: "-1" }],
        hafuList: [{ hd: "19.00", hdf: "1" }],
        singleList: [{ poolCode: "HAD", single: 1 }],
      },
    },
  }]]);

  const [match] = convertSportteryMorningMatches(morningPayload, fixedPayloads, beforeKickoff);
  assert.equal(match.saleStatus, "selling");
  assert.equal(market(match, "spf").options.find((option) => option.id === "win")?.odds, 2.25);
  assert.equal(market(match, "spf").options.find((option) => option.id === "win")?.oddsTrend, -1);
  assert.equal(market(match, "spf").options.find((option) => option.id === "draw")?.odds, 3.12);
  assert.equal(market(match, "spf").singleAvailable, true);
  assert.equal(market(match, "spf").passAvailable, true);
  assert.equal(market(match, "rqspf").handicap, -1);
  assert.equal(market(match, "score").options.find((option) => option.id === "3:1")?.odds, 10.5);
  assert.equal(market(match, "goals").options.find((option) => option.id === "2")?.oddsTrend, -1);
  assert.equal(market(match, "halfFull").options.find((option) => option.id === "WD")?.odds, 19);
});

test("自动刷新策略覆盖 09、11、23 点边界", () => {
  assert.deepEqual(getSportteryRefreshPolicy(new Date(2026, 6, 23, 8, 59)), { mode: "standard", autoIntervalMs: null });
  assert.deepEqual(getSportteryRefreshPolicy(new Date(2026, 6, 23, 9, 0)), { mode: "morning", autoIntervalMs: 5 * 60 * 1000 });
  assert.deepEqual(getSportteryRefreshPolicy(new Date(2026, 6, 23, 10, 59)), { mode: "morning", autoIntervalMs: 5 * 60 * 1000 });
  assert.deepEqual(getSportteryRefreshPolicy(new Date(2026, 6, 23, 11, 0)), { mode: "standard", autoIntervalMs: 60 * 60 * 1000 });
  assert.deepEqual(getSportteryRefreshPolicy(new Date(2026, 6, 23, 23, 0)), { mode: "standard", autoIntervalMs: null });
  assert.equal(getNextSportteryAutoRefreshDelay(new Date(2026, 6, 23, 10, 58)), 2 * 60 * 1000);
  assert.equal(getNextSportteryAutoRefreshDelay(new Date(2026, 6, 23, 22, 30)), 30 * 60 * 1000);
  assert.equal(getNextSportteryAutoRefreshDelay(new Date(2026, 6, 23, 23, 30)), 9.5 * 60 * 60 * 1000);
});
