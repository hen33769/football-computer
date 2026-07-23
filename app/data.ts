import type { Market, MarketType, MatchItem, OddsOption } from "./types";

export const MARKET_LABELS: Record<MarketType, string> = {
  spf: "胜平负",
  rqspf: "让球胜平负",
  score: "比分",
  goals: "总进球数",
  halfFull: "半全场胜平负",
};

export const MARKET_LIMITS: Record<MarketType, number> = {
  spf: 8,
  rqspf: 8,
  score: 4,
  goals: 6,
  halfFull: 4,
};

export const DEFAULT_VISIBLE_MARKETS: MarketType[] = ["spf", "rqspf"];

const weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function weekdayFromDate(dateValue: string): string {
  const date = new Date(`${dateValue}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "" : weekdayNames[date.getDay()];
}

const option = (id: string, label: string, odds: number): OddsOption => ({
  id,
  label,
  odds,
  selected: false,
});

const scoreLabels = [
  "1:0", "2:0", "2:1", "3:0", "3:1", "3:2", "4:0", "4:1", "4:2", "5:0", "5:1", "5:2",
  "胜其他", "0:0", "1:1", "2:2", "3:3", "平其他", "0:1", "0:2", "1:2", "0:3", "1:3", "2:3",
  "0:4", "1:4", "2:4", "0:5", "1:5", "2:5", "负其他",
];

const scoreIds = [
  "1:0", "2:0", "2:1", "3:0", "3:1", "3:2", "4:0", "4:1", "4:2", "5:0", "5:1", "5:2",
  "winOther", "0:0", "1:1", "2:2", "3:3", "drawOther", "0:1", "0:2", "1:2", "0:3", "1:3", "2:3",
  "0:4", "1:4", "2:4", "0:5", "1:5", "2:5", "loseOther",
];

const scoreBaseOdds = [
  7.5, 12, 8.5, 24, 20, 28, 55, 48, 70, 120, 110, 150,
  32, 8, 5.8, 12, 42, 160, 8.2, 12, 8.5, 25, 20, 28,
  60, 55, 75, 130, 120, 160, 34,
];

export function createMarkets(seed = 0, handicap = -1): Market[] {
  const bump = (value: number, factor = 1) => Number((value + seed * factor).toFixed(2));
  return [
    {
      type: "spf",
      singleAvailable: true,
      options: [option("win", "主胜", bump(1.82, 0.04)), option("draw", "平", bump(3.42, 0.03)), option("lose", "主负", bump(3.58, -0.04))],
    },
    {
      type: "rqspf",
      handicap,
      singleAvailable: true,
      options: [option("win", "主胜", bump(3.26, 0.05)), option("draw", "平", bump(3.62, 0.02)), option("lose", "主负", bump(1.84, -0.03))],
    },
    {
      type: "score",
      options: scoreLabels.map((label, index) => option(scoreIds[index], label, bump(scoreBaseOdds[index], 0.35))),
    },
    {
      type: "goals",
      options: [8.5, 4.2, 3.25, 3.55, 5.8, 10.5, 20, 32].map((odds, index) => option(index === 7 ? "7+" : String(index), index === 7 ? "7+" : String(index), bump(odds, 0.16))),
    },
    {
      type: "halfFull",
      options: ["胜胜", "胜平", "胜负", "平胜", "平平", "平负", "负胜", "负平", "负负"].map((label, index) =>
        option(["WW", "WD", "WL", "DW", "DD", "DL", "LW", "LD", "LL"][index], label, bump([4.5, 13, 22, 5.6, 4.8, 5.2, 22, 13, 4.1][index], 0.22)),
      ),
    },
  ];
}

export function createEmptyMatch(index = 0, emptyOdds = false): MatchItem {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const markets = createMarkets(index % 4);
  if (emptyOdds) {
    markets.forEach((market) => market.options.forEach((item) => { item.odds = 0; }));
    const handicapMarket = markets.find((market) => market.type === "rqspf");
    if (handicapMarket) handicapMarket.handicap = undefined;
  }
  return {
    id: `match-${Date.now()}-${index}`,
    date,
    weekday: weekdayFromDate(date),
    code: String(index + 1).padStart(3, "0"),
    league: "",
    time: `${date} 20:00`,
    home: "",
    away: "",
    markets,
  };
}

export const initialMatches: MatchItem[] = [
  ["2026-07-22", "周三", "201", "韩职", "18:30", "富川FC", "安养FC", -1],
  ["2026-07-22", "周三", "202", "欧冠", "21:00", "费内巴切", "本菲卡", 1],
  ["2026-07-23", "周四", "101", "瑞超", "01:00", "马尔默", "埃尔夫斯堡", -1],
  ["2026-07-23", "周四", "102", "美职足", "08:30", "迈阿密国际", "亚特兰大联", -1],
  ["2026-07-24", "周五", "001", "日职", "18:00", "浦和红钻", "大阪钢巴", 1],
  ["2026-07-24", "周五", "002", "挪超", "23:00", "博德闪耀", "维京", -1],
].map(([date, weekday, code, league, time, home, away, handicap], index) => ({
  id: `sample-${index + 1}`,
  date: String(date),
  weekday: String(weekday),
  code: String(code),
  league: String(league),
  time: String(time),
  home: String(home),
  away: String(away),
  markets: createMarkets(index, Number(handicap)),
}));

export function cloneMatches(matches: MatchItem[]): MatchItem[] {
  return JSON.parse(JSON.stringify(matches)) as MatchItem[];
}
