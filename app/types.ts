export type MarketType = "spf" | "rqspf" | "score" | "goals" | "halfFull";

export type OddsHistoryEntry = {
  odds: number;
  updatedAt: string;
  trend: -1 | 0 | 1;
};

export type OddsOption = {
  id: string;
  label: string;
  odds: number;
  oddsTrend?: -1 | 0 | 1;
  oddsHistory?: OddsHistoryEntry[];
  selected: boolean;
};

export type Market = {
  type: MarketType;
  handicap?: number;
  singleAvailable?: boolean;
  passAvailable?: boolean;
  options: OddsOption[];
};

export type MatchItem = {
  id: string;
  saleStatus?: "pending" | "selling" | "stopped";
  date: string;
  weekday: string;
  code: string;
  league: string;
  time: string;
  home: string;
  away: string;
  markets: Market[];
  result?: MatchResult;
};

export type CurrentHits = Record<string, Partial<Record<MarketType, string>>>;

export type MatchResult = {
  matchId: string;
  updatedAt: string;
  source: "manual" | "api";
  values: Partial<Record<MarketType, string>>;
  rqspfHandicap?: number;
  fullScore?: {
    home: number;
    away: number;
  };
  halfScore?: {
    home: number;
    away: number;
  };
};

export type MatchResults = Record<string, MatchResult>;

export type SavedSlip = {
  id?: string;
  name: string;
  savedAt: string;
  updatedAt?: string;
  matches: MatchItem[];
  passes: number[];
  multiple: number;
  paymentStatus?: "unpaid" | "paid";
  oddsLocked?: boolean;
  hits?: CurrentHits;
  resultValues?: CurrentHits;
  failedMatches?: string[];
  settledAt?: string;
  settledPrize?: number;
  oddsLockedBeforeSettlement?: boolean;
};

export type PrizeRange = {
  min: number;
  max: number;
  uncappedMax: number;
};
