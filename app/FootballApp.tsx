"use client";

import {
  App,
  Badge,
  Button,
  Card,
  Checkbox,
  ColorPicker,
  ConfigProvider,
  DatePicker,
  Divider,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Popover,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Upload,
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
  EditOutlined,
  ExpandOutlined,
  EyeOutlined,
  FileTextOutlined,
  HomeOutlined,
  ImportOutlined,
  InfoCircleOutlined,
  LockOutlined,
  MinusOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  RollbackOutlined,
  SaveOutlined,
  SettingOutlined,
  StarFilled,
  UndoOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  calculateCurrentPrize,
  calculatePassMultipliers,
  calculatePrizeRange,
  calculateStake,
  countBets,
  getOrderStatus,
  getPassLimit,
  getPassOptions,
  isOrderFailed,
  isOrderSettleable,
  isNewMatchSelectionBlocked,
  matchHasSelectedHit,
  MAX_SELECTED_MATCHES,
  selectedMatches,
  selectedOptions,
} from "./calculator";
import {
  cloneMatches,
  MARKET_LABELS,
} from "./data";
import { parseRecognizedText } from "./ocr";
import {
  convertSportteryMatches,
  fetchSportteryMatchCalculator,
  fetchSportteryMatchScore,
  fetchSportteryMatchSnapshot,
  getNextSportteryAutoRefreshDelay,
  getSportteryRefreshPolicy,
  hasMatchStarted,
  getSportteryMatchPhaseTc,
  isSportteryRegularTimeFinished,
  isMatchSellable,
  mergeSportteryMatchCache,
  normalizeSportteryMatchId,
  parseSportteryMatchScore,
  refreshSelectedOdds,
  type SportteryLeague,
  type SportteryMatchFetchMode,
  type SportteryMatchSnapshot,
  type SportteryMatchDate,
} from "./sporttery";
import { judgeSlipWithResults, RESULT_MARKETS, resultSelectOptions } from "./results";
import {
  createDefaultSettings,
  DEFAULT_LEAGUE_TAG_COLORS,
  getLeagueTagColor,
  leagueColorSettingKey,
  loadAppSettings,
  normalizeAppSettings,
  readableTagTextColor,
  saveAppSettings,
  withLeagueTagColor,
  type AppSettings,
} from "./settings";
import type { CurrentHits, Market, MarketType, MatchItem, MatchResults, PrizeRange, SavedSlip } from "./types";

const SAVED_KEY = "football-simulator-saved-slips-v1";
const LEGACY_DRAFT_KEY = "football-simulator-current-draft-v1";
const PROFIT_KEY = "football-simulator-current-profit-v1";
const EXPENSE_KEY = "football-simulator-total-expense-v1";
const INCOME_KEY = "football-simulator-total-income-v1";
const LOADED_ORDER_KEY = "football-simulator-loaded-order-v1";
const MATCH_CACHE_KEY = "football-simulator-match-cache-v1";
const LEGACY_MATCH_RESULTS_KEY = "football-simulator-match-results-v1";

export type AppView = "betting" | "orders" | "settings";
type DataTransferMode = "orders" | "settings" | "matches" | "full";
type OrderProgressFilter = "settled" | "unsettled" | null;
type OrderStatusFilter = "success" | "hopeful" | "failed";
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
type LoadedOrderDraft = {
  id: string;
  name: string;
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

const currency = (value: number) => value.toLocaleString("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateKeyFromToday = (offsetDays: number) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

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

const isOrderOddsLocked = (slip: Pick<SavedSlip, "oddsLocked" | "settledAt">) => Boolean(slip.settledAt || slip.oddsLocked);

const createManualOrderEntry = (): ManualOrderEntry => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  matchId: null,
  text: "",
});

const matchWithClearedSelections = (match: MatchItem): MatchItem => ({
  ...cloneMatches([match])[0],
  id: normalizeSportteryMatchId(match.id),
  markets: match.markets.map((market) => ({
    ...market,
    options: market.options.map((option) => ({ ...option, selected: false })),
  })),
});

const formatManualMatchText = (match: MatchItem) => {
  const selectionLines = match.markets.flatMap((market) => {
    const selected = market.options.filter((option) => option.selected);
    if (selected.length === 0) return [];
    const marketLabel = `${MARKET_LABELS[market.type]}${market.type === "rqspf" && typeof market.handicap === "number" ? `（${market.handicap > 0 ? "+" : ""}${market.handicap}）` : ""}`;
    return [`${marketLabel} ${selected.map((option) => `${option.label} @${option.odds.toFixed(2)}`).join(" | ")}`];
  });
  return [
    `比赛 ID：${normalizeSportteryMatchId(match.id)}`,
    `比赛日期：${match.date}`,
    `联赛：${match.league || "未填写"}`,
    `开赛时间：${match.time || match.date}`,
    `${match.weekday}${match.code} ${match.home} VS ${match.away}`,
    ...selectionLines,
  ].join("\n");
};

function OddsTrendIndicator({ trend }: { trend?: -1 | 0 | 1 }) {
  if (!trend) return null;
  const rising = trend > 0;
  return (
    <span className={`odds-trend ${rising ? "up" : "down"}`} aria-label={rising ? "倍率上涨" : "倍率下跌"} title={rising ? "倍率上涨" : "倍率下跌"}>
      {rising ? <CaretUpOutlined aria-hidden="true" /> : <CaretDownOutlined aria-hidden="true" />}
    </span>
  );
}

