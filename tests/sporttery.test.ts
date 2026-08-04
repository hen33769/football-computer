import assert from "node:assert/strict";
import test from "node:test";
import { cloneMatches, createEmptyMatch } from "../app/data";
import {
  convertSportteryMorningMatches,
  convertSportteryMatches,
  enrichSportteryMatchOddsHistory,
  fetchSportteryMatchSnapshot,
  getNextSportteryAutoRefreshDelay,
  getMatchSaleState,
  getSportteryRefreshPolicy,
  getSportteryMatchPhaseTc,
  hasMatchStarted,
  isSportteryRegularTimeFinished,
  isMatchSelectable,
  isMatchSellable,
  mergeSportteryMatchCache,
  parseSportteryOptionOddsHistory,
  parseSportteryMatchScore,
  parseSportteryMatchScoreDetails,
  parseSportteryMatchHandicap,
  parseSportteryFixedBonus,
  refreshSelectedOdds,
  replaceSportteryMatches,
  selectAvailableOrderBets,
  unionSportteryMatchCache,
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

test("开赛时间是停售边界，开赛前非可售比赛均为待开售", () => {
  const [match] = convertSportteryMatches(payload, new Date("2026-07-22T10:00:00"));
  assert.equal(match.saleStatus, "selling");
  assert.equal(getMatchSaleState(match, new Date("2026-07-22T10:00:00")), "selling");
  assert.equal(getMatchSaleState(match, new Date("2026-07-23T01:29:59")), "selling");
  assert.equal(getMatchSaleState(match, new Date("2026-07-23T01:30:00")), "stopped");

  const pending = {
    ...match,
    saleStatus: "pending" as const,
    date: "2026-07-30",
    time: "2026-07-31 20:00",
  };
  assert.equal(getMatchSaleState(pending, new Date("2026-07-22T10:00:00")), "pending");
  assert.equal(getMatchSaleState(pending, new Date("2026-07-31T19:59:59")), "pending");
  assert.equal(isMatchSellable(pending, new Date("2026-07-31T19:59:59")), false);
  assert.equal(isMatchSelectable(pending, new Date("2026-07-31T19:59:59")), true);

  const stopped = { ...pending, saleStatus: "stopped" as const };
  assert.equal(getMatchSaleState(stopped, new Date("2026-07-22T10:00:00")), "pending");
  assert.equal(isMatchSelectable(stopped, new Date("2026-07-22T10:00:00")), true);
  assert.equal(getMatchSaleState(stopped, new Date("2026-07-31T20:00:00")), "stopped");
  assert.equal(isMatchSelectable(stopped, new Date("2026-07-31T20:00:00")), false);
});

test("载入和复制订单只恢复当前仍可选择的投注项", () => {
  const current = convertSportteryMatches(payload, beforeKickoff);
  const orderMatches = cloneMatches(current);
  const orderSpf = market(orderMatches[0], "spf");
  orderSpf.options[0].selected = true;
  orderSpf.options[1].selected = true;
  market(orderMatches[0], "rqspf").options[0].selected = true;

  const currentSpf = market(current[0], "spf");
  currentSpf.options[1].odds = 0;
  currentSpf.options[2].selected = true;

  const available = selectAvailableOrderBets(current, orderMatches, beforeKickoff);
  assert.deepEqual(market(available[0], "spf").options.map((option) => option.selected), [true, false, false]);
  assert.equal(market(available[0], "rqspf").options[0].selected, true);

  const stopped = selectAvailableOrderBets(current, orderMatches, new Date("2026-07-23T01:30:00"));
  assert.equal(stopped[0].markets.some((item) => item.options.some((option) => option.selected)), false);
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

test("比赛缓存覆盖最新数据、停售旧比赛并清除七天前数据", () => {
  const incoming = convertSportteryMatches(payload, beforeKickoff);
  const previous = cloneMatches(incoming)[0];
  previous.id = "sporttery-2040585";
  market(previous, "spf").options[0].selected = true;
  market(previous, "spf").options[0].odds = 9.99;
  const stale = { ...createEmptyMatch(2), id: "2040001", date: "2026-07-20", saleStatus: "selling" as const };
  stale.time = "2026-07-20 20:00";
  market(stale, "spf").options[0].selected = true;
  const expired = { ...createEmptyMatch(3), id: "2039999", date: "2026-07-15", saleStatus: "selling" as const };
  expired.time = "2026-07-15 20:00";
  const future = { ...createEmptyMatch(4), id: "2040002", date: "2026-07-24", saleStatus: "selling" as const };
  future.time = "2026-07-24 20:00";
  market(future, "spf").options[0].selected = true;

  const cached = mergeSportteryMatchCache(
    [previous, stale, expired, future],
    incoming,
    new Date("2026-07-23T12:00:00"),
  );
  assert.equal(cached.length, 3);
  assert.equal(cached[0].id, "2040001");
  assert.equal(cached[0].saleStatus, "stopped");
  assert.equal(isMatchSellable(cached[0]), false);
  assert.equal(market(cached[0], "spf").options[0].selected, false);
  assert.equal(cached[1].id, "2040585");
  assert.equal(market(cached[1], "spf").options[0].selected, true);
  assert.equal(market(cached[1], "spf").options[0].odds, 2.94);
  assert.equal(cached[2].id, "2040002");
  assert.equal(cached[2].saleStatus, "pending");
  assert.equal(market(cached[2], "spf").options[0].selected, true);
});

test("新增导入比赛以新值更新同场数据，并由现有数据补齐缺项", () => {
  const existing = cloneMatches(convertSportteryMatches(payload, beforeKickoff))[0];
  market(existing, "spf").options[0].odds = 9.99;
  const duplicate = cloneMatches(convertSportteryMatches(payload, beforeKickoff))[0];
  duplicate.id = "sporttery-2040585";
  market(duplicate, "spf").options[0].odds = 1.11;
  duplicate.markets = [{
    ...market(duplicate, "spf"),
    options: [market(duplicate, "spf").options[0]],
  }];
  const added = { ...createEmptyMatch(2), id: "sporttery-2040002", date: "2026-07-24", code: "203" };
  const expired = { ...createEmptyMatch(3), id: "2039999", date: "2026-07-15" };

  const union = unionSportteryMatchCache(
    [existing, expired],
    [duplicate, added, cloneMatches([added])[0]],
    new Date("2026-07-23T12:00:00"),
  );

  assert.equal(union.length, 2);
  assert.equal(union[0].id, "2040585");
  assert.equal(market(union[0], "spf").options[0].odds, 1.11);
  assert.equal(market(union[0], "spf").options[1].odds, 2.82);
  assert.equal(market(union[0], "rqspf").options[0].odds, 1.48);
  assert.equal(union[1].id, "2040002");
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

test("matchResultList 为空时仍可从全场和半场比分推导五类赛果", () => {
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
    halfFull: "WW",
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
  assert.equal(match.saleStatus, "pending");
  assert.equal(getMatchSaleState(match, beforeKickoff), "pending");
  assert.equal(isMatchSelectable(match, beforeKickoff), true);
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

test("固定奖金历史仅保留实际倍率变化并计算最后一次方向", () => {
  const fixedHistoryPayload = {
    value: {
      oddsHistory: {
        hadList: [
          { h: "2.10", updateDate: "2026-07-25", updateTime: "09:00:00" },
          { h: "2.10", updateDate: "2026-07-25", updateTime: "10:00:00" },
          { h: "2.25", updateDate: "2026-07-26", updateTime: "11:00:00" },
          { h: "2.18", updateDate: "2026-07-27", updateTime: "12:00:00" },
        ],
      },
    },
  };
  const history = parseSportteryOptionOddsHistory(fixedHistoryPayload, "spf", "win");

  assert.deepEqual(history, [
    { odds: 2.1, updatedAt: "2026-07-25 09:00:00", trend: 0 },
    { odds: 2.25, updatedAt: "2026-07-26 11:00:00", trend: 1 },
    { odds: 2.18, updatedAt: "2026-07-27 12:00:00", trend: -1 },
  ]);

  const [baseMatch] = convertSportteryMatches(payload, beforeKickoff);
  market(baseMatch, "spf").options.find((option) => option.id === "win")!.odds = 2.18;
  const enriched = enrichSportteryMatchOddsHistory(baseMatch, fixedHistoryPayload);
  assert.equal(market(enriched, "spf").options.find((option) => option.id === "win")?.oddsTrend, -1);
  assert.equal(market(enriched, "spf").options.find((option) => option.id === "win")?.oddsHistory?.length, 3);
});

test("当前倍率缺失时使用趋势最后一条倍率", () => {
  const [baseMatch] = convertSportteryMatches(payload, beforeKickoff);
  market(baseMatch, "spf").options.find((option) => option.id === "win")!.odds = 0;
  const enriched = enrichSportteryMatchOddsHistory(baseMatch, {
    value: {
      oddsHistory: {
        hadList: [
          { h: "2.10", updateDate: "2026-07-25", updateTime: "09:00:00" },
          { h: "2.38", updateDate: "2026-07-25", updateTime: "10:00:00" },
        ],
      },
    },
  });
  const option = market(enriched, "spf").options.find((item) => item.id === "win");
  assert.equal(option?.odds, 2.38);
  assert.equal(option?.oddsTrend, 1);
  assert.equal(option?.oddsHistory?.length, 2);
});

test("比赛缓存同步不会用空倍率覆盖旧有效倍率", () => {
  const [previous] = cloneMatches(convertSportteryMatches(payload, beforeKickoff));
  const previousSpf = market(previous, "spf");
  previousSpf.options[0].selected = true;
  previousSpf.options[1].selected = true;

  const [incoming] = cloneMatches(convertSportteryMatches(payload, beforeKickoff));
  incoming.saleStatus = "stopped";
  incoming.markets.forEach((item) => {
    item.singleAvailable = false;
    item.passAvailable = false;
    item.options.forEach((option) => {
      option.odds = 0;
      option.oddsTrend = 0;
      option.selected = false;
      delete option.oddsHistory;
    });
  });
  const win = market(incoming, "spf").options.find((option) => option.id === "win")!;
  win.oddsHistory = [
    { odds: 2.1, updatedAt: "2026-07-25 09:00:00", trend: 0 },
    { odds: 2.38, updatedAt: "2026-07-25 10:00:00", trend: 1 },
  ];

  const [cached] = mergeSportteryMatchCache([previous], [incoming], beforeKickoff);
  const cachedSpf = market(cached, "spf");
  assert.equal(cached.saleStatus, "stopped");
  assert.equal(cachedSpf.options.find((option) => option.id === "win")?.odds, 2.38);
  assert.equal(cachedSpf.options.find((option) => option.id === "win")?.oddsTrend, 1);
  assert.equal(cachedSpf.options.find((option) => option.id === "draw")?.odds, 2.82);
  assert.deepEqual(cachedSpf.options.map((option) => option.selected), [true, true, false]);
});

test("常规模式以完整列表为主并用 calculator 覆盖同场详细赔率", async () => {
  const now = new Date("2026-07-24T12:00:00");
  const standardPayload = structuredClone(payload);
  const standardMatch = standardPayload.value!.matchInfoList![0].subMatchList[0];
  standardPayload.value!.matchInfoList![0].businessDate = "2026-07-24";
  standardMatch.businessDate = "2026-07-24";
  standardMatch.matchDate = "2026-07-24";
  standardMatch.matchTime = "20:00:00";

  const futureMatch = structuredClone(standardMatch);
  futureMatch.matchId = 2040999;
  futureMatch.matchNum = 6201;
  futureMatch.matchNumStr = "周六201";
  futureMatch.businessDate = "2026-07-25";
  futureMatch.matchDate = "2026-07-25";
  futureMatch.matchTime = "20:00:00";
  futureMatch.homeTeamAbbName = "未来主队";
  futureMatch.awayTeamAbbName = "未来客队";
  delete futureMatch.had;
  delete futureMatch.hhad;
  delete futureMatch.crs;
  delete futureMatch.ttg;
  delete futureMatch.hafu;
  futureMatch.poolList = futureMatch.poolList?.map((pool) => ({
    poolCode: pool.poolCode,
    poolStatus: "Selling",
    cbtSingle: 0,
    cbtAllUp: 1,
  }));

  const pastMatch = structuredClone(futureMatch);
  pastMatch.matchId = 2040998;
  pastMatch.businessDate = "2026-07-23";
  pastMatch.matchDate = "2026-07-23";

  const matchListPayload: SportteryMatchListResponse = {
    ...structuredClone(standardPayload),
    value: {
      ...structuredClone(standardPayload.value!),
      matchInfoList: [{
        businessDate: "2026-07-24",
        subMatchList: [structuredClone(standardMatch), futureMatch, pastMatch],
      }],
    },
  };
  const fixedBonusPayload = {
    success: true,
    value: {
      oddsHistory: {
        hadList: [{ h: "2.25", d: "3.12", a: "2.46" }],
        hhadList: [{ h: "2.28", d: "3.20", a: "2.88", goalLine: "-1" }],
        crsList: [{ s03s01: "10.50" }],
        ttgList: [{ s2: "3.12" }],
        hafuList: [{ hd: "19.00" }],
      },
    },
  };

  const originalFetch = globalThis.fetch;
  const fixedBonusMatchIds: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/getMatchCalculatorV1.qry")) {
      return Response.json(standardPayload);
    }
    if (url.pathname.endsWith("/getMatchListV1.qry")) {
      return Response.json(matchListPayload);
    }
    if (url.pathname.endsWith("/getFixedBonusV1.qry")) {
      fixedBonusMatchIds.push(url.searchParams.get("matchId") ?? "");
      return Response.json(fixedBonusPayload);
    }
    throw new Error(`未处理的测试请求：${url}`);
  };

  try {
    const snapshot = await fetchSportteryMatchSnapshot("standard", now);
    assert.equal(snapshot.mode, "standard");
    assert.deepEqual(fixedBonusMatchIds.sort(), ["2040585", "2040999"]);
    assert.deepEqual(snapshot.matches.map((match) => match.id), ["2040585", "2040999"]);
    const detailed = snapshot.matches.find((match) => match.id === "2040585")!;
    assert.equal(detailed.saleStatus, "selling");
    assert.equal(getMatchSaleState(detailed, now), "selling");
    assert.equal(market(detailed, "spf").options.find((option) => option.id === "win")?.odds, 2.94);
    const supplemented = snapshot.matches.find((match) => match.id === "2040999")!;
    assert.equal(supplemented.saleStatus, "pending");
    assert.equal(market(supplemented, "spf").options.find((option) => option.id === "win")?.odds, 2.25);
    assert.equal(market(supplemented, "rqspf").handicap, -1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("常规模式在 calculator 暂无比赛列表时使用完整列表补充待开售比赛", async () => {
  const now = new Date("2026-08-04T12:00:00");
  const calculatorPayload: SportteryMatchCalculatorResponse = {
    success: true,
    errorCode: "0",
    errorMessage: "处理成功",
    value: {
      vtoolsConfig: { onLineSaleStatus: 1 },
    },
  };
  const baseMatch = structuredClone(payload.value!.matchInfoList![0].subMatchList[0]);
  baseMatch.matchId = 2040716;
  baseMatch.matchNum = 2001;
  baseMatch.matchNumStr = "周二001";
  baseMatch.businessDate = "2026-08-04";
  baseMatch.matchDate = "2026-08-05";
  baseMatch.matchTime = "08:30:00";
  baseMatch.matchStatus = "Define";
  baseMatch.homeTeamAbbName = "里莫";
  baseMatch.awayTeamAbbName = "桑托斯";
  baseMatch.leagueAbbName = "巴西杯";
  const euroMatch = structuredClone(baseMatch);
  euroMatch.matchId = 2040727;
  euroMatch.matchNum = 2002;
  euroMatch.matchNumStr = "周二002";
  euroMatch.matchTime = "00:00:00";
  euroMatch.homeTeamAbbName = "米亚尔比";
  euroMatch.awayTeamAbbName = "布拉迪斯";
  euroMatch.leagueAbbName = "欧冠";
  const matchListPayload: SportteryMatchListResponse = {
    success: true,
    errorCode: "0",
    errorMessage: "处理成功",
    value: {
      totalCount: 2,
      lastUpdateTime: "2026-08-04 08:26:11",
      matchInfoList: [{
        businessDate: "2026-08-04",
        subMatchList: [baseMatch, euroMatch],
      }],
      matchDateList: [{ businessDate: "2026-08-04", businessDateCn: "周二" }],
      leagueList: [
        { leagueId: "7", leagueName: "巴西杯", leagueNameAbbr: "巴西杯" },
        { leagueId: "69", leagueName: "欧洲冠军联赛", leagueNameAbbr: "欧冠" },
      ],
    },
  };

  const originalFetch = globalThis.fetch;
  const fixedBonusMatchIds: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/getMatchCalculatorV1.qry")) {
      return Response.json(calculatorPayload);
    }
    if (url.pathname.endsWith("/getMatchListV1.qry")) {
      return Response.json(matchListPayload);
    }
    if (url.pathname.endsWith("/getFixedBonusV1.qry")) {
      fixedBonusMatchIds.push(url.searchParams.get("matchId") ?? "");
      return Response.json({ success: true, value: { oddsHistory: {} } });
    }
    throw new Error(`未处理的测试请求：${url}`);
  };

  try {
    const snapshot = await fetchSportteryMatchSnapshot("standard", now);
    assert.deepEqual(snapshot.matches.map((match) => match.id), ["2040716", "2040727"]);
    assert.deepEqual(snapshot.leagues.map((league) => league.leagueNameAbbr), ["巴西杯", "欧冠"]);
    assert.equal(snapshot.lastUpdateTime, "2026-08-04 08:26:11");
    assert.deepEqual(fixedBonusMatchIds.sort(), ["2040716", "2040727"]);
    assert.equal(getMatchSaleState(snapshot.matches[0], now), "pending");
    assert.equal(getMatchSaleState(snapshot.matches[1], now), "pending");
  } finally {
    globalThis.fetch = originalFetch;
  }
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
