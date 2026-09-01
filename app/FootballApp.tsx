"use client";

import {
  App,
  Button,
  Card,
  Checkbox,
  ColorPicker,
  ConfigProvider,
  DatePicker,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Popover,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Upload,
  type InputRef,
} from "antd";
import {
  CalculatorOutlined,
  CaretDownOutlined,
  CaretUpOutlined,
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  DollarOutlined,
  EditOutlined,
  ExpandOutlined,
  EyeOutlined,
  HomeOutlined,
  ImportOutlined,
  InfoCircleOutlined,
  LineChartOutlined,
  LockOutlined,
  LoadingOutlined,
  MinusOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  RollbackOutlined,
  SaveOutlined,
  UndoOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  calculateBetSummary,
  calculateCurrentPrize,
  calculatePassMultipliers,
  calculatePrizeRange,
  calculatePrizeRangeMetrics,
  calculateStake,
  countBets,
  getOrderShortPasses,
  getOrderStatus,
  getPassOptions,
  isOrderFailed,
  isOrderSettleable,
  isNewMatchSelectionBlocked,
  matchHasSelectedHit,
  MAX_SELECTED_MATCHES,
  selectedMatches,
  selectedOptions,
  winningOptionId,
  type PrizeRangeMetrics,
} from "./calculator";
import { appendOrderPassValue, formatOrderPassValue, inferOrderPasses } from "./order-passes";
import { matchPassesLeagueFilter, orderContainsTeam, orderPassesLeagueFilter, retainAvailableLeagueNames, splitTeamNameByQuery } from "./order-filters";
import { prioritizeLeagueNames, sortMatchesForManualOrder } from "./sorting";
import {
  cloneMatches,
  MARKET_LABELS,
} from "./data";
import {
  CLOUD_STORAGE_KEYS,
  ensureOrderIds,
  type CloudAccount,
  type CloudPersonalData,
  type CloudSyncStatus,
} from "./cloud";
import { applyOrderSyncIntent, type CloudOrderMutationResult, type OrderSyncIntent } from "./personal-sync";
import { localCache, sessionCache } from "./browser-storage";
import { MatchPreviewModal, OfficialTrendModal } from "./FootballInsights";
import { FinanceTrendModal } from "./FinanceTrendModal";
import { buildFinanceTrendFromOrders, shanghaiDateKey } from "./finance-trend";
import { getFinanceTrend } from "./api-client/finance";
import { orderFilterIncomeTotal, orderLedgerTotals, orderStakeTotal, sortSavedOrders, unionSavedOrders } from "./imports";
import { isOrderPaid } from "./order-model";
import { CLOUD_APP_URL } from "./links";
import { formatManualMatchText, formatManualOrderText } from "./manual-order-format";
import { AppShellHeader } from "./components/AppShellHeader";
import { TeamNameWithAlias } from "./components/TeamNameWithAlias";
import { parseRecognizedText } from "./ocr";
import {
  convertSportteryMatches,
  fetchSportteryMatchCalculator,
  fetchSportteryMatchById,
  fetchSportteryMatchHandicap,
  fetchSportteryMatchScore,
  fetchSportteryMatchSnapshot,
  getMatchSaleState,
  getNextSportteryAutoRefreshDelay,
  getSportteryRefreshPolicy,
  hasMatchStarted,
  getSportteryMatchPhaseTc,
  isSportteryRegularTimeFinished,
  isMatchSelectable,
  mergeSportteryMatchCache,
  normalizeSportteryMatchId,
  parseSportteryMatchScoreDetails,
  refreshSelectedOdds,
  selectAvailableOrderBets,
  unionSportteryMatchCache,
  type SportteryLeague,
  type SportteryMatchFetchMode,
  type SportteryMatchSnapshot,
  type SportteryMatchDate,
} from "./sporttery";
import { hasCompleteMatchResult, isMatchResult, isOrderMatchJudged, judgeLoadedOrdersWithResults, repairSlipHandicapResults, RESULT_MARKETS, resultSelectOptions } from "./results";
import {
  AUTO_RESULT_REQUEST_INTERVAL_MS,
  scheduleAutoResultRetry,
  type AutoResultRetryState,
} from "./result-fetch-queue";
import {
  createDefaultSettings,
  DEFAULT_LEAGUE_TAG_COLORS,
  getLeagueTagColor,
  leagueColorSettingKey,
  loadAppSettings,
  normalizeAppSettings,
  readableTagTextColor,
  saveAppSettings,
  unionAppSettings,
  withLeagueTagColor,
  type AppSettings,
} from "./settings";
import { buildTeamNameIndex, normalizeTeamName, type TeamNameActiveSlot, type TeamNameGroup, type TeamNameGroupDraft } from "./team-aliases";
import type { CurrentHits, Market, MarketType, MatchItem, MatchResults, OddsOption, PrizeRange, SavedSlip } from "./types";

const SAVED_KEY = CLOUD_STORAGE_KEYS.orders;
const LEGACY_DRAFT_KEY = "football-simulator-current-draft-v1";
const PROFIT_KEY = "football-simulator-current-profit-v1";
const EXPENSE_KEY = CLOUD_STORAGE_KEYS.expense;
const INCOME_KEY = CLOUD_STORAGE_KEYS.income;
const LOADED_ORDER_KEY = "football-simulator-loaded-order-v1";
const MATCH_CACHE_KEY = CLOUD_STORAGE_KEYS.matches;
const LEGACY_MATCH_RESULTS_KEY = "football-simulator-match-results-v1";
const ORDER_LIST_BATCH_SIZE = 10;
const RESPONSIVE_DATE_PICKER_CLASS_NAMES = { popup: { root: "responsive-date-picker-popup" } };

export type AppView = "betting" | "orders" | "settings";
type DataTransferMode = "orders" | "settings" | "matches" | "full";
type ImportStrategy = "merge" | "replace";
type OrderProgressFilter = "settled" | "unsettled" | "unpaid" | null;
type OrderStatusFilter = "success" | "hopeful" | "failed" | "paid";
type CloudOrderQuery = {
  from?: string | null;
  to?: string | null;
  progress?: OrderProgressFilter;
  statuses?: OrderStatusFilter[];
  limit?: number;
  offset?: number;
};
type CloudOrderQueryResult = {
  orders: SavedSlip[];
  total: number;
  unsettledCount: number;
};
type MatchSaleFilter = "all" | "non-stopped" | "stopped" | "selling" | "pending";
const MATCH_SALE_FILTER_OPTIONS: Array<{ value: MatchSaleFilter; label: string }> = [
  { value: "all", label: "不限" },
  { value: "non-stopped", label: "非停售" },
  { value: "stopped", label: "已停售" },
  { value: "selling", label: "可售" },
  { value: "pending", label: "待开售" },
];
const MATCH_PHASE_ROWS = [
  [1, "上半场"],
  [2, "下半场"],
  [3, "加时赛上半场"],
  [4, "加时赛下半场"],
  [5, "点球决胜"],
  [10, "中场休息"],
  [11, "下半场结束，等待加时赛"],
  [12, "加时赛中场休息"],
  [13, "加时赛结束，等待点球决胜"],
  [14, "比赛结束"],
  [16, "赛前"],
] as const;
const MANUAL_ORDER_PASS_SHORTCUTS = Array.from({ length: 8 }, (_, index) => index + 1);
type LoadedOrderDraft = {
  mode?: "load" | "copy";
  filteredOptionCount?: number;
  id: string;
  name: string;
  matches: MatchItem[];
  passes: number[];
  multiple: number;
  hits: CurrentHits;
};
type AccountLoginBetDraft = {
  matches: MatchItem[];
  passes: number[];
  multiple: number;
  hits: CurrentHits;
};
type ManualOrderEntry = {
  key: string;
  matchId: string | null;
  text: string;
};

const HighlightedOrderTeamName = ({ name, query }: { name: string; query: string }) => (
  <>
    {splitTeamNameByQuery(name, query).map((segment, index) => (
      segment.highlighted
        ? <mark className="order-team-query-highlight" key={`${index}-${segment.text}`}>{segment.text}</mark>
        : <Fragment key={`${index}-${segment.text}`}>{segment.text}</Fragment>
    ))}
  </>
);

const currency = (value: number) => value.toLocaleString("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const savedSlipDateKey = (savedAt: string) => {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const createSlipId = () => String(Date.now());

const parseMatchDateTime = (match: Pick<MatchItem, "date" | "time">) => {
  if (!match.time) return null;
  const source = /^\d{1,2}:\d{2}$/.test(match.time)
    ? `${match.date}T${match.time}:00`
    : match.time.replace(" ", "T");
  const parsed = dayjs(source);
  return parsed.isValid() ? parsed : null;
};

const formatMatchCardTime = (match: MatchItem) => parseMatchDateTime(match)?.format("MM-DD HH:mm") ?? match.time;

const compareMatchDisplayOrder = (left: MatchItem, right: MatchItem) => (
  left.date.localeCompare(right.date)
  || left.code.localeCompare(right.code, "zh-CN", { numeric: true, sensitivity: "base" })
);

const sortMatchesForDisplay = (items: MatchItem[]) => [...items].sort(compareMatchDisplayOrder);

const countSelectedOptions = (items: MatchItem[]) => items.reduce((total, match) => total + selectedOptions(match).length, 0);

const matchesSaleFilter = (match: MatchItem, filter: MatchSaleFilter, now: Date) => {
  const state = getMatchSaleState(match, now);
  if (filter === "all") return true;
  if (filter === "non-stopped") return state !== "stopped";
  return state === filter;
};

const isOrderOddsLocked = (slip: Pick<SavedSlip, "oddsLocked" | "settledAt" | "paymentStatus">) => (
  Boolean(slip.settledAt || slip.oddsLocked || isOrderPaid(slip))
);

const formatHandicap = (handicap: number) => `${handicap > 0 ? "+" : ""}${handicap}`;

const formatOrderOptionLabel = (market: Market, option: OddsOption) => {
  if (market.type !== "rqspf" || typeof market.handicap !== "number") return option.label;
  const resultLabel = option.label === "主胜" ? "胜" : option.label === "主负" ? "负" : option.label;
  return `(${formatHandicap(market.handicap)})${resultLabel}`;
};

const HALF_FULL_RESULT_LABELS: Record<string, string> = {
  WW: "胜胜",
  WD: "胜平",
  WL: "胜负",
  DW: "平胜",
  DD: "平平",
  DL: "平负",
  LW: "负胜",
  LD: "负平",
  LL: "负负",
};

const matchResultOptionLabel = (match: MatchItem, type: MarketType, optionId?: string) => {
  if (!optionId) return null;
  return match.markets.find((market) => market.type === type)?.options.find((option) => option.id === optionId)?.label
    ?? (type === "halfFull" ? HALF_FULL_RESULT_LABELS[optionId] : undefined)
    ?? optionId;
};

const orderActionKey = (slip: Pick<SavedSlip, "id" | "savedAt">) => slip.id || slip.savedAt;

const createManualOrderEntry = (): ManualOrderEntry => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  matchId: null,
  text: "",
});

function ManualMatchOptionLabel({ match, now }: { match: MatchItem; now: Date }) {
  const saleState = getMatchSaleState(match, now);
  return (
    <span className="manual-match-option-label">
      <span>{match.date} · {match.weekday}{match.code} · {match.home} VS {match.away}</span>
      {saleState === "selling"
        ? <Tag color="success">在售</Tag>
        : saleState === "pending"
          ? <Tag color="orange">待开售</Tag>
          : <Tag color="error">已停售</Tag>}
    </span>
  );
}

const matchWithClearedSelections = (match: MatchItem): MatchItem => ({
  ...cloneMatches([match])[0],
  id: normalizeSportteryMatchId(match.id),
  markets: match.markets.map((market) => ({
    ...market,
    options: market.options.map((option) => ({ ...option, selected: false })),
  })),
});

function OddsTrendIndicator({ trend }: { trend?: -1 | 0 | 1 }) {
  if (!trend) return null;
  const rising = trend > 0;
  return (
    <span className={`odds-trend ${rising ? "up" : "down"}`} aria-label={rising ? "倍率上涨" : "倍率下跌"} title={rising ? "倍率上涨" : "倍率下跌"}>
      {rising ? <CaretUpOutlined aria-hidden="true" /> : <CaretDownOutlined aria-hidden="true" />}
    </span>
  );
}