const winningMultiplierRange = (range: PrizeRange, stake: number) => {
  if (range.max <= 0 || stake <= 0) return "—";
  const format = (value: number) => value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${format(range.min / stake)} – ${format(range.max / stake)} 倍`;
};

function DetailPrizeRange({ range, stake }: { range: PrizeRange; stake: number }) {
  const available = range.max > 0;
  return (
    <div className="detail-range-card">
      <div className="detail-range-prize">
        <span>中奖奖金范围</span>
        <strong>{available ? `¥${currency(range.min)} – ¥${currency(range.max)}` : "—"}</strong>
        <small>最低值排除未中奖的 0 元结果</small>
        <div className="detail-range-metrics">
          <div>
            <span>中奖时利润范围</span>
            <b>{available ? `¥${currency(range.min - stake)} – ¥${currency(range.max - stake)}` : "—"}</b>
          </div>
          <div>
            <span>中奖倍率范围</span>
            <b>{winningMultiplierRange(range, stake)}</b>
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
  if (details.length === 0) return null;
  const grouped = [...passes].sort((left, right) => left - right).map((pass) => ({ pass, items: details.filter((item) => item.pass === pass) }));
  const fullMultiplier = (value: number) => value.toLocaleString("zh-CN", { useGrouping: false, minimumFractionDigits: 0, maximumFractionDigits: 4 });
  return (
    <section className="pass-multiplier-details">
      <div className="pass-multiplier-title"><span>串关明细</span><Tag color="cyan">完整显示 {details.length} 组</Tag></div>
      {grouped.map(({ pass, items }) => (
        <div className="pass-multiplier-group" key={pass}>
          <h4>{pass === 1 ? "单场" : `${pass} 串 1`}<small>{items.length} 组</small></h4>
          <div className="pass-multiplier-lines">
            {items.map((item, index) => (
              <div className="pass-multiplier-line" key={`${pass}-${index}`}>
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
  if (typeof match.saleStatus !== "undefined" && match.saleStatus !== "selling" && match.saleStatus !== "stopped") return false;
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
    && (typeof order.oddsLocked === "undefined" || typeof order.oddsLocked === "boolean")
    && (typeof order.hits === "undefined" || isExportedHits(order.hits))
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
    const raw = localStorage.getItem(MATCH_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (!Array.isArray(parsed)) return [];
    const cleaned = mergeSportteryMatchCache([], parsed.filter(isExportedMatch), dateKeyFromToday(0));
    localStorage.setItem(MATCH_CACHE_KEY, JSON.stringify(cleaned.map(matchWithClearedSelections)));
    return cleaned;
  } catch {
    return [];
  }
};

const saveCachedMatches = (matches: MatchItem[]) => {
  const cache = matches.map(matchWithClearedSelections);
  localStorage.setItem(MATCH_CACHE_KEY, JSON.stringify(cache));
};

const passLabel = (passes: number[]) => passes.length
  ? [...passes].sort((left, right) => left - right).map((value) => value === 1 ? "单场" : `${value} 串 1`).join("、")
  : "未选择串关";

const inferOrderPasses = (text: string, orderMatches: MatchItem[]) => {
  const matchCount = selectedMatches(orderMatches).length;
  const limit = Math.min(matchCount, getPassLimit(orderMatches));
  if (limit <= 0) return [];
  const values = Array.from(text.matchAll(/([1-8])\s*(?:串|[xX×])\s*1/g), (item) => Number(item[1]));
  if (values.length === 0) {
    const passByCount = text.match(/([1-8])\s*关/);
    if (passByCount) values.push(Number(passByCount[1]));
  }
  const valid = [...new Set(values)].filter((value) => value >= 1 && value <= limit).sort((a, b) => a - b);
  return valid.length ? valid : [limit];
};

const cloneHits = (hits: CurrentHits | undefined): CurrentHits => Object.fromEntries(
  Object.entries(hits ?? {}).map(([matchId, values]) => [matchId, { ...values }]),
);

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
}: {
  market: Market;
  matchId: string;
  onToggle: (matchId: string, type: MarketType, optionId: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="market-row">
      <div className={`handicap-badge ${market.type === "spf" ? "neutral" : market.type === "rqspf" && (market.handicap ?? 0) > 0 ? "positive" : ""}`}>
        {market.type === "spf" ? "-" : `${(market.handicap ?? 0) > 0 ? "+" : ""}${market.handicap ?? 0}`}
      </div>
      <div className="market-options compact-options">
        {market.options.map((item) => (
          <button
            type="button"
            className={`odds-option ${!disabled && item.odds > 0 && item.selected ? "selected" : ""}`}
            key={item.id}
            disabled={disabled || item.odds <= 0}
            onClick={() => onToggle(matchId, market.type, item.id)}
            aria-pressed={!disabled && item.odds > 0 && item.selected}
          >
            <span>{item.label}</span>
            <strong>{item.odds > 0 ? <>{item.odds.toFixed(2)}<OddsTrendIndicator trend={item.oddsTrend} /></> : "--"}</strong>
          </button>
        ))}
      </div>
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

function MatchCard({
  match,
  onToggle,
  onMore,
  leagueColor,
  onLeagueColorSave,
}: {
  match: MatchItem;
  onToggle: (matchId: string, type: MarketType, optionId: string) => void;
  onMore: (matchId: string) => void;
  leagueColor: string;
  onLeagueColorSave: (league: string, color: string) => void;
}) {
  const picked = selectedOptions(match).length;
  const sellable = isMatchSellable(match);
  const spf = match.markets.find((market) => market.type === "spf")!;
  const rqspf = match.markets.find((market) => market.type === "rqspf")!;
  return (
    <article className={`match-card ${picked ? "has-selection" : ""} ${sellable ? "" : "stopped"}`}>
      <div className="match-meta">
        <div>
          <span className="match-code">{match.weekday}{match.code}</span>
          <EditableLeagueTag league={match.league} color={leagueColor} onSave={onLeagueColorSave} />
          {!sellable && <Tag color="default">已停售</Tag>}
        </div>
        <div className="match-time">{formatMatchCardTime(match)}</div>
      </div>
      <div className="teams-row">
        <div className="teams"><b>{match.home}</b><span>VS</span><b>{match.away}</b></div>
      </div>
      <MarketRow market={spf} matchId={match.id} onToggle={onToggle} disabled={!sellable} />
      <MarketRow market={rqspf} matchId={match.id} onToggle={onToggle} disabled={!sellable} />
      <Button className="more-play-button" type={picked ? "primary" : "default"} ghost={Boolean(picked)} onClick={() => onMore(match.id)}>
        更多玩法{picked ? ` · 已选 ${picked} 项` : ""}
      </Button>
    </article>
  );
}

function InnerFootballApp({ initialView, onNavigate }: { initialView: AppView; onNavigate?: (view: AppView) => void }) {
  const { message, modal, notification } = App.useApp();
  const headerRef = useRef<HTMLElement | null>(null);
  const [loadedOrderDraft] = useState<LoadedOrderDraft | null>(() => {
    if (initialView !== "betting") return null;
    try {
      const raw = sessionStorage.getItem(LOADED_ORDER_KEY);
      return raw ? JSON.parse(raw) as LoadedOrderDraft : null;
    } catch {
      return null;
    }
  });
  const [matches, setMatches] = useState<MatchItem[]>(() => loadedOrderDraft ? cloneMatches(loadedOrderDraft.matches) : loadCachedMatches());
  const matchesRef = useRef(matches);
  const [passes, setPasses] = useState<number[]>(() => loadedOrderDraft ? [...loadedOrderDraft.passes] : []);
  const [multiple, setMultiple] = useState(() => loadedOrderDraft?.multiple ?? 1);
  const [temporaryOrder, setTemporaryOrder] = useState<{ id: string; name: string } | null>(() => loadedOrderDraft ? { id: loadedOrderDraft.id, name: loadedOrderDraft.name } : null);
  const [hits, setHits] = useState<CurrentHits>(() => cloneHits(loadedOrderDraft?.hits));
  const [moreMatchId, setMoreMatchId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const activeView = initialView;
  const [orderDetail, setOrderDetail] = useState<SavedSlip | null>(null);
  const [orderHits, setOrderHits] = useState<CurrentHits>({});
  const [orderFailedMatches, setOrderFailedMatches] = useState<string[]>([]);
  const [editingOrder, setEditingOrder] = useState<SavedSlip | null>(null);
  const [orderEditName, setOrderEditName] = useState("");
  const [orderEditTime, setOrderEditTime] = useState("");
  const [orderEditMatches, setOrderEditMatches] = useState<MatchItem[]>([]);
  const [orderEditOddsLocked, setOrderEditOddsLocked] = useState(false);
  const [expandedOrderIds, setExpandedOrderIds] = useState<string[]>([]);
  const [orderOddsRefreshing, setOrderOddsRefreshing] = useState(false);
  const [savedSlips, setSavedSlips] = useState<SavedSlip[]>(() => {
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      return raw ? JSON.parse(raw) as SavedSlip[] : [];
    } catch {
      return [];
    }
  });
  const [matchResults, setMatchResults] = useState<MatchResults>({});
  const [resultFetchingMatchIds, setResultFetchingMatchIds] = useState<string[]>([]);
  const [allResultsFetching, setAllResultsFetching] = useState(false);
  const [matchResultsCollapsed, setMatchResultsCollapsed] = useState(true);
  const [orderDateRange, setOrderDateRange] = useState<[string, string] | null>(null);
  const [orderProgressFilter, setOrderProgressFilter] = useState<OrderProgressFilter>("unsettled");
  const [orderStatusFilters, setOrderStatusFilters] = useState<OrderStatusFilter[]>(["hopeful"]);
  const [expenseTotal, setExpenseTotal] = useState(() => {
    const stored = Number(localStorage.getItem(EXPENSE_KEY));
    if (localStorage.getItem(EXPENSE_KEY) !== null && Number.isFinite(stored)) return Math.max(0, stored);
    return savedSlips.reduce((total, slip) => total + calculateStake(slip.matches, slip.passes, slip.multiple), 0);
  });
  const [incomeTotal, setIncomeTotal] = useState(() => {
    const stored = Number(localStorage.getItem(INCOME_KEY));
    if (localStorage.getItem(INCOME_KEY) !== null && Number.isFinite(stored)) return Math.max(0, stored);
    const oldProfit = Number(localStorage.getItem(PROFIT_KEY));
    const derivedExpense = savedSlips.reduce((total, slip) => total + calculateStake(slip.matches, slip.passes, slip.multiple), 0);
    if (localStorage.getItem(PROFIT_KEY) !== null && Number.isFinite(oldProfit)) return Math.max(0, oldProfit + derivedExpense);
    return savedSlips.reduce((total, slip) => total + (slip.settledPrize ?? 0), 0);
  });
  const [expenseEditing, setExpenseEditing] = useState(false);
  const [incomeEditing, setIncomeEditing] = useState(false);
  const [expenseDraft, setExpenseDraft] = useState(0);
  const [incomeDraft, setIncomeDraft] = useState(0);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [manualOrderOpen, setManualOrderOpen] = useState(false);
  const [manualOrderName, setManualOrderName] = useState("");
  const [manualOrderPassText, setManualOrderPassText] = useState("");
  const [manualOrderMultiple, setManualOrderMultiple] = useState(1);
  const [manualOrderEntries, setManualOrderEntries] = useState<ManualOrderEntry[]>(() => [createManualOrderEntry()]);
  const [manualPickerEntryKey, setManualPickerEntryKey] = useState<string | null>(null);
  const [manualPickerMatch, setManualPickerMatch] = useState<MatchItem | null>(null);
  const [sportteryLoaded, setSportteryLoaded] = useState(false);
  const [sportteryRefreshing, setSportteryRefreshing] = useState(false);
  const [sportteryLastUpdateTime, setSportteryLastUpdateTime] = useState("");
  const [sportteryFetchMode, setSportteryFetchMode] = useState<SportteryMatchFetchMode>(() => getSportteryRefreshPolicy().mode);
  const [saleClock, setSaleClock] = useState(() => Date.now());
  const [matchDates, setMatchDates] = useState<SportteryMatchDate[]>(() => cachedMatchDates(matches));
  const [leagueOptions, setLeagueOptions] = useState<SportteryLeague[]>(() => cachedLeagueOptions(matches));
  const [selectedMatchDate, setSelectedMatchDate] = useState<string | null>(null);
  const [onlySellableMatches, setOnlySellableMatches] = useState(true);
  const [visibleLeagueNames, setVisibleLeagueNames] = useState<string[] | null>(null);
  const [collapsedMatchDates, setCollapsedMatchDates] = useState<string[]>([]);
  const initializedMatchDateCollapseRef = useRef(new Set<string>());
  const autoCollapsedMatchDatesRef = useRef(new Set<string>());
  const [appSettings, setAppSettings] = useState<AppSettings>(() => loadAppSettings());
  const saleNow = useMemo(() => new Date(saleClock), [saleClock]);

  const applySportterySnapshot = useCallback((snapshot: SportteryMatchSnapshot) => {
    const updateVisibleMatches = activeView === "betting" && !temporaryOrder;
    const currentCache = updateVisibleMatches ? matchesRef.current : loadCachedMatches();
    const mergedMatches = mergeSportteryMatchCache(currentCache, snapshot.matches, dateKeyFromToday(0));
    saveCachedMatches(mergedMatches);
    if (updateVisibleMatches) {
      const nextDates = cachedMatchDates(mergedMatches, snapshot.matchDates);
      const nextLeagues = cachedLeagueOptions(mergedMatches, snapshot.leagues);
      matchesRef.current = mergedMatches;
      setMatches(mergedMatches);
      setMatchDates(nextDates);
      setLeagueOptions(nextLeagues);
      setSelectedMatchDate((current) => current && nextDates.some((item) => item.businessDate === current) ? current : null);
      setVisibleLeagueNames((current) => current?.filter((name) => nextLeagues.some((item) => item.leagueNameAbbr === name)) ?? null);
    }
    setSportteryFetchMode(snapshot.mode);
    setSportteryLastUpdateTime(snapshot.lastUpdateTime);
    setSportteryLoaded(true);
  }, [activeView, temporaryOrder]);

  useEffect(() => {
    localStorage.removeItem(LEGACY_DRAFT_KEY);
    localStorage.removeItem(LEGACY_MATCH_RESULTS_KEY);
  }, []);

  useEffect(() => {
    if (!loadedOrderDraft) return;
    sessionStorage.removeItem(LOADED_ORDER_KEY);
    message.success(`已载入“${loadedOrderDraft.name}”，保存时将更新当前订单`);
  }, [loadedOrderDraft, message]);

  useEffect(() => {
    localStorage.setItem(EXPENSE_KEY, String(expenseTotal));
  }, [expenseTotal]);

  useEffect(() => {
    localStorage.setItem(INCOME_KEY, String(incomeTotal));
  }, [incomeTotal]);

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
    matches.forEach((match) => dateAvailability.set(match.date, (dateAvailability.get(match.date) ?? false) || isMatchSellable(match, saleNow)));
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
    const mode = getSportteryRefreshPolicy(new Date()).mode;
    void fetchSportteryMatchSnapshot(mode)
      .then((snapshot) => {
        if (!active) return;
        applySportterySnapshot(snapshot);
        console.log("[体彩接口] 进入投注页获取比赛", { mode, totalCount: snapshot.matches.length, fixedBonusFailureCount: snapshot.fixedBonusFailureCount });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSportteryLoaded(true);
        console.error("[体彩接口] 进入投注页获取比赛失败", error);
      });
    return () => { active = false; };
  }, [activeView, applySportterySnapshot, temporaryOrder]);

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
            const snapshot = await fetchSportteryMatchSnapshot(policy.mode);
            if (!disposed) applySportterySnapshot(snapshot);
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
  }, [activeView, applySportterySnapshot, temporaryOrder]);

  const refreshSportteryData = async () => {
    setSportteryRefreshing(true);
    try {
      const mode = getSportteryRefreshPolicy(new Date()).mode;
      const snapshot = await fetchSportteryMatchSnapshot(mode);
      applySportterySnapshot(snapshot);
      notification.success({
        title: "比赛数据已刷新",
        description: `${mode === "morning" ? "早间逐场最新赔率" : "常规比赛接口"} · 共 ${snapshot.matches.length} 场${snapshot.fixedBonusFailureCount ? ` · ${snapshot.fixedBonusFailureCount} 场投注情况获取失败` : ""}${snapshot.lastUpdateTime ? ` · 接口更新 ${snapshot.lastUpdateTime}` : ""}`,
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

  const navigateToView = (view: AppView) => {
    if (view !== "betting" && temporaryOrder) {
      sessionStorage.setItem(LOADED_ORDER_KEY, JSON.stringify({
        id: temporaryOrder.id,
        name: temporaryOrder.name,
        matches: cloneMatches(matches),
        passes: [...activePasses],
        multiple,
        hits: cloneHits(hits),
      } satisfies LoadedOrderDraft));
    }
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
      "--header-content-gap",
      "--header-content-bottom",
      "--header-note-pad-top",
      "--header-note-pad-bottom",
    ];
    const updateHeader = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const progress = Math.min(1, Math.max(0, window.scrollY / 180));
        const root = document.documentElement;
        root.style.setProperty("--header-top-pad", `${26 - progress * 16}px`);
        root.style.setProperty("--header-bottom-pad", `${10 * progress}px`);
        root.style.setProperty("--header-content-height", `${84 - progress * 44}px`);
        root.style.setProperty("--header-brand-size", `${54 - progress * 14}px`);
        root.style.setProperty("--header-title-size", `${36 - progress * 12}px`);
        root.style.setProperty("--header-note-opacity", `${1 - progress}`);
        root.style.setProperty("--header-note-height", `${44 * (1 - progress)}px`);
        root.style.setProperty("--header-note-margin", `${20 * (1 - progress)}px`);
        root.style.setProperty("--header-label-width", `${84 * (1 - progress)}px`);
        root.style.setProperty("--header-action-gap", `${10 - progress * 4}px`);
        root.style.setProperty("--header-brand-opacity", `${1 - progress}`);
        root.style.setProperty("--header-brand-width", `${460 * (1 - progress)}px`);
        root.style.setProperty("--header-brand-height", `${60 * (1 - progress)}px`);
        root.style.setProperty("--header-brand-translate", `${-7 * progress}px`);
        root.style.setProperty("--header-content-gap", `${24 * (1 - progress)}px`);
        root.style.setProperty("--header-content-bottom", `${12 * (1 - progress)}px`);
        root.style.setProperty("--header-note-pad-top", `${10 * (1 - progress)}px`);
        root.style.setProperty("--header-note-pad-bottom", `${12 * (1 - progress)}px`);
      });
    };
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateHeader);
      propertyNames.forEach((name) => document.documentElement.style.removeProperty(name));
    };
  }, []);

  const betCount = useMemo(() => countBets(matches, activePasses), [matches, activePasses]);
  const stake = useMemo(() => calculateStake(matches, activePasses, multiple), [matches, activePasses, multiple]);
  const prizeRange = useMemo(() => calculatePrizeRange(matches, activePasses, multiple), [matches, activePasses, multiple]);
  const currentPrize = useMemo(() => calculateCurrentPrize(matches, activePasses, multiple, hits), [matches, activePasses, multiple, hits]);
  const currentProfit = currentPrize - stake;
  const netProfit = incomeTotal - expenseTotal;
  const orderDetailStake = orderDetail ? calculateStake(orderDetail.matches, orderDetail.passes, orderDetail.multiple) : 0;
  const orderDetailPrize = orderDetail ? calculateCurrentPrize(orderDetail.matches, orderDetail.passes, orderDetail.multiple, orderHits) : 0;
  const orderDetailProfit = orderDetailPrize - orderDetailStake;
  const orderDetailRange = orderDetail ? calculatePrizeRange(orderDetail.matches, orderDetail.passes, orderDetail.multiple) : { min: 0, max: 0, uncappedMax: 0 };
  const orderDetailMatches = orderDetail ? sortMatchesForDisplay(selectedMatches(orderDetail.matches)) : [];
  const orderDetailPickedCount = orderDetailMatches.reduce((total, match) => total + selectedOptions(match).length, 0);
  const filteredSavedSlips = useMemo(() => savedSlips
    .filter((slip) => {
      if (orderProgressFilter === "settled" && !slip.settledAt) return false;
      if (orderProgressFilter === "unsettled" && slip.settledAt) return false;
      if (orderStatusFilters.length > 0 && !orderStatusFilters.includes(getOrderStatus(slip))) return false;
      if (!orderDateRange) return true;
      const savedDate = savedSlipDateKey(slip.savedAt);
      return savedDate >= orderDateRange[0] && savedDate <= orderDateRange[1];
    })
    .sort((left, right) => {
      const leftTime = new Date(left.savedAt).getTime();
      const rightTime = new Date(right.savedAt).getTime();
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    }), [savedSlips, orderDateRange, orderProgressFilter, orderStatusFilters]);
  const unsettledOrderCount = useMemo(() => savedSlips.filter((slip) => !slip.settledAt).length, [savedSlips]);
  const visibleUnlockedOrderCount = useMemo(
    () => filteredSavedSlips.filter((slip) => !isOrderOddsLocked(slip)).length,
    [filteredSavedSlips],
  );
  const visibleSettleableOrders = useMemo(
    () => filteredSavedSlips.filter(isOrderSettleable),
    [filteredSavedSlips],
  );
  const filteredOrderStake = useMemo(
    () => filteredSavedSlips.reduce((total, slip) => total + calculateStake(slip.matches, slip.passes, slip.multiple), 0),
    [filteredSavedSlips],
  );
  const resultMatches = useMemo(() => {
    const unique = new Map<string, MatchItem>();
    filteredSavedSlips
      .filter((slip) => !slip.settledAt)
      .forEach((slip) => selectedMatches(slip.matches)
        .filter((match) => !(slip.failedMatches ?? []).includes(match.id) && !matchHasSelectedHit(match, slip.hits ?? {}))
        .forEach((match) => {
        const matchId = normalizeSportteryMatchId(match.id);
        if (!unique.has(matchId)) unique.set(matchId, match);
        }));
    return sortMatchesForDisplay([...unique.values()]);
  }, [filteredSavedSlips]);

  const availableMatchDateSet = useMemo(() => new Set(matchDates
    .filter((date) => matches.some((match) => match.date === date.businessDate && (!onlySellableMatches || isMatchSellable(match, saleNow))))
    .map((item) => item.businessDate)), [matchDates, matches, onlySellableMatches, saleNow]);
  const visibleLeagueSet = useMemo(
    () => new Set(visibleLeagueNames ?? leagueOptions.map((item) => item.leagueNameAbbr)),
    [leagueOptions, visibleLeagueNames],
  );
  const settingsLeagueNames = useMemo(() => [...new Set([
    ...Object.keys(DEFAULT_LEAGUE_TAG_COLORS),
    ...leagueOptions.map((item) => leagueColorSettingKey(item.leagueNameAbbr)),
    ...Object.keys(appSettings.appearance.leagueTagColors),
  ])], [appSettings.appearance.leagueTagColors, leagueOptions]);
  const filteredMatches = useMemo(() => matches
    .filter((match) => !selectedMatchDate || match.date === selectedMatchDate)
    .filter((match) => !onlySellableMatches || isMatchSellable(match, saleNow))
    .filter((match) => leagueOptions.length === 0 || visibleLeagueSet.has(match.league))
    .sort(compareMatchDisplayOrder), [leagueOptions.length, matches, onlySellableMatches, saleNow, selectedMatchDate, visibleLeagueSet]);

  const groupedMatches = useMemo(() => {
    const groups = new Map<string, MatchItem[]>();
    filteredMatches.forEach((match) => groups.set(match.date, [...(groups.get(match.date) ?? []), match]));
    return Array.from(groups.entries());
  }, [filteredMatches]);

  const moreMatch = matches.find((match) => match.id === moreMatchId) ?? null;

  const toggleOption = (matchId: string, type: MarketType, optionId: string) => {
    const targetMatch = matches.find((match) => match.id === matchId);
    const option = targetMatch?.markets.find((market) => market.type === type)?.options.find((item) => item.id === optionId);
    if (!targetMatch || !isMatchSellable(targetMatch) || !option || option.odds <= 0) return;
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

  const persistNewOrder = (name: string, orderMatches: MatchItem[], orderPasses: number[], orderMultiple: number, source: string) => {
    const nextOrder: SavedSlip = {
      id: createSlipId(),
      name: name.trim() || `${source}订单 ${new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
      savedAt: new Date().toISOString(),
      matches: cloneMatches(orderMatches),
      passes: [...orderPasses],
      multiple: orderMultiple,
      oddsLocked: false,
      hits: {},
    };
    const all = [nextOrder, ...savedSlips];
    setSavedSlips(all);
    setExpenseTotal((current) => current + calculateStake(nextOrder.matches, nextOrder.passes, nextOrder.multiple));
    localStorage.setItem(SAVED_KEY, JSON.stringify(all));
    notification.success({
      message: "订单添加完成",
      description: `新增 1 个订单，包含 ${selectedMatches(orderMatches).length} 场比赛`,
      placement: "bottomRight",
    });
  };

  const restoreSavedMatches = () => {
    sessionStorage.removeItem(LOADED_ORDER_KEY);
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

  const openManualOrder = () => {
    setManualOrderName("");
    setManualOrderPassText("");
    setManualOrderMultiple(1);
    setManualOrderEntries([createManualOrderEntry()]);
    setManualPickerEntryKey(null);
    setManualPickerMatch(null);
    setManualOrderOpen(true);
  };

  const updateManualOrderEntry = (key: string, patch: Partial<ManualOrderEntry>) => {
    setManualOrderEntries((current) => current.map((entry) => entry.key === key ? { ...entry, ...patch } : entry));
  };

  const addManualOrderEntry = () => {
    if (manualOrderEntries.length >= MAX_SELECTED_MATCHES) {
      message.warning(`最多可选择 ${MAX_SELECTED_MATCHES} 场比赛`);
      return;
    }
    setManualOrderEntries((current) => [...current, createManualOrderEntry()]);
  };

  const selectManualOrderMatch = (entryKey: string, matchId: string | null) => {
    const source = matchId ? matches.find((match) => normalizeSportteryMatchId(match.id) === normalizeSportteryMatchId(matchId)) : null;
    if (!source) {
      updateManualOrderEntry(entryKey, { matchId: null, text: "" });
      return;
    }
    const draft = matchWithClearedSelections(source);
    updateManualOrderEntry(entryKey, { matchId: draft.id, text: formatManualMatchText(draft) });
  };

  const openManualMatchPicker = (entry: ManualOrderEntry) => {
    const source = entry.matchId ? matches.find((match) => normalizeSportteryMatchId(match.id) === normalizeSportteryMatchId(entry.matchId!)) : null;
    if (!source) {
      message.info("请先从已保存比赛中选择一场；找不到时可直接手动填写文本");
      return;
    }
    const draft = matchWithClearedSelections(source);
    const parsed = parseRecognizedText(entry.text, { selectOptions: true })[0];
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

  const addManualOrder = () => {
    if (manualOrderEntries.length > MAX_SELECTED_MATCHES) {
      message.warning(`最多可选择 ${MAX_SELECTED_MATCHES} 场比赛`);
      return;
    }
    const parsedEntries = manualOrderEntries.map((entry) => parseRecognizedText(entry.text, { selectOptions: true }));
    const invalidIndex = parsedEntries.findIndex((entryMatches) => entryMatches.length !== 1 || selectedMatches(entryMatches).length !== 1);
    if (invalidIndex >= 0) {
      message.warning(`第 ${invalidIndex + 1} 场没有识别到完整比赛及投注项`);
      return;
    }
    const parsed = parsedEntries.flat();
    const invalidIdIndex = parsed.findIndex((match) => !/^\d{7}$/.test(normalizeSportteryMatchId(match.id)));
    if (invalidIdIndex >= 0) {
      message.warning(`第 ${invalidIdIndex + 1} 场需要填写 7 位比赛 ID`);
      return;
    }
    const normalizedMatches = parsed.map((match) => ({ ...match, id: normalizeSportteryMatchId(match.id) }));
    if (new Set(normalizedMatches.map((match) => match.id)).size !== normalizedMatches.length) {
      message.warning("同一比赛不能重复添加");
      return;
    }
    const combinedText = manualOrderEntries.map((entry) => entry.text).join("\n\n");
    const orderPasses = inferOrderPasses(manualOrderPassText || combinedText, normalizedMatches);
    persistNewOrder(manualOrderName, normalizedMatches, orderPasses, manualOrderMultiple, "手动");
    setManualOrderOpen(false);
  };

  const saveSlip = () => {
    const nextName = saveName.trim() || dayjs().format("YYYY年MM月DD日 HH时mm分ss秒");
    const orderId = temporaryOrder?.id ?? createSlipId();
    const loadedOrderIndex = temporaryOrder ? savedSlips.findIndex((slip) => slip.id === temporaryOrder.id) : -1;
    const previousOrder = loadedOrderIndex >= 0 ? savedSlips[loadedOrderIndex] : null;
    if (previousOrder?.settledAt) {
      message.warning("该订单已结账，不能再更新");
      return;
    }
    const next: SavedSlip = {
      id: orderId,
      name: nextName,
      savedAt: previousOrder?.savedAt ?? new Date().toISOString(),
      matches: cloneMatches(matches),
      passes: [...activePasses],
      multiple,
      oddsLocked: previousOrder?.oddsLocked ?? false,
      hits: cloneHits(hits),
      failedMatches: previousOrder?.failedMatches?.filter((matchId) => matches.some((match) => match.id === matchId)) ?? [],
    };
    const all = loadedOrderIndex >= 0
      ? savedSlips.map((slip, index) => index === loadedOrderIndex ? next : slip)
      : [next, ...savedSlips];
    const previousStake = previousOrder ? calculateStake(previousOrder.matches, previousOrder.passes, previousOrder.multiple) : 0;
    const nextStake = calculateStake(next.matches, next.passes, next.multiple);
    setSavedSlips(all);
    setExpenseTotal((current) => Math.max(0, current + nextStake - previousStake));
    localStorage.setItem(SAVED_KEY, JSON.stringify(all));
    if (temporaryOrder) setTemporaryOrder({ id: orderId, name: next.name });
    setSaveOpen(false);
    setSaveName("");
    message.success(loadedOrderIndex >= 0 ? "预测单已更新" : "预测单已保存到本机");
  };

  const openSaveSlip = () => {
    setSaveName(temporaryOrder?.name ?? "");
    setSaveOpen(true);
  };

  const loadSlip = (slip: SavedSlip) => {
    if (slip.settledAt) {
      message.warning("该订单已结账，不能再载入修改");
      return;
    }
    const orderId = slip.id || createSlipId();
    const loadedSlip = slip.id ? slip : { ...slip, id: orderId };
    if (!slip.id) {
      const nextSavedSlips = savedSlips.map((item) => item === slip ? loadedSlip : item);
      setSavedSlips(nextSavedSlips);
      localStorage.setItem(SAVED_KEY, JSON.stringify(nextSavedSlips));
    }
    setMatches(cloneMatches(loadedSlip.matches));
    setPasses([...loadedSlip.passes]);
    setMultiple(loadedSlip.multiple);
    setHits(cloneHits(loadedSlip.hits));
    setTemporaryOrder({ id: orderId, name: loadedSlip.name });
    sessionStorage.setItem(LOADED_ORDER_KEY, JSON.stringify({
      id: orderId,
      name: loadedSlip.name,
      matches: cloneMatches(loadedSlip.matches),
      passes: [...loadedSlip.passes],
      multiple: loadedSlip.multiple,
      hits: cloneHits(loadedSlip.hits),
    } satisfies LoadedOrderDraft));
    navigateToView("betting");
  };

  const deleteSlip = (target: SavedSlip) => {
    if (!savedSlips.includes(target)) return;
    const next = savedSlips.filter((slip) => slip !== target);
    setSavedSlips(next);
    setExpenseTotal((current) => Math.max(0, current - calculateStake(target.matches, target.passes, target.multiple)));
    if (target.settledAt) setIncomeTotal((current) => Math.max(0, current - (target.settledPrize ?? 0)));
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  };

  const toggleOrderExpanded = (id: string) => {
    setExpandedOrderIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const expandAllOrderOptions = () => {
    const visibleOrderKeys = filteredSavedSlips.map((slip, index) => slip.id || `legacy-${slip.savedAt}-${index}`);
    setExpandedOrderIds((current) => [...new Set([...current, ...visibleOrderKeys])]);
  };

  const lockVisibleOrderOdds = () => {
    const visibleUnlockedOrders = new Set(filteredSavedSlips.filter((slip) => !isOrderOddsLocked(slip)));
    if (visibleUnlockedOrders.size === 0) {
      message.info("当前查看的订单倍率均已锁定");
      return;
    }

    const nextOrders = savedSlips.map((slip) => visibleUnlockedOrders.has(slip) ? { ...slip, oddsLocked: true } : slip);
    const detailIndex = orderDetail ? savedSlips.findIndex((slip) => slip === orderDetail || Boolean(orderDetail.id && slip.id === orderDetail.id)) : -1;
    setSavedSlips(nextOrders);
    localStorage.setItem(SAVED_KEY, JSON.stringify(nextOrders));
    if (detailIndex >= 0) setOrderDetail(nextOrders[detailIndex]);
    notification.success({
      title: "倍率锁定完成",
      description: `已锁定当前查看的 ${visibleUnlockedOrders.size} 个订单`,
      placement: "bottomRight",
    });
  };

  const refreshUnlockedOrderOdds = async () => {
    const unlockedOrderCount = savedSlips.filter((slip) => !isOrderOddsLocked(slip)).length;
    if (unlockedOrderCount === 0) {
      message.info("没有可更新的未锁定订单");
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
        if (isOrderOddsLocked(slip)) return slip;
        const refreshed = refreshSelectedOdds(slip.matches, latestMatches);
        matchedOptionCount += refreshed.matchedOptionCount;
        changedOptionCount += refreshed.changedOptionCount;
        unmatchedOptionCount += refreshed.unmatchedOptionCount;
        return { ...slip, matches: refreshed.matches };
      });
      const detailIndex = orderDetail ? savedSlips.findIndex((slip) => slip === orderDetail || Boolean(orderDetail.id && slip.id === orderDetail.id)) : -1;
      setSavedSlips(nextOrders);
      localStorage.setItem(SAVED_KEY, JSON.stringify(nextOrders));
      if (detailIndex >= 0) setOrderDetail(nextOrders[detailIndex]);
      notification.success({
        title: "订单倍率更新完成",
        description: `已检查 ${unlockedOrderCount} 个未锁定订单，匹配 ${matchedOptionCount} 个投注项，${changedOptionCount} 项倍率发生变化${unmatchedOptionCount ? `；${unmatchedOptionCount} 项暂无最新可售倍率，已保留原值` : ""}`,
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
    setOrderEditOddsLocked(isOrderOddsLocked(slip));
  };

  const closeOrderEditor = () => {
    setEditingOrder(null);
    setOrderEditName("");
    setOrderEditTime("");
    setOrderEditMatches([]);
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

  const saveOrderHits = () => {
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
    const next = savedSlips.map((slip) => slip === orderDetail ? updated : slip);
    setSavedSlips(next);
    setOrderDetail(updated);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    notification.success({ message: "比赛结果已保存", description: `已更新订单“${updated.name}”的命中与失败状态`, placement: "bottomRight" });
  };

  const updateMatchResult = (match: MatchItem, type: MarketType, optionId?: string) => {
    const matchId = normalizeSportteryMatchId(match.id);
    setMatchResults((current) => {
      const values = { ...(current[matchId]?.values ?? {}) };
      if (optionId) values[type] = optionId;
      else delete values[type];
      const next = { ...current };
      if (Object.keys(values).length > 0) next[matchId] = { matchId, updatedAt: new Date().toISOString(), source: "manual", values };
      else delete next[matchId];
      return next;
    });
  };

  const requestMatchResult = async (match: MatchItem) => {
    const matchId = normalizeSportteryMatchId(match.id);
    const scorePayload = await fetchSportteryMatchScore(matchId);
    const phase = getSportteryMatchPhaseTc(scorePayload);
    console.log("[体彩接口] 比分与比赛阶段原始数据", scorePayload);
    if (!isSportteryRegularTimeFinished(scorePayload)) return { status: "unfinished" as const, phase };
    const values = parseSportteryMatchScore(scorePayload, match);
    if (Object.keys(values).length === 0) throw new Error("常规时间已结束，但比分接口暂未返回可识别比分");
    const nextResult = { matchId, updatedAt: new Date().toISOString(), source: "api" as const, values };
    setMatchResults((current) => ({ ...current, [matchId]: nextResult }));
    return { status: "success" as const, valueCount: Object.keys(values).length };
  };

  const fetchMatchResult = async (match: MatchItem) => {
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

  const judgeVisibleOrders = () => {
    const visibleOrders = new Set(filteredSavedSlips.filter((slip) => !slip.settledAt));
    if (visibleOrders.size === 0) {
      message.info("当前没有可判断的未结账订单");
      return;
    }
    const availableResultCount = resultMatches.filter((match) => Object.keys(matchResults[normalizeSportteryMatchId(match.id)]?.values ?? {}).length > 0).length;
    if (availableResultCount === 0) {
      message.warning("请先填写或获取赛果");
      return;
    }
    const next = savedSlips.map((slip) => visibleOrders.has(slip) ? judgeSlipWithResults(slip, matchResults) : slip);
    setSavedSlips(next);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    if (orderDetail) {
      const updatedDetail = next.find((slip) => slip === orderDetail || Boolean(orderDetail.id && slip.id === orderDetail.id));
      if (updatedDetail) {
        setOrderDetail(updatedDetail);
        setOrderHits(cloneHits(updatedDetail.hits));
        setOrderFailedMatches([...(updatedDetail.failedMatches ?? [])]);
      }
    }
    const failedOrders = next.filter((slip) => visibleOrders.has(slip) && isOrderFailed(slip)).length;
    notification.success({ message: "订单判断完成", description: `已判断 ${visibleOrders.size} 个未结账订单${failedOrders ? `，其中 ${failedOrders} 个订单已不符合串关条件` : ""}`, placement: "bottomRight" });
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

  const saveOrderEdits = () => {
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
    const hasInvalidOdds = !editingOrder.settledAt && selectedMatches(orderEditMatches).some((match) => match.markets.some((market) => market.options.some((option) => option.selected && option.odds <= 0)));
    if (hasInvalidOdds) {
      message.warning("请为所有已选项填写大于 0 的倍率");
      return;
    }
    const updated: SavedSlip = {
      ...editingOrder,
      id: editingOrder.id || createSlipId(),
      name: nextName,
      savedAt: nextTime.millisecond(0).toISOString(),
      matches: editingOrder.settledAt ? cloneMatches(editingOrder.matches) : cloneMatches(orderEditMatches),
      oddsLocked: Boolean(editingOrder.settledAt || orderEditOddsLocked),
    };
    const sameOrder = (slip: SavedSlip) => slip === editingOrder || Boolean(editingOrder.id && slip.id === editingOrder.id);
    const next = savedSlips.map((slip) => sameOrder(slip) ? updated : slip);
    setSavedSlips(next);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    if (orderDetail && sameOrder(orderDetail)) setOrderDetail(updated);
    if (temporaryOrder?.id === updated.id) {
      setMatches(cloneMatches(updated.matches));
      setTemporaryOrder({ id: updated.id!, name: updated.name });
    }
    closeOrderEditor();
    notification.success({ message: "订单已更新", description: `已保存“${updated.name}”的${editingOrder.settledAt ? "名称和时间" : "名称、时间和倍率"}`, placement: "bottomRight" });
  };

  const settleOrders = (targets: SavedSlip[]) => {
    const settleableTargets = targets.filter((target) => savedSlips.includes(target) && isOrderSettleable(target));
    if (settleableTargets.length === 0) return;
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
    const next = savedSlips.map((slip) => settledOrders.get(slip) ?? slip);
    const settledPrizeTotal = [...settledOrders.values()].reduce((total, slip) => total + (slip.settledPrize ?? 0), 0);
    setSavedSlips(next);
    setIncomeTotal((current) => current + settledPrizeTotal);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    const settledDetail = orderDetail ? settledOrders.get(orderDetail) : undefined;
    if (settledDetail) setOrderDetail(settledDetail);
    if (temporaryOrder && [...settledOrders.values()].some((slip) => slip.id === temporaryOrder.id)) restoreSavedMatches();
    notification.success({
      message: settleableTargets.length === 1 ? "订单结账完成" : `${settleableTargets.length} 个订单结账完成`,
      description: settledPrizeTotal > 0 ? `中奖奖金 ¥${currency(settledPrizeTotal)} 已计入累计收入` : "中奖金额为 ¥0.00，订单已锁定",
      placement: "bottomRight",
    });
  };

  const withdrawOrderSettlement = (target: SavedSlip) => {
    if (!target.settledAt || !savedSlips.includes(target)) return;
    const withdrawn: SavedSlip = {
      ...target,
      settledAt: undefined,
      settledPrize: undefined,
      oddsLocked: target.oddsLockedBeforeSettlement ?? false,
      oddsLockedBeforeSettlement: undefined,
    };
    const next = savedSlips.map((slip) => slip === target ? withdrawn : slip);
    setSavedSlips(next);
    setIncomeTotal((current) => Math.max(0, current - (target.settledPrize ?? 0)));
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    if (orderDetail === target) setOrderDetail(withdrawn);
    notification.success({
      message: "结账已撤回",
      description: `订单已恢复为未结账状态，累计收入已扣除 ¥${currency(target.settledPrize ?? 0)}`,
      placement: "bottomRight",
    });
  };

  const downloadJson = (payload: object, filename: string) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
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
    downloadJson(payload, `竞彩足球-${label}-${exportedAt.slice(0, 10)}.json`);
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

  const mergeOrders = (incomingOrders: SavedSlip[]) => {
    const nextOrders = [...savedSlips];
    let added = 0;
    let updated = 0;
    let expenseDelta = 0;
    let incomeDelta = 0;
    incomingOrders.forEach((order) => {
      const index = nextOrders.findIndex((item) => item.id === order.id);
      if (index >= 0) {
        expenseDelta += calculateStake(order.matches, order.passes, order.multiple) - calculateStake(nextOrders[index].matches, nextOrders[index].passes, nextOrders[index].multiple);
        incomeDelta += (order.settledPrize ?? 0) - (nextOrders[index].settledPrize ?? 0);
        nextOrders[index] = order;
        updated += 1;
      } else {
        nextOrders.push(order);
        expenseDelta += calculateStake(order.matches, order.passes, order.multiple);
        incomeDelta += order.settledPrize ?? 0;
        added += 1;
      }
    });
    return { nextOrders, added, updated, expenseDelta, incomeDelta };
  };

  const importDataJson = async (file: File, mode: DataTransferMode) => {
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("JSON 文件不能超过 20 MB");
      const rawPayload = JSON.parse(await file.text()) as unknown;
      if (!rawPayload || typeof rawPayload !== "object") throw new Error("JSON 文件内容无效");
      const payload = rawPayload as Record<string, unknown>;
      const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : payload;

      if (mode === "settings") {
        if (!data.settings || typeof data.settings !== "object") throw new Error("文件中缺少 settings 对象");
        const nextSettings = saveAppSettings(normalizeAppSettings(data.settings));
        setAppSettings(nextSettings);
        notification.success({ message: "设置导入完成", description: "联赛标签颜色已更新", placement: "bottomRight" });
        return;
      }

      const restoreMatches = () => {
        const rawMatches = data.matches;
        if (!Array.isArray(rawMatches)) throw new Error("文件中缺少 matches 数组");
        if (!rawMatches.every(isExportedMatch)) throw new Error("比赛数据结构与导出格式不一致");
        const restoredMatches = mergeSportteryMatchCache([], JSON.parse(JSON.stringify(rawMatches)) as MatchItem[], dateKeyFromToday(0));
        saveCachedMatches(restoredMatches);
        matchesRef.current = restoredMatches;
        if (!temporaryOrder) setMatches(restoredMatches);
        setMatchDates(cachedMatchDates(restoredMatches));
        setLeagueOptions(cachedLeagueOptions(restoredMatches));
        return restoredMatches;
      };

      if (mode === "matches") {
        const restoredMatches = restoreMatches();
        notification.success({ message: "比赛数据导入完成", description: `已恢复 ${restoredMatches.length} 场 5 天内比赛`, placement: "bottomRight" });
        return;
      }

      const rawOrders = data.orders;
      if (!Array.isArray(rawOrders)) throw new Error("文件中缺少 orders 数组");
      if (!rawOrders.every(isExportedOrder)) throw new Error("订单数据结构与导出格式不一致");
      const importKey = createSlipId();
      const incomingOrders = (JSON.parse(JSON.stringify(rawOrders)) as SavedSlip[]).map((order, index) => ({ ...order, id: order.id || `${importKey}-${index}` }));

      if (mode === "full") {
        if (!data.settings || typeof data.settings !== "object") throw new Error("完整数据中缺少 settings 对象");
        const finance = data.finance && typeof data.finance === "object" ? data.finance as Record<string, unknown> : null;
        const importedExpense = Number(finance?.expenseTotal);
        const importedIncome = Number(finance?.incomeTotal);
        if (!finance || !Number.isFinite(importedExpense) || !Number.isFinite(importedIncome) || importedExpense < 0 || importedIncome < 0) {
          throw new Error("完整数据中的 finance 账本无效");
        }
        const restoredOrders = [...incomingOrders].sort((left, right) => new Date(right.savedAt).getTime() - new Date(left.savedAt).getTime());
        const restoredSettings = normalizeAppSettings(data.settings);
        const rawMatches = data.matches;
        if (!Array.isArray(rawMatches) || !rawMatches.every(isExportedMatch)) throw new Error("完整数据中的 matches 比赛数据无效");
        const restoredMatches = mergeSportteryMatchCache([], JSON.parse(JSON.stringify(rawMatches)) as MatchItem[], dateKeyFromToday(0));
        modal.confirm({
          title: "恢复完整数据？",
          content: `将覆盖当前本地订单、比赛、设置和账本，恢复 ${restoredOrders.length} 个订单与 ${restoredMatches.length} 场比赛。`,
          okText: "覆盖恢复",
          cancelText: "取消",
          okButtonProps: { danger: true },
          onOk: () => {
            setSavedSlips(restoredOrders);
            setAppSettings(saveAppSettings(restoredSettings));
            setExpenseTotal(importedExpense);
            setIncomeTotal(importedIncome);
            saveCachedMatches(restoredMatches);
            matchesRef.current = restoredMatches;
            if (!temporaryOrder) setMatches(restoredMatches);
            setMatchDates(cachedMatchDates(restoredMatches));
            setLeagueOptions(cachedLeagueOptions(restoredMatches));
            localStorage.setItem(SAVED_KEY, JSON.stringify(restoredOrders));
            localStorage.setItem(EXPENSE_KEY, String(importedExpense));
            localStorage.setItem(INCOME_KEY, String(importedIncome));
            notification.success({ message: "完整数据恢复完成", description: `已恢复 ${restoredOrders.length} 个订单、${restoredMatches.length} 场比赛、设置与账本`, placement: "bottomRight" });
          },
        });
        return;
      }

      const { nextOrders, added, updated, expenseDelta, incomeDelta } = mergeOrders(incomingOrders);
      setSavedSlips(nextOrders);
      setExpenseTotal((current) => Math.max(0, current + expenseDelta));
      setIncomeTotal((current) => Math.max(0, current + incomeDelta));
      localStorage.setItem(SAVED_KEY, JSON.stringify(nextOrders));
      notification.success({ message: "订单导入完成", description: `新增 ${added} 个，更新 ${updated} 个`, placement: "bottomRight" });
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
    setMatches((current) => current.map((match) => ({
      ...match,
      markets: match.markets.map((market) => ({
        ...market,
        options: market.options.map((option) => ({ ...option, selected: false })),
      })),
    })));
    setPasses([]);
    setHits({});
    setDetailsOpen(false);
    message.success("已清空当前选择，比赛数据保留");
  };

  const unlockExpenseEditor = () => {
    setExpenseDraft(expenseTotal);
    setExpenseEditing(true);
  };

  const unlockIncomeEditor = () => {
    setIncomeDraft(incomeTotal);
    setIncomeEditing(true);
  };

  const saveExpenseCorrection = () => {
    const next = Math.max(0, Number(expenseDraft || 0));
    setExpenseTotal(next);
    setExpenseEditing(false);
    message.success("累计支出已保存并锁定");
  };

  const saveIncomeCorrection = () => {
    const next = Math.max(0, Number(incomeDraft || 0));
    setIncomeTotal(next);
    setIncomeEditing(false);
    message.success("累计收入已保存并锁定");
  };

  const toggleLeagueVisibility = (leagueName: string) => {
    setVisibleLeagueNames((current) => {
      const visible = current ?? leagueOptions.map((item) => item.leagueNameAbbr);
      return visible.includes(leagueName)
        ? visible.filter((item) => item !== leagueName)
        : [...visible, leagueName];
    });
  };

  const clearMatchFilters = () => {
    setSelectedMatchDate(null);
    setVisibleLeagueNames(null);
    setOnlySellableMatches(false);
  };

  const toggleMatchDateCollapsed = (date: string) => {
    autoCollapsedMatchDatesRef.current.delete(date);
    setCollapsedMatchDates((current) => current.includes(date)
      ? current.filter((item) => item !== date)
      : [...current, date]);
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
      const next = saveAppSettings(withLeagueTagColor(current, leagueName, color));
      return next;
    });
    notification.success({ message: "联赛颜色已保存", description: `${leagueColorSettingKey(leagueName)} · ${color.toUpperCase()}`, placement: "bottomRight" });
  };

  const resetLeagueTagColors = () => {
    const next = saveAppSettings(createDefaultSettings());
    setAppSettings(next);
    notification.success({ message: "联赛颜色已恢复默认", placement: "bottomRight" });
  };

  const importMenu = (
    <div className="data-popover-menu">
      <div className="data-popover-heading"><b>导入数据</b><span>选择要从 JSON 文件恢复的内容</span></div>
      {([
        ["orders", "导入订单", "按订单 ID 新增或更新，不改动设置"],
        ["settings", "导入设置", "覆盖联赛颜色等应用设置"],
        ["matches", "导入比赛数据", "覆盖本地比赛缓存"],
        ["full", "导入完整数据", "确认后覆盖订单、比赛、设置与账本"],
      ] as const).map(([mode, title, description]) => (
        <Upload
          key={mode}
          accept=".json,application/json"
          showUploadList={false}
          beforeUpload={(file) => { void importDataJson(file, mode); return Upload.LIST_IGNORE; }}
        >
          <Button type="text" block><span><b>{title}</b><small>{description}</small></span><RightOutlined /></Button>
        </Upload>
      ))}
    </div>
  );

  const exportMenu = (
    <div className="data-popover-menu">
      <div className="data-popover-heading"><b>导出数据</b><span>可分别备份订单、比赛与设置</span></div>
      <Button type="text" block disabled={savedSlips.length === 0} onClick={() => exportData("orders")}><span><b>导出订单</b><small>{savedSlips.length} 个本地订单</small></span><DownloadOutlined /></Button>
      <Button type="text" block onClick={() => exportData("settings")}><span><b>导出设置</b><small>联赛颜色等应用设置</small></span><DownloadOutlined /></Button>
      <Button type="text" block onClick={() => exportData("matches")}><span><b>导出比赛数据</b><small>5 天内比赛缓存</small></span><DownloadOutlined /></Button>
      <Button type="text" block onClick={() => exportData("full")}><span><b>导出完整数据</b><small>订单、比赛、设置与收支账本</small></span><DownloadOutlined /></Button>
    </div>
  );

  return (
    <div className="football-app">
      <header className="hero-header" ref={headerRef}>
        <div className="hero-glow" />
        <div className="hero-content">
          <div className="brand-lockup">
            <div className="brand-ball"><StarFilled /></div>
            <div><p>中国体育彩票 · 玩法模拟</p><h1>竞彩足球模拟工具</h1></div>
          </div>
          <div className="hero-actions">
            {activeView === "orders" && <Button icon={<PlusOutlined />} onClick={openManualOrder}><span className="header-button-label">手动添加订单</span></Button>}
            <Popover content={importMenu} trigger="click" placement="bottomRight"><Button icon={<UploadOutlined />}><span className="header-button-label">JSON 导入</span></Button></Popover>
            <Popover content={exportMenu} trigger="click" placement="bottomRight"><Button icon={<DownloadOutlined />}><span className="header-button-label">导出数据</span></Button></Popover>
            <Button className={activeView === "betting" ? "view-toggle active" : "view-toggle"} icon={<HomeOutlined />} onClick={() => navigateToView("betting")}>
              <span className="header-button-label">投注</span>
            </Button>
            <Badge className="order-navigation-badge" count={unsettledOrderCount} size="small" offset={[-12, 4]} onClick={() => navigateToView("orders")}>
              <Button className={activeView === "orders" ? "view-toggle active" : "view-toggle"} icon={<FileTextOutlined />}>
                <span className="header-button-label">订单</span>
              </Button>
            </Badge>
            <Button className={activeView === "settings" ? "view-toggle active" : "view-toggle"} icon={<SettingOutlined />} onClick={() => navigateToView("settings")}>
              <span className="header-button-label">设置</span>
            </Button>
          </div>
        </div>
        <div className="responsible-note"><InfoCircleOutlined /> 非官方模拟工具 · 不提供购彩、支付或交易服务 · 请理性参与</div>
      </header>
      <div className="hero-header-spacer" aria-hidden="true" />

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
            </Space>
          </div>
          <div className="match-toolbar">
            <div className="match-filter-row match-date-control">
              <span>比赛日期</span>
              <DatePicker
                allowClear
                format="YYYY-MM-DD"
                placeholder="全部日期"
                value={selectedMatchDate ? dayjs(selectedMatchDate) : null}
                disabledDate={(date) => !availableMatchDateSet.has(date.format("YYYY-MM-DD"))}
                onChange={(date) => setSelectedMatchDate(date?.format("YYYY-MM-DD") ?? null)}
              />
              <Checkbox checked={onlySellableMatches} disabled={Boolean(temporaryOrder)} onChange={(event) => setOnlySellableMatches(event.target.checked)}>仅可售</Checkbox>
              <Button
                className="match-refresh-button"
                icon={<ReloadOutlined />}
                loading={sportteryRefreshing}
                disabled={Boolean(temporaryOrder)}
                onClick={() => { void refreshSportteryData(); }}
              >刷新数据</Button>
            </div>
            <div className="match-filter-row league-filter-control">
              <span>比赛类型</span>
              <div className="league-filter-tags">
                {leagueOptions.map((league) => {
                  const visible = visibleLeagueSet.has(league.leagueNameAbbr);
                  const leagueColor = getLeagueTagColor(appSettings, league.leagueNameAbbr);
                  return (
                    <Tag
                      key={league.leagueId}
                      color={leagueColor}
                      variant={visible ? "solid" : "outlined"}
                      style={visible ? { color: readableTagTextColor(leagueColor) } : undefined}
                      role="button"
                      tabIndex={0}
                      title={league.leagueName}
                      onClick={() => toggleLeagueVisibility(league.leagueNameAbbr)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleLeagueVisibility(league.leagueNameAbbr);
                        }
                      }}
                    >
                      {league.leagueNameAbbr}
                    </Tag>
                  );
                })}
              </div>
              <small className="match-update-time">数据源：{sportteryFetchMode === "morning" ? "早间逐场最新赔率" : "常规比赛接口"} · 接口更新：{sportteryLastUpdateTime || "--"}</small>
            </div>
          </div>
          {filteredMatches.length === 0 ? (
            <Card><Empty description={matches.length ? "当前筛选条件下暂无比赛" : temporaryOrder ? "这个订单没有可展示的比赛" : sportteryLoaded ? "接口暂未返回比赛" : "正在加载官方比赛"}>
              {matches.length ? <Button type="primary" onClick={clearMatchFilters}>清除筛选</Button> : temporaryOrder ? <Button onClick={restoreSavedMatches}>返回官方比赛</Button> : null}
            </Empty></Card>
          ) : groupedMatches.map(([date, items]) => {
            const selectedMatchCount = items.filter((match) => selectedOptions(match).length > 0).length;
            const collapsed = collapsedMatchDates.includes(date);
            return (
              <section className="date-group" key={date}>
                <div className="date-divider">
                  <button type="button" className="date-divider-main" aria-expanded={!collapsed} onClick={() => toggleMatchDateCollapsed(date)}>
                    <span>{date}</span><small>{items[0]?.weekday} · {items.length} 场比赛</small><i />
                    {selectedMatchCount > 0 && <strong>已选 {selectedMatchCount} 场</strong>}
                  </button>
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
                      onToggle={toggleOption}
                      onMore={setMoreMatchId}
                      leagueColor={getLeagueTagColor(appSettings, match.league)}
                      onLeagueColorSave={updateLeagueTagColor}
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
            <strong>{prizeRange.max ? `¥${currency(prizeRange.min)} – ¥${currency(prizeRange.max)}` : "—"}</strong>
            <small>最低值排除未中奖的 0 元结果</small>
          </div>
          <div className="profit-row"><span>中奖时利润范围</span><b>{prizeRange.max ? `¥${currency(prizeRange.min - stake)} – ¥${currency(prizeRange.max - stake)}` : "—"}</b></div>
          <div className="profit-row multiplier-row"><span>中奖倍率范围</span><b>{winningMultiplierRange(prizeRange, stake)}</b></div>
          {prizeRange.uncappedMax > prizeRange.max && <div className="cap-note">未封顶理论最高 ¥{currency(prizeRange.uncappedMax)}，已按官方单注上限修正。</div>}
          <div className="panel-actions">
            <Button icon={<SaveOutlined />} disabled={!pickedCount} onClick={openSaveSlip}>{temporaryOrder ? "更新预测单" : "保存预测单"}</Button>
            <Button type={pickedCount ? "primary" : "default"} icon={<EyeOutlined />} disabled={!pickedCount} onClick={() => setDetailsOpen(true)}>查看明细</Button>
          </div>
        </aside>
      </main> : activeView === "orders" ? (
        <main className="page-shell orders-shell">
          <section className="orders-page">
            <div className="section-heading orders-heading">
              <div><span className="eyebrow">LOCAL ORDERS</span><h2>订单列表</h2><p>已保存的预测单只保存在当前浏览器中，可以查看明细或重新载入继续调整。</p></div>
              <Space wrap>
                <Tag color="cyan">显示 {filteredSavedSlips.length} / 共 {savedSlips.length} 个订单</Tag>
                <Button icon={<ExpandOutlined />} disabled={filteredSavedSlips.length === 0} onClick={expandAllOrderOptions}>展开全部选项</Button>
                <Button icon={<ReloadOutlined />} loading={orderOddsRefreshing} disabled={savedSlips.length === 0} onClick={() => { void refreshUnlockedOrderOdds(); }}>更新倍率</Button>
                <Button icon={<LockOutlined />} disabled={visibleUnlockedOrderCount === 0} onClick={lockVisibleOrderOdds}>锁定倍率</Button>
                <Tooltip title="仅结账成功与失败账单">
                  <span><Button className="checkout-order-button" icon={<CheckOutlined />} disabled={visibleSettleableOrders.length === 0} onClick={() => settleOrders(visibleSettleableOrders)}>一键结账</Button></span>
                </Tooltip>
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
                    onClick={() => {
                      setOrderDateRange(null);
                      setOrderProgressFilter(null);
                      setOrderStatusFilters([]);
                    }}
                  >清除过滤</Button>
                </div>
                <div className="order-filter-grid">
                  <label className="order-filter-field date-field">
                    <span>订单日期</span>
                    <DatePicker.RangePicker
                      allowClear
                      format="YYYY-MM-DD"
                      placeholder={["开始日期", "结束日期"]}
                      disabledDate={(current) => current.startOf("day").isAfter(dayjs().startOf("day"))}
                      value={orderDateRange ? [dayjs(orderDateRange[0]), dayjs(orderDateRange[1])] : null}
                      onChange={(dates) => setOrderDateRange(dates?.[0] && dates[1] ? [dates[0].format("YYYY-MM-DD"), dates[1].format("YYYY-MM-DD")] : null)}
                    />
                  </label>
                  <label className="order-filter-field">
                    <span>订单进度</span>
                    <Select
                      aria-label="订单进度"
                      allowClear
                      placeholder="不限"
                      value={orderProgressFilter ?? undefined}
                      options={[
                        { value: "all", label: "不限" },
                        { value: "settled", label: "已结账" },
                        { value: "unsettled", label: "未结账" },
                      ]}
                      onChange={(value) => setOrderProgressFilter(value && value !== "all" ? value as Exclude<OrderProgressFilter, null> : null)}
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
                      options={[
                        { value: "all", label: "不限" },
                        { value: "success", label: "成功" },
                        { value: "hopeful", label: "有希望" },
                        { value: "failed", label: "失败" },
                      ]}
                      onChange={(values) => {
                        const next = values as Array<OrderStatusFilter | "all">;
                        setOrderStatusFilters(next.includes("all") ? [] : next as OrderStatusFilter[]);
                      }}
                    />
                  </label>
                </div>
                <div className="order-filter-summary">
                  <div><span>筛选结果</span><b>{filteredSavedSlips.length}<small> 个订单</small></b></div>
                  <div><span>筛选投入</span><b>¥{currency(filteredOrderStake)}</b></div>
                  <p>“有希望”表示当前既未产生中奖金额，也未因失败场次失去全部串关机会。</p>
                </div>
              </Card>

              <Card className="order-statistics-panel">
                <div className="order-panel-heading">
                  <div><span className="eyebrow">OVERVIEW</span><h3>数据统计</h3></div>
                  <Tag color={netProfit >= 0 ? "green" : "red"}>{netProfit >= 0 ? "当前盈利" : "当前亏损"}</Tag>
                </div>
                <div className="order-statistics-grid">
                  <div className="order-stat-item order-money-card expense-card">
                    <span>累计支出</span>
                    {expenseEditing ? (
                      <div className="order-money-editor">
                        <InputNumber autoFocus aria-label="累计支出校正" controls={false} min={0} precision={2} prefix="¥" value={expenseDraft} onChange={(value) => setExpenseDraft(Math.max(0, Number(value ?? 0)))} onPressEnter={saveExpenseCorrection} />
                        <Button type="primary" aria-label="保存累计支出" icon={<CheckOutlined />} onClick={saveExpenseCorrection} />
                        <Button aria-label="取消编辑累计支出" icon={<CloseOutlined />} onClick={() => setExpenseEditing(false)} />
                      </div>
                    ) : (
                      <div className="order-money-locked">
                        <strong>¥{currency(expenseTotal)}</strong>
                        <Tooltip title="解锁编辑累计支出"><Button type="text" aria-label="解锁编辑累计支出" icon={<EditOutlined />} onClick={unlockExpenseEditor} /></Tooltip>
                      </div>
                    )}
                    <small>订单投入自动计入</small>
                  </div>
                  <div className="order-stat-item order-money-card income-card">
                    <span>累计收入</span>
                    {incomeEditing ? (
                      <div className="order-money-editor">
                        <InputNumber autoFocus aria-label="累计收入校正" controls={false} min={0} precision={2} prefix="¥" value={incomeDraft} onChange={(value) => setIncomeDraft(Math.max(0, Number(value ?? 0)))} onPressEnter={saveIncomeCorrection} />
                        <Button type="primary" aria-label="保存累计收入" icon={<CheckOutlined />} onClick={saveIncomeCorrection} />
                        <Button aria-label="取消编辑累计收入" icon={<CloseOutlined />} onClick={() => setIncomeEditing(false)} />
                      </div>
                    ) : (
                      <div className="order-money-locked">
                        <strong>¥{currency(incomeTotal)}</strong>
                        <Tooltip title="解锁编辑累计收入"><Button type="text" aria-label="解锁编辑累计收入" icon={<EditOutlined />} onClick={unlockIncomeEditor} /></Tooltip>
                      </div>
                    )}
                    <small>结账奖金自动计入</small>
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
                  <p>汇总当前未结账订单中尚未判断成功或失败的比赛；同一比赛只要仍有一个订单待判断就会保留。</p>
                </div>
                <Space wrap>
                  {!matchResultsCollapsed && <Button icon={<ReloadOutlined />} loading={allResultsFetching} disabled={resultMatches.length === 0 || resultFetchingMatchIds.length > 0} onClick={() => { void fetchAllMatchResults(); }}>获取全部赛果</Button>}
                  {!matchResultsCollapsed && <Button type="primary" icon={<CheckOutlined />} disabled={resultMatches.length === 0 || allResultsFetching || resultFetchingMatchIds.length > 0} onClick={judgeVisibleOrders}>一键判断并保存</Button>}
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
                          {RESULT_MARKETS.map((type) => (
                            <label key={type}>
                              <span>{MARKET_LABELS[type]}{type === "rqspf" ? `（${(match.markets.find((market) => market.type === type)?.handicap ?? 0) > 0 ? "+" : ""}${match.markets.find((market) => market.type === type)?.handicap ?? 0}）` : ""}</span>
                              <Select
                                allowClear
                                showSearch
                                optionFilterProp="label"
                                placeholder="选择赛果"
                                value={result?.values[type]}
                                options={resultSelectOptions(match, type)}
                                onChange={(value) => updateMatchResult(match, type, value)}
                              />
                            </label>
                          ))}
                        </div>
                        <Button
                          icon={<ReloadOutlined />}
                          loading={resultFetchingMatchIds.includes(matchId)}
                          disabled={allResultsFetching || (resultFetchingMatchIds.length > 0 && !resultFetchingMatchIds.includes(matchId))}
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
              <Card className="orders-empty"><Empty description="当前筛选条件下没有订单"><Button type="primary" onClick={() => { setOrderDateRange(null); setOrderProgressFilter(null); setOrderStatusFilters([]); }}>清除筛选</Button></Empty></Card>
            ) : (
              <div className="orders-grid">
                {filteredSavedSlips.map((slip, slipIndex) => {
                  const orderMatches = sortMatchesForDisplay(selectedMatches(slip.matches));
                  const orderBets = countBets(slip.matches, slip.passes);
                  const orderStake = calculateStake(slip.matches, slip.passes, slip.multiple);
                  const orderKey = slip.id || `legacy-${slip.savedAt}-${slipIndex}`;
                  const expanded = expandedOrderIds.includes(orderKey);
                  const savedHitCount = Object.values(slip.hits ?? {}).reduce((total, values) => total + Object.values(values).filter(Boolean).length, 0);
                  const trackedPrize = calculateCurrentPrize(slip.matches, slip.passes, slip.multiple, slip.hits ?? {});
                  const trackedPrizeText = trackedPrize.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
                  const orderFailed = isOrderFailed(slip);
                  const orderSettleable = isOrderSettleable(slip);
                  return (
                    <Card key={orderKey} className={`order-card ${orderFailed ? "failed" : ""}`}>
                      <div className="order-card-head">
                        <div className="order-card-meta-line">
                          <div className="order-card-tags">
                            <Tag color="geekblue">本地订单</Tag>
                            {savedHitCount > 0 && <Tag color="orange">已存 {savedHitCount} 个命中</Tag>}
                            {orderFailed && <Tag color="error">失败</Tag>}
                            {trackedPrize > 0 && <Tag color="green">已中奖 {trackedPrizeText} 元</Tag>}
                            {isOrderOddsLocked(slip) && <Tag color="gold" icon={<LockOutlined />}>倍率锁定</Tag>}
                            {slip.settledAt && <Tag color="cyan">已结账 ¥{currency(slip.settledPrize ?? 0)}</Tag>}
                          </div>
                          <time>{new Date(slip.savedAt).toLocaleString("zh-CN")}</time>
                        </div>
                        <h3>{slip.name}</h3>
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
                          return (
                          <section className={`order-match-entry ${matchFailed ? "failed" : ""}`} key={match.id}>
                            <div className="order-match-entry-head"><span>{match.weekday}{match.code}</span><b>{match.home} VS {match.away}</b>{matchFailed && <Tag color="error">失败</Tag>}{matchSuccessful && <Tag color="success">成功</Tag>}</div>
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
                                            <span className={isHit ? "hit" : ""}>{option.label}{isHit && <b>@{option.odds.toFixed(2)}</b>}</span>
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
                        <Button icon={<EyeOutlined />} onClick={() => openOrderDetails(slip)}>查看明细</Button>
                        <Button icon={<EditOutlined />} onClick={() => openOrderEditor(slip)}>编辑订单</Button>
                        {slip.settledAt ? (
                          <Popconfirm
                            title="确认撤回结账？"
                            description={`将从累计收入中扣除 ¥${currency(slip.settledPrize ?? 0)}，并把订单恢复为未结账状态。`}
                            okText="确认撤回"
                            cancelText="取消"
                            onConfirm={() => withdrawOrderSettlement(slip)}
                          >
                            <Button className="withdraw-checkout-button" icon={<RollbackOutlined />}>撤回</Button>
                          </Popconfirm>
                        ) : orderSettleable ? (
                          <Popconfirm
                            title="确认结账？"
                            description={`将按当前命中结果把 ¥${currency(trackedPrize)} 计入累计收入，结账后不可编辑倍率或命中。`}
                            okText="确认结账"
                            cancelText="取消"
                            onConfirm={() => settleOrders([slip])}
                          >
                            <Button className="checkout-order-button" icon={<CheckOutlined />}>结账</Button>
                          </Popconfirm>
                        ) : (
                          <Tooltip title="该订单未对比赛果">
                            <span><Button className="checkout-order-button" icon={<CheckOutlined />} disabled>结账</Button></span>
                          </Tooltip>
                        )}
                        <Button type="primary" icon={<ImportOutlined />} disabled={Boolean(slip.settledAt)} onClick={() => loadSlip(slip)}>载入投注</Button>
                        <Popconfirm title="删除这张预测单？" description="将同时回滚该订单的支出和已入账收入。" okText="删除" cancelText="取消" onConfirm={() => deleteSlip(slip)}>
                          <Button className="delete-order-button" danger icon={<DeleteOutlined />}>删除</Button>
                        </Popconfirm>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      ) : (
        <main className="page-shell settings-shell">
          <section className="settings-page">
            <div className="section-heading settings-heading">
              <div><span className="eyebrow">APP SETTINGS</span><h2>设置</h2><p>应用设置使用独立的版本化本地存储，后续新增配置不会与订单数据混在一起。</p></div>
              <Space wrap>
                <Tag color="cyan">{settingsLeagueNames.length} 个联赛颜色</Tag>
                <Button type="primary" icon={<HomeOutlined />} onClick={() => navigateToView("betting")}>返回投注</Button>
              </Space>
            </div>
            <Card className="settings-card">
              <div className="settings-card-head">
                <div><h3>联赛标签颜色</h3><p>比赛列表会自动加入接口返回的新联赛；修改颜色后立即保存到当前浏览器。</p></div>
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
            <Card className="settings-storage-card">
              <b>设置存储说明</b>
              <p>当前使用 <code>schemaVersion: 1</code> 和 <code>appearance.leagueTagColors</code>。导出设置或完整数据后，可在其他浏览器恢复。</p>
            </Card>
          </section>
        </main>
      )}

      <Modal
        open={Boolean(moreMatch)}
        onCancel={() => setMoreMatchId(null)}
        footer={<Button type="primary" onClick={() => setMoreMatchId(null)}>完成选择</Button>}
        width={980}
        title={moreMatch ? <Space>{`${moreMatch.weekday}${moreMatch.code} · ${moreMatch.home} VS ${moreMatch.away}`}{!isMatchSellable(moreMatch) && <Tag color="default">已停售 · 仅供查看</Tag>}</Space> : "更多玩法"}
        className="more-modal"
      >
        {moreMatch?.markets.map((market) => (
          <section className="modal-market" key={market.type}>
            <div className="modal-market-title"><span>{MARKET_LABELS[market.type]}{market.type === "rqspf" ? `（${(market.handicap ?? 0) > 0 ? "+" : ""}${market.handicap ?? 0}）` : ""}</span><Tag>{market.singleAvailable ? "单场 / 过关" : "过关"}</Tag></div>
            <div className="more-options-groups">
              {marketEditorGroups(market).map((group) => (
                <div className="more-options-row" key={group.key}>
                  {group.options.map((item) => (
                    <button type="button" disabled={!isMatchSellable(moreMatch) || item.odds <= 0} className={`more-odds-option ${isMatchSellable(moreMatch) && item.odds > 0 && item.selected ? "selected" : ""}`} key={item.id} onClick={() => toggleOption(moreMatch.id, market.type, item.id)} aria-pressed={isMatchSellable(moreMatch) && item.odds > 0 && item.selected}>
                      <span>{item.label}</span><strong>{item.odds > 0 ? <><OddsTrendIndicator trend={item.oddsTrend} />@{item.odds.toFixed(2)}</> : "--"}</strong>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </section>
        ))}
      </Modal>

      <Modal
        open={Boolean(editingOrder)}
        title={editingOrder ? `编辑订单 · ${editingOrder.name}` : "编辑订单"}
        width={820}
        okText="保存订单"
        cancelText="取消"
        onCancel={closeOrderEditor}
        onOk={saveOrderEdits}
      >
        <div className="order-editor-meta">
          <label>订单名称
            <Input value={orderEditName} onChange={(event) => setOrderEditName(event.target.value)} maxLength={30} showCount />
          </label>
          <label>订单创建时间
            <DatePicker
              showTime={{ format: "HH:mm:ss" }}
              showNow
              format="YYYY-MM-DD HH:mm:ss"
              value={orderEditTime && dayjs(orderEditTime).isValid() ? dayjs(orderEditTime) : null}
              onChange={(value) => setOrderEditTime(value?.toISOString() ?? "")}
            />
          </label>
        </div>
        <div className="order-editor-section-title">
          <b>已选项倍率</b>
          <div className="order-odds-lock"><LockOutlined /><span>锁定倍率</span><Switch checked={orderEditOddsLocked} disabled={Boolean(editingOrder?.settledAt)} onChange={setOrderEditOddsLocked} /></div>
        </div>
        <p className="modal-help">锁定后不会参与订单页的批量倍率更新；结账订单必须锁定。手动修改只影响当前订单快照，不会改动官方比赛列表、投注倍数或收支账本。</p>
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
                        <span>{option.label}</span>
                        <InputNumber
                          aria-label={`${match.home} VS ${match.away} ${MARKET_LABELS[market.type]} ${option.label} 倍率`}
                          controls={false}
                          min={0.01}
                          max={9999}
                          step={0.01}
                          precision={2}
                          value={option.odds > 0 ? option.odds : null}
                          prefix="@"
                          disabled={Boolean(editingOrder?.settledAt || orderEditOddsLocked)}
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
        <DetailPrizeRange range={prizeRange} stake={stake} />
        <div className="detail-pass-summary">
          <span>当前订单串关</span>
          <div>{activePasses.length ? activePasses.map((value) => <Tag color="cyan" key={value}>{value === 1 ? "单场" : `${value} 串 1`}</Tag>) : <Tag>未选择</Tag>}</div>
        </div>
        <p className="drawer-tip">点击一个已选项即标记为当前玩法命中；同一玩法再次点击可取消或改选。</p>
        {chosenMatches.map((match) => (
          <section className="detail-match" key={match.id}>
            <div className="detail-match-title"><span>{match.weekday}{match.code}</span><b>{match.home} VS {match.away}</b></div>
            <div className="detail-options">
              {match.markets.flatMap((market) => market.options.filter((item) => item.selected).map((item) => {
                const active = hits[match.id]?.[market.type] === item.id;
                return (
                  <button type="button" className={active ? "hit" : ""} key={`${market.type}-${item.id}`} onClick={() => toggleHit(match.id, market.type, item.id)}>
                    <small>{MARKET_LABELS[market.type]}{market.type === "rqspf" ? ` ${(market.handicap ?? 0) > 0 ? "+" : ""}${market.handicap ?? 0}` : ""}</small>
                    <span>{item.label}<b>@{item.odds.toFixed(2)}</b></span>
                    {active && <CheckOutlined />}
                  </button>
                );
              }))}
            </div>
          </section>
        ))}
        <PassMultiplierDetails matches={matches} passes={activePasses} hits={hits} />
      </Drawer>

      <Drawer
        open={Boolean(orderDetail)}
        onClose={() => setOrderDetail(null)}
        title={orderDetail ? `查看明细 · ${orderDetail.name} · ${orderDetailPickedCount} 个选项` : "查看明细"}
        size={560}
        className="details-drawer order-details-drawer"
        footer={orderDetail ? (
          <div className="order-detail-footer">
            <span>{orderDetail.settledAt ? `已于 ${new Date(orderDetail.settledAt).toLocaleString("zh-CN")} 结账，结果与倍率已锁定。` : "标记命中或比赛失败后请保存，结果将写入当前订单。"}</span>
            <Space>
              <Button onClick={() => setOrderDetail(null)}>关闭</Button>
              <Button type="primary" icon={<SaveOutlined />} disabled={Boolean(orderDetail.settledAt)} onClick={saveOrderHits}>{orderDetail.settledAt ? "已结账锁定" : "保存比赛结果"}</Button>
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
            <DetailPrizeRange range={orderDetailRange} stake={orderDetailStake} />
            <div className="detail-pass-summary">
              <span>订单串关</span>
              <div>{orderDetail.passes.length ? orderDetail.passes.map((value) => <Tag color="cyan" key={value}>{value === 1 ? "单场" : `${value} 串 1`}</Tag>) : <Tag>未选择</Tag>}</div>
            </div>
            <p className="drawer-tip">{orderDetail.settledAt ? "该订单已结账，只能查看保存时的比赛结果与中奖金额。" : "点击已选项可标记玩法命中；勾选“失败”会清除该场命中并将投注项置灰。完成后点击底部保存。"}</p>
            {orderDetailMatches.map((match) => {
              const matchFailed = orderFailedMatches.includes(match.id);
              return (
              <section className={`detail-match ${matchFailed ? "failed" : ""}`} key={match.id}>
                <div className="detail-match-title"><span>{match.weekday}{match.code}</span><b>{match.home} VS {match.away}</b><Checkbox checked={matchFailed} disabled={Boolean(orderDetail.settledAt)} onChange={(event) => toggleOrderMatchFailure(match.id, event.target.checked)}>失败</Checkbox></div>
                <div className="detail-options">
                  {match.markets.flatMap((market) => market.options.filter((item) => item.selected).map((item) => {
                    const active = orderHits[match.id]?.[market.type] === item.id;
                    return (
                      <button type="button" className={active ? "hit" : ""} disabled={Boolean(orderDetail.settledAt || matchFailed)} key={`${market.type}-${item.id}`} onClick={() => toggleOrderHit(match.id, market.type, item.id)}>
                        <small>{MARKET_LABELS[market.type]}{market.type === "rqspf" ? ` ${(market.handicap ?? 0) > 0 ? "+" : ""}${market.handicap ?? 0}` : ""}</small>
                        <span>{item.label}<b>@{item.odds.toFixed(2)}</b></span>
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

      <Modal open={saveOpen} onCancel={() => setSaveOpen(false)} onOk={saveSlip} title={temporaryOrder ? "更新当前预测单" : "保存当前预测单"} okText={temporaryOrder ? "覆盖更新" : "保存到本机"} cancelText="取消">
        <Input autoFocus value={saveName} onChange={(event) => setSaveName(event.target.value)} onPressEnter={saveSlip} placeholder="可选；留空则使用当前日期时间" maxLength={30} showCount />
        <p className="modal-help">名称留空时将使用“年月日时分秒”自动命名。数据仅保存在当前浏览器的本地存储中，不会上传。</p>
      </Modal>

      <Modal
        open={manualOrderOpen}
        onCancel={() => { setManualOrderOpen(false); setManualPickerEntryKey(null); setManualPickerMatch(null); }}
        onOk={addManualOrder}
        width={900}
        title="手动添加订单"
        okText="添加订单"
        cancelText="取消"
      >
        <div className="manual-order-fields">
          <label>订单名称<Input value={manualOrderName} onChange={(event) => setManualOrderName(event.target.value)} placeholder="留空则自动命名" maxLength={30} /></label>
          <label>串关方式<Input value={manualOrderPassText} onChange={(event) => setManualOrderPassText(event.target.value)} placeholder="例如：4串1、6串1" /></label>
          <label>投注倍数<InputNumber controls={false} min={1} max={50} value={manualOrderMultiple} onChange={(value) => setManualOrderMultiple(Math.min(50, Math.max(1, Number(value ?? 1))))} /></label>
        </div>
        <div className="manual-order-entry-list">
          {manualOrderEntries.map((entry, index) => (
            <section className="manual-order-entry" key={entry.key}>
              <div className="manual-order-entry-head">
                <b>比赛 {index + 1}</b>
                <Button type="text" danger icon={<DeleteOutlined />} disabled={manualOrderEntries.length === 1} onClick={() => setManualOrderEntries((current) => current.filter((item) => item.key !== entry.key))}>移除</Button>
              </div>
              <div className="manual-match-picker-row">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="从本地保存的比赛数据中选择"
                  value={entry.matchId}
                  options={sortMatchesForDisplay(matches).map((match) => ({
                    value: normalizeSportteryMatchId(match.id),
                    label: `${match.date} · ${match.weekday}${match.code} · ${match.home} VS ${match.away}${isMatchSellable(match) ? "" : " · 已停售"}`,
                  }))}
                  onChange={(value) => selectManualOrderMatch(entry.key, value ?? null)}
                />
                <Button icon={<EditOutlined />} disabled={!entry.matchId} onClick={() => openManualMatchPicker(entry)}>选择投注项</Button>
              </div>
              <Input.TextArea
                value={entry.text}
                onChange={(event) => updateManualOrderEntry(entry.key, { text: event.target.value })}
                autoSize={{ minRows: 7, maxRows: 14 }}
                placeholder={'找不到比赛时可直接填写，例如：\n比赛 ID：2040594\n比赛日期：2026-07-23\n联赛：巴甲\n开赛时间：2026-07-24 06:30\n周四201 科林蒂安 VS 里莫\n胜平负 主胜 @2.25 | 主负 @2.46\n让球胜平负（-1） 主胜 @2.28\n比分 3:1 @10.50 | 3:2 @25.00\n总进球数 1 @4.65 | 6 @20.00\n半全场胜平负 胜平 @19.00 | 胜负 @60.00'}
              />
            </section>
          ))}
        </div>
        <Button className="manual-add-match-button" type="dashed" block icon={<PlusOutlined />} onClick={addManualOrderEntry}>添加一场比赛</Button>
        <p className="modal-help">每个订单最多选择 {MAX_SELECTED_MATCHES} 场比赛。每场比赛对应一个文本框；优先选择本地比赛并通过“选择投注项”自动生成文本，找不到比赛时可手填，但必须包含 7 位比赛 ID、比赛信息、玩法、选项和倍率。</p>
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
          <section className="modal-market" key={market.type}>
            <div className="modal-market-title"><span>{MARKET_LABELS[market.type]}{market.type === "rqspf" ? `（${(market.handicap ?? 0) > 0 ? "+" : ""}${market.handicap ?? 0}）` : ""}</span></div>
            <div className="more-options-groups">
              {marketEditorGroups(market).map((group) => (
                <div className="more-options-row" key={group.key}>
                  {group.options.map((item) => (
                    <button type="button" disabled={item.odds <= 0} className={`more-odds-option ${item.odds > 0 && item.selected ? "selected" : ""}`} key={item.id} onClick={() => toggleManualPickerOption(market.type, item.id)} aria-pressed={item.odds > 0 && item.selected}>
                      <span>{item.label}</span><strong>{item.odds > 0 ? `@${item.odds.toFixed(2)}` : "--"}</strong>
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

export default function FootballApp({ initialView = "betting", onNavigate }: { initialView?: AppView; onNavigate?: (view: AppView) => void }) {
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
        <b>竞彩足球模拟工具</b>
        <span>正在载入官方比赛…</span>
      </div>
    );
  }
  return (
    <ConfigProvider theme={{
      token: { colorPrimary: "#f04e55", borderRadius: 12, colorText: "#172a32", fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif' },
      components: { Button: { controlHeight: 40 }, Modal: { borderRadiusLG: 18 } },
    }}>
      <App notification={{ placement: "bottomRight", showProgress: true, pauseOnHover: true }}><InnerFootballApp initialView={initialView} onNavigate={onNavigate} /></App>
    </ConfigProvider>
  );
}