function OddsHistoryTooltip({
  option,
  children,
  disabled = false,
}: {
  option: OddsOption;
  children: ReactElement;
  disabled?: boolean;
}) {
  const history = option.oddsHistory ?? [];
  const changeCount = Math.max(0, history.length - 1);
  if (disabled || !history.length) return children;
  const displayedHistory = history;
  const openingOdds = displayedHistory[0].odds;
  const content = (
    <div className="odds-history-popover">
      <div className="odds-history-title"><b>{option.label}</b><span>共 {history.length} 条记录 · {changeCount} 次变化</span></div>
      <div className="odds-history-columns"><span>时间</span><span>倍率</span><span>较初盘</span></div>
      <div className="odds-history-list">
        {displayedHistory.map((entry, index) => {
          const isInitial = index === 0;
          const isLatest = displayedHistory.length > 1 && index === displayedHistory.length - 1;
          const rawRelativeChange = entry.odds - openingOdds;
          const relativeChange = Math.abs(rawRelativeChange) < 0.005 ? 0 : rawRelativeChange;
          return (
            <div key={`${entry.updatedAt}-${entry.odds}-${index}`}>
              <span className="odds-history-date">
                {entry.updatedAt || "发布时间未知"}
                {isInitial && <Tag color="blue">初盘</Tag>}
                {isLatest && <Tag color="red">最新</Tag>}
              </span>
              <strong className={entry.trend > 0 ? "up" : entry.trend < 0 ? "down" : ""}>
                {entry.odds.toFixed(2)}<OddsTrendIndicator trend={entry.trend} />
              </strong>
              <span className={`odds-history-relative ${relativeChange > 0 ? "up" : relativeChange < 0 ? "down" : ""}`}>
                {relativeChange > 0 ? "+" : ""}{relativeChange.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
  return (
    <Tooltip
      title={content}
      color="#fff"
      mouseEnterDelay={0.6}
      placement="top"
      classNames={{ root: "odds-history-tooltip" }}
    >
      <span className="odds-tooltip-target">{children}</span>
    </Tooltip>
  );
}

const winningMultiplierRange = (range: PrizeRangeMetrics["multiplier"]) => {
  if (range.max <= 0) return "—";
  const format = (value: number) => value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${format(range.min)} – ${format(range.max)} 倍`;
};

function DetailPrizeRange({ range, metrics, live = false }: { range: PrizeRange; metrics: PrizeRangeMetrics; live?: boolean }) {
  return (
    <div className="detail-range-card">
      <div className="detail-range-prize">
        <span>{live ? "实时中奖奖金范围" : "中奖奖金范围"}</span>
        <strong>{metrics.available ? `¥${currency(metrics.prize.min)} – ¥${currency(metrics.prize.max)}` : "—"}</strong>
        <small>{live ? "已有成功投注项的比赛仅按成功项计算；最低值排除未中奖的 0 元结果" : "最低值排除未中奖的 0 元结果"}</small>
        <div className="detail-range-metrics">
          <div>
            <span>中奖时利润范围</span>
            <b>{metrics.available ? `¥${currency(metrics.profit.min)} – ¥${currency(metrics.profit.max)}` : "—"}</b>
          </div>
          <div>
            <span>中奖倍率范围</span>
            <b>{winningMultiplierRange(metrics.multiplier)}</b>
          </div>
        </div>
      </div>
      {range.uncappedMax > range.max && <p className="detail-range-cap">未封顶理论最高 ¥{currency(range.uncappedMax)}，已按官方单注上限修正。</p>}
    </div>
  );
}

function PassMultiplierDetails({ matches, passes, hits }: { matches: MatchItem[]; passes: number[]; hits: CurrentHits }) {
  const orderedMatches = useMemo(() => sortMatchesForDisplay(matches), [matches]);
  const details = useMemo(() => calculatePassMultipliers(orderedMatches, passes, hits), [orderedMatches, passes, hits]);
  const summary = useMemo(() => calculateBetSummary(orderedMatches, passes), [orderedMatches, passes]);
  if (details.length === 0) return null;
  const grouped = [...passes].sort((left, right) => left - right).map((pass) => ({ pass, items: details.filter((item) => item.pass === pass) }));
  const fullMultiplier = (value: number) => value.toLocaleString("zh-CN", { useGrouping: false, minimumFractionDigits: 0, maximumFractionDigits: 4 });
  return (
    <section className="pass-multiplier-details">
      <div className="pass-multiplier-title">
        <span>串关明细</span>
        <div className="pass-multiplier-title-tags">
          <Tag color="geekblue">{summary.ticketCount} 张</Tag>
          <Tag color="cyan">{summary.groupCount} 组</Tag>
          <Tag color="orange">{summary.betCount} 注</Tag>
        </div>
      </div>
      {grouped.map(({ pass, items }) => (
        <div className="pass-multiplier-group" key={pass}>
          <h4>{pass === 1 ? "单场" : `${pass} 串 1`}<small>{items.length} 组</small></h4>
          <div className="pass-multiplier-lines">
            {items.map((item, index) => (
              <div className="pass-multiplier-line" key={`${pass}-${index}`}>
                <strong className="pass-multiplier-bet-count">{item.betCount} 注</strong>
                <i>|</i>
                <strong className={item.fullyHit ? "complete-hit" : "incomplete-hit"}>@{item.hitMultiplier.toFixed(2)}</strong>
                <i>|</i>
                <strong className="full-multiplier">@{fullMultiplier(item.multiplier)}</strong>
                <b>=</b>
                <div>{item.factors.map((factor, factorIndex) => (
                  <Fragment key={`${factor.matchId}-${factor.marketType}-${factor.optionId}`}>
                    {factorIndex > 0 && <em>×</em>}
                    <span className={factor.hit ? "factor-hit" : "factor-miss"} title={`${factor.matchLabel} · ${MARKET_LABELS[factor.marketType]} · ${factor.optionLabel}`}>@{factor.odds.toFixed(2)}</span>
                  </Fragment>
                ))}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

const MARKET_TYPES: MarketType[] = ["spf", "rqspf", "score", "goals", "halfFull"];

const isExportedMatch = (value: unknown): value is MatchItem => {
  if (!value || typeof value !== "object") return false;
  const match = value as Partial<MatchItem>;
  if (![match.id, match.date, match.weekday, match.code, match.league, match.time, match.home, match.away].every((item) => typeof item === "string")) return false;
  if (typeof match.saleStatus !== "undefined" && !["pending", "selling", "stopped"].includes(match.saleStatus)) return false;
  if (typeof match.result !== "undefined" && !isMatchResult(match.result)) return false;
  if (!Array.isArray(match.markets)) return false;
  return match.markets.every((market) => (
    Boolean(market)
    && typeof market === "object"
    && MARKET_TYPES.includes(market.type)
    && Array.isArray(market.options)
    && market.options.every((option) => (
      Boolean(option)
      && typeof option.id === "string"
      && typeof option.label === "string"
      && typeof option.odds === "number"
      && Number.isFinite(option.odds)
      && (typeof option.oddsTrend === "undefined" || [-1, 0, 1].includes(option.oddsTrend))
      && (typeof option.oddsHistory === "undefined" || (
        Array.isArray(option.oddsHistory)
        && option.oddsHistory.every((entry) => (
          typeof entry.odds === "number"
          && Number.isFinite(entry.odds)
          && typeof entry.updatedAt === "string"
          && [-1, 0, 1].includes(entry.trend)
        ))
      ))
      && typeof option.selected === "boolean"
    ))
  ));
};

const isExportedHits = (value: unknown): value is CurrentHits => Boolean(value)
  && typeof value === "object"
  && !Array.isArray(value)
  && Object.values(value as Record<string, unknown>).every((matchHits) => Boolean(matchHits)
    && typeof matchHits === "object"
    && !Array.isArray(matchHits)
    && Object.entries(matchHits as Record<string, unknown>).every(([market, optionId]) => (
      MARKET_TYPES.includes(market as MarketType) && (typeof optionId === "undefined" || typeof optionId === "string")
    )));

const isExportedOrder = (value: unknown): value is SavedSlip => {
  if (!value || typeof value !== "object") return false;
  const order = value as Partial<SavedSlip>;
  return (typeof order.id === "undefined" || typeof order.id === "string")
    && typeof order.name === "string"
    && typeof order.savedAt === "string"
    && Array.isArray(order.matches)
    && order.matches.every(isExportedMatch)
    && selectedMatches(order.matches).length <= MAX_SELECTED_MATCHES
    && Array.isArray(order.passes)
    && order.passes.every((pass) => Number.isInteger(pass) && pass >= 1 && pass <= 8)
    && typeof order.multiple === "number"
    && Number.isFinite(order.multiple)
    && order.multiple >= 1
    && order.multiple <= 50
    && (typeof order.paymentStatus === "undefined" || order.paymentStatus === "unpaid" || order.paymentStatus === "paid")
    && (typeof order.oddsLocked === "undefined" || typeof order.oddsLocked === "boolean")
    && (typeof order.hits === "undefined" || isExportedHits(order.hits))
    && (typeof order.resultValues === "undefined" || isExportedHits(order.resultValues))
    && (typeof order.failedMatches === "undefined" || (Array.isArray(order.failedMatches) && order.failedMatches.every((matchId) => typeof matchId === "string")))
    && (typeof order.settledAt === "undefined" || typeof order.settledAt === "string")
    && (typeof order.settledPrize === "undefined" || (typeof order.settledPrize === "number" && Number.isFinite(order.settledPrize)))
    && (typeof order.oddsLockedBeforeSettlement === "undefined" || typeof order.oddsLockedBeforeSettlement === "boolean");
};

const cachedMatchDates = (matches: MatchItem[], responseDates: SportteryMatchDate[] = []) => {
  const dates = new Map(responseDates.map((item) => [item.businessDate, item]));
  matches.forEach((match) => {
    if (!dates.has(match.date)) dates.set(match.date, { businessDate: match.date });
  });
  return [...dates.values()].sort((left, right) => left.businessDate.localeCompare(right.businessDate));
};

const cachedLeagueOptions = (matches: MatchItem[], responseLeagues: SportteryLeague[] = []) => {
  const leagues = new Map(responseLeagues.map((item) => [item.leagueNameAbbr, item]));
  matches.forEach((match) => {
    if (!match.league || leagues.has(match.league)) return;
    leagues.set(match.league, {
      leagueId: `cached-${match.league}`,
      leagueName: match.league,
      leagueNameAbbr: match.league,
    });
  });
  return [...leagues.values()];
};

const loadCachedMatches = () => {
  try {
    const raw = localCache.getItem(MATCH_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (!Array.isArray(parsed)) return [];
    const cleaned = mergeSportteryMatchCache([], parsed.filter(isExportedMatch), new Date());
    localCache.setItem(MATCH_CACHE_KEY, JSON.stringify(cleaned.map(matchWithClearedSelections)));
    return cleaned;
  } catch {
    return [];
  }
};

const saveCachedMatches = (matches: MatchItem[]) => {
  const cache = matches.map(matchWithClearedSelections);
  localCache.setItem(MATCH_CACHE_KEY, JSON.stringify(cache));
};

const passLabel = (passes: number[]) => passes.length
  ? [...passes].sort((left, right) => left - right).map((value) => value === 1 ? "单场" : `${value} 串 1`).join("、")
  : "未选择串关";

const cloneHits = (hits: CurrentHits | undefined): CurrentHits => Object.fromEntries(
  Object.entries(hits ?? {}).map(([matchId, values]) => [matchId, { ...values }]),
);

const filterHitsForSelections = (hits: CurrentHits | undefined, matches: MatchItem[]): CurrentHits => Object.fromEntries(
  Object.entries(hits ?? {}).flatMap(([matchId, values]) => {
    const match = matches.find((item) => normalizeSportteryMatchId(item.id) === normalizeSportteryMatchId(matchId));
    if (!match) return [];
    const selectedValues = Object.fromEntries(Object.entries(values).filter(([type, optionId]) => (
      match.markets.find((market) => market.type === type)?.options
        .some((option) => option.id === optionId && option.selected)
    )));
    return Object.keys(selectedValues).length > 0 ? [[match.id, selectedValues]] : [];
  }),
) as CurrentHits;

const marketEditorGroups = (market: Market) => {
  if (market.type === "score") {
    const drawIds = new Set(["0:0", "1:1", "2:2", "3:3", "drawOther"]);
    return [
      { key: "win", label: "主胜比分", options: market.options.filter((option) => option.id === "winOther" || (!drawIds.has(option.id) && option.id !== "loseOther" && Number(option.id.split(":")[0]) > Number(option.id.split(":")[1]))) },
      { key: "draw", label: "平局比分", options: market.options.filter((option) => drawIds.has(option.id)) },
      { key: "lose", label: "主负比分", options: market.options.filter((option) => option.id === "loseOther" || (!drawIds.has(option.id) && option.id !== "winOther" && Number(option.id.split(":")[0]) < Number(option.id.split(":")[1]))) },
    ];
  }
  if (market.type === "halfFull") {
    return [
      { key: "W", label: "半场主胜", options: market.options.filter((option) => option.id.startsWith("W")) },
      { key: "D", label: "半场平局", options: market.options.filter((option) => option.id.startsWith("D")) },
      { key: "L", label: "半场主负", options: market.options.filter((option) => option.id.startsWith("L")) },
    ];
  }
  if (market.type === "goals") {
    return [
      { key: "low", label: "0–3 球", options: market.options.slice(0, 4) },
      { key: "high", label: "4–7+ 球", options: market.options.slice(4) },
    ];
  }
  return [{ key: market.type, label: "赛果", options: market.options }];
};

function MarketRow({
  market,
  matchId,
  onToggle,
  disabled = false,
  disableOddsTooltip = false,
}: {
  market: Market;
  matchId: string;
  onToggle: (matchId: string, type: MarketType, optionId: string) => void;
  disabled?: boolean;
  disableOddsTooltip?: boolean;
}) {
  const handicapValue = typeof market.handicap === "number" && Number.isFinite(market.handicap)
    ? market.handicap
    : undefined;
  const hasHandicap = market.type === "rqspf" && handicapValue !== undefined && handicapValue !== 0;

  return (
    <div className="market-row">
      <div className="market-label">
        <div className={`handicap-badge ${!hasHandicap ? "neutral" : handicapValue > 0 ? "positive" : ""}`}>
          {hasHandicap ? `${handicapValue > 0 ? "+" : ""}${handicapValue}` : "-"}
        </div>
        <MarketSupportTags market={market} compact />
      </div>
      <div className="market-options compact-options">
        {market.options.map((item) => (
          <OddsHistoryTooltip option={item} disabled={disableOddsTooltip} key={item.id}>
            <button
              type="button"
              className={`odds-option ${!disabled && item.odds > 0 && item.selected ? "selected" : ""}`}
              disabled={disabled || item.odds <= 0}
              onClick={() => onToggle(matchId, market.type, item.id)}
              aria-pressed={!disabled && item.odds > 0 && item.selected}
            >
              <span>{item.label}</span>
              <strong>{item.odds > 0 ? <>{item.odds.toFixed(2)}<OddsTrendIndicator trend={item.oddsTrend} /></> : "--"}</strong>
            </button>
          </OddsHistoryTooltip>
        ))}
      </div>
    </div>
  );
}

function MarketSupportTags({ market, compact = false }: { market: Market; compact?: boolean }) {
  return (
    <div className={`market-support-tags${compact ? " compact" : ""}`} aria-label="投注方式支持">
      {compact ? (
        <>
          <Tag color={market.singleAvailable ? "geekblue" : "info"}>{market.singleAvailable ? "单" : "-"}</Tag>
          <Tag color={market.passAvailable ? "orange" : "info"}>{market.passAvailable ? "串" : "-"}</Tag>
        </>
      ) : (
        <>
          {market.singleAvailable && <Tag color="geekblue">单场</Tag>}
          {market.passAvailable && <Tag color="orange">过关</Tag>}
        </>
      )}
    </div>
  );
}

function EditableLeagueTag({
  league,
  color,
  onSave,
}: {
  league: string;
  color: string;
  onSave: (league: string, color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftColor, setDraftColor] = useState(color);

  const editor = (
    <div className="league-color-popover">
      <div><b>{league}</b><span>联赛标签颜色</span></div>
      <ColorPicker
        value={draftColor}
        showText
        disabledAlpha
        onChange={(value) => setDraftColor(value.toHexString())}
      />
      <div className="league-color-popover-actions">
        <Button size="small" onClick={() => setOpen(false)}>取消</Button>
        <Button size="small" type="primary" onClick={() => { onSave(league, draftColor); setOpen(false); }}>确定</Button>
      </div>
    </div>
  );

  return (
    <Popover content={editor} trigger="click" open={open} onOpenChange={(nextOpen) => { if (nextOpen) setDraftColor(color); setOpen(nextOpen); }} placement="bottomLeft">
      <Tag
        color={color}
        variant="solid"
        className="league-tag editable"
        style={{ color: readableTagTextColor(color) }}
        role="button"
        tabIndex={0}
        title={`设置 ${league} 标签颜色`}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {league}
      </Tag>
    </Popover>
  );
}

function scoreResultTone(score: { home: number; away: number }) {
  if (score.home > score.away) return "result-home";
  if (score.home < score.away) return "result-away";
  return "result-draw";
}

function MatchTeamsLabel({ match, teamNameIndex }: { match: MatchItem; teamNameIndex: ReturnType<typeof buildTeamNameIndex> }) {
  return <><TeamNameWithAlias name={match.home} index={teamNameIndex} /> VS <TeamNameWithAlias name={match.away} index={teamNameIndex} /></>;
}

function MatchCard({
  match,
  now,
  teamNameIndex,
  onToggle,
  onPreview,
  onMore,
  onTrend,
  leagueColor,
  onLeagueColorSave,
  disableOddsTooltip,
  resultLoading,
}: {
  match: MatchItem;
  now: Date;
  teamNameIndex: ReturnType<typeof buildTeamNameIndex>;
  onToggle: (matchId: string, type: MarketType, optionId: string) => void;
  onPreview: (matchId: string) => void;
  onMore: (matchId: string) => void;
  onTrend: (matchId: string) => void;
  leagueColor: string;
  onLeagueColorSave: (league: string, color: string) => void;
  disableOddsTooltip: boolean;
  resultLoading: boolean;
}) {
  const picked = selectedOptions(match).length;
  const saleState = getMatchSaleState(match, now);
  const selectable = saleState !== "stopped";
  const spf = match.markets.find((market) => market.type === "spf")!;
  const rqspf = match.markets.find((market) => market.type === "rqspf")!;
  const fullScore = match.result?.fullScore;
  const halfScore = match.result?.halfScore;
  const fullScoreTone = fullScore ? scoreResultTone(fullScore) : "";
  const halfScoreTone = halfScore ? scoreResultTone(halfScore) : "";
  return (
    <article className={`match-card ${picked ? "has-selection" : ""} ${saleState}`}>
      <div className="match-meta">
        <div>
          <span className="match-code">{match.weekday}{match.code}</span>
          <EditableLeagueTag league={match.league} color={leagueColor} onSave={onLeagueColorSave} />
          {saleState === "pending" && <Tag color="warning">待开售</Tag>}
          {saleState === "stopped" && <Tag color="default">已停售</Tag>}
        </div>
        <div className="match-time">{formatMatchCardTime(match)}</div>
      </div>
      <div className="teams-row">
        <b className="match-team-name match-home-team"><TeamNameWithAlias name={match.home} index={teamNameIndex} /></b>
        {fullScore ? (
          <>
            <span className={`match-final-score match-home-score ${fullScoreTone}`}>{fullScore.home}</span>
            <span className={`match-final-score match-score-separator ${fullScoreTone}`}>:</span>
            <span className={`match-final-score match-away-score ${fullScoreTone}`}>{fullScore.away}</span>
          </>
        ) : resultLoading ? (
          <span className="match-result-loading" title="正在获取赛果" aria-label="正在获取赛果"><LoadingOutlined spin /></span>
        ) : <span className="match-versus">VS</span>}
        <b className="match-team-name match-away-team"><TeamNameWithAlias name={match.away} index={teamNameIndex} /></b>
        {halfScore && (
          <>
            <small className={`match-half-score match-half-home ${halfScoreTone}`}>{halfScore.home}</small>
            <small className={`match-half-score match-half-separator ${halfScoreTone}`}>:</small>
            <small className={`match-half-score match-half-away ${halfScoreTone}`}>{halfScore.away}</small>
          </>
        )}
      </div>
      <MarketRow market={spf} matchId={match.id} onToggle={onToggle} disabled={!selectable} disableOddsTooltip={disableOddsTooltip} />
      <MarketRow market={rqspf} matchId={match.id} onToggle={onToggle} disabled={!selectable} disableOddsTooltip={disableOddsTooltip} />
      <div className="match-card-actions">
        <Button onClick={() => onPreview(match.id)}>赛事前瞻</Button>
        <Button className="more-play-button" type={picked ? "primary" : "default"} ghost={Boolean(picked)} onClick={() => onMore(match.id)}>
          更多玩法{picked ? ` · 已选 ${picked} 项` : ""}
        </Button>
        <Button onClick={() => onTrend(match.id)}>官方趋势</Button>
      </div>
    </article>
  );
}

const TEAM_NAME_ACTIVE_OPTIONS = [
  { value: null, label: "不激活" },
  { value: 1, label: "激活名称 1" },
  { value: 2, label: "激活名称 2" },
] as const;

function TeamNameGroupEditor({
  draft,
  onChange,
  onAddName,
  onRemoveName,
  onCancel,
  onSave,
  saving,
}: {
  draft: TeamNameGroupDraft;
  onChange: (draft: TeamNameGroupDraft) => void;
  onAddName: () => void;
  onRemoveName: (index: number) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const activeCount = draft.names.filter((entry) => entry.activeSlot !== null).length;
  const updateName = (index: number, name: string) => {
    onChange({
      ...draft,
      names: draft.names.map((entry, entryIndex) => entryIndex === index ? { ...entry, name } : entry),
    });
  };
  const updateActiveSlot = (index: number, activeSlot: TeamNameActiveSlot) => {
    onChange({
      ...draft,
      names: draft.names.map((entry, entryIndex) => entryIndex === index
        ? { ...entry, activeSlot }
        : activeSlot !== null && entry.activeSlot === activeSlot
          ? { ...entry, activeSlot: null }
          : entry),
    });
  };

  return (
    <div className="team-name-group-editor">
      <div className="team-name-group-editor-title">
        <div><b>{draft.id ? "编辑队伍名称组" : "新增队伍名称组"}</b><span>所有名称都会参与识别，激活名称用于投注页展示。</span></div>
        <Tag color={activeCount === 2 ? "success" : "warning"}>已激活 {activeCount} / 2</Tag>
      </div>
      <div className="team-name-editor-rows">
        {draft.names.map((entry, index) => (
          <div className="team-name-editor-row" key={entry.id ?? `new-${index}`}>
            <Input
              value={entry.name}
              maxLength={80}
              placeholder="输入队伍名称"
              aria-label={`队伍名称 ${index + 1}`}
              onChange={(event) => updateName(index, event.target.value)}
            />
            <Select
              value={entry.activeSlot}
              options={TEAM_NAME_ACTIVE_OPTIONS.map((option) => ({ ...option }))}
              aria-label={`队伍名称 ${index + 1} 的激活状态`}
              onChange={(value) => updateActiveSlot(index, value as TeamNameActiveSlot)}
            />
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              disabled={draft.names.length <= 2}
              aria-label={`删除队伍名称 ${index + 1}`}
              onClick={() => onRemoveName(index)}
            />
          </div>
        ))}
      </div>
      <div className="team-name-group-editor-actions">
        <Button type="dashed" icon={<PlusOutlined />} onClick={onAddName}>增加名称</Button>
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={onSave}>保存</Button>
        </Space>
      </div>
      <p className="team-name-editor-help">必须恰好激活两个名称；未激活名称仍可用于识别接口返回的历史翻译。</p>
    </div>
  );
}

function TeamNameGroupSummary({
  group,
  canManage,
  deleting,
  onEdit,
  onDelete,
}: {
  group: TeamNameGroup;
  canManage: boolean;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <section className="team-name-group-summary">
      <div className="team-name-group-summary-head">
        <div><b>队伍名称组</b><span>{group.names.length} 个名称 · 已激活 {group.names.filter((entry) => entry.activeSlot !== null).length} 个</span></div>
        {canManage && (
          <Space size="small">
            <Button size="small" icon={<EditOutlined />} onClick={onEdit}>编辑</Button>
            <Popconfirm title="删除这组队伍名称？" description="删除后投注页将不再显示这组名称的辅助名称。" okText="删除" cancelText="取消" okButtonProps={{ danger: true, loading: deleting }} onConfirm={onDelete}>
              <Button size="small" danger icon={<DeleteOutlined />} loading={deleting}>删除</Button>
            </Popconfirm>
          </Space>
        )}
      </div>
      <div className="team-name-group-names">
        {group.names.map((entry) => (
          <Tag color={entry.activeSlot ? "cyan" : "default"} key={entry.id}>
            {entry.name}{entry.activeSlot ? ` · 激活 ${entry.activeSlot}` : " · 未激活"}
          </Tag>
        ))}
      </div>
    </section>
  );
}

function InnerFootballApp({
  initialView,
  onNavigate,
  cloudAccount,
  cloudPersonal,
  teamNameGroups,
  cloudSyncStatus,
  onCloudSettingsChange,
  onTeamNameGroupSave,
  onTeamNameGroupDelete,
  onCloudFinanceCorrectionChange,
  onCloudOrderMutation,
  onCloudOrdersQueryChange,
  onCloudMatchesChange,
  onCloudMatchesUpdate,
  onCloudMatchesRefresh,
  onRequireAccount,
  onLogout,
}: {
  initialView: AppView;
  onNavigate?: (view: AppView) => void;
  cloudAccount: CloudAccount | null;
  cloudPersonal: CloudPersonalData | null;
  teamNameGroups: TeamNameGroup[];
  cloudSyncStatus: CloudSyncStatus;
  onCloudSettingsChange: (settings: AppSettings) => void;
  onTeamNameGroupSave: (group: TeamNameGroupDraft) => Promise<TeamNameGroup>;
  onTeamNameGroupDelete: (group: Pick<TeamNameGroup, "id" | "revision">) => Promise<void>;
  onCloudFinanceCorrectionChange: (correction: { expenseCorrection: number; incomeCorrection: number }) => Promise<CloudPersonalData["finance"]>;
  onCloudOrderMutation: (intent: OrderSyncIntent) => Promise<CloudOrderMutationResult>;
  onCloudOrdersQueryChange: (query: CloudOrderQuery) => Promise<CloudOrderQueryResult>;
  onCloudMatchesChange: (matches: MatchItem[]) => void;
  onCloudMatchesUpdate: (matches: MatchItem[]) => Promise<MatchItem[]>;
  onCloudMatchesRefresh: (manual: boolean) => Promise<SportteryMatchSnapshot>;
  onRequireAccount: (view?: AppView) => void;
  onLogout: () => Promise<void>;
}) {
  const { message, modal, notification } = App.useApp();
  const isGuestMode = cloudAccount?.id === "local";
  const isCloudMode = Boolean(cloudAccount && !isGuestMode);
  const canManageTeamNames = cloudAccount?.role === "admin" && !isGuestMode;
  const teamNameIndex = useMemo(() => buildTeamNameIndex(teamNameGroups), [teamNameGroups]);
  const headerRef = useRef<HTMLElement | null>(null);
  const orderListLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [accountLoginBetDraft] = useState<AccountLoginBetDraft | null>(() => {
    if (initialView !== "betting") return null;
    try {
      const raw = sessionCache.getItem(CLOUD_STORAGE_KEYS.loginBetDraft);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<AccountLoginBetDraft>;
      return Array.isArray(parsed.matches)
        && Array.isArray(parsed.passes)
        && typeof parsed.multiple === "number"
        && parsed.hits
        && typeof parsed.hits === "object"
        ? parsed as AccountLoginBetDraft
        : null;
    } catch {
      return null;
    }
  });
  const [loadedOrderDraft] = useState<LoadedOrderDraft | null>(() => {
    if (initialView !== "betting") return null;
    try {
      const raw = sessionCache.getItem(LOADED_ORDER_KEY);
      return raw ? JSON.parse(raw) as LoadedOrderDraft : null;
    } catch {
      return null;
    }
  });
  const [matches, setMatches] = useState<MatchItem[]>(() => accountLoginBetDraft
    ? cloneMatches(accountLoginBetDraft.matches)
    : loadedOrderDraft
      ? cloneMatches(loadedOrderDraft.matches)
      : loadCachedMatches());
  const matchesRef = useRef(matches);
  const [passes, setPasses] = useState<number[]>(() => accountLoginBetDraft
    ? [...accountLoginBetDraft.passes]
    : loadedOrderDraft
      ? [...loadedOrderDraft.passes]
      : []);
  const [multiple, setMultiple] = useState(() => accountLoginBetDraft?.multiple ?? loadedOrderDraft?.multiple ?? 1);
  const [temporaryOrder, setTemporaryOrder] = useState<{ id: string; name: string } | null>(() => (
    loadedOrderDraft && loadedOrderDraft.mode !== "copy" ? { id: loadedOrderDraft.id, name: loadedOrderDraft.name } : null
  ));
  const [hits, setHits] = useState<CurrentHits>(() => accountLoginBetDraft
    ? cloneHits(accountLoginBetDraft.hits)
    : loadedOrderDraft?.mode === "copy"
      ? {}
      : cloneHits(loadedOrderDraft?.hits));
  const [previewMatchId, setPreviewMatchId] = useState<string | null>(null);
  const [moreMatchId, setMoreMatchId] = useState<string | null>(null);
  const [trendMatchId, setTrendMatchId] = useState<string | null>(null);
  const [financeTrendOpen, setFinanceTrendOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const activeView = initialView;
  const [orderDetail, setOrderDetail] = useState<SavedSlip | null>(null);
  const [orderHits, setOrderHits] = useState<CurrentHits>({});
  const [orderFailedMatches, setOrderFailedMatches] = useState<string[]>([]);
  const [editingOrder, setEditingOrder] = useState<SavedSlip | null>(null);
  const [orderEditName, setOrderEditName] = useState("");
  const [orderEditTime, setOrderEditTime] = useState("");
  const [orderEditMatches, setOrderEditMatches] = useState<MatchItem[]>([]);
  const [orderEditPasses, setOrderEditPasses] = useState<number[]>([]);
  const [orderEditMultiple, setOrderEditMultiple] = useState(1);
  const [orderEditOddsLocked, setOrderEditOddsLocked] = useState(false);
  const [expandedOrderIds, setExpandedOrderIds] = useState<string[]>([]);
  const [orderOddsRefreshing, setOrderOddsRefreshing] = useState(false);
  const [initialSavedSlipLoad] = useState(() => {
    if (!cloudAccount) return { orders: [] as SavedSlip[], repairedOrders: [] as SavedSlip[] };
    if (!isGuestMode && cloudPersonal) {
      return {
        orders: ensureOrderIds(cloudPersonal.orders.map(repairSlipHandicapResults)),
        repairedOrders: [] as SavedSlip[],
      };
    }
    try {
      const raw = localCache.getItem(SAVED_KEY);
      if (!raw) return { orders: [] as SavedSlip[], repairedOrders: [] as SavedSlip[] };
      const parsed = JSON.parse(raw) as SavedSlip[];
      const repaired = ensureOrderIds(parsed.map(repairSlipHandicapResults));
      const repairedOrders = repaired.filter((slip, index) => slip !== parsed[index]);
      if (repairedOrders.length > 0) {
        localCache.setItem(SAVED_KEY, JSON.stringify(repaired));
      }
      return { orders: repaired, repairedOrders };
    } catch {
      return { orders: [] as SavedSlip[], repairedOrders: [] as SavedSlip[] };
    }
  });
  const [savedSlips, setSavedSlips] = useState<SavedSlip[]>(initialSavedSlipLoad.orders);
  const [cloudOrderTotal, setCloudOrderTotal] = useState(() => (
    isCloudMode && cloudPersonal ? cloudPersonal.orderTotal ?? initialSavedSlipLoad.orders.length : initialSavedSlipLoad.orders.length
  ));
  const [cloudUnsettledOrderCount, setCloudUnsettledOrderCount] = useState(() => (
    isCloudMode && cloudPersonal ? cloudPersonal.unsettledOrderCount ?? initialSavedSlipLoad.orders.filter((slip) => !slip.settledAt).length : initialSavedSlipLoad.orders.filter((slip) => !slip.settledAt).length
  ));
  const [cloudOrdersLoading, setCloudOrdersLoading] = useState(false);
  const [saveSlipLoading, setSaveSlipLoading] = useState(false);
  const [manualOrderSaving, setManualOrderSaving] = useState(false);
  const [orderEditSaving, setOrderEditSaving] = useState(false);
  const [orderHitsSaving, setOrderHitsSaving] = useState(false);
  const [judgingOrders, setJudgingOrders] = useState(false);
  const [lockingOrderOdds, setLockingOrderOdds] = useState(false);
  const [loadingOrderId, setLoadingOrderId] = useState<string | null>(null);
  const [settlingOrderIds, setSettlingOrderIds] = useState<string[]>([]);
  const [payingOrderIds, setPayingOrderIds] = useState<string[]>([]);
  const [withdrawingOrderIds, setWithdrawingOrderIds] = useState<string[]>([]);
  const [deletingOrderIds, setDeletingOrderIds] = useState<string[]>([]);
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [incomeSaving, setIncomeSaving] = useState(false);
  const repairedOrdersSentRef = useRef(false);
  const [matchResults, setMatchResults] = useState<MatchResults>({});
  const [bettingResultFetchingMatchIds, setBettingResultFetchingMatchIds] = useState<string[]>([]);
  const autoResultRetryAtRef = useRef(new Map<string, AutoResultRetryState>());
  const autoResultFetchingRef = useRef(false);
  const [resultFetchingMatchIds, setResultFetchingMatchIds] = useState<string[]>([]);
  const [allResultsFetching, setAllResultsFetching] = useState(false);
  const [matchResultsCollapsed, setMatchResultsCollapsed] = useState(true);
  const [orderDateRange, setOrderDateRange] = useState<[string, string] | null>(() => {
    const today = dayjs().format("YYYY-MM-DD");
    return [today, today];
  });
  const [bulkPayPopoverOpen, setBulkPayPopoverOpen] = useState(false);
  const [bulkSettlePopoverOpen, setBulkSettlePopoverOpen] = useState(false);
  const [orderProgressFilter, setOrderProgressFilter] = useState<OrderProgressFilter>("unsettled");
  const [orderStatusFilters, setOrderStatusFilters] = useState<OrderStatusFilter[]>([]);
  const [orderShortPassFilters, setOrderShortPassFilters] = useState<number[]>([]);
  const [orderShortPassDropdownOpen, setOrderShortPassDropdownOpen] = useState(false);
  const orderShortPassInputClickRef = useRef(false);
  const [orderTeamQuery, setOrderTeamQuery] = useState("");
  const [selectedOrderLeagueNames, setSelectedOrderLeagueNames] = useState<string[]>([]);
  const [renderedOrderCount, setRenderedOrderCount] = useState(ORDER_LIST_BATCH_SIZE);
  const [expenseTotal, setExpenseTotal] = useState(() => {
    if (!cloudAccount) return 0;
    if (isCloudMode && cloudPersonal) return Math.max(0, cloudPersonal.finance.expenseTotal);
    const stored = Number(localCache.getItem(EXPENSE_KEY));
    if (localCache.getItem(EXPENSE_KEY) !== null && Number.isFinite(stored)) return Math.max(0, stored);
    return savedSlips.reduce((total, slip) => total + (isOrderPaid(slip) ? calculateStake(slip.matches, slip.passes, slip.multiple) : 0), 0);
  });
  const [incomeTotal, setIncomeTotal] = useState(() => {
    if (!cloudAccount) return 0;
    if (isCloudMode && cloudPersonal) return Math.max(0, cloudPersonal.finance.incomeTotal);
    const stored = Number(localCache.getItem(INCOME_KEY));
    if (localCache.getItem(INCOME_KEY) !== null && Number.isFinite(stored)) return Math.max(0, stored);
    const oldProfit = Number(localCache.getItem(PROFIT_KEY));
    const derivedExpense = savedSlips.reduce((total, slip) => total + calculateStake(slip.matches, slip.passes, slip.multiple), 0);
    if (localCache.getItem(PROFIT_KEY) !== null && Number.isFinite(oldProfit)) return Math.max(0, oldProfit + derivedExpense);
    return savedSlips.reduce((total, slip) => total + (slip.settledPrize ?? 0), 0);
  });
  const [expenseCorrection, setExpenseCorrection] = useState(() => (
    isCloudMode && cloudPersonal ? cloudPersonal.finance.expenseCorrection ?? 0 : 0
  ));
  const [incomeCorrection, setIncomeCorrection] = useState(() => (
    isCloudMode && cloudPersonal ? cloudPersonal.finance.incomeCorrection ?? 0 : 0
  ));
  const [expenseOrdersTotal, setExpenseOrdersTotal] = useState(() => (
    isCloudMode && cloudPersonal ? cloudPersonal.finance.expenseOrders ?? Math.max(0, cloudPersonal.finance.expenseTotal - (cloudPersonal.finance.expenseCorrection ?? 0)) : 0
  ));
  const [incomeOrdersTotal, setIncomeOrdersTotal] = useState(() => (
    isCloudMode && cloudPersonal ? cloudPersonal.finance.incomeOrders ?? Math.max(0, cloudPersonal.finance.incomeTotal - (cloudPersonal.finance.incomeCorrection ?? 0)) : 0
  ));
  const [expenseEditing, setExpenseEditing] = useState(false);
  const [incomeEditing, setIncomeEditing] = useState(false);
  const [expenseDraft, setExpenseDraft] = useState(0);
  const [incomeDraft, setIncomeDraft] = useState(0);
  const [saveOpen, setSaveOpen] = useState(() => Boolean(accountLoginBetDraft && cloudAccount));
  const [saveName, setSaveName] = useState("");
  const saveNameInputRef = useRef<InputRef>(null);
  const [manualOrderOpen, setManualOrderOpen] = useState(false);
  const [manualOrderName, setManualOrderName] = useState("");
  const [manualOrderPassText, setManualOrderPassText] = useState("");
  const [manualOrderPassDropdownOpen, setManualOrderPassDropdownOpen] = useState(false);
  const manualOrderPassInputClickRef = useRef(false);
  const [manualOrderMultiple, setManualOrderMultiple] = useState(1);
  const [manualOrderSavedAt, setManualOrderSavedAt] = useState("");
  const [manualOrderEntries, setManualOrderEntries] = useState<ManualOrderEntry[]>(() => [createManualOrderEntry()]);
  const [manualTemporaryMatches, setManualTemporaryMatches] = useState<Record<string, MatchItem>>({});
  const [manualMatchLookupIds, setManualMatchLookupIds] = useState<Record<string, string>>({});
  const manualOrderEntryListRef = useRef<HTMLDivElement>(null);
  const manualOrderMatchPickerRowRefs = useRef(new Map<string, HTMLDivElement>());
  const manualMatchLookupTimersRef = useRef(new Map<string, number>());
  const manualMatchLookupQueriesRef = useRef(new Map<string, string>());
  const manualMatchLookupGenerationRef = useRef(0);
  const pendingManualOrderScrollEntryKeyRef = useRef<string | null>(null);
  const [manualPickerEntryKey, setManualPickerEntryKey] = useState<string | null>(null);
  const [manualPickerMatch, setManualPickerMatch] = useState<MatchItem | null>(null);
  const [sportteryLoaded, setSportteryLoaded] = useState(false);
  const [sportteryLoading, setSportteryLoading] = useState(false);
  const [sportteryRefreshing, setSportteryRefreshing] = useState(false);
  const [sportteryLastUpdateTime, setSportteryLastUpdateTime] = useState("");
  const [sportteryFetchMode, setSportteryFetchMode] = useState<SportteryMatchFetchMode>(() => getSportteryRefreshPolicy().mode);
  const [saleClock, setSaleClock] = useState(() => Date.now());
  const [, setMatchDates] = useState<SportteryMatchDate[]>(() => cachedMatchDates(matches));
  const [leagueOptions, setLeagueOptions] = useState<SportteryLeague[]>(() => cachedLeagueOptions(matches));
  const [selectedMatchDate, setSelectedMatchDate] = useState<string | null>(null);
  const [matchSaleFilter, setMatchSaleFilter] = useState<MatchSaleFilter>("non-stopped");
  const [selectedLeagueNames, setSelectedLeagueNames] = useState<string[]>([]);
  const [collapsedMatchDates, setCollapsedMatchDates] = useState<string[]>([]);
  const initializedMatchDateCollapseRef = useRef(new Set<string>());
  const autoCollapsedMatchDatesRef = useRef(new Set<string>());
  const [appSettings, setAppSettings] = useState<AppSettings>(() => (
    !cloudAccount ? createDefaultSettings() :
    isCloudMode && cloudPersonal ? normalizeAppSettings(cloudPersonal.settings) : loadAppSettings()
  ));
  const [teamNameEditor, setTeamNameEditor] = useState<TeamNameGroupDraft | null>(null);
  const [teamNameSaving, setTeamNameSaving] = useState(false);
  const [teamNameDeletingId, setTeamNameDeletingId] = useState<string | null>(null);
  const [importStrategy, setImportStrategy] = useState<ImportStrategy>("merge");
  const saleNow = useMemo(() => new Date(saleClock), [saleClock]);
  const manualSelectedMatchIds = useMemo(() => new Set(manualOrderEntries.flatMap((entry) => (
    entry.matchId ? [normalizeSportteryMatchId(entry.matchId)] : []
  ))), [manualOrderEntries]);
  const manualMatchSources = useMemo(() => {
    const temporary = Object.values(manualTemporaryMatches);
    const temporaryIds = new Set(temporary.map((match) => normalizeSportteryMatchId(match.id)));
    return [...temporary, ...matches.filter((match) => !temporaryIds.has(normalizeSportteryMatchId(match.id)))];
  }, [manualTemporaryMatches, matches]);
  const manualMatchOptions = useMemo(() => sortMatchesForManualOrder(manualMatchSources).map((match) => {
    const value = normalizeSportteryMatchId(match.id);
    const saleState = getMatchSaleState(match, saleNow);
    const statusText = saleState === "selling" ? "在售" : saleState === "pending" ? "待开售" : "已停售";
    const displayText = `${match.date} · ${match.weekday}${match.code} · ${match.home} VS ${match.away}`;
    return {
      value,
      searchText: `${value} ${displayText} ${statusText}`,
      label: <ManualMatchOptionLabel match={match} now={saleNow} />,
    };
  }), [manualMatchSources, saleNow]);

  const applyCloudFinance = useCallback((finance: CloudPersonalData["finance"]) => {
    setExpenseTotal(Math.max(0, finance.expenseTotal));
    setIncomeTotal(Math.max(0, finance.incomeTotal));
    setExpenseCorrection(finance.expenseCorrection ?? 0);
    setIncomeCorrection(finance.incomeCorrection ?? 0);
    setExpenseOrdersTotal(finance.expenseOrders ?? Math.max(0, finance.expenseTotal - (finance.expenseCorrection ?? 0)));
    setIncomeOrdersTotal(finance.incomeOrders ?? Math.max(0, finance.incomeTotal - (finance.incomeCorrection ?? 0)));
  }, []);

  const currentCloudOrderQuery = useCallback((): CloudOrderQuery => ({
    from: orderDateRange?.[0] ?? null,
    to: orderDateRange?.[1] ?? null,
    progress: orderProgressFilter,
    statuses: orderStatusFilters,
    limit: 500,
    offset: 0,
  }), [orderDateRange, orderProgressFilter, orderStatusFilters]);

  const commitOrderMutation = useCallback(async (intent: OrderSyncIntent) => {
    const normalizedIntent: OrderSyncIntent = {
      upsertOrders: ensureOrderIds(intent.upsertOrders),
      deleteOrderIds: [...new Set(intent.deleteOrderIds)],
      operation: intent.operation,
    };
    if (isGuestMode) {
      const nextOrders = applyOrderSyncIntent(savedSlips, normalizedIntent);
      setSavedSlips(nextOrders);
      localCache.setItem(SAVED_KEY, JSON.stringify(nextOrders));
      return nextOrders;
    }

    try {
      const result = await onCloudOrderMutation(normalizedIntent);
      let nextOrders = result.orders;
      if (activeView === "orders") {
        try {
          const queried = await onCloudOrdersQueryChange(currentCloudOrderQuery());
          nextOrders = ensureOrderIds(queried.orders);
          setCloudOrderTotal(queried.total);
          setCloudUnsettledOrderCount(queried.unsettledCount);
        } catch (queryError) {
          console.error("[云端订单] 写入后重新加载筛选订单失败", queryError);
          setCloudOrderTotal(result.orders.length);
          setCloudUnsettledOrderCount(result.orders.filter((slip) => !slip.settledAt).length);
        }
      } else {
        setCloudOrderTotal(result.orders.length);
        setCloudUnsettledOrderCount(result.orders.filter((slip) => !slip.settledAt).length);
      }
      setSavedSlips(nextOrders);
      if (result.finance) applyCloudFinance(result.finance);
      return nextOrders;
    } catch (error) {
      message.error(error instanceof Error ? error.message : "订单同步失败，请刷新后重试");
      return null;
    }
  }, [activeView, applyCloudFinance, currentCloudOrderQuery, isGuestMode, message, onCloudOrderMutation, onCloudOrdersQueryChange, savedSlips]);

  const persistAppSettings = useCallback((settings: AppSettings) => {
    const normalized = normalizeAppSettings(settings);
    if (isGuestMode) saveAppSettings(normalized);
    else if (isCloudMode) onCloudSettingsChange(normalized);
    return normalized;
  }, [isCloudMode, isGuestMode, onCloudSettingsChange]);

  const applySportterySnapshot = useCallback((snapshot: SportteryMatchSnapshot, saveToCloud = true) => {
    const updateVisibleMatches = activeView === "betting" && !temporaryOrder;
    const currentCache = updateVisibleMatches ? matchesRef.current : loadCachedMatches();
    const mergedMatches = mergeSportteryMatchCache(currentCache, snapshot.matches, new Date());
    saveCachedMatches(mergedMatches);
    if (saveToCloud) onCloudMatchesChange(mergedMatches);
    if (updateVisibleMatches) {
      const nextDates = cachedMatchDates(mergedMatches, snapshot.matchDates);
      const nextLeagues = cachedLeagueOptions(mergedMatches, snapshot.leagues);
      matchesRef.current = mergedMatches;
      setMatches(mergedMatches);
      setMatchDates(nextDates);
      setLeagueOptions(nextLeagues);
      setSelectedMatchDate((current) => current && nextDates.some((item) => item.businessDate === current) ? current : null);
      setSelectedLeagueNames((current) => current.filter((name) => nextLeagues.some((item) => item.leagueNameAbbr === name)));
    }
    setSportteryFetchMode(snapshot.mode);
    setSportteryLastUpdateTime(snapshot.lastUpdateTime);
    setSportteryLoaded(true);
  }, [activeView, onCloudMatchesChange, temporaryOrder]);

  const loadSportterySnapshot = useCallback(async (manual: boolean) => {
    try {
      const snapshot = await onCloudMatchesRefresh(manual);
      if (snapshot.fromCache && snapshot.refreshError) throw new Error(snapshot.refreshError);
      return { snapshot, source: "cloud" as const };
    } catch (cloudError) {
      const mode = getSportteryRefreshPolicy(new Date()).mode;
      const snapshot = await fetchSportteryMatchSnapshot(mode);
      console.warn("[体彩接口] 云端比赛刷新失败，已回退到前端官方接口", cloudError);
      return { snapshot, source: "official-fallback" as const };
    }
  }, [onCloudMatchesRefresh]);

  useEffect(() => {
    localCache.removeItem(LEGACY_DRAFT_KEY);
    localCache.removeItem(LEGACY_MATCH_RESULTS_KEY);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 560px)");
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (!loadedOrderDraft) return;
    sessionCache.removeItem(LOADED_ORDER_KEY);
    const filteredText = loadedOrderDraft.filteredOptionCount
      ? `，已过滤 ${loadedOrderDraft.filteredOptionCount} 个不可用投注项`
      : "";
    message.success(loadedOrderDraft.mode === "copy"
      ? `已复制“${loadedOrderDraft.name}”的投注，保存时将创建新订单${filteredText}`
      : `已载入“${loadedOrderDraft.name}”，保存时将更新当前订单${filteredText}`);
  }, [loadedOrderDraft, message]);

  useEffect(() => {
    if (!accountLoginBetDraft || !cloudAccount) return;
    sessionCache.removeItem(CLOUD_STORAGE_KEYS.loginBetDraft);
    message.success("账号已登录，刚才选择的比赛和串关已保留");
  }, [accountLoginBetDraft, cloudAccount, message]);

  useEffect(() => {
    if (!isGuestMode) return;
    localCache.setItem(EXPENSE_KEY, String(expenseTotal));
  }, [expenseTotal, isGuestMode]);

  useEffect(() => {
    if (!isGuestMode) return;
    localCache.setItem(INCOME_KEY, String(incomeTotal));
  }, [incomeTotal, isGuestMode]);

  useEffect(() => {
    if (!isGuestMode || repairedOrdersSentRef.current || initialSavedSlipLoad.repairedOrders.length === 0) return;
    repairedOrdersSentRef.current = true;
    void commitOrderMutation({ upsertOrders: initialSavedSlipLoad.repairedOrders, deleteOrderIds: [] });
  }, [commitOrderMutation, initialSavedSlipLoad.repairedOrders, isGuestMode]);

  useEffect(() => {
    matchesRef.current = matches;
  }, [matches]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date();
      setSaleClock(now.getTime());
      if (temporaryOrder) return;
      setMatches((current) => {
        let changed = false;
        const next = current.map((match) => {
          if (!hasMatchStarted(match, now) || match.saleStatus === "stopped") return match;
          changed = true;
          return {
            ...match,
            saleStatus: "stopped" as const,
            markets: match.markets.map((market) => ({
              ...market,
              options: market.options.map((option) => option.selected ? { ...option, selected: false } : option),
            })),
          };
        });
        return changed ? next : current;
      });
    }, 30 * 1000);
    return () => window.clearInterval(timer);
  }, [temporaryOrder]);

  useEffect(() => {
    if (temporaryOrder) return;
    const dateAvailability = new Map<string, boolean>();
    matches.forEach((match) => dateAvailability.set(match.date, (dateAvailability.get(match.date) ?? false) || getMatchSaleState(match, saleNow) !== "stopped"));
    const newlyUnavailableDates: string[] = [];
    const newlySellableDates: string[] = [];
    dateAvailability.forEach((hasSellableMatch, date) => {
      if (!initializedMatchDateCollapseRef.current.has(date) && !hasSellableMatch) {
        newlyUnavailableDates.push(date);
        autoCollapsedMatchDatesRef.current.add(date);
      } else if (hasSellableMatch && autoCollapsedMatchDatesRef.current.has(date)) {
        newlySellableDates.push(date);
        autoCollapsedMatchDatesRef.current.delete(date);
      }
      initializedMatchDateCollapseRef.current.add(date);
    });
    if (newlyUnavailableDates.length > 0 || newlySellableDates.length > 0) {
      setCollapsedMatchDates((current) => [...new Set([...current.filter((date) => !newlySellableDates.includes(date)), ...newlyUnavailableDates])]);
    }
  }, [matches, saleNow, temporaryOrder]);

  useEffect(() => {
    if (activeView !== "betting") return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      setSportteryLoading(true);
      void loadSportterySnapshot(false)
        .then(({ snapshot, source }) => {
          if (!active) return;
          applySportterySnapshot(snapshot, source === "official-fallback");
          console.log("[体彩接口] 进入投注页获取比赛", { source, mode: snapshot.mode, totalCount: snapshot.matches.length, fixedBonusFailureCount: snapshot.fixedBonusFailureCount });
        })
        .catch((error: unknown) => {
          if (!active) return;
          setSportteryLoaded(true);
          console.error("[体彩接口] 进入投注页获取比赛失败", error);
        })
        .finally(() => {
          if (active) setSportteryLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activeView, applySportterySnapshot, loadSportterySnapshot, temporaryOrder]);

  useEffect(() => {
    if (activeView !== "betting") return;
    let disposed = false;
    let timer = 0;
    const schedule = () => {
      if (disposed) return;
      timer = window.setTimeout(async () => {
        if (disposed) return;
        const policy = getSportteryRefreshPolicy(new Date());
        if (policy.autoIntervalMs !== null) {
          try {
            const { snapshot, source } = await loadSportterySnapshot(false);
            if (!disposed) applySportterySnapshot(snapshot, source === "official-fallback");
          } catch (error) {
            console.error("[体彩接口] 自动刷新比赛失败", error);
          }
        }
        schedule();
      }, getNextSportteryAutoRefreshDelay(new Date()));
    };
    schedule();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [activeView, applySportterySnapshot, loadSportterySnapshot, temporaryOrder]);

  const refreshSportteryData = async () => {
    if (sportteryLoading || sportteryRefreshing) return;
    setSportteryRefreshing(true);
    try {
      const { snapshot, source } = await loadSportterySnapshot(true);
      applySportterySnapshot(snapshot, source === "official-fallback");
      notification.success({
        title: "比赛数据已刷新",
        description: `${snapshot.mode === "morning" ? "早间逐场最新赔率" : "常规接口 + 缺失比赛补充"} · ${source === "cloud" ? "云端缓存/刷新" : "前端官方兜底"} · 共 ${snapshot.matches.length} 场${snapshot.fixedBonusFailureCount ? ` · ${snapshot.fixedBonusFailureCount} 场投注情况获取失败` : ""}${snapshot.lastUpdateTime ? ` · 接口更新 ${snapshot.lastUpdateTime}` : ""}`,
        placement: "bottomRight",
      });
    } catch (error) {
      notification.error({
        title: "刷新比赛数据失败",
        description: error instanceof Error ? error.message : "无法连接体彩比赛接口",
        placement: "bottomRight",
      });
    } finally {
      setSportteryRefreshing(false);
    }
  };

  const chosenMatches = useMemo(() => sortMatchesForDisplay(selectedMatches(matches)), [matches]);
  const pickedCount = useMemo(() => chosenMatches.reduce((total, match) => total + selectedOptions(match).length, 0), [chosenMatches]);
  const passOptions = useMemo(() => getPassOptions(matches), [matches]);
  const activePasses = useMemo(() => {
    const valid = passes.filter((value) => passOptions.includes(value));
    return valid.length > 0 || passOptions.length === 0 ? valid : [passOptions[passOptions.length - 1]];
  }, [passes, passOptions]);
  const orderEditPassOptions = useMemo(() => [...new Set([
    ...getPassOptions(orderEditMatches),
    ...(editingOrder?.passes ?? []),
  ])]
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= MAX_SELECTED_MATCHES)
    .sort((left, right) => left - right), [editingOrder, orderEditMatches]);

  const scrollManualOrderPickerIntoView = useCallback((entryKey: string) => {
    const frame = window.requestAnimationFrame(() => {
      const row = manualOrderMatchPickerRowRefs.current.get(entryKey);
      const list = manualOrderEntryListRef.current;
      if (!row || !list) return;
      const target = row.querySelector<HTMLElement>(".ant-select") ?? row;
      const listRect = list.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const centeredTop = list.scrollTop
        + targetRect.top
        - listRect.top
        - Math.max(0, (list.clientHeight - targetRect.height) / 2);
      list.scrollTo({
        top: Math.max(0, centeredTop),
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useLayoutEffect(() => {
    const targetEntryKey = pendingManualOrderScrollEntryKeyRef.current;
    if (!targetEntryKey) return;
    pendingManualOrderScrollEntryKeyRef.current = null;
    return scrollManualOrderPickerIntoView(targetEntryKey);
  }, [manualOrderEntries, scrollManualOrderPickerIntoView]);

  const navigateToView = (view: AppView) => {
    if (!cloudAccount && view !== "betting") {
      onRequireAccount(view);
      return;
    }
    if (view !== "betting" && temporaryOrder) restoreSavedMatches();
    if (onNavigate) {
      onNavigate(view);
      return;
    }
    window.location.assign(view === "orders" ? "/orders" : view === "settings" ? "/settings" : "/");
  };

  useLayoutEffect(() => {
    let frame = 0;
    const measureExpandedHeader = () => {
      const header = headerRef.current;
      if (header) document.documentElement.style.setProperty("--header-expanded-height", `${header.getBoundingClientRect().height}px`);
    };
    measureExpandedHeader();
    frame = requestAnimationFrame(() => { if (window.scrollY <= 1) measureExpandedHeader(); });
    const handleResize = () => {
      if (window.scrollY > 1) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measureExpandedHeader);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
      document.documentElement.style.removeProperty("--header-expanded-height");
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const propertyNames = [
      "--header-top-pad",
      "--header-bottom-pad",
      "--header-content-height",
      "--header-brand-size",
      "--header-title-size",
      "--header-note-opacity",
      "--header-note-height",
      "--header-note-margin",
      "--header-label-width",
      "--header-action-gap",
      "--header-brand-opacity",
      "--header-brand-width",
      "--header-brand-height",
      "--header-brand-translate",
      "--header-tagline-height",
      "--header-tagline-margin",
      "--header-content-gap",
      "--header-content-bottom",
      "--header-note-pad-top",
      "--header-note-pad-bottom",
    ];
    const updateHeader = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const progress = Math.min(1, Math.max(0, window.scrollY / 180));
        const mobileHeader = window.matchMedia("(max-width: 560px)").matches;
        const root = document.documentElement;
        root.style.setProperty("--header-top-pad", `${26 - progress * 16}px`);
        root.style.setProperty("--header-bottom-pad", `${10 * progress}px`);
        root.style.setProperty("--header-content-height", `${84 - progress * 44}px`);
        root.style.setProperty("--header-brand-size", `${64 - progress * (mobileHeader ? 16 : 36)}px`);
        root.style.setProperty("--header-title-size", `${36 - progress * 12}px`);
        root.style.setProperty("--header-note-opacity", `${1 - progress}`);
        root.style.setProperty("--header-note-height", `${44 * (1 - progress)}px`);
        root.style.setProperty("--header-note-margin", `${20 * (1 - progress)}px`);
        root.style.setProperty("--header-label-width", `${84 * (1 - progress)}px`);
        root.style.setProperty("--header-action-gap", `${10 - progress * 4}px`);
        root.style.setProperty("--header-brand-opacity", `${mobileHeader ? 1 - progress : 1}`);
        root.style.setProperty("--header-brand-width", `${mobileHeader ? 560 * (1 - progress) : 560 - progress * 250}px`);
        root.style.setProperty("--header-brand-height", `${mobileHeader ? 68 * (1 - progress) : 68 - progress * 40}px`);
        root.style.setProperty("--header-brand-translate", `${-7 * progress}px`);
        root.style.setProperty("--header-tagline-height", `${18 * (1 - progress)}px`);
        root.style.setProperty("--header-tagline-margin", `${3 * (1 - progress)}px`);
        root.style.setProperty("--header-content-gap", `${24 * (1 - progress)}px`);
        root.style.setProperty("--header-content-bottom", `${12 * (1 - progress)}px`);
        root.style.setProperty("--header-note-pad-top", `${10 * (1 - progress)}px`);
        root.style.setProperty("--header-note-pad-bottom", `${12 * (1 - progress)}px`);
      });
    };
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    window.addEventListener("resize", updateHeader);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateHeader);
      window.removeEventListener("resize", updateHeader);
      propertyNames.forEach((name) => document.documentElement.style.removeProperty(name));
    };
  }, []);

  const betCount = useMemo(() => countBets(matches, activePasses), [matches, activePasses]);
  const stake = useMemo(() => calculateStake(matches, activePasses, multiple), [matches, activePasses, multiple]);
  const prizeRange = useMemo(() => calculatePrizeRange(matches, activePasses, multiple), [matches, activePasses, multiple]);
  const prizeRangeMetrics = useMemo(() => calculatePrizeRangeMetrics(prizeRange, stake, multiple), [prizeRange, stake, multiple]);
  const currentPrize = useMemo(() => calculateCurrentPrize(matches, activePasses, multiple, hits), [matches, activePasses, multiple, hits]);
  const currentProfit = currentPrize - stake;
  const netProfit = incomeTotal - expenseTotal;
  const loadFinanceTrend = useCallback(() => {
    if (isCloudMode) return getFinanceTrend();
    const orderTotals = orderLedgerTotals(savedSlips);
    return Promise.resolve({
      points: buildFinanceTrendFromOrders(savedSlips, {
        expenseCorrection: expenseTotal - orderTotals.expense,
        incomeCorrection: incomeTotal - orderTotals.income,
        date: shanghaiDateKey(new Date().toISOString()),
      }),
    });
  }, [expenseTotal, incomeTotal, isCloudMode, savedSlips]);
  const orderDetailStake = orderDetail ? calculateStake(orderDetail.matches, orderDetail.passes, orderDetail.multiple) : 0;
  const orderDetailPrize = orderDetail ? calculateCurrentPrize(orderDetail.matches, orderDetail.passes, orderDetail.multiple, orderHits) : 0;
  const orderDetailProfit = orderDetailPrize - orderDetailStake;
  const orderDetailRange = orderDetail ? calculatePrizeRange(orderDetail.matches, orderDetail.passes, orderDetail.multiple, orderHits) : { min: 0, max: 0, uncappedMax: 0 };
  const orderDetailRangeMetrics = calculatePrizeRangeMetrics(orderDetailRange, orderDetailStake, orderDetail?.multiple ?? 0);
  const orderDetailMatches = orderDetail ? sortMatchesForDisplay(selectedMatches(orderDetail.matches)) : [];
  const orderDetailPickedCount = orderDetailMatches.reduce((total, match) => total + selectedOptions(match).length, 0);
  const availableOrderLeagueNames = useMemo(() => {
    const namesInOrders = new Set(savedSlips.flatMap((slip) => selectedMatches(slip.matches)
      .map((match) => match.league)
      .filter(Boolean)));
    const orderedNames = leagueOptions
      .map((league) => league.leagueNameAbbr)
      .filter((leagueName) => namesInOrders.delete(leagueName));
    return prioritizeLeagueNames([...orderedNames, ...namesInOrders]);
  }, [leagueOptions, savedSlips]);
  const availableOrderLeagueNameSet = useMemo(() => new Set(availableOrderLeagueNames), [availableOrderLeagueNames]);
  const effectiveSelectedOrderLeagueNames = useMemo(() => (
    retainAvailableLeagueNames(selectedOrderLeagueNames, availableOrderLeagueNameSet)
  ), [availableOrderLeagueNameSet, selectedOrderLeagueNames]);
  const selectedOrderLeagueSet = useMemo(() => new Set(effectiveSelectedOrderLeagueNames), [effectiveSelectedOrderLeagueNames]);
  const cloudOrderQuery = useMemo(() => currentCloudOrderQuery(), [currentCloudOrderQuery]);

  useEffect(() => {
    // Options come from the latest order result set, so hidden selections must be removed after that external data changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedOrderLeagueNames((current) => retainAvailableLeagueNames(current, availableOrderLeagueNameSet));
  }, [availableOrderLeagueNameSet]);

  useEffect(() => {
    if (!isCloudMode || activeView !== "orders") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setCloudOrdersLoading(true);
      void onCloudOrdersQueryChange(cloudOrderQuery)
        .then((result) => {
          if (cancelled) return;
          setSavedSlips(ensureOrderIds(result.orders));
          setCloudOrderTotal(result.total);
          setCloudUnsettledOrderCount(result.unsettledCount);
          setRenderedOrderCount(ORDER_LIST_BATCH_SIZE);
        })
        .catch((error) => {
          if (!cancelled) message.error(error instanceof Error ? error.message : "订单筛选加载失败，请刷新后重试");
        })
        .finally(() => {
          if (!cancelled) setCloudOrdersLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeView, cloudOrderQuery, isCloudMode, message, onCloudOrdersQueryChange]);

  const filteredSavedSlips = useMemo(() => sortSavedOrders(savedSlips
    .filter((slip) => {
      if (orderProgressFilter === "settled" && !slip.settledAt) return false;
      if (orderProgressFilter === "unsettled" && slip.settledAt) return false;
      if (orderProgressFilter === "unpaid" && isOrderPaid(slip)) return false;
      if (orderStatusFilters.length > 0 && !orderStatusFilters.some((status) => (
        status === "paid" ? isOrderPaid(slip) : getOrderStatus(slip) === status
      ))) return false;
      if (orderShortPassFilters.length > 0 && !orderShortPassFilters.some((pass) => getOrderShortPasses(slip).includes(pass))) return false;
      if (orderDateRange) {
        const savedDate = savedSlipDateKey(slip.savedAt);
        if (savedDate < orderDateRange[0] || savedDate > orderDateRange[1]) return false;
      }
      return orderContainsTeam(slip, orderTeamQuery)
        && orderPassesLeagueFilter(slip, selectedOrderLeagueSet);
    })), [
      savedSlips,
      orderDateRange,
      orderShortPassFilters,
      orderProgressFilter,
      orderStatusFilters,
      orderTeamQuery,
      selectedOrderLeagueSet,
    ]);
  const orderTotalCount = isCloudMode ? cloudOrderTotal : savedSlips.length;
  const unsettledOrderCount = useMemo(() => (
    isCloudMode ? cloudUnsettledOrderCount : savedSlips.filter((slip) => !slip.settledAt).length
  ), [cloudUnsettledOrderCount, isCloudMode, savedSlips]);
  const visibleUnlockedOrderCount = useMemo(
    () => filteredSavedSlips.filter((slip) => !isOrderPaid(slip) && !isOrderOddsLocked(slip)).length,
    [filteredSavedSlips],
  );
  const filteredOrderTotalStake = useMemo(() => orderStakeTotal(filteredSavedSlips), [filteredSavedSlips]);
  const filteredOrderPaidStake = useMemo(() => orderLedgerTotals(filteredSavedSlips).expense, [filteredSavedSlips]);
  const filteredOrderIncome = useMemo(() => orderFilterIncomeTotal(filteredSavedSlips), [filteredSavedSlips]);
  const filteredOrderProfit = filteredOrderIncome - filteredOrderPaidStake;
  const renderedSavedSlips = useMemo(
    () => filteredSavedSlips.slice(0, renderedOrderCount),
    [filteredSavedSlips, renderedOrderCount],
  );
  const filteredSettleableOrders = useMemo(
    () => filteredSavedSlips.filter(isOrderSettleable),
    [filteredSavedSlips],
  );
  const filteredPayableOrders = useMemo(
    () => filteredSavedSlips.filter((slip) => !slip.settledAt && !isOrderPaid(slip)),
    [filteredSavedSlips],
  );
  const hasMoreRenderedOrders = renderedSavedSlips.length < filteredSavedSlips.length;
  const resultMatches = useMemo(() => {
    const unique = new Map<string, MatchItem>();
    const officialById = new Map(matches.map((match) => [normalizeSportteryMatchId(match.id), match]));
    filteredSavedSlips
      .forEach((slip) => selectedMatches(slip.matches)
        .filter((match) => !isOrderMatchJudged(slip, match))
        .forEach((match) => {
        const matchId = normalizeSportteryMatchId(match.id);
        if (!unique.has(matchId)) unique.set(matchId, officialById.get(matchId) ?? match);
        }));
    return sortMatchesForDisplay([...unique.values()]);
  }, [filteredSavedSlips, matches]);

  useEffect(() => {
    if (activeView !== "orders" || !hasMoreRenderedOrders || typeof IntersectionObserver === "undefined") return;
    const target = orderListLoadMoreRef.current;
    if (!target) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setRenderedOrderCount((current) => Math.min(
        current + ORDER_LIST_BATCH_SIZE,
        filteredSavedSlips.length,
      ));
    }, { rootMargin: "360px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [activeView, filteredSavedSlips.length, hasMoreRenderedOrders]);

  const availableMatchDateSet = useMemo(
    () => new Set(matches.map((match) => match.date).filter(Boolean)),
    [matches],
  );
  const dateAndSaleFilteredMatches = useMemo(() => matches
    .filter((match) => !selectedMatchDate || match.date === selectedMatchDate)
    .filter((match) => matchesSaleFilter(match, matchSaleFilter, saleNow)),
  [matches, matchSaleFilter, saleNow, selectedMatchDate]);
  const availableLeagueOptions = useMemo(() => {
    const availableLeagueNames = new Set(dateAndSaleFilteredMatches.map((match) => match.league));
    const optionByName = new Map(leagueOptions.map((league) => [league.leagueNameAbbr, league]));
    return prioritizeLeagueNames(leagueOptions
      .filter((league) => availableLeagueNames.has(league.leagueNameAbbr))
      .map((league) => league.leagueNameAbbr))
      .map((leagueName) => optionByName.get(leagueName))
      .filter((league): league is SportteryLeague => Boolean(league));
  }, [dateAndSaleFilteredMatches, leagueOptions]);
  const availableLeagueNameSet = useMemo(() => (
    new Set(availableLeagueOptions.map((league) => league.leagueNameAbbr))
  ), [availableLeagueOptions]);
  const effectiveSelectedLeagueNames = useMemo(() => (
    retainAvailableLeagueNames(selectedLeagueNames, availableLeagueNameSet)
  ), [availableLeagueNameSet, selectedLeagueNames]);
  const selectedLeagueSet = useMemo(() => new Set(effectiveSelectedLeagueNames), [effectiveSelectedLeagueNames]);

  useEffect(() => {
    // Date, sale status, and refreshed match data can all remove options that are no longer clickable in the toolbar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedLeagueNames((current) => retainAvailableLeagueNames(current, availableLeagueNameSet));
  }, [availableLeagueNameSet]);

  const settingsLeagueNames = useMemo(() => [...new Set([
    ...Object.keys(DEFAULT_LEAGUE_TAG_COLORS),
    ...leagueOptions.map((item) => leagueColorSettingKey(item.leagueNameAbbr)),
    ...Object.keys(appSettings.appearance.leagueTagColors),
  ])], [appSettings.appearance.leagueTagColors, leagueOptions]);
  const filteredMatches = useMemo(() => dateAndSaleFilteredMatches
    .filter((match) => matchPassesLeagueFilter(match, selectedLeagueSet))
    .sort(compareMatchDisplayOrder), [dateAndSaleFilteredMatches, selectedLeagueSet]);

  const groupedMatches = useMemo(() => {
    const groups = new Map<string, MatchItem[]>();
    filteredMatches.forEach((match) => groups.set(match.date, [...(groups.get(match.date) ?? []), match]));
    return Array.from(groups.entries());
  }, [filteredMatches]);

  const moreMatch = matches.find((match) => match.id === moreMatchId) ?? null;
  const previewMatch = matches.find((match) => match.id === previewMatchId) ?? null;
  const trendMatch = matches.find((match) => match.id === trendMatchId) ?? null;

  const toggleOption = (matchId: string, type: MarketType, optionId: string) => {
    const targetMatch = matches.find((match) => match.id === matchId);
    const option = targetMatch?.markets.find((market) => market.type === type)?.options.find((item) => item.id === optionId);
    if (!targetMatch || !isMatchSelectable(targetMatch, saleNow) || !option || option.odds <= 0) return;
    if (!option.selected && isNewMatchSelectionBlocked(matches, matchId)) {
      message.warning(`最多可选择 ${MAX_SELECTED_MATCHES} 场比赛`);
      return;
    }
    setMatches((current) => current.map((match) => match.id !== matchId ? match : {
      ...match,
      markets: match.markets.map((market) => market.type !== type ? market : {
        ...market,
        options: market.options.map((item) => item.id === optionId ? { ...item, selected: !item.selected } : item),
      }),
    }));
    setHits((current) => current[matchId]?.[type] === optionId ? {
      ...current,
      [matchId]: { ...current[matchId], [type]: undefined },
    } : current);
  };

  const clearBettingMatch = (matchId: string) => {
    const removedCount = matches.find((match) => match.id === matchId)?.markets
      .reduce((total, market) => total + market.options.filter((option) => option.selected).length, 0) ?? 0;
    setMatches((current) => current.map((match) => match.id !== matchId ? match : {
      ...match,
      markets: match.markets.map((market) => ({
        ...market,
        options: market.options.map((option) => option.selected ? { ...option, selected: false } : option),
      })),
    }));
    setHits((current) => {
      if (!current[matchId]) return current;
      const next = { ...current };
      delete next[matchId];
      return next;
    });
    if (removedCount >= pickedCount) setDetailsOpen(false);
  };

  const persistNewOrder = async (
    name: string,
    orderMatches: MatchItem[],
    orderPasses: number[],
    orderMultiple: number,
    source: string,
    savedAt?: string,
  ) => {
    const createdAt = savedAt && dayjs(savedAt).isValid()
      ? dayjs(savedAt).millisecond(0).toISOString()
      : new Date().toISOString();
    const nextOrder: SavedSlip = {
      id: createSlipId(),
      name: name.trim() || `${source}订单 ${new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
      savedAt: createdAt,
      matches: cloneMatches(orderMatches),
      passes: [...orderPasses],
      multiple: orderMultiple,
      paymentStatus: "unpaid",
      oddsLocked: false,
      hits: {},
    };
    const committedOrders = await commitOrderMutation({ upsertOrders: [nextOrder], deleteOrderIds: [] });
    if (!committedOrders) return false;
    notification.success({
      message: "订单添加完成",
      description: `新增 1 个订单，包含 ${selectedMatches(orderMatches).length} 场比赛`,
      placement: "bottomRight",
    });
    return true;
  };

  const restoreSavedMatches = () => {
    sessionCache.removeItem(LOADED_ORDER_KEY);
    const cachedMatches = loadCachedMatches();
    matchesRef.current = cachedMatches;
    setMatches(cachedMatches);
    setMatchDates(cachedMatchDates(cachedMatches));
    setLeagueOptions(cachedLeagueOptions(cachedMatches));
    setPasses([]);
    setMultiple(1);
    setHits({});
    setMoreMatchId(null);
    setDetailsOpen(false);
    setSportteryLoaded(false);
    setTemporaryOrder(null);
  };

  const clearPredictionSelections = () => {
    setMatches((current) => current.map((match) => ({
      ...match,
      markets: match.markets.map((market) => ({
        ...market,
        options: market.options.map((option) => ({ ...option, selected: false })),
      })),
    })));
    setPasses([]);
    setHits({});
    setMoreMatchId(null);
    setDetailsOpen(false);
  };

  const clearManualMatchLookups = () => {
    manualMatchLookupGenerationRef.current += 1;
    manualMatchLookupTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    manualMatchLookupTimersRef.current.clear();
    manualMatchLookupQueriesRef.current.clear();
    setManualTemporaryMatches({});
    setManualMatchLookupIds({});
  };

  const closeManualOrder = () => {
    setManualOrderOpen(false);
    setManualOrderPassDropdownOpen(false);
    setManualPickerEntryKey(null);
    setManualPickerMatch(null);
    clearManualMatchLookups();
  };

  const openManualOrder = () => {
    clearManualMatchLookups();
    setManualOrderName("");
    setManualOrderPassText("");
    setManualOrderPassDropdownOpen(false);
    setManualOrderMultiple(1);
    setManualOrderSavedAt("");
    setManualOrderEntries([createManualOrderEntry()]);
    setManualPickerEntryKey(null);
    setManualPickerMatch(null);
    setManualOrderOpen(true);
  };

  const searchManualOrderMatch = (entryKey: string, rawQuery: string) => {
    const query = rawQuery.trim();
    const previousTimer = manualMatchLookupTimersRef.current.get(entryKey);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);
    manualMatchLookupTimersRef.current.delete(entryKey);
    manualMatchLookupQueriesRef.current.set(entryKey, query);
    setManualMatchLookupIds((current) => {
      if (!(entryKey in current)) return current;
      const next = { ...current };
      delete next[entryKey];
      return next;
    });
    if (!/^\d{6,}$/.test(query) || manualTemporaryMatches[query]) return;

    setManualMatchLookupIds((current) => ({ ...current, [entryKey]: query }));
    const generation = manualMatchLookupGenerationRef.current;
    const timer = window.setTimeout(() => {
      manualMatchLookupTimersRef.current.delete(entryKey);
      if (manualMatchLookupQueriesRef.current.get(entryKey) !== query) return;
      void fetchSportteryMatchById(query, manualMatchSources, saleNow)
        .then((match) => {
          if (manualMatchLookupGenerationRef.current !== generation
            || manualMatchLookupQueriesRef.current.get(entryKey) !== query) return;
          if (!match) {
            message.info(`比赛 ${query} 已取得赔率，但缺少日期、时间或场次号，请继续手动填写`);
            return;
          }
          setManualTemporaryMatches((current) => ({ ...current, [normalizeSportteryMatchId(match.id)]: match }));
        })
        .catch((error: unknown) => {
          if (manualMatchLookupGenerationRef.current !== generation
            || manualMatchLookupQueriesRef.current.get(entryKey) !== query) return;
          message.warning(error instanceof Error ? error.message : `比赛 ${query} 查询失败`);
        })
        .finally(() => {
          if (manualMatchLookupGenerationRef.current !== generation
            || manualMatchLookupQueriesRef.current.get(entryKey) !== query) return;
          setManualMatchLookupIds((current) => {
            if (current[entryKey] !== query) return current;
            const next = { ...current };
            delete next[entryKey];
            return next;
          });
        });
    }, 350);
    manualMatchLookupTimersRef.current.set(entryKey, timer);
  };

  const updateManualOrderEntry = (key: string, patch: Partial<ManualOrderEntry>) => {
    setManualOrderEntries((current) => current.map((entry) => entry.key === key ? { ...entry, ...patch } : entry));
  };

  const addManualOrderEntry = () => {
    const firstEmptyEntry = manualOrderEntries.find((entry) => entry.text.trim().length === 0);
    if (firstEmptyEntry) {
      scrollManualOrderPickerIntoView(firstEmptyEntry.key);
      return;
    }
    if (manualOrderEntries.length >= MAX_SELECTED_MATCHES) {
      message.warning(`最多可选择 ${MAX_SELECTED_MATCHES} 场比赛`);
      return;
    }
    const nextEntry = createManualOrderEntry();
    pendingManualOrderScrollEntryKeyRef.current = nextEntry.key;
    setManualOrderEntries((current) => [...current, nextEntry]);
  };

  const selectManualOrderMatch = (entryKey: string, matchId: string | null) => {
    const normalizedMatchId = matchId ? normalizeSportteryMatchId(matchId) : null;
    if (normalizedMatchId && manualOrderEntries.some((entry) => (
      entry.key !== entryKey
      && entry.matchId
      && normalizeSportteryMatchId(entry.matchId) === normalizedMatchId
    ))) {
      message.warning("该比赛已在当前订单中选择，请选择其他比赛");
      return;
    }
    const source = normalizedMatchId
      ? manualTemporaryMatches[normalizedMatchId]
        ?? matches.find((match) => normalizeSportteryMatchId(match.id) === normalizedMatchId)
      : null;
    if (!source) {
      updateManualOrderEntry(entryKey, { matchId: null, text: "" });
      return;
    }
    const draft = matchWithClearedSelections(source);
    updateManualOrderEntry(entryKey, { matchId: draft.id, text: formatManualMatchText(draft) });
  };

  const openManualMatchPicker = (entry: ManualOrderEntry) => {
    const normalizedMatchId = entry.matchId ? normalizeSportteryMatchId(entry.matchId) : "";
    const source = normalizedMatchId
      ? manualTemporaryMatches[normalizedMatchId]
        ?? matches.find((match) => normalizeSportteryMatchId(match.id) === normalizedMatchId)
      : null;
    if (!source) {
      message.info("请先从已保存比赛中选择一场；找不到时可直接手动填写文本");
      return;
    }
    const draft = matchWithClearedSelections(source);
    const parsed = parseRecognizedText(entry.text, { selectOptions: true, emptyOdds: true })[0];
    if (parsed) {
      draft.markets = draft.markets.map((market) => {
        const parsedMarket = parsed.markets.find((item) => item.type === market.type);
        return {
          ...market,
          options: market.options.map((option) => {
            const parsedOption = parsedMarket?.options.find((item) => item.id === option.id && item.selected);
            return parsedOption ? { ...option, odds: parsedOption.odds > 0 ? parsedOption.odds : option.odds, selected: true } : option;
          }),
        };
      });
    }
    setManualPickerEntryKey(entry.key);
    setManualPickerMatch(draft);
  };

  const toggleManualPickerOption = (type: MarketType, optionId: string) => {
    setManualPickerMatch((current) => current ? {
      ...current,
      markets: current.markets.map((market) => market.type !== type ? market : {
        ...market,
        options: market.options.map((option) => option.id === optionId && option.odds > 0 ? { ...option, selected: !option.selected } : option),
      }),
    } : current);
  };

  const applyManualPickerSelection = () => {
    if (!manualPickerMatch || !manualPickerEntryKey) return;
    if (selectedOptions(manualPickerMatch).length === 0) {
      message.warning("请至少选择一个投注项");
      return;
    }
    updateManualOrderEntry(manualPickerEntryKey, {
      matchId: normalizeSportteryMatchId(manualPickerMatch.id),
      text: formatManualMatchText(manualPickerMatch),
    });
    setManualPickerEntryKey(null);
    setManualPickerMatch(null);
  };

  const addManualOrder = async () => {
    if (manualOrderSaving) return;
    if (manualOrderEntries.length > MAX_SELECTED_MATCHES) {
      message.warning(`最多可选择 ${MAX_SELECTED_MATCHES} 场比赛`);
      return;
    }
    const parsedEntries = manualOrderEntries.map((entry) => parseRecognizedText(entry.text, { selectOptions: true, emptyOdds: true }));
    const invalidIndex = parsedEntries.findIndex((entryMatches) => entryMatches.length !== 1 || selectedMatches(entryMatches).length !== 1);
    if (invalidIndex >= 0) {
      message.warning(`第 ${invalidIndex + 1} 场没有识别到完整比赛及投注项`);
      return;
    }
    const parsed = parsedEntries.flat();
    const invalidIdIndex = parsed.findIndex((match) => !/^\d{6,}$/.test(normalizeSportteryMatchId(match.id)));
    if (invalidIdIndex >= 0) {
      message.warning(`第 ${invalidIdIndex + 1} 场需要填写至少 6 位纯数字比赛 ID`);
      return;
    }
    const normalizedMatches = parsed.map((match) => ({ ...match, id: normalizeSportteryMatchId(match.id) }));
    const missingHandicapIndex = normalizedMatches.findIndex((match) => {
      const rqspf = match.markets.find((market) => market.type === "rqspf");
      return rqspf?.options.some((option) => option.selected) && typeof rqspf.handicap !== "number";
    });
    if (missingHandicapIndex >= 0) {
      message.warning(`第 ${missingHandicapIndex + 1} 场选择了让球胜平负，请填写让球数，例如“让球胜平负（-1）”`);
      return;
    }
    if (new Set(normalizedMatches.map((match) => match.id)).size !== normalizedMatches.length) {
      message.warning("同一比赛不能重复添加");
      return;
    }
    const combinedText = manualOrderEntries.map((entry) => entry.text).join("\n\n");
    const orderPasses = inferOrderPasses(manualOrderPassText || combinedText, normalizedMatches);
    const createdAt = manualOrderSavedAt ? dayjs(manualOrderSavedAt) : null;
    if (createdAt && !createdAt.isValid()) {
      message.warning("请选择有效的订单创建时间，或清空后使用当前时间");
      return;
    }
    setManualOrderSaving(true);
    try {
      const saved = await persistNewOrder(
        manualOrderName,
        normalizedMatches,
        orderPasses,
        manualOrderMultiple,
        "手动",
        createdAt?.toISOString(),
      );
      if (!saved) return;
      closeManualOrder();
    } finally {
      setManualOrderSaving(false);
    }
  };

  const saveSlip = async () => {
    if (saveSlipLoading) return;
    const nextName = saveName.trim() || dayjs().format("YYYY年MM月DD日 HH时mm分ss秒");
    const orderId = temporaryOrder?.id ?? createSlipId();
    const loadedOrderIndex = temporaryOrder ? savedSlips.findIndex((slip) => slip.id === temporaryOrder.id) : -1;
    const previousOrder = loadedOrderIndex >= 0 ? savedSlips[loadedOrderIndex] : null;
    if (previousOrder && (previousOrder.settledAt || isOrderPaid(previousOrder))) {
      message.warning(previousOrder.settledAt ? "该订单已结账，不能再更新" : "该订单已支付，投注内容已经冻结");
      return;
    }
    const next: SavedSlip = {
      id: orderId,
      name: nextName,
      savedAt: previousOrder?.savedAt ?? new Date().toISOString(),
      updatedAt: previousOrder?.updatedAt,
      matches: cloneMatches(matches),
      passes: [...activePasses],
      multiple,
      paymentStatus: previousOrder?.paymentStatus === "paid" ? "paid" : "unpaid",
      oddsLocked: previousOrder?.oddsLocked ?? false,
      hits: previousOrder ? filterHitsForSelections(previousOrder.hits, matches) : {},
      resultValues: previousOrder?.resultValues
        ? Object.fromEntries(Object.entries(previousOrder.resultValues).filter(([matchId]) => matches.some((match) => match.id === matchId)))
        : undefined,
      failedMatches: previousOrder?.failedMatches?.filter((matchId) => matches.some((match) => match.id === matchId)) ?? [],
    };
    setSaveSlipLoading(true);
    try {
      const committedOrders = await commitOrderMutation({ upsertOrders: [next], deleteOrderIds: [] });
      if (!committedOrders) return;
      setSaveOpen(false);
      setSaveName("");
      if (temporaryOrder) restoreSavedMatches();
      else clearPredictionSelections();
      message.success(loadedOrderIndex >= 0 ? "预测单已更新" : isGuestMode ? "预测单已保存到本机" : "预测单已保存到账号");
    } finally {
      setSaveSlipLoading(false);
    }
  };

  const openSaveSlip = () => {
    if (!cloudAccount) {
      sessionCache.setItem(CLOUD_STORAGE_KEYS.loginBetDraft, JSON.stringify({
        matches,
        passes: activePasses,
        multiple,
        hits,
      } satisfies AccountLoginBetDraft));
      onRequireAccount();
      return;
    }
    setSaveName(temporaryOrder?.name ?? "");
    setSaveOpen(true);
  };

  const loadSlip = async (slip: SavedSlip) => {
    if (loadingOrderId) return;
    if (slip.settledAt || isOrderPaid(slip)) {
      message.warning(slip.settledAt ? "该订单已结账，不能再载入修改" : "该订单已支付，投注内容已经冻结");
      return;
    }
    const availableMatches = selectAvailableOrderBets(matches, slip.matches, saleNow);
    const availableOptionCount = countSelectedOptions(availableMatches);
    if (availableOptionCount === 0) {
      message.warning("该订单没有当前可用的投注项");
      return;
    }
    const filteredOptionCount = Math.max(0, countSelectedOptions(slip.matches) - availableOptionCount);
    const availableHits = filterHitsForSelections(slip.hits, availableMatches);
    const orderId = slip.id || createSlipId();
    const loadedSlip = slip.id ? slip : { ...slip, id: orderId };
    setLoadingOrderId(orderActionKey(slip));
    try {
      if (!slip.id) {
        const committedOrders = await commitOrderMutation({ upsertOrders: [loadedSlip], deleteOrderIds: [] });
        if (!committedOrders) return;
      }
      setMatches(availableMatches);
      setPasses([...loadedSlip.passes]);
      setMultiple(loadedSlip.multiple);
      setHits(availableHits);
      setTemporaryOrder({ id: orderId, name: loadedSlip.name });
      sessionCache.setItem(LOADED_ORDER_KEY, JSON.stringify({
        mode: "load",
        filteredOptionCount,
        id: orderId,
        name: loadedSlip.name,
        matches: availableMatches,
        passes: [...loadedSlip.passes],
        multiple: loadedSlip.multiple,
        hits: availableHits,
      } satisfies LoadedOrderDraft));
      navigateToView("betting");
    } finally {
      setLoadingOrderId(null);
    }
  };

  const copySlip = (slip: SavedSlip) => {
    const copiedMatches = selectAvailableOrderBets(matches, slip.matches, saleNow);
    const availableOptionCount = countSelectedOptions(copiedMatches);
    if (availableOptionCount === 0) {
      message.warning("该订单没有当前可用的投注项");
      return;
    }
    const filteredOptionCount = Math.max(0, countSelectedOptions(slip.matches) - availableOptionCount);
    setMatches(copiedMatches);
    setPasses([...slip.passes]);
    setMultiple(slip.multiple);
    setHits({});
    setTemporaryOrder(null);
    sessionCache.setItem(LOADED_ORDER_KEY, JSON.stringify({
      mode: "copy",
      filteredOptionCount,
      id: slip.id || createSlipId(),
      name: slip.name,
      matches: copiedMatches,
      passes: [...slip.passes],
      multiple: slip.multiple,
      hits: {},
    } satisfies LoadedOrderDraft));
    navigateToView("betting");
  };

  const deleteSlip = async (target: SavedSlip) => {
    const targetKey = orderActionKey(target);
    if (deletingOrderIds.includes(targetKey)) return;
    if (!savedSlips.includes(target)) return;
    setDeletingOrderIds((current) => [...new Set([...current, targetKey])]);
    try {
      const committedOrders = await commitOrderMutation({
        upsertOrders: [],
        deleteOrderIds: target.id ? [target.id] : [],
      });
      if (!committedOrders) return;
      if (isGuestMode) {
        if (isOrderPaid(target)) setExpenseTotal((current) => Math.max(0, current - calculateStake(target.matches, target.passes, target.multiple)));
        if (target.settledAt) setIncomeTotal((current) => Math.max(0, current - (target.settledPrize ?? 0)));
      }
    } finally {
      setDeletingOrderIds((current) => current.filter((key) => key !== targetKey));
    }
  };

  const toggleOrderExpanded = (id: string) => {
    setExpandedOrderIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const clearOrderFilters = () => {
    setRenderedOrderCount(ORDER_LIST_BATCH_SIZE);
    setOrderDateRange(null);
    setOrderProgressFilter(null);
    setOrderStatusFilters([]);
    setOrderShortPassFilters([]);
    setOrderShortPassDropdownOpen(false);
    setOrderTeamQuery("");
    setSelectedOrderLeagueNames([]);
  };

  const clearOrderShortPassFilter = () => {
    setRenderedOrderCount(ORDER_LIST_BATCH_SIZE);
    setOrderShortPassFilters([]);
    setOrderShortPassDropdownOpen(false);
  };

  const toggleOrderLeagueFilter = (leagueName: string) => {
    setRenderedOrderCount(ORDER_LIST_BATCH_SIZE);
    setSelectedOrderLeagueNames((current) => current.includes(leagueName)
      ? current.filter((item) => item !== leagueName)
      : [...current, leagueName]);
  };

  const expandAllOrderOptions = () => {
    const visibleOrderKeys = filteredSavedSlips.map((slip, index) => slip.id || `legacy-${slip.savedAt}-${index}`);
    setExpandedOrderIds((current) => [...new Set([...current, ...visibleOrderKeys])]);
  };

  const lockVisibleOrderOdds = async () => {
    if (lockingOrderOdds) return;
    const visibleUnlockedOrders = new Set(filteredSavedSlips.filter((slip) => !isOrderPaid(slip) && !isOrderOddsLocked(slip)));
    if (visibleUnlockedOrders.size === 0) {
      message.info("当前查看的订单倍率均已锁定");
      return;
    }

    const nextOrders = savedSlips.map((slip) => visibleUnlockedOrders.has(slip) ? { ...slip, oddsLocked: true } : slip);
    const updatedOrders = nextOrders.filter((slip, index) => slip !== savedSlips[index]);
    const detailOrderId = orderDetail?.id;
    setLockingOrderOdds(true);
    try {
      const committedOrders = await commitOrderMutation({ upsertOrders: updatedOrders, deleteOrderIds: [], operation: "lock-odds" });
      if (!committedOrders) return;
      if (detailOrderId) {
        const committedDetail = committedOrders.find((slip) => slip.id === detailOrderId);
        if (committedDetail) setOrderDetail(committedDetail);
      }
      notification.success({
        title: "倍率锁定完成",
        description: `已锁定当前查看的 ${visibleUnlockedOrders.size} 个订单`,
        placement: "bottomRight",
      });
    } finally {
      setLockingOrderOdds(false);
    }
  };

  const refreshUnlockedOrderOdds = async () => {
    if (orderOddsRefreshing) return;
    const visibleUnlockedOrders = new Set(filteredSavedSlips.filter((slip) => !isOrderPaid(slip) && !isOrderOddsLocked(slip)));
    if (visibleUnlockedOrders.size === 0) {
      message.info("当前查看的订单没有可更新的未锁定订单");
      return;
    }

    setOrderOddsRefreshing(true);
    try {
      const payload = await fetchSportteryMatchCalculator();
      const latestMatches = convertSportteryMatches(payload);
      let matchedOptionCount = 0;
      let changedOptionCount = 0;
      let unmatchedOptionCount = 0;
      const nextOrders = savedSlips.map((slip) => {
        if (!visibleUnlockedOrders.has(slip)) return slip;
        const refreshed = refreshSelectedOdds(slip.matches, latestMatches);
        matchedOptionCount += refreshed.matchedOptionCount;
        changedOptionCount += refreshed.changedOptionCount;
        unmatchedOptionCount += refreshed.unmatchedOptionCount;
        return { ...slip, matches: refreshed.matches };
      });
      const detailOrderId = orderDetail?.id;
      const updatedOrders = nextOrders.filter((slip, index) => slip !== savedSlips[index]);
      const committedOrders = await commitOrderMutation({ upsertOrders: updatedOrders, deleteOrderIds: [], operation: "refresh-odds" });
      if (!committedOrders) return;
      if (detailOrderId) {
        const committedDetail = committedOrders.find((slip) => slip.id === detailOrderId);
        if (committedDetail) setOrderDetail(committedDetail);
      }
      notification.success({
        title: "订单倍率更新完成",
        description: `已检查当前查看的 ${visibleUnlockedOrders.size} 个未锁定订单，匹配 ${matchedOptionCount} 个投注项，${changedOptionCount} 项倍率发生变化${unmatchedOptionCount ? `；${unmatchedOptionCount} 项暂无最新可售倍率，已保留原值` : ""}`,
        placement: "bottomRight",
      });
    } catch (error) {
      notification.error({
        title: "订单倍率更新失败",
        description: error instanceof Error ? error.message : "无法连接体彩比赛接口",
        placement: "bottomRight",
      });
    } finally {
      setOrderOddsRefreshing(false);
    }
  };

  const openOrderEditor = (slip: SavedSlip) => {
    setEditingOrder(slip);
    setOrderEditName(slip.name);
    setOrderEditTime(slip.savedAt);
    setOrderEditMatches(cloneMatches(slip.matches));
    setOrderEditPasses([...slip.passes]);
    setOrderEditMultiple(slip.multiple);
    setOrderEditOddsLocked(isOrderOddsLocked(slip));
  };

  const closeOrderEditor = () => {
    setEditingOrder(null);
    setOrderEditName("");
    setOrderEditTime("");
    setOrderEditMatches([]);
    setOrderEditPasses([]);
    setOrderEditMultiple(1);
    setOrderEditOddsLocked(false);
  };

  const openOrderDetails = (slip: SavedSlip) => {
    setOrderDetail(slip);
    setOrderHits(cloneHits(slip.hits));
    setOrderFailedMatches([...(slip.failedMatches ?? [])]);
  };

  const toggleOrderHit = (matchId: string, type: MarketType, optionId: string) => {
    setOrderFailedMatches((current) => current.filter((id) => id !== matchId));
    setOrderHits((current) => {
      const previous = current[matchId]?.[type];
      return {
        ...current,
        [matchId]: { ...current[matchId], [type]: previous === optionId ? undefined : optionId },
      };
    });
  };

  const toggleOrderMatchFailure = (matchId: string, failed: boolean) => {
    setOrderFailedMatches((current) => failed ? [...new Set([...current, matchId])] : current.filter((id) => id !== matchId));
    if (failed) {
      setOrderHits((current) => {
        const next = { ...current };
        delete next[matchId];
        return next;
      });
    }
  };

  const saveOrderHits = async () => {
    if (orderHitsSaving) return;
    if (!orderDetail) return;
    if (orderDetail.settledAt) {
      message.warning("该订单已结账，命中结果已锁定");
      return;
    }
    const updated = {
      ...orderDetail,
      id: orderDetail.id || createSlipId(),
      hits: cloneHits(orderHits),
      failedMatches: [...orderFailedMatches],
    };
    setOrderHitsSaving(true);
    try {
      const committedOrders = await commitOrderMutation({ upsertOrders: [updated], deleteOrderIds: [] });
      if (!committedOrders) return;
      const committedOrder = committedOrders.find((slip) => slip.id === updated.id) ?? updated;
      setOrderDetail(committedOrder);
      notification.success({ message: "比赛结果已保存", description: `已更新订单“${committedOrder.name}”的命中与失败状态`, placement: "bottomRight" });
    } finally {
      setOrderHitsSaving(false);
    }
  };

  const updateMatchResult = (match: MatchItem, type: MarketType, optionId?: string) => {
    const matchId = normalizeSportteryMatchId(match.id);
    setMatchResults((current) => {
      const values = { ...(current[matchId]?.values ?? {}) };
      if (optionId) values[type] = optionId;
      else delete values[type];
      const exactScore = String(values.score ?? "").match(/^(\d+):(\d+)$/);
      const fullScore = exactScore
        ? { home: Number(exactScore[1]), away: Number(exactScore[2]) }
        : type === "score" ? undefined : current[matchId]?.fullScore;
      const matchHandicap = match.markets.find((market) => market.type === "rqspf")?.handicap;
      const rqspfHandicap = current[matchId]?.rqspfHandicap ?? matchHandicap;
      if (fullScore && typeof rqspfHandicap === "number") {
        values.rqspf = winningOptionId("rqspf", fullScore.home, fullScore.away, 0, 0, rqspfHandicap);
      }
      const next = { ...current };
      if (Object.keys(values).length > 0) next[matchId] = {
        matchId,
        updatedAt: new Date().toISOString(),
        source: "manual",
        values,
        ...(typeof rqspfHandicap === "number" ? { rqspfHandicap } : {}),
        ...(fullScore ? { fullScore } : {}),
      };
      else delete next[matchId];
      return next;
    });
  };

  const requestMatchResult = async (match: MatchItem) => {
    const matchId = normalizeSportteryMatchId(match.id);
    const [scorePayload, fetchedHandicap] = await Promise.all([
      fetchSportteryMatchScore(matchId),
      fetchSportteryMatchHandicap(matchId).catch(() => undefined),
    ]);
    const phase = getSportteryMatchPhaseTc(scorePayload);
    console.log("[体彩接口] 比分与比赛阶段原始数据", scorePayload);
    if (!isSportteryRegularTimeFinished(scorePayload)) return { status: "unfinished" as const, phase };
    const cachedMatch = matchesRef.current.find((item) => normalizeSportteryMatchId(item.id) === matchId);
    const cachedHandicap = cachedMatch?.markets.find((market) => market.type === "rqspf")?.handicap;
    const rqspfHandicap = fetchedHandicap ?? cachedHandicap;
    const resultMatch = {
      ...match,
      markets: match.markets.map((market) => market.type === "rqspf"
        ? { ...market, handicap: rqspfHandicap }
        : market),
    };
    const parsedResult = parseSportteryMatchScoreDetails(scorePayload, resultMatch);
    const values = parsedResult.values;
    if (Object.keys(values).length === 0) throw new Error("常规时间已结束，但比分接口暂未返回可识别比分");
    const nextResult = {
      matchId,
      updatedAt: new Date().toISOString(),
      source: "api" as const,
      values,
      ...(typeof rqspfHandicap === "number" ? { rqspfHandicap } : {}),
      fullScore: parsedResult.fullScore,
      halfScore: parsedResult.halfScore,
    };
    setMatchResults((current) => ({ ...current, [matchId]: nextResult }));
    return { status: "success" as const, valueCount: Object.keys(values).length, result: nextResult };
  };

  const fetchMatchResult = async (match: MatchItem) => {
    if (allResultsFetching || resultFetchingMatchIds.length > 0) return;
    const matchId = normalizeSportteryMatchId(match.id);
    setResultFetchingMatchIds([matchId]);
    try {
      const outcome = await requestMatchResult(match);
      if (outcome.status === "unfinished") {
        notification.warning({
          message: "比赛可能未结束",
          description: `${match.home} VS ${match.away} · 当前阶段 ${outcome.phase ?? "未知"}，常规时间尚未确认结束`,
          placement: "bottomRight",
        });
        return;
      }
      notification.success({ message: "赛果获取完成", description: `${match.home} VS ${match.away} · 已填充 ${outcome.valueCount} 个玩法`, placement: "bottomRight" });
    } catch (error) {
      notification.error({ message: "赛果获取失败", description: error instanceof Error ? error.message : "无法读取赛果接口", placement: "bottomRight" });
    } finally {
      setResultFetchingMatchIds([]);
    }
  };

  const fetchAllMatchResults = async () => {
    if (allResultsFetching || resultFetchingMatchIds.length > 0) return;
    if (resultMatches.length === 0) {
      message.info("当前没有待获取赛果的比赛");
      return;
    }
    setAllResultsFetching(true);
    let successCount = 0;
    let unfinishedCount = 0;
    let failedCount = 0;
    let firstError = "";
    try {
      for (const match of resultMatches) {
        try {
          const outcome = await requestMatchResult(match);
          if (outcome.status === "success") successCount += 1;
          else unfinishedCount += 1;
        } catch (error) {
          failedCount += 1;
          if (!firstError) firstError = error instanceof Error ? error.message : "无法读取赛果接口";
        }
      }
      const description = `共 ${resultMatches.length} 场：成功 ${successCount} 场，可能未结束 ${unfinishedCount} 场，请求失败 ${failedCount} 场${firstError ? `；首个错误：${firstError}` : ""}`;
      if (successCount > 0) notification.success({ message: "全部赛果获取完成", description, placement: "bottomRight" });
      else notification.warning({ message: "暂未获取到可用赛果", description, placement: "bottomRight" });
    } finally {
      setAllResultsFetching(false);
    }
  };

  useEffect(() => {
    if (activeView !== "betting") {
      autoResultRetryAtRef.current.clear();
      return;
    }
    if (temporaryOrder || !sportteryLoaded || sportteryLoading || sportteryRefreshing || autoResultFetchingRef.current) return;
    const candidates = groupedMatches.flatMap(([date, items]) => (
      collapsedMatchDates.includes(date) || autoCollapsedMatchDatesRef.current.has(date) ? [] : items
    )).filter((match) => {
      const matchId = normalizeSportteryMatchId(match.id);
      const retryState = autoResultRetryAtRef.current.get(matchId);
      return getMatchSaleState(match, saleNow) === "stopped"
        && !hasCompleteMatchResult(match)
        && (!retryState || retryState.nextAttemptAt <= saleNow.getTime());
    });
    if (candidates.length === 0) return;
    const queue = candidates.map((match) => {
      const matchId = normalizeSportteryMatchId(match.id);
      const retryState = autoResultRetryAtRef.current.get(matchId);
      return {
        match,
        retryCount: retryState?.retryCount ?? 0,
        retryAt: retryState?.nextAttemptAt ?? 0,
      };
    });
    autoResultFetchingRef.current = true;
    void (async () => {
      const resultUpdates: MatchItem[] = [];
      let lastRequestAt = 0;
      while (queue.length > 0) {
        const readyIndex = queue.findIndex((item) => item.retryAt <= Date.now());
        if (readyIndex < 0) break;
        const [{ match, retryCount }] = queue.splice(readyIndex, 1);
        const matchId = normalizeSportteryMatchId(match.id);
        const waitMs = Math.max(0, AUTO_RESULT_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
        if (waitMs > 0) await new Promise((resolve) => window.setTimeout(resolve, waitMs));
        setBettingResultFetchingMatchIds([matchId]);
        lastRequestAt = Date.now();
        try {
          const outcome = await requestMatchResult(match);
          if (outcome.status === "success") {
            autoResultRetryAtRef.current.delete(matchId);
            resultUpdates.push({ ...match, result: outcome.result });
          } else {
            const retryState = scheduleAutoResultRetry(retryCount, "unfinished");
            if (retryState) {
              autoResultRetryAtRef.current.set(matchId, retryState);
              queue.push({ match, retryCount: retryState.retryCount, retryAt: retryState.nextAttemptAt });
            } else {
              autoResultRetryAtRef.current.set(matchId, { retryCount, nextAttemptAt: Number.POSITIVE_INFINITY });
            }
          }
        } catch (error) {
          const retryState = scheduleAutoResultRetry(retryCount, "error");
          if (retryState) {
            autoResultRetryAtRef.current.set(matchId, retryState);
            queue.push({ match, retryCount: retryState.retryCount, retryAt: retryState.nextAttemptAt });
          } else {
            autoResultRetryAtRef.current.set(matchId, { retryCount, nextAttemptAt: Number.POSITIVE_INFINITY });
          }
          console.error("[体彩接口] 自动获取投注页赛果失败", { matchId: match.id, error });
        }
        setBettingResultFetchingMatchIds([]);
      }
      if (resultUpdates.length === 0) return;
      const resultById = new Map(resultUpdates.map((match) => [normalizeSportteryMatchId(match.id), match.result]));
      const applyResults = (current: MatchItem[]) => current.map((match) => {
        const result = resultById.get(normalizeSportteryMatchId(match.id));
        return result ? { ...match, result } : match;
      });
      const localMatches = applyResults(matchesRef.current);
      matchesRef.current = localMatches;
      setMatches(localMatches);
      saveCachedMatches(localMatches);
      try {
        const saved = await onCloudMatchesUpdate(resultUpdates);
        const savedResultById = new Map(saved.map((match) => [normalizeSportteryMatchId(match.id), match.result]));
        const persistedMatches = matchesRef.current.map((match) => {
          const result = savedResultById.get(normalizeSportteryMatchId(match.id));
          return result ? { ...match, result } : match;
        });
        matchesRef.current = persistedMatches;
        setMatches(persistedMatches);
        saveCachedMatches(persistedMatches);
      } catch (error) {
        console.error("[比赛接口] 自动赛果批量保存失败", error);
        notification.error({
          message: "赛果保存失败",
          description: error instanceof Error ? error.message : "已取得赛果，但暂时无法保存到云端",
          placement: "bottomRight",
        });
      }
    })().finally(() => {
      autoResultFetchingRef.current = false;
      setBettingResultFetchingMatchIds([]);
    });
  }, [
    activeView,
    collapsedMatchDates,
    groupedMatches,
    notification,
    onCloudMatchesUpdate,
    saleNow,
    sportteryLoaded,
    sportteryLoading,
    sportteryRefreshing,
    temporaryOrder,
  ]);

  const judgeVisibleOrders = async () => {
    if (judgingOrders) return;
    if (filteredSavedSlips.length === 0 || resultMatches.length === 0) {
      message.info("当前筛选订单中没有待判断比赛");
      return;
    }
    const availableResultCount = resultMatches.filter((match) => Object.keys(matchResults[normalizeSportteryMatchId(match.id)]?.values ?? {}).length > 0).length;
    if (availableResultCount === 0) {
      message.warning("请先填写或获取赛果");
      return;
    }
    const updatedOrders = judgeLoadedOrdersWithResults(filteredSavedSlips, matchResults);
    if (updatedOrders.length === 0) {
      message.info("当前筛选订单没有需要按现有赛果更新的内容");
      return;
    }
    setJudgingOrders(true);
    try {
      const committedOrders = await commitOrderMutation({ upsertOrders: updatedOrders, deleteOrderIds: [], operation: "judge" });
      if (!committedOrders) return;
      if (orderDetail) {
        const updatedDetail = committedOrders.find((slip) => slip === orderDetail || Boolean(orderDetail.id && slip.id === orderDetail.id));
        if (updatedDetail) {
          setOrderDetail(updatedDetail);
          setOrderHits(cloneHits(updatedDetail.hits));
          setOrderFailedMatches([...(updatedDetail.failedMatches ?? [])]);
        }
      }
      const failedOrders = updatedOrders.filter(isOrderFailed).length;
      notification.success({ message: "订单判断完成", description: `已更新 ${updatedOrders.length} 个当前筛选且需要判断的订单${failedOrders ? `，其中 ${failedOrders} 个订单已不符合串关条件` : ""}`, placement: "bottomRight" });
    } finally {
      setJudgingOrders(false);
    }
  };

  const updateOrderOptionOdds = (matchId: string, type: MarketType, optionId: string, odds: number) => {
    setOrderEditMatches((current) => current.map((match) => match.id !== matchId ? match : {
      ...match,
      markets: match.markets.map((market) => market.type !== type ? market : {
        ...market,
        options: market.options.map((option) => option.id === optionId ? { ...option, odds } : option),
      }),
    }));
  };

  const saveOrderEdits = async () => {
    if (orderEditSaving) return;
    if (!editingOrder) return;
    const nextName = orderEditName.trim();
    if (!nextName) {
      message.warning("请输入订单名称");
      return;
    }
    const nextTime = dayjs(orderEditTime);
    if (!nextTime.isValid()) {
      message.warning("请选择有效的订单创建时间");
      return;
    }
    const wagerFrozen = Boolean(editingOrder.settledAt || isOrderPaid(editingOrder));
    const nextPasses = wagerFrozen
      ? [...editingOrder.passes]
      : [...new Set(orderEditPasses)].sort((left, right) => left - right);
    if (!wagerFrozen && selectedMatches(orderEditMatches).length > 0 && nextPasses.length === 0) {
      message.warning("请至少选择一种串关方式");
      return;
    }
    const hasInvalidOdds = !wagerFrozen && selectedMatches(orderEditMatches).some((match) => match.markets.some((market) => market.options.some((option) => option.selected && option.odds <= 0)));
    if (hasInvalidOdds) {
      message.warning("请为所有已选项填写大于 0 的倍率");
      return;
    }
    const updated: SavedSlip = {
      ...editingOrder,
      id: editingOrder.id || createSlipId(),
      name: nextName,
      savedAt: nextTime.millisecond(0).toISOString(),
      matches: wagerFrozen ? cloneMatches(editingOrder.matches) : cloneMatches(orderEditMatches),
      passes: nextPasses,
      multiple: wagerFrozen ? editingOrder.multiple : orderEditMultiple,
      oddsLocked: Boolean(wagerFrozen || orderEditOddsLocked),
    };
    const sameOrder = (slip: SavedSlip) => slip === editingOrder || Boolean(editingOrder.id && slip.id === editingOrder.id);
    setOrderEditSaving(true);
    try {
      const committedOrders = await commitOrderMutation({ upsertOrders: [updated], deleteOrderIds: [] });
      if (!committedOrders) return;
      const committedOrder = committedOrders.find((slip) => slip.id === updated.id) ?? updated;
      if (orderDetail && sameOrder(orderDetail)) setOrderDetail(committedOrder);
      if (temporaryOrder?.id === committedOrder.id) {
        setMatches(cloneMatches(committedOrder.matches));
        setPasses([...committedOrder.passes]);
        setMultiple(committedOrder.multiple);
        setTemporaryOrder({ id: committedOrder.id!, name: committedOrder.name });
      }
      closeOrderEditor();
      notification.success({ message: "订单已更新", description: `已保存“${committedOrder.name}”的${wagerFrozen ? "名称和时间" : "名称、时间、投注倍数、串关和赔率"}`, placement: "bottomRight" });
    } finally {
      setOrderEditSaving(false);
    }
  };

  const payOrders = async (targets: SavedSlip[]) => {
    const payableTargets = targets.filter((target) => savedSlips.includes(target) && !target.settledAt && !isOrderPaid(target));
    const payableKeys = payableTargets.map(orderActionKey);
    if (payableTargets.length === 0 || payableKeys.some((key) => payingOrderIds.includes(key))) return;
    setPayingOrderIds((current) => [...new Set([...current, ...payableKeys])]);
    let matchedOptionCount = 0;
    let changedOptionCount = 0;
    let unmatchedOptionCount = 0;
    let refreshError = "";
    try {
      let latestMatches: MatchItem[] = [];
      try {
        latestMatches = convertSportteryMatches(await fetchSportteryMatchCalculator());
      } catch (error) {
        refreshError = error instanceof Error ? error.message : "无法连接体彩比赛接口";
      }
      const paidOrders = payableTargets.map((target) => {
        const refreshed = refreshSelectedOdds(target.matches, latestMatches);
        matchedOptionCount += refreshed.matchedOptionCount;
        changedOptionCount += refreshed.changedOptionCount;
        unmatchedOptionCount += refreshed.unmatchedOptionCount;
        return {
          ...target,
          matches: refreshed.matches,
          paymentStatus: "paid" as const,
          oddsLocked: true,
        };
      });
      const committedOrders = await commitOrderMutation({
        upsertOrders: paidOrders,
        deleteOrderIds: [],
        operation: "pay",
      });
      if (!committedOrders) return;
      if (isGuestMode) {
        const paidStake = payableTargets.reduce((total, order) => total + calculateStake(order.matches, order.passes, order.multiple), 0);
        setExpenseTotal((current) => current + paidStake);
      }
      if (orderDetail?.id) {
        const committedDetail = committedOrders.find((slip) => slip.id === orderDetail.id);
        if (committedDetail) setOrderDetail(committedDetail);
      }
      setBulkPayPopoverOpen(false);
      notification.success({
        message: payableTargets.length === 1 ? "订单支付完成" : `${payableTargets.length} 个订单支付完成`,
        description: `匹配 ${matchedOptionCount} 个投注项，更新 ${changedOptionCount} 项倍率，${unmatchedOptionCount} 项无法取得最新有效倍率并保留原值${refreshError ? `；接口异常：${refreshError}` : ""}；全部订单已锁定倍率`,
        placement: "bottomRight",
      });
    } finally {
      setPayingOrderIds((current) => current.filter((key) => !payableKeys.includes(key)));
    }
  };

  const settleOrders = async (targets: SavedSlip[]) => {
    const targetKeys = targets.map(orderActionKey);
    if (targetKeys.some((key) => settlingOrderIds.includes(key))) return;
    const settleableTargets = targets.filter((target) => savedSlips.includes(target) && isOrderSettleable(target));
    if (settleableTargets.length === 0) return;
    const settleableTargetKeys = settleableTargets.map(orderActionKey);
    const settledAt = new Date().toISOString();
    const settlementIdBase = Date.now();
    const settledOrders = new Map(settleableTargets.map((target, index) => {
      const settledPrize = calculateCurrentPrize(target.matches, target.passes, target.multiple, target.hits ?? {});
      return [target, {
        ...target,
        id: target.id || String(settlementIdBase + index),
        settledAt,
        settledPrize,
        oddsLockedBeforeSettlement: Boolean(target.oddsLocked),
        oddsLocked: true,
      } satisfies SavedSlip] as const;
    }));
    const settledPrizeTotal = [...settledOrders.values()].reduce((total, slip) => total + (slip.settledPrize ?? 0), 0);
    setSettlingOrderIds((current) => [...new Set([...current, ...settleableTargetKeys])]);
    try {
      const committedOrders = await commitOrderMutation({ upsertOrders: [...settledOrders.values()], deleteOrderIds: [], operation: "settle" });
      if (!committedOrders) return;
      setBulkSettlePopoverOpen(false);
      if (isGuestMode) setIncomeTotal((current) => current + settledPrizeTotal);
      const settledDetail = orderDetail?.id
        ? committedOrders.find((slip) => slip.id === orderDetail.id)
        : undefined;
      if (settledDetail) setOrderDetail(settledDetail);
      if (temporaryOrder && [...settledOrders.values()].some((slip) => slip.id === temporaryOrder.id)) restoreSavedMatches();
      notification.success({
        message: settleableTargets.length === 1 ? "订单结账完成" : `${settleableTargets.length} 个订单结账完成`,
        description: settledPrizeTotal > 0 ? `中奖奖金 ¥${currency(settledPrizeTotal)} 已计入累计收入` : "中奖金额为 ¥0.00，订单已锁定",
        placement: "bottomRight",
      });
    } finally {
      setSettlingOrderIds((current) => current.filter((key) => !settleableTargetKeys.includes(key)));
    }
  };

  const withdrawOrderSettlement = async (target: SavedSlip) => {
    const targetKey = orderActionKey(target);
    if (withdrawingOrderIds.includes(targetKey)) return;
    if (!target.settledAt || !savedSlips.includes(target)) return;
    const withdrawn: SavedSlip = {
      ...target,
      settledAt: undefined,
      settledPrize: undefined,
      oddsLocked: target.oddsLockedBeforeSettlement ?? false,
      oddsLockedBeforeSettlement: undefined,
    };
    setWithdrawingOrderIds((current) => [...new Set([...current, targetKey])]);
    try {
      const committedOrders = await commitOrderMutation({ upsertOrders: [withdrawn], deleteOrderIds: [] });
      if (!committedOrders) return;
      const committedOrder = committedOrders.find((slip) => slip.id === withdrawn.id) ?? withdrawn;
      if (isGuestMode) setIncomeTotal((current) => Math.max(0, current - (target.settledPrize ?? 0)));
      if (orderDetail === target) setOrderDetail(committedOrder);
      notification.success({
        message: "结账已撤回",
        description: `订单已恢复为未结账状态，累计收入已扣除 ¥${currency(target.settledPrize ?? 0)}`,
        placement: "bottomRight",
      });
    } finally {
      setWithdrawingOrderIds((current) => current.filter((key) => key !== targetKey));
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const downloadJson = (payload: object, filename: string) => {
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), filename);
  };

  const exportEditingOrder = () => {
    if (!editingOrder) return;
    const text = formatManualOrderText(orderEditMatches);
    if (!text) {
      message.warning("当前订单没有可导出的已选比赛");
      return;
    }
    const filename = (orderEditName.trim() || editingOrder.name || "订单").replace(/[\\/:*?"<>|]/g, "-");
    downloadBlob(new Blob([`\uFEFF${text}`], { type: "text/plain;charset=utf-8" }), `${filename}.txt`);
    message.success("订单已按手动添加格式导出");
  };

  const saveRepositoryPage = () => {
    const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="refresh" content="0; url=${CLOUD_APP_URL}" />
    <title>打开 SMGR</title>
  </head>
  <body>
    <p>正在打开 SMGR……</p>
    <p><a href="${CLOUD_APP_URL}">如果没有自动跳转，请点击这里</a></p>
    <script>window.location.replace(${JSON.stringify(CLOUD_APP_URL)});</script>
  </body>
</html>
`;
    downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), "SMGR.html");
    message.success("页面已保存，打开 HTML 文件即可进入在线正式版");
  };

  const exportData = (mode: DataTransferMode) => {
    const exportedAt = new Date().toISOString();
    const cachedMatches = loadCachedMatches();
    const data = mode === "orders"
      ? { orders: JSON.parse(JSON.stringify(savedSlips)) as SavedSlip[] }
      : mode === "settings"
        ? { settings: normalizeAppSettings(appSettings) }
        : mode === "matches"
          ? { matches: cachedMatches }
        : {
            orders: JSON.parse(JSON.stringify(savedSlips)) as SavedSlip[],
            settings: normalizeAppSettings(appSettings),
            finance: { expenseTotal, incomeTotal },
            matches: cachedMatches,
          };
    const payload = {
      version: 5,
      kind: mode,
      exportedAt,
      data,
    };
    const label = mode === "orders" ? "订单" : mode === "settings" ? "设置" : mode === "matches" ? "比赛数据" : "完整数据";
    downloadJson(payload, `SMGR-${label}-${exportedAt.slice(0, 10)}.json`);
    notification.success({
      message: `${label}导出完成`,
      description: mode === "orders"
        ? `已导出 ${savedSlips.length} 个订单`
        : mode === "settings"
          ? "已导出当前应用设置"
          : mode === "matches"
            ? `已导出 ${cachedMatches.length} 场比赛`
            : `已导出 ${savedSlips.length} 个订单、${cachedMatches.length} 场比赛、设置与账本`,
      placement: "bottomRight",
    });
  };

  const importDataJson = async (file: File, mode: DataTransferMode, strategy: ImportStrategy) => {
    try {
      if (mode === "matches" && !cloudAccount) {
        throw new Error("请先登录账号或进入游客 Demo");
      }
      if (file.size > 20 * 1024 * 1024) throw new Error("JSON 文件不能超过 20 MB");
      const rawPayload = JSON.parse(await file.text()) as unknown;
      if (!rawPayload || typeof rawPayload !== "object") throw new Error("JSON 文件内容无效");
      const payload = rawPayload as Record<string, unknown>;
      const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : payload;

      if (mode === "settings") {
        if (!data.settings || typeof data.settings !== "object") throw new Error("文件中缺少 settings 对象");
        const nextSettings = persistAppSettings(strategy === "merge"
          ? unionAppSettings(appSettings, data.settings)
          : normalizeAppSettings(data.settings));
        setAppSettings(nextSettings);
        notification.success({
          message: strategy === "merge" ? "设置合并完成" : "设置覆盖完成",
          description: strategy === "merge" ? "已用 JSON 颜色更新冲突项，并保留文件缺少的现有颜色" : "联赛标签颜色已替换",
          placement: "bottomRight",
        });
        return;
      }

      const prepareMatches = (matchStrategy: ImportStrategy) => {
        const rawMatches = data.matches;
        if (!Array.isArray(rawMatches)) throw new Error("文件中缺少 matches 数组");
        if (!rawMatches.every(isExportedMatch)) throw new Error("比赛数据结构与导出格式不一致");
        const incomingMatches = JSON.parse(JSON.stringify(rawMatches)) as MatchItem[];
        const currentMatches = temporaryOrder ? loadCachedMatches() : matchesRef.current;
        return matchStrategy === "merge"
          ? unionSportteryMatchCache(currentMatches, incomingMatches, new Date())
          : mergeSportteryMatchCache([], incomingMatches, new Date());
      };

      const applyMatches = (restoredMatches: MatchItem[]) => {
        saveCachedMatches(restoredMatches);
        onCloudMatchesChange(restoredMatches);
        matchesRef.current = restoredMatches;
        if (!temporaryOrder) setMatches(restoredMatches);
        setMatchDates(cachedMatchDates(restoredMatches));
        setLeagueOptions(cachedLeagueOptions(restoredMatches));
      };

      if (mode === "matches") {
        const restoredMatches = prepareMatches(strategy);
        applyMatches(restoredMatches);
        notification.success({
          message: strategy === "merge" ? "比赛数据合并完成" : "比赛数据覆盖完成",
          description: `当前共有 ${restoredMatches.length} 场 5 天内比赛`,
          placement: "bottomRight",
        });
        return;
      }

      const rawOrders = data.orders;
      if (!Array.isArray(rawOrders)) throw new Error("文件中缺少 orders 数组");
      if (!rawOrders.every(isExportedOrder)) throw new Error("订单数据结构与导出格式不一致");
      const importKey = createSlipId();
      const incomingOrders = (JSON.parse(JSON.stringify(rawOrders)) as SavedSlip[]).map((order, index) => ({ ...order, id: order.id || `${importKey}-${index}` }));
      const currentOrdersById = new Map(savedSlips.flatMap((order) => order.id ? [[order.id, order] as const] : []));
      const withCurrentOrderVersions = (orders: SavedSlip[]) => orders.map((order) => {
        const currentOrder = order.id ? currentOrdersById.get(order.id) : undefined;
        return currentOrder?.updatedAt && !order.updatedAt ? { ...order, updatedAt: currentOrder.updatedAt } : order;
      });

      if (mode === "full") {
        if (!data.settings || typeof data.settings !== "object") throw new Error("完整数据中缺少 settings 对象");
        const finance = data.finance && typeof data.finance === "object" ? data.finance as Record<string, unknown> : null;
        const importedExpense = Number(finance?.expenseTotal);
        const importedIncome = Number(finance?.incomeTotal);
        if (!finance || !Number.isFinite(importedExpense) || !Number.isFinite(importedIncome) || importedExpense < 0 || importedIncome < 0) {
          throw new Error("完整数据中的 finance 账本无效");
        }
        const orderMerge = unionSavedOrders(savedSlips, incomingOrders);
        const restoredOrders = withCurrentOrderVersions(strategy === "merge" ? orderMerge.nextOrders : sortSavedOrders(incomingOrders));
        const restoredSettings = strategy === "merge"
          ? unionAppSettings(appSettings, data.settings)
          : normalizeAppSettings(data.settings);
        const canImportMatches = Boolean(cloudAccount);
        const rawMatches = data.matches;
        if (canImportMatches && (!Array.isArray(rawMatches) || !rawMatches.every(isExportedMatch))) throw new Error("完整数据中的 matches 比赛数据无效");
        const restoredMatches = canImportMatches ? prepareMatches(strategy) : loadCachedMatches();
        const nextExpense = strategy === "merge" ? Math.max(0, expenseTotal + orderMerge.expenseDelta) : importedExpense;
        const nextIncome = strategy === "merge" ? Math.max(0, incomeTotal + orderMerge.incomeDelta) : importedIncome;
        modal.confirm({
          title: strategy === "merge" ? "新增完整数据？" : "覆盖完整数据？",
          content: strategy === "merge"
            ? `将新增 ${orderMerge.added} 个、更新 ${orderMerge.updated} 个订单，并以 JSON 数据更新设置${canImportMatches ? isGuestMode ? "与本地比赛" : "与公共比赛" : ""}；文件缺项继续使用现有数据。`
            : `将覆盖当前${isGuestMode ? "游客" : "账号"}的订单、设置和账本，恢复 ${restoredOrders.length} 个订单${canImportMatches ? `与 ${restoredMatches.length} 场${isGuestMode ? "本地" : "公共"}比赛` : "；比赛保持不变"}。`,
          okText: strategy === "merge" ? "新增合并" : "覆盖恢复",
          cancelText: "取消",
          okButtonProps: { danger: strategy === "replace" },
          onOk: async () => {
            const restoredOrderIds = new Set(restoredOrders.flatMap((order) => order.id ? [order.id] : []));
            const incomingOrderIds = new Set(incomingOrders.flatMap((order) => order.id ? [order.id] : []));
            const committedOrders = await commitOrderMutation({
              upsertOrders: strategy === "merge"
                ? restoredOrders.filter((order) => Boolean(order.id && incomingOrderIds.has(order.id)))
                : restoredOrders,
              deleteOrderIds: strategy === "replace"
                ? savedSlips.flatMap((order) => order.id && !restoredOrderIds.has(order.id) ? [order.id] : [])
                : [],
            });
            if (!committedOrders) throw new Error("订单同步失败");
            setAppSettings(persistAppSettings(restoredSettings));
            if (isGuestMode) {
              setExpenseTotal(nextExpense);
              setIncomeTotal(nextIncome);
            }
            if (canImportMatches) applyMatches(restoredMatches);
            notification.success({
              message: strategy === "merge" ? "完整数据合并完成" : "完整数据覆盖完成",
              description: strategy === "merge"
                ? `新增 ${orderMerge.added} 个、更新 ${orderMerge.updated} 个订单，当前${isGuestMode ? "游客" : "账号"}共有 ${restoredOrders.length} 个订单`
                : `已恢复当前${isGuestMode ? "游客" : "账号"}的 ${restoredOrders.length} 个订单、设置与账本${canImportMatches ? `，并更新 ${restoredMatches.length} 场${isGuestMode ? "本地" : "公共"}比赛` : ""}`,
              placement: "bottomRight",
            });
          },
        });
        return;
      }

      if (strategy === "merge") {
        const { nextOrders, added, updated, expenseDelta, incomeDelta } = unionSavedOrders(savedSlips, incomingOrders);
        const incomingOrderIds = new Set(incomingOrders.flatMap((order) => order.id ? [order.id] : []));
        const committedOrders = await commitOrderMutation({
          upsertOrders: withCurrentOrderVersions(nextOrders.filter((order) => Boolean(order.id && incomingOrderIds.has(order.id)))),
          deleteOrderIds: [],
        });
        if (!committedOrders) return;
        if (isGuestMode) {
          setExpenseTotal((current) => Math.max(0, current + expenseDelta));
          setIncomeTotal((current) => Math.max(0, current + incomeDelta));
        }
        notification.success({ message: "订单合并完成", description: `新增 ${added} 个，更新 ${updated} 个同 ID 订单`, placement: "bottomRight" });
        return;
      }

      const restoredOrders = withCurrentOrderVersions(sortSavedOrders(incomingOrders));
      const currentTotals = orderLedgerTotals(savedSlips);
      const restoredTotals = orderLedgerTotals(restoredOrders);
      const restoredOrderIds = new Set(restoredOrders.flatMap((order) => order.id ? [order.id] : []));
      const committedOrders = await commitOrderMutation({
        upsertOrders: restoredOrders,
        deleteOrderIds: savedSlips.flatMap((order) => order.id && !restoredOrderIds.has(order.id) ? [order.id] : []),
      });
      if (!committedOrders) return;
      if (isGuestMode) {
        setExpenseTotal((current) => Math.max(0, current - currentTotals.expense + restoredTotals.expense));
        setIncomeTotal((current) => Math.max(0, current - currentTotals.income + restoredTotals.income));
      }
      notification.success({ message: "订单覆盖完成", description: `已恢复 ${restoredOrders.length} 个订单`, placement: "bottomRight" });
    } catch (error) {
      notification.error({
        message: "JSON 导入失败",
        description: error instanceof Error ? error.message : "无法读取该文件",
        placement: "bottomRight",
      });
    }
  };

  const toggleHit = (matchId: string, type: MarketType, optionId: string) => {
    setHits((current) => {
      const previous = current[matchId]?.[type];
      return {
        ...current,
        [matchId]: { ...current[matchId], [type]: previous === optionId ? undefined : optionId },
      };
    });
  };

  const clearCurrentSelections = () => {
    if (pickedCount === 0) return;
    clearPredictionSelections();
    message.success("已清空当前选择，比赛数据保留");
  };

  const unlockExpenseEditor = () => {
    setExpenseDraft(isCloudMode ? expenseCorrection : expenseTotal);
    setExpenseEditing(true);
  };

  const unlockIncomeEditor = () => {
    setIncomeDraft(isCloudMode ? incomeCorrection : incomeTotal);
    setIncomeEditing(true);
  };

  const saveExpenseCorrection = async () => {
    if (expenseSaving) return;
    const next = Number(expenseDraft || 0);
    if (!Number.isFinite(next)) {
      message.error("支出纠错值无效");
      return;
    }
    if (isCloudMode) {
      setExpenseSaving(true);
      try {
        const finance = await onCloudFinanceCorrectionChange({ expenseCorrection: next, incomeCorrection });
        applyCloudFinance(finance);
        setExpenseEditing(false);
        message.success("支出纠错值已保存");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "支出纠错值保存失败");
      } finally {
        setExpenseSaving(false);
      }
      return;
    }
    setExpenseSaving(true);
    setExpenseTotal(Math.max(0, next));
    setExpenseEditing(false);
    setExpenseSaving(false);
    message.success("累计支出已保存并锁定");
  };

  const saveIncomeCorrection = async () => {
    if (incomeSaving) return;
    const next = Number(incomeDraft || 0);
    if (!Number.isFinite(next)) {
      message.error("收入纠错值无效");
      return;
    }
    if (isCloudMode) {
      setIncomeSaving(true);
      try {
        const finance = await onCloudFinanceCorrectionChange({ expenseCorrection, incomeCorrection: next });
        applyCloudFinance(finance);
        setIncomeEditing(false);
        message.success("收入纠错值已保存");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "收入纠错值保存失败");
      } finally {
        setIncomeSaving(false);
      }
      return;
    }
    setIncomeSaving(true);
    setIncomeTotal(Math.max(0, next));
    setIncomeEditing(false);
    setIncomeSaving(false);
    message.success("累计收入已保存并锁定");
  };

  const toggleLeagueFilter = (leagueName: string) => {
    setSelectedLeagueNames((current) => current.includes(leagueName)
      ? current.filter((item) => item !== leagueName)
      : [...current, leagueName]);
  };

  const clearMatchFilters = () => {
    setSelectedMatchDate(null);
    setSelectedLeagueNames([]);
    setMatchSaleFilter("all");
  };

  const toggleMatchDateCollapsed = (date: string) => {
    autoCollapsedMatchDatesRef.current.delete(date);
    setCollapsedMatchDates((current) => {
      const collapsed = current.includes(date);
      if (!collapsed) {
        filteredMatches.filter((match) => match.date === date).forEach((match) => {
          autoResultRetryAtRef.current.delete(normalizeSportteryMatchId(match.id));
        });
      }
      return collapsed ? current.filter((item) => item !== date) : [...current, date];
    });
  };

  const copyMatchesForDate = async (date: string, dateMatches: MatchItem[]) => {
    const content = [date, ...dateMatches.map((match) => `${match.home} vs ${match.away}`)].join("\n");
    try {
      await navigator.clipboard.writeText(content);
      message.success(`已复制 ${date} 的 ${dateMatches.length} 场比赛`);
    } catch {
      message.error("复制失败，请检查浏览器剪贴板权限");
    }
  };

  const updateLeagueTagColor = (leagueName: string, color: string) => {
    setAppSettings((current) => {
      const next = persistAppSettings(withLeagueTagColor(current, leagueName, color));
      return next;
    });
    notification.success({ message: "联赛颜色已保存", description: `${leagueColorSettingKey(leagueName)} · ${color.toUpperCase()}`, placement: "bottomRight" });
  };

  const resetLeagueTagColors = () => {
    const next = persistAppSettings(createDefaultSettings());
    setAppSettings(next);
    notification.success({ message: "联赛颜色已恢复默认", placement: "bottomRight" });
  };

  const startNewTeamNameGroup = () => {
    if (teamNameEditor) return;
    setTeamNameEditor({
      names: [
        { name: "", activeSlot: 1 },
        { name: "", activeSlot: 2 },
      ],
    });
  };

  const editTeamNameGroup = (group: TeamNameGroup) => {
    setTeamNameEditor({
      id: group.id,
      expectedRevision: group.revision,
      names: group.names.map(({ id, name, activeSlot }) => ({ id, name, activeSlot })),
    });
  };

  const teamNameDraftError = (draft: TeamNameGroupDraft) => {
    if (draft.names.length < 2) return "每个队伍至少需要两个名称";
    const keys = draft.names.map((entry) => normalizeTeamName(entry.name));
    if (keys.some((key) => !key)) return "队伍名称不能为空";
    if (new Set(keys).size !== keys.length) return "同一队伍中不能填写重复名称";
    const activeSlots = draft.names.flatMap((entry) => entry.activeSlot === null ? [] : [entry.activeSlot]);
    if (activeSlots.length !== 2 || new Set(activeSlots).size !== 2) return "请恰好激活两个名称";
    return null;
  };

  const saveTeamNameEditor = async () => {
    if (!teamNameEditor || teamNameSaving) return;
    const validationError = teamNameDraftError(teamNameEditor);
    if (validationError) {
      message.error(validationError);
      return;
    }
    setTeamNameSaving(true);
    try {
      await onTeamNameGroupSave(teamNameEditor);
      setTeamNameEditor(null);
      notification.success({ message: "队伍名称已保存", placement: "bottomRight" });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "队伍名称保存失败");
    } finally {
      setTeamNameSaving(false);
    }
  };

  const removeTeamNameGroup = async (group: TeamNameGroup) => {
    if (teamNameDeletingId) return;
    setTeamNameDeletingId(group.id);
    try {
      await onTeamNameGroupDelete(group);
      if (teamNameEditor?.id === group.id) setTeamNameEditor(null);
      notification.success({ message: "队伍名称组已删除", placement: "bottomRight" });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "队伍名称删除失败");
    } finally {
      setTeamNameDeletingId(null);
    }
  };

  const importMenu = (
    <div className="data-popover-menu">
      <div className="data-popover-heading"><b>导入数据</b><span>先选择导入方式，再选择 JSON 文件内容</span></div>
      <Segmented
        className="data-import-strategy"
        block
        value={importStrategy}
        onChange={(value) => setImportStrategy(value as ImportStrategy)}
        options={[
          { label: "新增合并", value: "merge" },
          { label: "覆盖恢复", value: "replace" },
        ]}
      />
      {([
        ["orders", "导入订单", importStrategy === "merge" ? "同 ID 用 JSON 更新，文件缺项保留本地值" : "用 JSON 订单替换本地订单"],
        ["settings", "导入设置", importStrategy === "merge" ? "同联赛用 JSON 更新，文件缺项保留本地值" : "用 JSON 设置替换本地设置"],
        ["matches", isGuestMode ? "导入本地比赛数据" : "导入公共比赛数据",
          importStrategy === "merge"
            ? `同场用 JSON 更新，缺少的玩法与倍率保留${isGuestMode ? "本地" : "云端"}值`
            : `用 JSON 比赛替换${isGuestMode ? "当前浏览器" : "所有账号"}的比赛数据`],
        ["full", "导入完整数据",
          importStrategy === "merge"
            ? `JSON 值优先更新，文件缺项保留${isGuestMode ? "本地" : "云端"}值`
            : `覆盖当前${isGuestMode ? "游客" : "账号"}数据与${isGuestMode ? "本地" : "公共"}比赛`],
      ] as const).map(([mode, title, description]) => {
        const disabled = mode === "matches" && !cloudAccount;
        return (
          <Upload
            key={mode}
            accept=".json,application/json"
            disabled={disabled}
            showUploadList={false}
            beforeUpload={(file) => { void importDataJson(file, mode, importStrategy); return Upload.LIST_IGNORE; }}
          >
            <Button type="text" block disabled={disabled}><span><b>{title}</b><small>{description}</small></span><RightOutlined /></Button>
          </Upload>
        );
      })}
    </div>
  );

  const exportMenu = (
    <div className="data-popover-menu">
      <div className="data-popover-heading"><b>导出数据</b><span>可分别备份订单、比赛与设置</span></div>
      <Button type="text" block disabled={savedSlips.length === 0} onClick={() => exportData("orders")}><span><b>导出订单</b><small>{savedSlips.length} 个{isGuestMode ? "本地" : "云端"}订单</small></span><DownloadOutlined /></Button>
      <Button type="text" block onClick={() => exportData("settings")}><span><b>导出设置</b><small>联赛颜色等应用设置</small></span><DownloadOutlined /></Button>
      <Button type="text" block onClick={() => exportData("matches")}><span><b>导出比赛数据</b><small>7 天内比赛缓存</small></span><DownloadOutlined /></Button>
      <Button type="text" block onClick={() => exportData("full")}><span><b>导出完整数据</b><small>订单、比赛、设置与收支账本</small></span><DownloadOutlined /></Button>
    </div>
  );

  const bulkPayStake = filteredPayableOrders.reduce(
    (total, order) => total + calculateStake(order.matches, order.passes, order.multiple),
    0,
  );
  const bulkSettlePrize = filteredSettleableOrders.reduce(
    (total, order) => total + calculateCurrentPrize(order.matches, order.passes, order.multiple, order.hits ?? {}),
    0,
  );
  const bulkSettleSuccessCount = filteredSettleableOrders.filter((order) => getOrderStatus(order) === "success").length;
  const bulkSettleFailedCount = filteredSettleableOrders.length - bulkSettleSuccessCount;
  const editingOrderWagerFrozen = Boolean(editingOrder && (editingOrder.settledAt || isOrderPaid(editingOrder)));
  const bulkPayContent = (
    <div className="bulk-action-popover">
      <b>确认一键支付？</b>
      <p>仅处理当前筛选结果中的未支付订单。</p>
      <div><span>订单数量</span><strong>{filteredPayableOrders.length} 个</strong></div>
      <div><span>支付金额</span><strong>¥{currency(bulkPayStake)}</strong></div>
      <small>支付前会更新倍率；无法取得最新有效倍率的投注项保留原值。支付后投注内容与倍率全部冻结。</small>
      <Space>
        <Button size="small" onClick={() => setBulkPayPopoverOpen(false)}>取消</Button>
        <Button size="small" type="primary" loading={payingOrderIds.length > 0} onClick={() => { void payOrders(filteredPayableOrders); }}>确认支付</Button>
      </Space>
    </div>
  );
  const bulkSettleContent = (
    <div className="bulk-action-popover">
      <b>确认一键结账？</b>
      <p>仅处理当前筛选结果中已支付、未结账且已有判断结果的订单。</p>
      <div><span>订单数量</span><strong>{filteredSettleableOrders.length} 个</strong></div>
      <div><span>成功 / 失败</span><strong>{bulkSettleSuccessCount} / {bulkSettleFailedCount}</strong></div>
      <div><span>预计计入收入</span><strong>¥{currency(bulkSettlePrize)}</strong></div>
      <Space>
        <Button size="small" onClick={() => setBulkSettlePopoverOpen(false)}>取消</Button>
        <Button size="small" type="primary" loading={settlingOrderIds.length > 0} onClick={() => { void settleOrders(filteredSettleableOrders); }}>确认结账</Button>
      </Space>
    </div>
  );

  return (
    <div className="football-app">
      <AppShellHeader
        activeView={activeView}
        cloudAccount={cloudAccount}
        cloudSyncStatus={cloudSyncStatus}
        headerRef={headerRef}
        isGuestMode={isGuestMode}
        unsettledOrderCount={unsettledOrderCount}
        onAddOrder={openManualOrder}
        onLogout={onLogout}
        onNavigate={navigateToView}
        onRequireAccount={() => onRequireAccount()}
        onSavePage={saveRepositoryPage}
      />

      {activeView === "betting" ? <main className="page-shell">
        <section className="main-column">
          {temporaryOrder && (
            <div className="temporary-order-banner">
              <div><Tag color="purple">订单临时投注</Tag><b>{temporaryOrder.name}</b><span>这里展示订单快照，不会改动官方比赛列表。</span></div>
              <Button icon={<RollbackOutlined />} onClick={restoreSavedMatches}>返回官方比赛</Button>
            </div>
          )}
          <div className="section-heading">
            <div><span className="eyebrow">MATCH CENTER</span><h2>比赛与预测</h2><p>默认展示胜平负和让球胜平负，点击更多玩法可选择比分、进球数与半全场。</p></div>
            <Space wrap>
              <Tag color="cyan">显示 {filteredMatches.length} / 共 {matches.length} 场</Tag>
              <Tag color={pickedCount ? "red" : "default"}>{pickedCount} 个选项</Tag>
              {bettingResultFetchingMatchIds.length > 0 && <Tag color="processing">正在获取 {bettingResultFetchingMatchIds.length} 场赛果</Tag>}
            </Space>
          </div>
          <div className="match-toolbar">
            <div className="match-filter-row match-date-control">
              <span>比赛日期</span>
              <div className="match-date-filters">
                <DatePicker
                  allowClear
                  classNames={RESPONSIVE_DATE_PICKER_CLASS_NAMES}
                  format="YYYY-MM-DD"
                  inputReadOnly={isMobileViewport}
                  placeholder="全部日期"
                  value={selectedMatchDate ? dayjs(selectedMatchDate) : null}
                  disabled={sportteryLoading}
                  disabledDate={(date) => !availableMatchDateSet.has(date.format("YYYY-MM-DD"))}
                  onChange={(date) => setSelectedMatchDate(date?.format("YYYY-MM-DD") ?? null)}
                />
                <Select
                  className="match-sale-filter"
                  aria-label="比赛销售状态"
                  value={matchSaleFilter}
                  options={MATCH_SALE_FILTER_OPTIONS}
                  disabled={Boolean(temporaryOrder) || sportteryLoading}
                  onChange={setMatchSaleFilter}
                />
              </div>
              <Button
                className="match-refresh-button"
                icon={<ReloadOutlined />}
                loading={sportteryLoading || sportteryRefreshing}
                disabled={Boolean(temporaryOrder) || sportteryLoading || sportteryRefreshing}
                onClick={() => { void refreshSportteryData(); }}
              >{sportteryLoading ? "加载中" : "刷新数据"}</Button>
            </div>
            <div className="match-filter-row league-filter-control">
              <span className="match-filter-label">比赛类型<small>不选则不限</small></span>
              <div className="league-filter-tags">
                {availableLeagueOptions.map((league) => {
                  const selected = selectedLeagueSet.has(league.leagueNameAbbr);
                  const leagueColor = getLeagueTagColor(appSettings, league.leagueNameAbbr);
                  return (
                    <Tag
                      key={league.leagueId}
                      color={leagueColor}
                      variant={selected ? "solid" : "outlined"}
                      style={selected ? { color: readableTagTextColor(leagueColor) } : undefined}
	                      role="button"
	                      aria-pressed={selected}
	                      aria-disabled={sportteryLoading}
	                      tabIndex={sportteryLoading ? -1 : 0}
	                      title={`${league.leagueName} · ${selected ? "已选择" : "点击筛选"}；不选代表不限`}
                      onClick={() => {
                        if (!sportteryLoading) toggleLeagueFilter(league.leagueNameAbbr);
                      }}
                      onKeyDown={(event) => {
                        if (sportteryLoading) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleLeagueFilter(league.leagueNameAbbr);
                        }
                      }}
                    >
                      {league.leagueNameAbbr}
                    </Tag>
                  );
                })}
              </div>
              <small className="match-update-time">数据源：{sportteryFetchMode === "morning" ? "早间逐场最新赔率" : "常规接口 + 缺失比赛补充"} · 接口更新：{sportteryLastUpdateTime || "--"}</small>
            </div>
          </div>
          {filteredMatches.length === 0 ? (
            <Card><Empty description={matches.length ? "当前筛选条件下暂无比赛" : temporaryOrder ? "这个订单没有可展示的比赛" : sportteryLoaded && !sportteryLoading ? "接口暂未返回比赛" : "正在加载官方比赛"}>
              {matches.length ? <Button type="primary" disabled={sportteryLoading} onClick={clearMatchFilters}>清除筛选</Button> : temporaryOrder ? <Button onClick={restoreSavedMatches}>返回官方比赛</Button> : null}
            </Empty></Card>
          ) : groupedMatches.map(([date, items]) => {
            const selectedMatchCount = items.filter((match) => selectedOptions(match).length > 0).length;
            const collapsed = collapsedMatchDates.includes(date);
            return (
              <section className="date-group" key={date}>
                <div className="date-divider">
                  <div className="date-divider-main">
                    <span>{date}</span><small>{items[0]?.weekday} · {items.length} 场比赛</small><i />
                    {selectedMatchCount > 0 && <strong>已选 {selectedMatchCount} 场</strong>}
                  </div>
                  <Tooltip title="复制该日期下的比赛">
                    <Button type="text" className="date-divider-icon" aria-label={`复制 ${date} 的比赛`} icon={<CopyOutlined />} onClick={() => { void copyMatchesForDate(date, items); }} />
                  </Tooltip>
                  <Button
                    type="text"
                    className="date-divider-icon"
                    aria-label={`${collapsed ? "展开" : "收起"} ${date} 的比赛`}
                    aria-expanded={!collapsed}
                    icon={collapsed ? <CaretDownOutlined /> : <CaretUpOutlined />}
                    onClick={() => toggleMatchDateCollapsed(date)}
                  />
                </div>
                {!collapsed && <div className="match-grid">
                  {items.map((match) => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      now={saleNow}
                      teamNameIndex={teamNameIndex}
                      onToggle={toggleOption}
                      onPreview={setPreviewMatchId}
                      onMore={setMoreMatchId}
                      onTrend={setTrendMatchId}
                      leagueColor={getLeagueTagColor(appSettings, match.league)}
                      onLeagueColorSave={updateLeagueTagColor}
                      disableOddsTooltip={isMobileViewport}
                      resultLoading={bettingResultFetchingMatchIds.includes(normalizeSportteryMatchId(match.id))}
                    />
                  ))}
                </div>}
              </section>
            );
          })}
        </section>

        <aside className="bet-panel">
          <div className="bet-panel-head">
            <div className="bet-panel-title"><span><CalculatorOutlined /> 预测结算</span><Tag color="red">模拟</Tag></div>
            <div className="bet-panel-head-actions"><Button type="text" size="small" disabled={!pickedCount} icon={<CloseOutlined />} onClick={clearCurrentSelections}>清空选择</Button></div>
          </div>
          <div className="selection-summary">
            <div><strong>{chosenMatches.length}</strong><span>已选场次</span></div>
            <div><strong>{betCount.toLocaleString("zh-CN")}</strong><span>注数</span></div>
            <div><strong>¥{stake.toLocaleString("zh-CN")}</strong><span>投入</span></div>
          </div>
          <div className="panel-section">
            <label>自由过关 <Tooltip title="比分、半全场最高 4 关；总进球最高 6 关；胜平负最高 8 关。"><QuestionCircleOutlined /></Tooltip></label>
            <div className="pass-grid">
              {passOptions.length ? passOptions.map((value) => (
                <button
                  type="button"
                  key={value}
                  className={activePasses.includes(value) ? "active" : ""}
                  onClick={() => setPasses(() => activePasses.includes(value) ? activePasses.filter((item) => item !== value) : [...activePasses, value].sort((a, b) => a - b))}
                >
                  {value === 1 ? "单场" : `${value} 串 1`}
                </button>
              )) : <p className="panel-hint">先选择至少 1 场比赛</p>}
            </div>
          </div>
          <div className="panel-section multiple-section">
            <label>投注倍数</label>
            <div className="multiple-control">
              <Button icon={<MinusOutlined />} disabled={multiple <= 1} onClick={() => setMultiple((value) => Math.max(1, value - 1))} />
              <InputNumber controls={false} min={1} max={50} value={multiple} onChange={(value) => setMultiple(Math.min(50, Math.max(1, Number(value ?? 1))))} />
              <Button icon={<PlusOutlined />} disabled={multiple >= 50} onClick={() => setMultiple((value) => Math.min(50, value + 1))} />
              <span>最高 50 倍</span>
            </div>
          </div>
          <div className="prize-card">
            <span>中奖奖金范围</span>
            <strong>{prizeRangeMetrics.available ? `¥${currency(prizeRangeMetrics.prize.min)} – ¥${currency(prizeRangeMetrics.prize.max)}` : "—"}</strong>
            <small>最低值排除未中奖的 0 元结果</small>
          </div>
          <div className="profit-row"><span>中奖时利润范围</span><b>{prizeRangeMetrics.available ? `¥${currency(prizeRangeMetrics.profit.min)} – ¥${currency(prizeRangeMetrics.profit.max)}` : "—"}</b></div>
          <div className="profit-row multiplier-row"><span>中奖倍率范围</span><b>{winningMultiplierRange(prizeRangeMetrics.multiplier)}</b></div>
          {prizeRange.uncappedMax > prizeRange.max && <div className="cap-note">未封顶理论最高 ¥{currency(prizeRange.uncappedMax)}，已按官方单注上限修正。</div>}
          <div className="panel-actions">
            <Button icon={<SaveOutlined />} disabled={!pickedCount || saveSlipLoading} onClick={openSaveSlip}>{temporaryOrder ? "更新预测单" : "保存预测单"}</Button>
            <Button type={pickedCount ? "primary" : "default"} icon={<EyeOutlined />} disabled={!pickedCount} onClick={() => setDetailsOpen(true)}>查看明细</Button>
          </div>
        </aside>
      </main> : activeView === "orders" ? (
        <main className="page-shell orders-shell">
          <section className="orders-page">
            <div className="section-heading orders-heading">
              <div><span className="eyebrow">{isGuestMode ? "LOCAL ORDERS" : "CLOUD ORDERS"}</span><h2>订单列表</h2><p>{isGuestMode ? "游客订单和累计收支只保存在当前浏览器，不会上传服务器或跨设备同步。" : "订单、累计收支会保存到当前账号，并在其他设备登录后自动同步。"}</p></div>
              <Space wrap>
                <Tag color="cyan">{cloudOrdersLoading ? "正在加载订单…" : `显示 ${filteredSavedSlips.length} / 共 ${orderTotalCount} 个订单`}</Tag>
                <Button icon={<ExpandOutlined />} disabled={cloudOrdersLoading || filteredSavedSlips.length === 0} onClick={expandAllOrderOptions}>展开全部选项</Button>
                <Button icon={<ReloadOutlined />} loading={orderOddsRefreshing} disabled={cloudOrdersLoading || lockingOrderOdds || filteredSavedSlips.length === 0} onClick={() => { void refreshUnlockedOrderOdds(); }}>更新倍率</Button>
                <Button icon={<LockOutlined />} loading={lockingOrderOdds} disabled={cloudOrdersLoading || orderOddsRefreshing || visibleUnlockedOrderCount === 0} onClick={() => { void lockVisibleOrderOdds(); }}>锁定倍率</Button>
                <Popover content={bulkPayContent} trigger="click" open={bulkPayPopoverOpen} onOpenChange={setBulkPayPopoverOpen}>
                  <Button icon={<DollarOutlined />} loading={payingOrderIds.length > 0} disabled={cloudOrdersLoading || filteredPayableOrders.length === 0 || payingOrderIds.length > 0}>一键支付</Button>
                </Popover>
                <Popover content={bulkSettleContent} trigger="click" open={bulkSettlePopoverOpen} onOpenChange={setBulkSettlePopoverOpen}>
                  <Button className="checkout-order-button" icon={<CheckOutlined />} loading={settlingOrderIds.length > 0} disabled={cloudOrdersLoading || filteredSettleableOrders.length === 0 || settlingOrderIds.length > 0}>一键结账</Button>
                </Popover>
                <Button type="primary" icon={<HomeOutlined />} onClick={() => navigateToView("betting")}>返回投注</Button>
              </Space>
            </div>
            <div className="order-overview">
              <Card className="order-filter-panel">
                <div className="order-panel-heading">
                  <div><span className="eyebrow">FILTERS</span><h3>筛选订单</h3></div>
                  <Button
                    type="text"
                    icon={<UndoOutlined />}
                    disabled={cloudOrdersLoading}
                    onClick={clearOrderFilters}
                  >清除过滤</Button>
                </div>
                <div className="order-filter-grid">
                  <label className="order-filter-field date-field">
                    <span>订单日期</span>
                    <DatePicker.RangePicker
                      allowClear
                      allowEmpty={[true, true]}
                      classNames={RESPONSIVE_DATE_PICKER_CLASS_NAMES}
                      format="YYYY-MM-DD"
                      inputReadOnly={isMobileViewport}
                      placeholder={["开始日期", "结束日期"]}
                      disabled={cloudOrdersLoading}
                      disabledDate={(current) => current.startOf("day").isAfter(dayjs().startOf("day"))}
                      value={orderDateRange ? [dayjs(orderDateRange[0]), dayjs(orderDateRange[1])] : null}
                      onChange={(dates) => {
                        setRenderedOrderCount(ORDER_LIST_BATCH_SIZE);
                        setOrderDateRange(dates?.[0] && dates[1] ? [dates[0].format("YYYY-MM-DD"), dates[1].format("YYYY-MM-DD")] : null);
                      }}
                    />
                  </label>
                  <label className="order-filter-field">
                    <span>订单进度</span>
                    <Select
                      aria-label="订单进度"
                      allowClear
                      placeholder="不限"
                      value={orderProgressFilter ?? undefined}
                      disabled={cloudOrdersLoading}
                      options={[
                        { value: "all", label: "不限" },
                        { value: "settled", label: "已结账" },
                        { value: "unsettled", label: "未结账" },
                        { value: "unpaid", label: "未支付" },
                      ]}
                      onChange={(value) => {
                        setRenderedOrderCount(ORDER_LIST_BATCH_SIZE);
                        const nextValue = String(value);
                        setOrderProgressFilter(nextValue === "settled" || nextValue === "unsettled" || nextValue === "unpaid" ? nextValue : null);
                      }}
                    />
                  </label>
                  <label className="order-filter-field">
                    <span>订单状态</span>
                    <Select
                      aria-label="订单状态"
                      mode="multiple"
                      allowClear
                      maxTagCount="responsive"
                      placeholder="不限"
                      value={orderStatusFilters}
                      disabled={cloudOrdersLoading}
                      options={[
                        { value: "all", label: "不限" },
                        { value: "success", label: "成功" },
                        { value: "hopeful", label: "有希望" },
                        { value: "failed", label: "失败" },
                        { value: "paid", label: "已支付" },
                      ]}
                      onChange={(values) => {
                        setRenderedOrderCount(ORDER_LIST_BATCH_SIZE);
                        const next = values as Array<OrderStatusFilter | "all">;
                        setOrderStatusFilters(next.includes("all") ? [] : next as OrderStatusFilter[]);
                      }}
                    />
                  </label>
                  <label className="order-filter-field order-short-pass-filter-field">
                    <span>错失</span>
                    <Dropdown
                      open={orderShortPassDropdownOpen}
                      trigger={["click"]}
                      placement="bottomLeft"
                      rootClassName="manual-pass-shortcut-dropdown order-short-pass-dropdown"
                      onOpenChange={(open, info) => {
                        if (info.source !== "trigger") return;
                        if (!open && orderShortPassInputClickRef.current) return;
                        setOrderShortPassDropdownOpen(open);
                      }}
                      menu={{
                        items: MANUAL_ORDER_PASS_SHORTCUTS.map((value) => ({
                          key: String(value),
                          label: `差${value}关`,
                        })),
                        selectedKeys: orderShortPassFilters.map(String),
                        onClick: ({ key }) => {
                          const value = Number(key);
                          setRenderedOrderCount(ORDER_LIST_BATCH_SIZE);
                          setOrderShortPassFilters((current) => current.includes(value)
                            ? current.filter((item) => item !== value)
                            : [...current, value].sort((left, right) => left - right));
                          setOrderShortPassDropdownOpen(true);
                        },
                      }}
                    >
                      <div className="order-short-pass-filter-control">
                        <Input
                          aria-label="错失"
                          readOnly
                          value={orderShortPassFilters.map((value) => `差${value}关`).join("、")}
                          disabled={cloudOrdersLoading}
                          onClickCapture={() => {
                            orderShortPassInputClickRef.current = true;
                            window.setTimeout(() => {
                              orderShortPassInputClickRef.current = false;
                            });
                          }}
                          onFocus={(event) => {
                            const input = event.currentTarget;
                            window.requestAnimationFrame(() => {
                              if (document.activeElement === input) setOrderShortPassDropdownOpen(true);
                            });
                          }}
                          placeholder="请选择差关"
                        />
                        {orderShortPassFilters.length > 0 && (
                          <button
                            type="button"
                            className="order-short-pass-clear"
                            aria-label="清除错失筛选"
                            disabled={cloudOrdersLoading}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              clearOrderShortPassFilter();
                            }}
                          >
                            <CloseOutlined />
                          </button>
                        )}
                      </div>
                    </Dropdown>
                  </label>
                  <label className="order-filter-field order-team-filter-field">
                    <span>比赛队伍</span>
                    <Input
                      allowClear
                      aria-label="按比赛队伍筛选订单"
                      placeholder="输入主队或客队名称"
                      value={orderTeamQuery}
                      disabled={cloudOrdersLoading}
                      onChange={(event) => {
                        setRenderedOrderCount(ORDER_LIST_BATCH_SIZE);
                        setOrderTeamQuery(event.target.value);
                      }}
                    />
                  </label>
                  <div className="order-filter-field order-league-filter-field">
                    <span>比赛类型 <small>不选代表不限</small></span>
                    <div className="league-filter-tags">
                      {availableOrderLeagueNames.map((leagueName) => {
                        const selected = selectedOrderLeagueNames.includes(leagueName);
                        const leagueColor = getLeagueTagColor(appSettings, leagueName);
                        return (
                          <Tag
                            key={leagueName}
                            color={leagueColor}
                            variant={selected ? "solid" : "outlined"}
                            style={selected ? { color: readableTagTextColor(leagueColor) } : undefined}
                            role="button"
                            aria-pressed={selected}
                            aria-disabled={cloudOrdersLoading}
                            tabIndex={cloudOrdersLoading ? -1 : 0}
                            title={`${leagueName} · ${selected ? "已选择" : "点击筛选"}；不选代表不限`}
                            onClick={() => {
                              if (!cloudOrdersLoading) toggleOrderLeagueFilter(leagueName);
                            }}
                            onKeyDown={(event) => {
                              if (cloudOrdersLoading) return;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleOrderLeagueFilter(leagueName);
                              }
                            }}
                          >
                            {leagueName}
                          </Tag>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="order-filter-summary">
                  <div><span>筛选结果</span><b>{filteredSavedSlips.length}<small> 个订单</small></b></div>
                  <div><span>筛选总额</span><b>¥{currency(filteredOrderTotalStake)}</b></div>
                  <div><span>已支付</span><b>¥{currency(filteredOrderPaidStake)}</b></div>
                  <Tooltip title={<><div>已支付：¥{currency(filteredOrderPaidStake)}</div><div>筛选收入：¥{currency(filteredOrderIncome)}</div></>}>
                    <div className={`order-filter-profit ${filteredOrderProfit >= 0 ? "positive" : "negative"}`}>
                      <span>筛选盈亏</span>
                      <b>{filteredOrderProfit > 0 ? "+" : filteredOrderProfit < 0 ? "−" : ""}¥{currency(Math.abs(filteredOrderProfit))}</b>
                    </div>
                  </Tooltip>
                  <p>“有希望”表示当前既未产生中奖金额，也未因失败场次失去全部串关机会。</p>
                </div>
              </Card>

              <Card className="order-statistics-panel">
                <div className="order-panel-heading">
                  <div>
                    <span className="eyebrow">OVERVIEW</span>
                    <div className="order-statistics-title">
                      <h3>数据统计</h3>
                      <Tooltip title="查看支出、收入与利润趋势">
                        <Button
                          type="text"
                          className="order-trend-button"
                          aria-label="查看支出、收入与利润趋势"
                          icon={<LineChartOutlined />}
                          onClick={() => setFinanceTrendOpen(true)}
                        />
                      </Tooltip>
                    </div>
                  </div>
                  <Tag color={netProfit >= 0 ? "green" : "red"}>{netProfit >= 0 ? "当前盈利" : "当前亏损"}</Tag>
                </div>
                <div className="order-statistics-grid">
	                  <div className="order-stat-item order-money-card expense-card">
	                    <span>累计支出</span>
	                    {expenseEditing ? (
	                      <div className="order-money-editor">
		                        <InputNumber autoFocus aria-label={isCloudMode ? "支出纠错值" : "累计支出校正"} controls={false} min={isCloudMode ? undefined : 0} precision={2} prefix="¥" value={expenseDraft} disabled={expenseSaving} onChange={(value) => setExpenseDraft(Number(value ?? 0))} onPressEnter={() => { if (!expenseSaving) void saveExpenseCorrection(); }} />
		                        <Button type="primary" aria-label={isCloudMode ? "保存支出纠错值" : "保存累计支出"} icon={<CheckOutlined />} loading={expenseSaving} disabled={expenseSaving} onClick={() => { void saveExpenseCorrection(); }} />
		                        <Button aria-label={isCloudMode ? "取消编辑支出纠错值" : "取消编辑累计支出"} icon={<CloseOutlined />} disabled={expenseSaving} onClick={() => setExpenseEditing(false)} />
	                        {isCloudMode && <small>预览最终支出：¥{currency(expenseOrdersTotal)} {Number(expenseDraft || 0) >= 0 ? "+" : "−"} ¥{currency(Math.abs(Number(expenseDraft || 0)))} = ¥{currency(expenseOrdersTotal + Number(expenseDraft || 0))}</small>}
	                      </div>
	                    ) : (
	                      <div className="order-money-locked">
	                        <strong>¥{currency(expenseTotal)}</strong>
	                        <Tooltip title={isCloudMode ? "编辑支出纠错值" : "解锁编辑累计支出"}><Button type="text" aria-label={isCloudMode ? "编辑支出纠错值" : "解锁编辑累计支出"} icon={<EditOutlined />} onClick={unlockExpenseEditor} /></Tooltip>
	                      </div>
	                    )}
	                    <small>{isCloudMode ? `订单支出 ¥${currency(expenseOrdersTotal)}，纠错 ${expenseCorrection >= 0 ? "+" : "−"}¥${currency(Math.abs(expenseCorrection))}` : "订单投入自动计入"}</small>
	                  </div>
	                  <div className="order-stat-item order-money-card income-card">
	                    <span>累计收入</span>
	                    {incomeEditing ? (
	                      <div className="order-money-editor">
		                        <InputNumber autoFocus aria-label={isCloudMode ? "收入纠错值" : "累计收入校正"} controls={false} min={isCloudMode ? undefined : 0} precision={2} prefix="¥" value={incomeDraft} disabled={incomeSaving} onChange={(value) => setIncomeDraft(Number(value ?? 0))} onPressEnter={() => { if (!incomeSaving) void saveIncomeCorrection(); }} />
		                        <Button type="primary" aria-label={isCloudMode ? "保存收入纠错值" : "保存累计收入"} icon={<CheckOutlined />} loading={incomeSaving} disabled={incomeSaving} onClick={() => { void saveIncomeCorrection(); }} />
		                        <Button aria-label={isCloudMode ? "取消编辑收入纠错值" : "取消编辑累计收入"} icon={<CloseOutlined />} disabled={incomeSaving} onClick={() => setIncomeEditing(false)} />
	                        {isCloudMode && <small>预览最终收入：¥{currency(incomeOrdersTotal)} {Number(incomeDraft || 0) >= 0 ? "+" : "−"} ¥{currency(Math.abs(Number(incomeDraft || 0)))} = ¥{currency(incomeOrdersTotal + Number(incomeDraft || 0))}</small>}
	                      </div>
	                    ) : (
	                      <div className="order-money-locked">
	                        <strong>¥{currency(incomeTotal)}</strong>
	                        <Tooltip title={isCloudMode ? "编辑收入纠错值" : "解锁编辑累计收入"}><Button type="text" aria-label={isCloudMode ? "编辑收入纠错值" : "解锁编辑累计收入"} icon={<EditOutlined />} onClick={unlockIncomeEditor} /></Tooltip>
	                      </div>
	                    )}
	                    <small>{isCloudMode ? `订单收入 ¥${currency(incomeOrdersTotal)}，纠错 ${incomeCorrection >= 0 ? "+" : "−"}¥${currency(Math.abs(incomeCorrection))}` : "结账奖金自动计入"}</small>
	                  </div>
                  <div className={`order-stat-item order-profit-card ${netProfit >= 0 ? "positive" : "negative"}`}>
                    <span>当前利润</span>
                    <strong>{netProfit >= 0 ? "+" : "−"}¥{currency(Math.abs(netProfit))}</strong>
                    <small>累计收入 − 累计支出</small>
                  </div>
                </div>
              </Card>
            </div>
            <Card className={`match-results-card ${matchResultsCollapsed ? "collapsed" : ""}`}>
              <div className="match-results-head">
                <div>
                  <span className="eyebrow">MATCH RESULTS</span>
                  <div className="match-results-title">
                    <h3>赛果</h3>
                    <Tooltip
                      placement="right"
                      styles={{ root: { maxWidth: 380 } }}
                      title={(
                        <div className="match-phase-tooltip">
                          <b>matchPhaseTc 比赛阶段</b>
                          <table>
                            <thead><tr><th>值</th><th>含义</th></tr></thead>
                            <tbody>{MATCH_PHASE_ROWS.map(([value, label]) => <tr key={value}><td>{value}</td><td>{label}</td></tr>)}</tbody>
                          </table>
                          <p>竞彩足球只判断常规时间：阶段为 1、2、10、16 时尚未结束；其它已知阶段均视为常规时间结束。</p>
                        </div>
                      )}
                    >
                      <button type="button" className="match-phase-info" aria-label="查看比赛阶段映射与常规时间判断规则"><InfoCircleOutlined /></button>
                    </Tooltip>
                  </div>
                  <p>汇总当前筛选订单中尚未完整判断赛果的比赛，包含已结账订单；让球数按比赛 ID 从官方比赛数据重新获取，并同步到订单。</p>
                </div>
                <Space wrap>
	                  {!matchResultsCollapsed && <Button icon={<ReloadOutlined />} loading={allResultsFetching} disabled={resultMatches.length === 0 || resultFetchingMatchIds.length > 0 || judgingOrders} onClick={() => { void fetchAllMatchResults(); }}>获取全部赛果</Button>}
	                  {!matchResultsCollapsed && <Button type="primary" icon={<CheckOutlined />} loading={judgingOrders} disabled={resultMatches.length === 0 || allResultsFetching || resultFetchingMatchIds.length > 0 || judgingOrders} onClick={() => { void judgeVisibleOrders(); }}>一键判断并保存</Button>}
                  <Button icon={matchResultsCollapsed ? <CaretDownOutlined /> : <CaretUpOutlined />} onClick={() => setMatchResultsCollapsed((value) => !value)}>{matchResultsCollapsed ? `展开赛果（${resultMatches.length} 场）` : "收起赛果"}</Button>
                </Space>
              </div>
              {!matchResultsCollapsed && (resultMatches.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前订单列表没有尚待判断的比赛" />
              ) : (
                <div className="match-results-list">
                  {resultMatches.map((match) => {
                    const matchId = normalizeSportteryMatchId(match.id);
                    const result = matchResults[matchId];
                    return (
                      <section className="match-result-row" key={matchId}>
                        <div className="match-result-identity">
                          <span>{match.weekday}{match.code}</span>
                          <b>{match.home} VS {match.away}</b>
                          <small>ID {matchId} · {match.date} · {formatMatchCardTime(match)}</small>
                          {result && <Tag color={result.source === "api" ? "cyan" : "default"}>{result.source === "api" ? "接口赛果" : "手动填写"}</Tag>}
                        </div>
                        <div className="match-result-fields">
                          {RESULT_MARKETS.map((type) => {
                            const handicap = type === "rqspf"
                              ? result?.rqspfHandicap ?? match.markets.find((market) => market.type === type)?.handicap
                              : undefined;
                            const value = type === "rqspf" && result?.fullScore && typeof handicap === "number"
                              ? winningOptionId("rqspf", result.fullScore.home, result.fullScore.away, 0, 0, handicap)
                              : result?.values[type];
                            return (
                              <label key={type}>
                                <span>{MARKET_LABELS[type]}{type === "rqspf" ? `（${typeof handicap === "number" ? formatHandicap(handicap) : "待获取盘口"}）` : ""}</span>
                                <Select
                                  allowClear
                                  showSearch
                                  optionFilterProp="label"
	                                  placeholder="选择赛果"
	                                  value={value}
	                                  options={resultSelectOptions(match, type)}
	                                  disabled={allResultsFetching || resultFetchingMatchIds.includes(matchId) || judgingOrders}
	                                  onChange={(nextValue) => updateMatchResult(match, type, nextValue)}
	                                />
                              </label>
                            );
                          })}
                        </div>
                        <Button
                          icon={<ReloadOutlined />}
	                          loading={resultFetchingMatchIds.includes(matchId)}
	                          disabled={allResultsFetching || judgingOrders || (resultFetchingMatchIds.length > 0 && !resultFetchingMatchIds.includes(matchId))}
	                          onClick={() => { void fetchMatchResult(match); }}
	                        >获取赛果</Button>
                      </section>
                    );
                  })}
                </div>
              ))}
            </Card>
            {savedSlips.length === 0 ? (
              <Card className="orders-empty"><Empty description="还没有保存的预测单"><Button type="primary" onClick={() => navigateToView("betting")}>去选择比赛</Button></Empty></Card>
            ) : filteredSavedSlips.length === 0 ? (
              <Card className="orders-empty"><Empty description="当前筛选条件下没有订单"><Button type="primary" disabled={cloudOrdersLoading} onClick={clearOrderFilters}>清除筛选</Button></Empty></Card>
            ) : (
              <>
                <div className="orders-grid">
                  {renderedSavedSlips.map((slip, slipIndex) => {
                  const orderMatches = sortMatchesForDisplay(selectedMatches(slip.matches));
                  const orderBets = countBets(slip.matches, slip.passes);
                  const orderStake = calculateStake(slip.matches, slip.passes, slip.multiple);
                  const orderPrizeRange = calculatePrizeRange(slip.matches, slip.passes, slip.multiple, slip.hits ?? {});
                  const orderPrizeRangeText = orderPrizeRange.max > 0
                    ? `¥${currency(orderPrizeRange.min)} – ¥${currency(orderPrizeRange.max)}`
                    : "—";
                  const orderKey = slip.id || `legacy-${slip.savedAt}-${slipIndex}`;
                  const expanded = expandedOrderIds.includes(orderKey);
                  const savedHitCount = Object.values(slip.hits ?? {}).reduce((total, values) => total + Object.values(values).filter(Boolean).length, 0);
                  const trackedPrize = calculateCurrentPrize(slip.matches, slip.passes, slip.multiple, slip.hits ?? {});
                  const trackedPrizeText = trackedPrize.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
                  const orderStatus = getOrderStatus(slip);
                  const orderFailed = orderStatus === "failed";
	                  const orderSettleable = isOrderSettleable(slip);
	                  const orderPaid = isOrderPaid(slip);
	                  const actionKey = orderActionKey(slip);
	                  const orderLoading = loadingOrderId === actionKey;
	                  const orderSettling = settlingOrderIds.includes(actionKey);
	                  const orderPaying = payingOrderIds.includes(actionKey);
	                  const orderWithdrawing = withdrawingOrderIds.includes(actionKey);
	                  const orderDeleting = deletingOrderIds.includes(actionKey);
	                  const orderBusy = orderLoading || orderPaying || orderSettling || orderWithdrawing || orderDeleting;
	                  return (
                    <Card key={orderKey} className={`order-card ${orderStatus === "hopeful" ? "" : orderStatus}`}>
                      <div className="order-card-head">
                        <div className="order-card-meta-line">
                          <div className="order-card-tags">
                            <Tag color="geekblue">{isGuestMode ? "本地订单" : "云端订单"}</Tag>
                            {savedHitCount > 0 && <Tag color="orange">{savedHitCount} 个命中</Tag>}
                            {orderFailed && <Tag color="error">失败</Tag>}
                            {trackedPrize > 0 && <Tag color="green">已中奖 {trackedPrizeText} 元</Tag>}
                            {isOrderOddsLocked(slip) && <Tag color="gold" icon={<LockOutlined />}>倍率锁定</Tag>}
	                            {slip.settledAt
	                              ? <Tag color="cyan">已结账 ¥{currency(slip.settledPrize ?? 0)}</Tag>
	                              : orderPaid
	                                ? <Tag color="success">已支付</Tag>
	                                : <Tag>未支付</Tag>}
                          </div>
                          <time>{new Date(slip.savedAt).toLocaleString("zh-CN")}</time>
                        </div>
                        <div className="order-card-title-line">
                          <h3>{slip.name}</h3>
                          <span className="order-card-prize-range"> {orderPrizeRangeText}</span>
                        </div>
                      </div>
                      <div className="order-metrics">
                        <div><strong>{orderMatches.length}</strong><span>场比赛</span></div>
                        <div><strong>{orderBets.toLocaleString("zh-CN")}</strong><span>注</span></div>
                        <div><strong>{slip.multiple}</strong><span>倍</span></div>
                        <div><strong>¥{orderStake.toLocaleString("zh-CN")}</strong><span>投入</span></div>
                      </div>
                      <div className="order-pass-line"><span>串关方式</span><b>{passLabel(slip.passes)}</b></div>
                      <div className={`order-match-list ${expanded ? "expanded" : ""}`}>
                        {orderMatches.map((match) => {
                          const matchFailed = (slip.failedMatches ?? []).includes(match.id);
                          const matchSuccessful = matchHasSelectedHit(match, slip.hits ?? {});
                          const scoreResult = matchResultOptionLabel(match, "score", slip.resultValues?.[match.id]?.score);
                          const halfFullResult = matchResultOptionLabel(match, "halfFull", slip.resultValues?.[match.id]?.halfFull);
                          return (
                          <section className={`order-match-entry ${matchFailed ? "failed" : ""}`} key={match.id}>
                            <div className="order-match-entry-head">
                              <span>{match.weekday}{match.code}</span>
                              <b>
                                <HighlightedOrderTeamName name={match.home} query={orderTeamQuery} />
                                {" VS "}
                                <HighlightedOrderTeamName name={match.away} query={orderTeamQuery} />
                              </b>
                              <div className="order-match-result-tags">
                                {scoreResult && <Tag color="blue">比分 {scoreResult}</Tag>}
                                {halfFullResult && <Tag color="volcano">半全场 {halfFullResult}</Tag>}
                                {matchFailed && <Tag color="error">失败</Tag>}
                                {matchSuccessful && <Tag color="success">成功</Tag>}
                              </div>
                            </div>
                            {expanded && (
                              <div className="order-picked-lines">
                                {match.markets.filter((market) => market.options.some((option) => option.selected)).map((market) => (
                                  <div className="order-picked-market" key={market.type}>
                                    <small>{MARKET_LABELS[market.type]}{market.type === "rqspf" ? `（${(market.handicap ?? 0) > 0 ? "+" : ""}${market.handicap ?? 0}）` : ""}</small>
                                    <div>
                                      {market.options.filter((option) => option.selected).map((option, optionIndex, pickedOptions) => {
                                        const isHit = slip.hits?.[match.id]?.[market.type] === option.id;
                                        return (
                                          <Fragment key={option.id}>
                                            <span className={isHit ? "hit" : ""}>{formatOrderOptionLabel(market, option)}{isHit && <b>@{option.odds.toFixed(2)}</b>}</span>
                                            {optionIndex < pickedOptions.length - 1 && <Divider type="vertical" className="order-option-divider" />}
                                          </Fragment>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </section>
                          );
                        })}
                      </div>
                      <Button className="order-expand-button" type="text" icon={expanded ? <CaretUpOutlined /> : <CaretDownOutlined />} onClick={() => toggleOrderExpanded(orderKey)}>{expanded ? "收起比赛选项" : "展开比赛选项"}</Button>
	                      <div className="order-actions">
	                        <Button icon={<EyeOutlined />} onClick={() => openOrderDetails(slip)}>明细</Button>
	                        <Button icon={<EditOutlined />} disabled={orderBusy || cloudOrdersLoading} onClick={() => openOrderEditor(slip)}>编辑</Button>
	                        {!slip.settledAt && !orderPaid && <Button type="primary" icon={<ImportOutlined />} loading={orderLoading} disabled={orderBusy || cloudOrdersLoading} onClick={() => { void loadSlip(slip); }}>载入投注</Button>}
	                        <Button color="orange" variant="solid" icon={<CopyOutlined />} disabled={orderBusy || cloudOrdersLoading} onClick={() => copySlip(slip)}>复制投注</Button>
	                        <div className="order-closing-actions">
	                          {slip.settledAt ? (
	                            <Popconfirm
                              title="确认撤回结账？"
                              description={`将从累计收入中扣除 ¥${currency(slip.settledPrize ?? 0)}，并把订单恢复为未结账状态。`}
	                              okText="确认撤回"
	                              cancelText="取消"
	                              okButtonProps={{ loading: orderWithdrawing, disabled: orderWithdrawing }}
	                              onConfirm={() => { void withdrawOrderSettlement(slip); }}
	                            >
	                              <Button className="withdraw-checkout-button" icon={<RollbackOutlined />} loading={orderWithdrawing} disabled={orderBusy || cloudOrdersLoading}>撤回</Button>
	                            </Popconfirm>
	                          ) : !orderPaid ? (
	                            <Popconfirm
	                              title="确认支付？"
	                              description="支付前会更新倍率；无法取得最新倍率时保留原值。支付后投注内容与倍率全部冻结。"
	                              okText="确认支付"
	                              cancelText="取消"
	                              okButtonProps={{ loading: orderPaying, disabled: orderPaying }}
	                              onConfirm={() => { void payOrders([slip]); }}
	                            >
	                              <Button icon={<DollarOutlined />} loading={orderPaying} disabled={orderBusy || cloudOrdersLoading}>支付</Button>
	                            </Popconfirm>
	                          ) : orderSettleable ? (
	                            <Popconfirm
                              title="确认结账？"
                              description={`将按当前命中结果把 ¥${currency(trackedPrize)} 计入累计收入，结账后不可编辑倍率或命中。`}
	                              okText="确认结账"
	                              cancelText="取消"
	                              okButtonProps={{ loading: orderSettling, disabled: orderSettling }}
	                              onConfirm={() => { void settleOrders([slip]); }}
	                            >
	                              <Button className="checkout-order-button" icon={<CheckOutlined />} loading={orderSettling} disabled={orderBusy || cloudOrdersLoading}>结账</Button>
	                            </Popconfirm>
	                          ) : (
                            <Tooltip title="该订单未对比赛果">
                              <span><Button className="checkout-order-button" icon={<CheckOutlined />} disabled>结账</Button></span>
                            </Tooltip>
	                          )}
	                          {!slip.settledAt && (
	                            <Popconfirm title="删除这张预测单？" description="将同时回滚该订单的支出和已入账收入。" okText="删除" cancelText="取消" okButtonProps={{ loading: orderDeleting, disabled: orderDeleting }} onConfirm={() => { void deleteSlip(slip); }}>
	                              <Button className="delete-order-button" danger icon={<DeleteOutlined />} loading={orderDeleting} disabled={orderBusy || cloudOrdersLoading}>删除</Button>
	                            </Popconfirm>
	                          )}
                        </div>
                      </div>
                    </Card>
                  );
                  })}
                </div>
                {hasMoreRenderedOrders && (
                  <div className="orders-load-more" ref={orderListLoadMoreRef} role="status" aria-live="polite">
                    <span>继续向下滚动加载更多订单</span>
                    <b>已展示 {renderedSavedSlips.length} / {filteredSavedSlips.length}</b>
                  </div>
                )}
              </>
            )}
          </section>
        </main>
      ) : (
        <main className="page-shell settings-shell">
          <section className="settings-page">
            <div className="section-heading settings-heading">
              <div><span className="eyebrow">{isGuestMode ? "LOCAL SETTINGS" : "CLOUD SETTINGS"}</span><h2>设置</h2><p>{isGuestMode ? "游客设置只保存在当前浏览器，清理浏览器数据后将无法恢复。" : "应用设置与当前账号绑定，并在其他设备登录后自动同步。"}</p></div>
              <Space wrap>
                <Tag color="cyan">{settingsLeagueNames.length} 个联赛颜色</Tag>
                <Button type="primary" icon={<HomeOutlined />} onClick={() => navigateToView("betting")}>返回投注</Button>
              </Space>
            </div>
            <Card className="settings-card">
              <div className="settings-card-head">
                <div><h3>联赛标签颜色</h3><p>比赛列表会自动加入接口返回的新联赛；修改颜色后立即保存到当前{isGuestMode ? "浏览器" : "账号"}。</p></div>
                <Popconfirm title="恢复默认联赛颜色？" okText="恢复默认" cancelText="取消" onConfirm={resetLeagueTagColors}>
                  <Button icon={<UndoOutlined />}>恢复默认</Button>
                </Popconfirm>
              </div>
              <div className="league-settings-grid">
                {settingsLeagueNames.map((leagueName) => {
                  const color = getLeagueTagColor(appSettings, leagueName);
                  const apiLeague = leagueOptions.find((item) => leagueColorSettingKey(item.leagueNameAbbr) === leagueName);
                  return (
                    <div className="league-setting-row" key={leagueName}>
                      <div className="league-setting-preview">
                        <Tag color={color} variant="solid" style={{ color: readableTagTextColor(color) }}>{leagueName}</Tag>
                        <span>{apiLeague?.leagueName ?? (DEFAULT_LEAGUE_TAG_COLORS[leagueName] ? "默认配置" : "自定义配置")}</span>
                      </div>
                      <ColorPicker
                        value={color}
                        showText
                        disabledAlpha
                        onChangeComplete={(value) => updateLeagueTagColor(leagueName, value.toHexString())}
                      />
                    </div>
                  );
                })}
              </div>
            </Card>
            {canManageTeamNames && <Card className="settings-card team-name-card">
              <div className="settings-card-head">
                <div><h3>队伍名称别名</h3><p>公共配置，所有用户共用；接口返回的历史名称也会参与识别，只有管理员可以修改。</p></div>
                <Button type="primary" icon={<PlusOutlined />} disabled={Boolean(teamNameEditor)} onClick={startNewTeamNameGroup}>添加队伍</Button>
              </div>
              {teamNameEditor && !teamNameEditor.id && (
                <TeamNameGroupEditor
                  draft={teamNameEditor}
                  onChange={setTeamNameEditor}
                  onAddName={() => setTeamNameEditor((current) => current ? { ...current, names: [...current.names, { name: "", activeSlot: null }] } : current)}
                  onRemoveName={(index) => setTeamNameEditor((current) => current ? { ...current, names: current.names.filter((_, entryIndex) => entryIndex !== index) } : current)}
                  onCancel={() => setTeamNameEditor(null)}
                  onSave={() => { void saveTeamNameEditor(); }}
                  saving={teamNameSaving}
                />
              )}
              {teamNameGroups.length === 0 && !teamNameEditor ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有队伍名称配置，点击右上角添加" />
              ) : (
                <div className="team-name-group-list">
                  {teamNameGroups.map((group) => teamNameEditor?.id === group.id ? (
                    <TeamNameGroupEditor
                      key={group.id}
                      draft={teamNameEditor}
                      onChange={setTeamNameEditor}
                      onAddName={() => setTeamNameEditor((current) => current ? { ...current, names: [...current.names, { name: "", activeSlot: null }] } : current)}
                      onRemoveName={(index) => setTeamNameEditor((current) => current ? { ...current, names: current.names.filter((_, entryIndex) => entryIndex !== index) } : current)}
                      onCancel={() => setTeamNameEditor(null)}
                      onSave={() => { void saveTeamNameEditor(); }}
                      saving={teamNameSaving}
                    />
                  ) : (
                    <TeamNameGroupSummary
                      key={group.id}
                      group={group}
                      canManage={canManageTeamNames}
                      deleting={teamNameDeletingId === group.id}
                      onEdit={() => editTeamNameGroup(group)}
                      onDelete={() => { void removeTeamNameGroup(group); }}
                    />
                  ))}
                </div>
              )}
            </Card>}
            <Card className="settings-card settings-data-card">
              <div className="settings-card-head">
                <div><h3>数据管理</h3><p>通过 JSON 文件备份或恢复订单、比赛、应用设置与收支账本。</p></div>
              </div>
              <div className="settings-data-grid">
                <section className="settings-data-item">
                  <div className="settings-data-item-copy">
                    <span className="settings-data-icon"><UploadOutlined /></span>
                    <div><b>JSON 导入</b><p>选择要恢复的数据类型，导入前会校验文件内容。</p></div>
                  </div>
                  <Popover content={importMenu} trigger="click" placement="bottomLeft">
                    <Button type="primary" icon={<UploadOutlined />}>选择导入内容</Button>
                  </Popover>
                </section>
                <section className="settings-data-item">
                  <div className="settings-data-item-copy">
                    <span className="settings-data-icon"><DownloadOutlined /></span>
                    <div><b>导出数据</b><p>分别导出订单、比赛、设置，或生成完整数据备份。</p></div>
                  </div>
                  <Popover content={exportMenu} trigger="click" placement="bottomLeft">
                    <Button icon={<DownloadOutlined />}>选择导出内容</Button>
                  </Popover>
                </section>
              </div>
            </Card>
          </section>
        </main>
      )}

      <FinanceTrendModal
        open={financeTrendOpen}
        onClose={() => setFinanceTrendOpen(false)}
        loadTrend={loadFinanceTrend}
      />

      <Modal
        open={Boolean(moreMatch)}
        zIndex={1050}
        onCancel={() => setMoreMatchId(null)}
        footer={<Button type="primary" onClick={() => setMoreMatchId(null)}>完成选择</Button>}
        width={980}
        title={moreMatch ? <Space><span>{moreMatch.weekday}{moreMatch.code} · </span><MatchTeamsLabel match={moreMatch} teamNameIndex={teamNameIndex} />{getMatchSaleState(moreMatch, saleNow) === "pending" && <Tag color="warning">待开售</Tag>}{getMatchSaleState(moreMatch, saleNow) === "stopped" && <Tag color="default">已停售 · 仅供查看</Tag>}</Space> : "更多玩法"}
        className="more-modal"
      >
        {moreMatch?.markets.map((market) => (
          <section className={`modal-market ${market.type}-market`} key={market.type}>
            <div className="modal-market-title"><span>{MARKET_LABELS[market.type]}{market.type === "rqspf" ? `（${(market.handicap ?? 0) > 0 ? "+" : ""}${market.handicap ?? 0}）` : ""}</span><MarketSupportTags market={market} /></div>
            <div className="more-options-groups">
              {marketEditorGroups(market).map((group) => (
                <div className={`more-options-row ${group.key}-group`} key={group.key}>
                  {group.options.map((item) => (
                    <OddsHistoryTooltip option={item} disabled={isMobileViewport} key={item.id}>
                      <button type="button" disabled={!isMatchSelectable(moreMatch, saleNow) || item.odds <= 0} className={`more-odds-option ${item.id === "winOther" || item.id === "loseOther" ? "score-other" : ""} ${isMatchSelectable(moreMatch, saleNow) && item.odds > 0 && item.selected ? "selected" : ""}`} onClick={() => toggleOption(moreMatch.id, market.type, item.id)} aria-pressed={isMatchSelectable(moreMatch, saleNow) && item.odds > 0 && item.selected}>
                        <span>{item.label}</span><strong>{item.odds > 0 ? <><i className="more-odds-at">@</i>{item.odds.toFixed(2)}<OddsTrendIndicator trend={item.oddsTrend} /></> : "--"}</strong>
                      </button>
                    </OddsHistoryTooltip>
                  ))}
                </div>
              ))}
            </div>
          </section>
        ))}
      </Modal>

      <MatchPreviewModal
        match={previewMatch}
        open={Boolean(previewMatch)}
        onClose={() => setPreviewMatchId(null)}
        teamNameIndex={teamNameIndex}
      />

      <OfficialTrendModal
        match={trendMatch}
        open={Boolean(trendMatch)}
        onClose={() => setTrendMatchId(null)}
        teamNameIndex={teamNameIndex}
      />

      <Modal
        open={Boolean(editingOrder)}
        title={editingOrder ? `编辑订单 · ${editingOrder.name}` : "编辑订单"}
        width={820}
        okText="保存订单"
        cancelText="取消"
        confirmLoading={orderEditSaving}
        okButtonProps={{ disabled: orderEditSaving }}
        cancelButtonProps={{ disabled: orderEditSaving }}
        onCancel={() => {
          if (!orderEditSaving) closeOrderEditor();
        }}
        onOk={() => { void saveOrderEdits(); }}
        footer={(_, { OkBtn, CancelBtn }) => (
          <>
            <CancelBtn />
            <Button icon={<DownloadOutlined />} disabled={orderEditSaving} onClick={exportEditingOrder}>导出订单</Button>
            <OkBtn />
          </>
        )}
      >
        <div className="order-editor-meta">
          <label>订单名称
            <Input value={orderEditName} disabled={orderEditSaving} onChange={(event) => setOrderEditName(event.target.value)} maxLength={30} showCount />
          </label>
          <label>订单创建时间
            <DatePicker
              classNames={RESPONSIVE_DATE_PICKER_CLASS_NAMES}
              showTime={{ format: "HH:mm:ss" }}
              showNow
              format="YYYY-MM-DD HH:mm:ss"
              inputReadOnly={isMobileViewport}
              value={orderEditTime && dayjs(orderEditTime).isValid() ? dayjs(orderEditTime) : null}
              disabled={orderEditSaving}
              onChange={(value) => setOrderEditTime(value?.toISOString() ?? "")}
            />
          </label>
          <label>投注倍数
            <InputNumber
              aria-label="编辑订单投注倍数"
              controls={false}
              min={1}
              max={50}
              disabled={editingOrderWagerFrozen || orderEditSaving}
              value={orderEditMultiple}
              onChange={(value) => setOrderEditMultiple(Math.min(50, Math.max(1, Number(value ?? 1))))}
            />
          </label>
        </div>
        <label className="order-editor-pass-field">串关方式
          <Select
            aria-label="编辑订单串关方式"
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            disabled={editingOrderWagerFrozen || orderEditSaving}
            placeholder="请选择串关方式"
            value={orderEditPasses}
            options={orderEditPassOptions.map((value) => ({
              value,
              label: value === 1 ? "单场" : `${value} 串 1`,
            }))}
            onChange={(values) => setOrderEditPasses([...values].sort((left, right) => left - right))}
          />
          <small>{editingOrderWagerFrozen ? "已支付或已结账订单的投注内容已经冻结。" : "修改串关后，支付金额会按新的订单投入计算。"}</small>
        </label>
        <div className="order-editor-section-title">
          <b>已选项倍率</b>
          <div className="order-odds-lock"><LockOutlined /><span>锁定倍率</span><Switch checked={orderEditOddsLocked} disabled={editingOrderWagerFrozen || orderEditSaving} onChange={setOrderEditOddsLocked} /></div>
        </div>
        <p className="modal-help">锁定后不会参与订单页的批量倍率更新；结账订单必须锁定。倍率修改只影响当前订单快照，不会改动官方比赛列表；串关修改会同步调整累计投入。</p>
        <div className="order-odds-editor">
          {selectedMatches(orderEditMatches).map((match) => (
            <section className="order-odds-match" key={match.id}>
              <div className="order-odds-match-title"><span>{match.weekday}{match.code}</span><b>{match.home} VS {match.away}</b></div>
              {match.markets.filter((market) => market.options.some((option) => option.selected)).map((market) => (
                <div className="order-odds-market" key={market.type}>
                  <span>{MARKET_LABELS[market.type]}{market.type === "rqspf" ? `（${(market.handicap ?? 0) > 0 ? "+" : ""}${market.handicap ?? 0}）` : ""}</span>
                  <div>
                    {market.options.filter((option) => option.selected).map((option) => (
                      <label key={option.id}>
                        <span>{formatOrderOptionLabel(market, option)}</span>
                        <InputNumber
                          aria-label={`${match.home} VS ${match.away} ${MARKET_LABELS[market.type]} ${formatOrderOptionLabel(market, option)} 倍率`}
                          controls={false}
                          min={0.01}
                          max={9999}
                          step={0.01}
                          precision={2}
                          value={option.odds > 0 ? option.odds : null}
                          prefix="@"
                          disabled={editingOrderWagerFrozen || orderEditOddsLocked || orderEditSaving}
                          onChange={(value) => updateOrderOptionOdds(match.id, market.type, option.id, Number(value ?? 0))}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      </Modal>

      <Drawer open={detailsOpen} onClose={() => setDetailsOpen(false)} title={`查看明细 · ${pickedCount} 个选项`} size={560} className="details-drawer">
        <div className="live-prize">
          <span>当前命中奖金</span><strong>¥{currency(currentPrize)}</strong>
          <small className={currentProfit >= 0 ? "profit-positive" : "profit-negative"}>当前利润 {currentProfit >= 0 ? "+" : ""}¥{currency(currentProfit)}</small>
        </div>
        <DetailPrizeRange range={prizeRange} metrics={prizeRangeMetrics} />
        <div className="detail-pass-summary">
          <span>当前订单串关</span>
          <div>{activePasses.length ? activePasses.map((value) => <Tag color="cyan" key={value}>{value === 1 ? "单场" : `${value} 串 1`}</Tag>) : <Tag>未选择</Tag>}</div>
        </div>
        <p className="drawer-tip">点击一个已选项即标记为当前玩法命中；同一玩法再次点击可取消或改选。</p>
        {chosenMatches.map((match) => (
          <section className="detail-match" key={match.id}>
            <div className="detail-match-title">
              <span>{match.weekday}{match.code}</span>
              <b><MatchTeamsLabel match={match} teamNameIndex={teamNameIndex} /></b>
              <Tooltip title="编辑本场投注">
                <Button
                  className="edit-match-bets"
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  aria-label={`编辑 ${match.home} VS ${match.away} 投注`}
                  onClick={() => setMoreMatchId(match.id)}
                />
              </Tooltip>
              <Button className="clear-match-bets" type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => clearBettingMatch(match.id)} />
            </div>
            <div className="detail-options betting-detail-options">
              {match.markets.flatMap((market) => market.options.filter((item) => item.selected).map((item) => {
                const active = hits[match.id]?.[market.type] === item.id;
                return (
                  <div className={`betting-detail-option ${active ? "hit" : ""}`} key={`${market.type}-${item.id}`}>
                    <button type="button" className="betting-detail-option-content" onClick={() => toggleHit(match.id, market.type, item.id)}>
                      <small>{MARKET_LABELS[market.type]}{market.type === "rqspf" ? ` ${(market.handicap ?? 0) > 0 ? "+" : ""}${market.handicap ?? 0}` : ""}</small>
                      <span>{formatOrderOptionLabel(market, item)}<b>@{item.odds.toFixed(2)}</b></span>
                      {active && <CheckOutlined />}
                    </button>
                  </div>
                );
              }))}
            </div>
          </section>
        ))}
        <PassMultiplierDetails matches={matches} passes={activePasses} hits={hits} />
      </Drawer>

      <Drawer
        open={Boolean(orderDetail)}
        onClose={() => {
          if (!orderHitsSaving) setOrderDetail(null);
        }}
        title={orderDetail ? `查看明细 · ${orderDetail.name} · ${orderDetailPickedCount} 个选项` : "查看明细"}
        size={560}
        className="details-drawer order-details-drawer"
        footer={orderDetail ? (
          <div className="order-detail-footer">
            <span>{orderDetail.settledAt ? `已于 ${new Date(orderDetail.settledAt).toLocaleString("zh-CN")} 结账，结果与倍率已锁定。` : "标记命中或比赛失败后请保存，结果将写入当前订单。"}</span>
            <Space>
              <Button disabled={orderHitsSaving} onClick={() => setOrderDetail(null)}>关闭</Button>
              <Button type="primary" icon={<SaveOutlined />} loading={orderHitsSaving} disabled={Boolean(orderDetail.settledAt) || orderHitsSaving} onClick={() => { void saveOrderHits(); }}>{orderDetail.settledAt ? "已结账锁定" : "保存比赛结果"}</Button>
            </Space>
          </div>
        ) : null}
      >
        {orderDetail && (
          <div className="order-detail">
            <div className="live-prize">
              <span>当前命中奖金</span><strong>¥{currency(orderDetailPrize)}</strong>
              <small className={orderDetailProfit >= 0 ? "profit-positive" : "profit-negative"}>当前利润 {orderDetailProfit >= 0 ? "+" : ""}¥{currency(orderDetailProfit)}</small>
            </div>
            <DetailPrizeRange range={orderDetailRange} metrics={orderDetailRangeMetrics} live />
            <div className="detail-pass-summary">
              <span>订单串关</span>
              <div>{orderDetail.passes.length ? orderDetail.passes.map((value) => <Tag color="cyan" key={value}>{value === 1 ? "单场" : `${value} 串 1`}</Tag>) : <Tag>未选择</Tag>}</div>
            </div>
            <p className="drawer-tip">{orderDetail.settledAt ? "该订单已结账，只能查看保存时的比赛结果与中奖金额。" : "点击已选项可标记玩法命中；勾选“失败”会清除该场命中并将投注项置灰。完成后点击底部保存。"}</p>
            {orderDetailMatches.map((match) => {
              const matchFailed = orderFailedMatches.includes(match.id);
              const scoreResult = matchResultOptionLabel(match, "score", orderDetail.resultValues?.[match.id]?.score);
              const halfFullResult = matchResultOptionLabel(match, "halfFull", orderDetail.resultValues?.[match.id]?.halfFull);
              return (
              <section className={`detail-match ${matchFailed ? "failed" : ""}`} key={match.id}>
                <div className="detail-match-title">
                  <span>{match.weekday}{match.code}</span>
                  <b>{match.home} VS {match.away}</b>
                  <div className="detail-match-result-tags">
                    {scoreResult && <Tag color="blue">比分 {scoreResult}</Tag>}
                    {halfFullResult && <Tag color="volcano">半全场 {halfFullResult}</Tag>}
                  </div>
                  <Checkbox checked={matchFailed} disabled={Boolean(orderDetail.settledAt) || orderHitsSaving} onChange={(event) => toggleOrderMatchFailure(match.id, event.target.checked)}>失败</Checkbox>
                </div>
                <div className="detail-options">
                  {match.markets.flatMap((market) => market.options.filter((item) => item.selected).map((item) => {
                    const active = orderHits[match.id]?.[market.type] === item.id;
                    return (
	                      <button type="button" className={active ? "hit" : ""} disabled={Boolean(orderDetail.settledAt || matchFailed) || orderHitsSaving} key={`${market.type}-${item.id}`} onClick={() => toggleOrderHit(match.id, market.type, item.id)}>
                        <small>{MARKET_LABELS[market.type]}{market.type === "rqspf" ? ` ${(market.handicap ?? 0) > 0 ? "+" : ""}${market.handicap ?? 0}` : ""}</small>
                        <span>{formatOrderOptionLabel(market, item)}<b>@{item.odds.toFixed(2)}</b></span>
                        {active && <CheckOutlined />}
                      </button>
                    );
                  }))}
                </div>
              </section>
              );
            })}
            <PassMultiplierDetails matches={orderDetail.matches} passes={orderDetail.passes} hits={orderHits} />
          </div>
        )}
      </Drawer>

      <Modal
        open={saveOpen}
        onCancel={() => {
          if (!saveSlipLoading) setSaveOpen(false);
        }}
        onOk={() => { void saveSlip(); }}
        confirmLoading={saveSlipLoading}
        okButtonProps={{ disabled: saveSlipLoading }}
        cancelButtonProps={{ disabled: saveSlipLoading }}
        afterOpenChange={(open) => {
          if (!open) return;
          window.requestAnimationFrame(() => saveNameInputRef.current?.focus({ cursor: "all" }));
        }}
        title={temporaryOrder ? "更新当前预测单" : "保存当前预测单"}
        okText={temporaryOrder ? "覆盖更新" : "保存到账号"}
        cancelText="取消"
      >
        <Input ref={saveNameInputRef} autoFocus value={saveName} disabled={saveSlipLoading} onChange={(event) => setSaveName(event.target.value)} onPressEnter={() => { if (!saveSlipLoading) void saveSlip(); }} placeholder="可选；留空则使用当前日期时间" maxLength={30} showCount />
        <p className="modal-help">名称留空时将使用“年月日时分秒”自动命名。保存后会同步到当前账号。</p>
      </Modal>

      <Modal
        open={manualOrderOpen}
        onCancel={() => {
          if (manualOrderSaving) return;
          closeManualOrder();
        }}
        onOk={() => { void addManualOrder(); }}
        width={900}
        title="添加订单"
        okText="添加订单"
        cancelText="取消"
        confirmLoading={manualOrderSaving}
        okButtonProps={{ disabled: manualOrderSaving }}
        cancelButtonProps={{ disabled: manualOrderSaving }}
      >
        <div className="manual-order-fields">
          <label>订单名称<Input value={manualOrderName} disabled={manualOrderSaving} onChange={(event) => setManualOrderName(event.target.value)} placeholder="留空则自动命名" maxLength={30} /></label>
          <label>订单创建时间
            <DatePicker
              classNames={RESPONSIVE_DATE_PICKER_CLASS_NAMES}
              showTime={{ format: "HH:mm:ss" }}
              showNow
              format="YYYY-MM-DD HH:mm:ss"
              inputReadOnly={isMobileViewport}
              value={manualOrderSavedAt && dayjs(manualOrderSavedAt).isValid() ? dayjs(manualOrderSavedAt) : null}
              disabled={manualOrderSaving}
              placeholder="留空则使用当前时间"
              onChange={(value) => setManualOrderSavedAt(value?.toISOString() ?? "")}
            />
          </label>
          <label>串关方式
            <Dropdown
              open={manualOrderPassDropdownOpen}
              trigger={["click"]}
              placement="bottomLeft"
              rootClassName="manual-pass-shortcut-dropdown"
              onOpenChange={(open, info) => {
                if (info.source !== "trigger") return;
                if (!open && manualOrderPassInputClickRef.current) return;
                setManualOrderPassDropdownOpen(open);
              }}
              menu={{
                items: MANUAL_ORDER_PASS_SHORTCUTS.map((value) => ({
                  key: String(value),
                  label: formatOrderPassValue(value),
                })),
                onClick: ({ key }) => {
                  setManualOrderPassText((current) => appendOrderPassValue(current, Number(key)));
                  setManualOrderPassDropdownOpen(true);
                },
              }}
            >
              <Input
                value={manualOrderPassText}
                disabled={manualOrderSaving}
                onClickCapture={() => {
                  manualOrderPassInputClickRef.current = true;
                  window.setTimeout(() => {
                    manualOrderPassInputClickRef.current = false;
                  });
                }}
                onFocus={(event) => {
                  const input = event.currentTarget;
                  window.requestAnimationFrame(() => {
                    if (document.activeElement === input) setManualOrderPassDropdownOpen(true);
                  });
                }}
                onChange={(event) => setManualOrderPassText(event.target.value)}
                placeholder="例如：单场、单关、2 关、3串1、三关、4、五串一"
              />
            </Dropdown>
          </label>
          <label>投注倍数<InputNumber controls={false} min={1} max={50} value={manualOrderMultiple} disabled={manualOrderSaving} onChange={(value) => setManualOrderMultiple(Math.min(50, Math.max(1, Number(value ?? 1))))} /></label>
        </div>
        <div className="manual-order-entry-list" ref={manualOrderEntryListRef}>
          {manualOrderEntries.map((entry, index) => (
            <section className="manual-order-entry" key={entry.key}>
              <div className="manual-order-entry-head">
                <b>比赛 {index + 1}</b>
                <Button type="text" danger icon={<DeleteOutlined />} disabled={manualOrderEntries.length === 1 || manualOrderSaving} onClick={() => setManualOrderEntries((current) => current.filter((item) => item.key !== entry.key))}>移除</Button>
              </div>
              <div
                className="manual-match-picker-row"
                ref={(element) => {
                  if (element) manualOrderMatchPickerRowRefs.current.set(entry.key, element);
                  else manualOrderMatchPickerRowRefs.current.delete(entry.key);
                }}
              >
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="searchText"
                  placeholder="从本地保存的比赛数据中选择"
                  value={entry.matchId}
                  disabled={manualOrderSaving}
                  loading={Boolean(manualMatchLookupIds[entry.key])}
                  options={manualMatchOptions.map((option) => ({
                    ...option,
                    disabled: (
                      option.value !== normalizeSportteryMatchId(entry.matchId ?? "")
                      && manualSelectedMatchIds.has(option.value)
                    ) || manualMatchLookupIds[entry.key] === option.value,
                  }))}
                  onSearch={(value) => searchManualOrderMatch(entry.key, value)}
                  onChange={(value) => selectManualOrderMatch(entry.key, value ?? null)}
                />
                <Button icon={<EditOutlined />} disabled={!entry.matchId || manualOrderSaving} onClick={() => openManualMatchPicker(entry)}>选择投注项</Button>
              </div>
              <Input.TextArea
                value={entry.text}
                disabled={manualOrderSaving}
                onChange={(event) => updateManualOrderEntry(entry.key, { text: event.target.value })}
                autoSize={{ minRows: 7, maxRows: 14 }}
                placeholder={'找不到比赛时可直接填写，例如：\n比赛 ID：2040594\n比赛日期：2026-07-23\n联赛：巴甲\n开赛时间：2026-07-24 06:30\n周四201 科林蒂安 VS 里莫\n胜平负 主胜 @2.25 | 主负 @2.46\n让球胜平负（-1） 主胜 @2.28\n比分 3:1 @10.50 | 3:2 @25.00\n总进球数 1 @4.65 | 6 @20.00\n半全场胜平负 胜平 @19.00 | 胜负 @60.00'}
              />
            </section>
          ))}
        </div>
        <Button className="manual-add-match-button" type="dashed" block icon={<PlusOutlined />} disabled={manualOrderSaving} onClick={addManualOrderEntry}>添加一场比赛</Button>
        <p className="modal-help">每个订单最多选择 {MAX_SELECTED_MATCHES} 场比赛。可在比赛选择框输入至少 6 位纯数字 matchId 查询官方数据；选中后通过“选择投注项”自动生成文本。仍找不到比赛时可手填，但必须包含比赛 ID、比赛信息、玩法、选项和倍率。创建时间留空则使用提交时的当前时间，并影响订单日期筛选与支出趋势归属。</p>
      </Modal>

      <Modal
        open={Boolean(manualPickerMatch)}
        onCancel={() => { setManualPickerEntryKey(null); setManualPickerMatch(null); }}
        onOk={applyManualPickerSelection}
        width={980}
        title={manualPickerMatch ? `${manualPickerMatch.weekday}${manualPickerMatch.code} · ${manualPickerMatch.home} VS ${manualPickerMatch.away}` : "选择投注项"}
        okText="完成选择"
        cancelText="取消"
        className="more-modal manual-match-picker-modal"
      >
        {manualPickerMatch?.markets.map((market) => (
          <section className={`modal-market ${market.type}-market`} key={market.type}>
            <div className="modal-market-title"><span>{MARKET_LABELS[market.type]}{market.type === "rqspf" ? `（${(market.handicap ?? 0) > 0 ? "+" : ""}${market.handicap ?? 0}）` : ""}</span><MarketSupportTags market={market} /></div>
            <div className="more-options-groups">
              {marketEditorGroups(market).map((group) => (
                <div className={`more-options-row ${group.key}-group`} key={group.key}>
                  {group.options.map((item) => (
                    <button type="button" disabled={item.odds <= 0} className={`more-odds-option ${item.id === "winOther" || item.id === "loseOther" ? "score-other" : ""} ${item.odds > 0 && item.selected ? "selected" : ""}`} key={item.id} onClick={() => toggleManualPickerOption(market.type, item.id)} aria-pressed={item.odds > 0 && item.selected}>
                      <span>{item.label}</span><strong>{item.odds > 0 ? <><i className="more-odds-at">@</i>{item.odds.toFixed(2)}</> : "--"}</strong>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </section>
        ))}
      </Modal>

    </div>
  );
}

const LOCAL_CLOUD_ACCOUNT: CloudAccount = { id: "local", account: "游客", role: "user" };
const ignoreCloudSettingsChange = () => undefined;
const ignoreTeamNameGroupSave = async (group: TeamNameGroupDraft) => ({
  id: group.id ?? "local",
  names: group.names.map((entry, index) => ({
    id: entry.id ?? `local-name-${index}`,
    groupId: group.id ?? "local",
    name: entry.name,
    nameKey: normalizeTeamName(entry.name),
    activeSlot: entry.activeSlot,
  })),
  revision: group.expectedRevision ?? 0,
  updatedAt: "",
});
const ignoreTeamNameGroupDelete = async () => undefined;
const ignoreCloudFinanceCorrectionChange = async (correction: { expenseCorrection: number; incomeCorrection: number }) => ({
  expenseTotal: Math.max(0, correction.expenseCorrection),
  incomeTotal: Math.max(0, correction.incomeCorrection),
  expenseCorrection: correction.expenseCorrection,
  incomeCorrection: correction.incomeCorrection,
});
const ignoreCloudOrderMutation = async () => ({
  orders: [],
  upsertedOrders: [],
  deletedOrderIds: [],
  revision: 0,
});
const ignoreCloudOrdersQueryChange = async (): Promise<CloudOrderQueryResult> => ({
  orders: [],
  total: 0,
  unsettledCount: 0,
});
const ignoreCloudMatchesChange = () => undefined;
const ignoreCloudMatchesUpdate = async (matches: MatchItem[]) => matches;
const ignoreCloudMatchesRefresh = async () => fetchSportteryMatchSnapshot(getSportteryRefreshPolicy(new Date()).mode);

export default function FootballApp({
  initialView = "betting",
  onNavigate,
  cloudAccount = LOCAL_CLOUD_ACCOUNT,
  cloudPersonal = null,
  teamNameGroups = [],
  cloudSyncStatus = "saved",
  onCloudSettingsChange = ignoreCloudSettingsChange,
  onTeamNameGroupSave = ignoreTeamNameGroupSave,
  onTeamNameGroupDelete = ignoreTeamNameGroupDelete,
  onCloudFinanceCorrectionChange = ignoreCloudFinanceCorrectionChange,
  onCloudOrderMutation = ignoreCloudOrderMutation,
  onCloudOrdersQueryChange = ignoreCloudOrdersQueryChange,
  onCloudMatchesChange = ignoreCloudMatchesChange,
  onCloudMatchesUpdate = ignoreCloudMatchesUpdate,
  onCloudMatchesRefresh = ignoreCloudMatchesRefresh,
  onRequireAccount = () => undefined,
  onLogout = async () => undefined,
}: {
  initialView?: AppView;
  onNavigate?: (view: AppView) => void;
  cloudAccount?: CloudAccount | null;
  cloudPersonal?: CloudPersonalData | null;
  teamNameGroups?: TeamNameGroup[];
  cloudSyncStatus?: CloudSyncStatus;
  onCloudSettingsChange?: (settings: AppSettings) => void;
  onTeamNameGroupSave?: (group: TeamNameGroupDraft) => Promise<TeamNameGroup>;
  onTeamNameGroupDelete?: (group: Pick<TeamNameGroup, "id" | "revision">) => Promise<void>;
  onCloudFinanceCorrectionChange?: (correction: { expenseCorrection: number; incomeCorrection: number }) => Promise<CloudPersonalData["finance"]>;
  onCloudOrderMutation?: (intent: OrderSyncIntent) => Promise<CloudOrderMutationResult>;
  onCloudOrdersQueryChange?: (query: CloudOrderQuery) => Promise<CloudOrderQueryResult>;
  onCloudMatchesChange?: (matches: MatchItem[]) => void;
  onCloudMatchesUpdate?: (matches: MatchItem[]) => Promise<MatchItem[]>;
  onCloudMatchesRefresh?: (manual: boolean) => Promise<SportteryMatchSnapshot>;
  onRequireAccount?: (view?: AppView) => void;
  onLogout?: () => Promise<void>;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) setMounted(true); });
    return () => { cancelled = true; };
  }, []);
  if (!mounted) {
    return (
      <div className="app-loading-shell">
        <div className="app-loading-mark">★</div>
        <b>Small Money Get Rich</b>
        <span>正在载入官方比赛…</span>
      </div>
    );
  }
  return (
    <ConfigProvider theme={{
      token: { colorPrimary: "#f04e55", borderRadius: 12, colorText: "#172a32", fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif' },
      components: { Button: { controlHeight: 40 }, Modal: { borderRadiusLG: 18 } },
    }}>
      <App notification={{ placement: "bottomRight", showProgress: true, pauseOnHover: true }}>
        <InnerFootballApp
          initialView={initialView}
          onNavigate={onNavigate}
          cloudAccount={cloudAccount}
          cloudPersonal={cloudPersonal}
          teamNameGroups={teamNameGroups}
          cloudSyncStatus={cloudSyncStatus}
          onCloudSettingsChange={onCloudSettingsChange}
          onTeamNameGroupSave={onTeamNameGroupSave}
          onTeamNameGroupDelete={onTeamNameGroupDelete}
          onCloudFinanceCorrectionChange={onCloudFinanceCorrectionChange}
          onCloudOrderMutation={onCloudOrderMutation}
          onCloudOrdersQueryChange={onCloudOrdersQueryChange}
          onCloudMatchesChange={onCloudMatchesChange}
          onCloudMatchesUpdate={onCloudMatchesUpdate}
          onCloudMatchesRefresh={onCloudMatchesRefresh}
          onRequireAccount={onRequireAccount}
          onLogout={onLogout}
        />
      </App>
    </ConfigProvider>
  );
}
