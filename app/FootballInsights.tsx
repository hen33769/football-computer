"use client";

import {
  Alert,
  Button,
  Empty,
  Modal,
  Spin,
  Tag,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  ExportOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
  fetchSportteryHistory,
  fetchSportteryPreviewStatic,
  fetchSportteryRecent,
  fetchSportteryTrend,
  filterNonFriendlyTournamentRows,
  getSportteryStandingsUrl,
  type InsightRecord,
  type PreviewStaticData,
  type SportteryTrendData,
} from "./sporttery-insights";
import type { MatchItem } from "./types";
import { TeamNameWithIcon } from "./components/TeamNameWithAlias";
import type { TeamNameIndex } from "./team-aliases";

const asRecord = (value: unknown): InsightRecord => (
  value && typeof value === "object" && !Array.isArray(value) ? value as InsightRecord : {}
);
const asRows = (value: unknown): InsightRecord[] => (
  Array.isArray(value) ? value.filter((item): item is InsightRecord => Boolean(item) && typeof item === "object") : []
);
const text = (value: unknown, fallback = "--") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};
const amount = (value: unknown, fallback = 0) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
};

const resultLabels: Record<string, string> = {
  HAD: "胜平负",
  HHAD: "让球胜平负",
  CRS: "比分",
  TTG: "总进球",
  HAFU: "半全场胜平负",
};

type TrendColumn = { key: string; label: string };

const hadColumns: TrendColumn[] = [
  { key: "h", label: "胜" },
  { key: "d", label: "平" },
  { key: "a", label: "负" },
];
const totalGoalColumns: TrendColumn[] = Array.from({ length: 8 }, (_, index) => ({
  key: `s${index}`,
  label: index === 7 ? "7+" : String(index),
}));
const halfFullColumns: TrendColumn[] = [
  ["hh", "胜胜"], ["hd", "胜平"], ["ha", "胜负"],
  ["dh", "平胜"], ["dd", "平平"], ["da", "平负"],
  ["ah", "负胜"], ["ad", "负平"], ["aa", "负负"],
].map(([key, label]) => ({ key, label }));
const scoreWinColumns: TrendColumn[] = [
  ["s01s00", "1:0"], ["s02s00", "2:0"], ["s02s01", "2:1"],
  ["s03s00", "3:0"], ["s03s01", "3:1"], ["s03s02", "3:2"],
  ["s04s00", "4:0"], ["s04s01", "4:1"], ["s04s02", "4:2"],
  ["s05s00", "5:0"], ["s05s01", "5:1"], ["s05s02", "5:2"], ["s-1sh", "胜其他"],
].map(([key, label]) => ({ key, label }));
const scoreDrawColumns: TrendColumn[] = [
  ["s00s00", "0:0"], ["s01s01", "1:1"], ["s02s02", "2:2"],
  ["s03s03", "3:3"], ["s-1sd", "平其他"],
].map(([key, label]) => ({ key, label }));
const scoreLoseColumns: TrendColumn[] = [
  ["s00s01", "0:1"], ["s00s02", "0:2"], ["s01s02", "1:2"],
  ["s00s03", "0:3"], ["s01s03", "1:3"], ["s02s03", "2:3"],
  ["s00s04", "0:4"], ["s01s04", "1:4"], ["s02s04", "2:4"],
  ["s00s05", "0:5"], ["s01s05", "1:5"], ["s02s05", "2:5"], ["s-1sa", "负其他"],
].map(([key, label]) => ({ key, label }));

function EmptyBlock({ description = "暂无数据" }: { description?: string }) {
  return <div className="insight-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} /></div>;
}

function TrendValue({ row, columnKey }: { row: InsightRecord; columnKey: string }) {
  const trend = amount(row[`${columnKey}f`]);
  return (
    <span className={`trend-value ${trend > 0 ? "up" : trend < 0 ? "down" : ""}`}>
      {text(row[columnKey])}
      {trend > 0 ? <ArrowUpOutlined /> : trend < 0 ? <ArrowDownOutlined /> : null}
    </span>
  );
}

function TrendTable({
  title,
  rows,
  columns,
  goalLine,
}: {
  title: string;
  rows: InsightRecord[];
  columns: TrendColumn[];
  goalLine?: string;
}) {
  return (
    <section className="insight-section">
      <div className="insight-section-title">
        <h3>{title}</h3>
        {goalLine && <Tag color={goalLine.startsWith("+") ? "red" : "blue"}>让球 {goalLine}</Tag>}
      </div>
      {rows.length ? (
        <div className="insight-table-scroll">
          <table className="insight-table trend-table">
            <thead>
              <tr>
                <th>发布时间</th>
                {columns.map((column) => <th key={column.key}>{column.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${text(row.updateDate)}-${text(row.updateTime)}-${index}`}>
                  <td className="table-date">{text(row.updateDate)} {text(row.updateTime)}</td>
                  {columns.map((column) => (
                    <td key={column.key}><TrendValue row={row} columnKey={column.key} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyBlock />}
    </section>
  );
}

export function OfficialTrendModal({
  match,
  open,
  onClose,
  teamNameIndex,
}: {
  match: MatchItem | null;
  open: boolean;
  onClose: () => void;
  teamNameIndex: TeamNameIndex;
}) {
  const [request, setRequest] = useState<{ key: string; data: SportteryTrendData | null; error: string }>({
    key: "",
    data: null,
    error: "",
  });
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey = open && match ? `${match.id}:${reloadKey}` : "";
  const loading = Boolean(requestKey) && request.key !== requestKey;
  const data = request.key === requestKey ? request.data : null;
  const error = request.key === requestKey ? request.error : "";

  useEffect(() => {
    if (!requestKey || !match) return;
    let cancelled = false;
    fetchSportteryTrend(match.id)
      .then((result) => {
        if (!cancelled) setRequest({ key: requestKey, data: result, error: "" });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setRequest({
          key: requestKey,
          data: null,
          error: reason instanceof Error ? reason.message : "固定奖金数据加载失败",
        });
      });
    return () => { cancelled = true; };
  }, [match, requestKey]);

  const history = asRecord(data?.oddsHistory);
  const results = useMemo(() => new Map(
    asRows(data?.matchResultList).map((item) => [text(item.code, ""), item]),
  ), [data]);
  const cancelled = String(data?.isCancel ?? "0") === "1";

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={1120}
      className="insight-modal"
      title={match ? <><span>{match.weekday}{match.code} · </span><TeamNameWithIcon name={match.home} index={teamNameIndex} /> <span>VS </span><TeamNameWithIcon name={match.away} index={teamNameIndex} iconPosition="before" aliasPosition="after" /><span> · 官方趋势</span></> : "官方趋势"}
      footer={<Button type="primary" onClick={onClose}>关闭</Button>}
    >
      <Spin spinning={loading}>
        {error && (
          <Alert
            type="error"
            showIcon
            message={error}
            action={<Button size="small" icon={<ReloadOutlined />} onClick={() => setReloadKey((value) => value + 1)}>重试</Button>}
          />
        )}
        {!error && cancelled && <Alert type="warning" showIcon message="该场比赛销售已取消" />}
        {!error && !cancelled && data && (
          <div className="insight-content">
            <section className="insight-section">
              <div className="insight-section-title"><h3>开奖结果</h3></div>
              {results.size ? (
                <div className="insight-table-scroll">
                  <table className="insight-table result-table">
                    <thead><tr><th>游戏</th><th>开奖结果</th><th>奖金</th></tr></thead>
                    <tbody>
                      {Object.entries(resultLabels).map(([code, label]) => {
                        const result = results.get(code) ?? {};
                        return (
                          <tr key={code}>
                            <td>{label}{code === "HHAD" && result.goalLine ? `（${text(result.goalLine)}）` : ""}</td>
                            <td><Tag color="red">{text(result.combinationDesc)}</Tag></td>
                            <td>{text(result.odds)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyBlock />}
            </section>
            <TrendTable title="胜平负固定奖金" rows={asRows(history.hadList)} columns={hadColumns} />
            <TrendTable
              title="让球胜平负固定奖金"
              rows={asRows(history.hhadList)}
              columns={hadColumns}
              goalLine={text(asRows(history.hhadList)[0]?.goalLine, "")}
            />
            <section className="insight-section">
              <div className="insight-section-title"><h3>比分固定奖金</h3></div>
              {asRows(history.crsList).length ? (
                <div className="score-trend-groups">
                  <TrendTable title="主胜比分" rows={asRows(history.crsList)} columns={scoreWinColumns} />
                  <TrendTable title="平局比分" rows={asRows(history.crsList)} columns={scoreDrawColumns} />
                  <TrendTable title="客胜比分" rows={asRows(history.crsList)} columns={scoreLoseColumns} />
                </div>
              ) : <EmptyBlock />}
            </section>
            <TrendTable title="总进球固定奖金" rows={asRows(history.ttgList)} columns={totalGoalColumns} />
            <TrendTable title="半全场胜平负固定奖金" rows={asRows(history.hafuList)} columns={halfFullColumns} />
            <p className="insight-note">注：固定奖金以完成有效投注所获得的某场比赛对应固定奖金为准。</p>
          </div>
        )}
        {!loading && !error && !data && <EmptyBlock />}
      </Spin>
    </Modal>
  );
}

type FilterFlag = 0 | 1;

function PreviewFilters({
  nonFriendlyFlag,
  tournamentFlag,
  homeAwayFlag,
  loading,
  onNonFriendlyChange,
  onTournamentChange,
  onHomeAwayChange,
}: {
  nonFriendlyFlag: FilterFlag;
  tournamentFlag: FilterFlag;
  homeAwayFlag: FilterFlag;
  loading: boolean;
  onNonFriendlyChange: (value: FilterFlag) => void;
  onTournamentChange: (value: FilterFlag) => void;
  onHomeAwayChange: (value: FilterFlag) => void;
}) {
  const toggleFilter = (
    event: KeyboardEvent<HTMLSpanElement>,
    currentValue: FilterFlag,
    onChange: (value: FilterFlag) => void,
  ) => {
    if (loading || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onChange(currentValue === 1 ? 0 : 1);
  };
  return (
    <div className="preview-filters">
      <Tag
        className="preview-filter-tag"
        color={nonFriendlyFlag === 1 ? "red" : undefined}
        role="checkbox"
        aria-checked={nonFriendlyFlag === 1}
        aria-disabled={loading}
        tabIndex={loading ? -1 : 0}
        onClick={() => !loading && onNonFriendlyChange(nonFriendlyFlag === 1 ? 0 : 1)}
        onKeyDown={(event) => toggleFilter(event, nonFriendlyFlag, onNonFriendlyChange)}
      >
        非友谊赛
      </Tag>
      <Tag
        className="preview-filter-tag"
        color={tournamentFlag === 1 ? "red" : undefined}
        role="checkbox"
        aria-checked={tournamentFlag === 1}
        aria-disabled={loading}
        tabIndex={loading ? -1 : 0}
        onClick={() => !loading && onTournamentChange(tournamentFlag === 1 ? 0 : 1)}
        onKeyDown={(event) => toggleFilter(event, tournamentFlag, onTournamentChange)}
      >
        同赛事
      </Tag>
      <Tag
        className="preview-filter-tag"
        color={homeAwayFlag === 1 ? "red" : undefined}
        role="checkbox"
        aria-checked={homeAwayFlag === 1}
        aria-disabled={loading}
        tabIndex={loading ? -1 : 0}
        onClick={() => !loading && onHomeAwayChange(homeAwayFlag === 1 ? 0 : 1)}
        onKeyDown={(event) => toggleFilter(event, homeAwayFlag, onHomeAwayChange)}
      >
        同主客
      </Tag>
    </div>
  );
}

const featureRows = [
  { key: "last", label: "近期交锋" },
  { key: "sameHomeAway", label: "同主客交锋" },
  { key: "eachHomeAway", label: "近期战况" },
  { key: "eachSameHomeAway", label: "同主客战况" },
] as const;

function FeatureAnalysis({ data }: { data: InsightRecord | null }) {
  if (!data) return <EmptyBlock />;
  const goalAvg = asRecord(data.goalAvg);
  const lossGoalAvg = asRecord(data.lossGoalAvg);
  const metrics = [
    ...featureRows.map(({ key, label }) => {
      const row = asRecord(data[key]);
      return {
        key,
        label: key === "last" || key === "eachHomeAway" ? `近${text(row.totalLegCnt, "10")}场${label.slice(2)}` : label,
        home: `${text(row.homeWinGoalMatchCnt, "0")}胜/${text(row.homeDrawMatchCnt, "0")}平/${text(row.homeLossGoalMatchCnt, "0")}负`,
        away: `${text(row.awayWinGoalMatchCnt, "0")}胜/${text(row.awayDrawMatchCnt, "0")}平/${text(row.awayLossGoalMatchCnt, "0")}负`,
        homeRatio: amount(row.homeScoreRatio),
        awayRatio: amount(row.awayScoreRatio),
      };
    }),
    {
      key: "goalAvg",
      label: "场均进球",
      home: `${text(goalAvg.homeGoalAvgCnt)} 个`,
      away: `${text(goalAvg.awayGoalAvgCnt)} 个`,
      homeRatio: amount(goalAvg.homeGoalAvgCntRatio),
      awayRatio: amount(goalAvg.awayGoalAvgCntRatio),
    },
    {
      key: "lossGoalAvg",
      label: "场均失球",
      home: `${text(lossGoalAvg.homeLossGoalAvgCnt)} 个`,
      away: `${text(lossGoalAvg.awayLossGoalAvgCnt)} 个`,
      homeRatio: amount(lossGoalAvg.homeLossGoalAvgCntRatio),
      awayRatio: amount(lossGoalAvg.awayLossGoalAvgCntRatio),
    },
  ];
  return (
    <div className="feature-analysis">
      <div className="feature-team-names"><b>{text(data.homeTeamShortName)}（主）</b><b>{text(data.awayTeamShortName)}（客）</b></div>
      {metrics.map((metric) => {
        const total = Math.max(metric.homeRatio + metric.awayRatio, 1);
        return (
          <div className="feature-row" key={metric.key}>
            <strong>{metric.home}</strong>
            <div className="feature-center">
              <span>{metric.label}</span>
              <div className="feature-bar">
                <i style={{ width: `${metric.homeRatio / total * 100}%` }} />
                <i style={{ width: `${metric.awayRatio / total * 100}%` }} />
              </div>
            </div>
            <strong>{metric.away}</strong>
          </div>
        );
      })}
    </div>
  );
}

function SummaryLine({ statistics }: { statistics: InsightRecord }) {
  if (!Object.keys(statistics).length) return null;
  return (
    <div className="preview-summary">
      <b>{text(statistics.teamShortName)}</b>
      <span>近 {text(statistics.totalLegCnt, "0")} 场</span>
      <strong className="win">{text(statistics.winGoalMatchCnt, "0")}胜（{text(statistics.winProbability, "0%")}）</strong>
      <strong className="draw">{text(statistics.drawMatchCnt, "0")}平（{text(statistics.drawProbability, "0%")}）</strong>
      <strong className="loss">{text(statistics.lossGoalMatchCnt, "0")}负（{text(statistics.lossProbability, "0%")}）</strong>
      <span>进 {text(statistics.goalCnt, "0")} / 失 {text(statistics.lossGoalCnt, "0")} / 净 {text(statistics.netGoal, "0")}</span>
    </div>
  );
}

function MatchRowsTable({
  rows,
  focusTeamName = "",
  resultMode = false,
}: {
  rows: InsightRecord[];
  focusTeamName?: string;
  resultMode?: boolean;
}) {
  if (!rows.length) return <EmptyBlock />;
  const maxTotalGoals = resultMode ? 0 : Math.max(
    ...rows.map((item) => Math.max(0, amount(item.totalTeamFullCourtGoalCnt))),
  );
  return (
    <div className="insight-table-scroll">
      <table className={`insight-table match-history-table ${resultMode ? "recent-match-table" : ""}`}>
        <thead><tr><th>比赛日期</th><th>赛事</th><th>主队</th><th>比分</th><th>客队</th>{resultMode ? <th>本队赛果</th> : <th>总进球</th>}</tr></thead>
        <tbody>
          {rows.map((item, index) => {
            const result = text(resultMode ? item.teamMatchResult : item.homeMatchResult, "");
            const homeTeamName = text(item.homeTeamShortName);
            const awayTeamName = text(item.awayTeamShortName);
            return (
              <tr key={`${text(item.matchId)}-${index}`}>
                <td className="table-date">{text(item.matchDate)}</td>
                <td>{text(item.tournamentShortName)}</td>
                <td className={focusTeamName && homeTeamName !== focusTeamName ? "opponent-team" : ""}>{homeTeamName}</td>
                <td><b className={`score-result ${result}`}>{text(item.fullCourtGoal)}</b><small>半 {text(item.halfTimeGoal)}</small></td>
                <td className={focusTeamName && awayTeamName !== focusTeamName ? "opponent-team" : ""}>{awayTeamName}</td>
                {resultMode ? (
                  <td><span className={`match-result ${result}`}>{result === "home" ? "胜" : result === "draw" ? "平" : "负"}</span></td>
                ) : (
                  <td>
                    <div
                      className="total-goals-trend"
                      title={`总进球 ${text(item.totalTeamFullCourtGoalCnt, "0")}`}
                    >
                      <span className="total-goals-track">
                        <i
                          style={{
                            width: `${maxTotalGoals > 0
                              ? Math.max(0, amount(item.totalTeamFullCourtGoalCnt)) / maxTotalGoals * 100
                              : 0}%`,
                          }}
                        />
                      </span>
                      <b>{text(item.totalTeamFullCourtGoalCnt, "0")}</b>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StandingsTable({ side }: { side: InsightRecord }) {
  const total = asRecord(side.total);
  if (!Object.keys(side).length) return <EmptyBlock />;
  return (
    <div className="preview-team-block">
      <div className="preview-team-title">
        <b>{text(total.teamShortName)}</b>
        <span>{text(total.groupName, text(total.phaseName, ""))} · 第 {text(total.ranking)} 名</span>
      </div>
      <div className="insight-table-scroll">
        <table className="insight-table standings-table">
          <thead><tr><th></th><th>场次</th><th>胜/平/负</th><th>胜率</th><th>进/失球</th><th>净胜球</th><th>积分</th><th>排名</th></tr></thead>
          <tbody>
            {([["total", "总"], ["home", "主"], ["away", "客"]] as const).map(([key, label]) => {
              const row = asRecord(side[key]);
              if (!Object.keys(row).length) return null;
              return (
                <tr key={key}>
                  <td><b>{label}</b></td>
                  <td>{text(row.totalLegCnt)}</td>
                  <td>{text(row.winGoalMatchCnt)}/{text(row.drawMatchCnt)}/{text(row.lossGoalMatchCnt)}</td>
                  <td>{text(row.winProbability)}</td>
                  <td>{text(row.goalCnt)}/{text(row.lossGoalCnt)}</td>
                  <td>{text(row.netGoal)}</td>
                  <td>{text(row.points)}</td>
                  <td><strong className="rank">{text(row.ranking)}</strong></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecentTeam({ team, nonFriendlyOnly }: { team: InsightRecord; nonFriendlyOnly: boolean }) {
  if (!Object.keys(team).length) return <EmptyBlock />;
  const statistics = asRecord(team.statistics);
  const matchRows = filterNonFriendlyTournamentRows(asRows(team.matchList), nonFriendlyOnly);
  return (
    <div className="preview-team-block">
      <SummaryLine statistics={statistics} />
      <MatchRowsTable rows={matchRows} focusTeamName={text(statistics.teamShortName, "")} resultMode />
    </div>
  );
}

function PlayersTable({ team }: { team: InsightRecord }) {
  const rows = asRows(team.playerList);
  return (
    <div className="preview-team-block">
      <div className="preview-team-title"><b>{text(team.teamShortName)}</b></div>
      {rows.length ? (
        <div className="insight-table-scroll">
          <table className="insight-table players-table">
            <thead><tr><th>号码-球员（位置）</th><th>出场（首/替）</th><th>进球（占比）</th><th>助攻（占比）</th><th>场均进球/助攻</th></tr></thead>
            <tbody>
              {rows.map((item, index) => (
                <tr key={`${text(item.personId)}-${index}`}>
                  <td><b>{text(item.uniformNo, "")}{item.uniformNo ? "-" : ""}{text(item.personName)}</b> {item.playerPositionDesc ? `（${text(item.playerPositionDesc)}）` : ""} {amount(item.injuryFlag) === 1 && <Tag color="red">伤</Tag>} {amount(item.suspensionFlag) === 1 && <Tag color="orange">停</Tag>}</td>
                  <td>{text(item.appearanceCnt)}（{text(item.startedMatchCnt)}/{text(item.substituteMatchCnt)}）</td>
                  <td>{text(item.goalCnt)}（{text(item.goalProbability)}）</td>
                  <td>{text(item.assistCnt)}（{text(item.assistProbability)}）</td>
                  <td>{text(item.goalAvgCnt)}/{text(item.assistAvgCnt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyBlock />}
    </div>
  );
}

function InjuriesTable({ team }: { team: InsightRecord }) {
  const rows = asRows(team.injuriesAndSuspensionsList);
  return (
    <div className="preview-team-block">
      <div className="preview-team-title"><b>{text(team.teamShortName)}</b></div>
      {rows.length ? (
        <div className="insight-table-scroll">
          <table className="insight-table players-table">
            <thead><tr><th>号码-球员（位置）</th><th>总出场</th><th>首发</th><th>替补</th><th>状态</th></tr></thead>
            <tbody>
              {rows.map((item, index) => (
                <tr key={`${text(item.personId)}-${index}`}>
                  <td><b>{text(item.uniformNo, "")}{item.uniformNo ? "-" : ""}{text(item.personName)}</b> {item.playerPositionDesc ? `（${text(item.playerPositionDesc)}）` : ""}</td>
                  <td>{text(item.appearanceCnt)}</td>
                  <td>{text(item.startedMatchCnt)}</td>
                  <td>{text(item.substituteMatchCnt)}</td>
                  <td>{amount(item.suspensionFlag) === 1 ? <Tag color="orange">停赛</Tag> : amount(item.injuryFlag) === 1 ? <Tag color="red">伤缺</Tag> : "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyBlock />}
    </div>
  );
}

export function MatchPreviewModal({
  match,
  open,
  onClose,
  teamNameIndex,
}: {
  match: MatchItem | null;
  open: boolean;
  onClose: () => void;
  teamNameIndex: TeamNameIndex;
}) {
  const [staticReloadKey, setStaticReloadKey] = useState(0);
  const [staticRequest, setStaticRequest] = useState<{ key: string; data: PreviewStaticData | null; error: string }>({
    key: "",
    data: null,
    error: "",
  });
  const [historyRequest, setHistoryRequest] = useState<{ key: string; data: InsightRecord | null; error: string }>({
    key: "",
    data: null,
    error: "",
  });
  const [historyNonFriendlyFlag, setHistoryNonFriendlyFlag] = useState<FilterFlag>(1);
  const [historyTournamentFlag, setHistoryTournamentFlag] = useState<FilterFlag>(0);
  const [historyHomeAwayFlag, setHistoryHomeAwayFlag] = useState<FilterFlag>(0);
  const [recentRequest, setRecentRequest] = useState<{ key: string; data: InsightRecord | null; error: string }>({
    key: "",
    data: null,
    error: "",
  });
  const [recentNonFriendlyFlag, setRecentNonFriendlyFlag] = useState<FilterFlag>(1);
  const [recentTournamentFlag, setRecentTournamentFlag] = useState<FilterFlag>(1);
  const [recentHomeAwayFlag, setRecentHomeAwayFlag] = useState<FilterFlag>(0);
  const staticRequestKey = open && match ? `${match.id}:${staticReloadKey}` : "";
  const historyRequestKey = open && match ? `${match.id}:${historyTournamentFlag}:${historyHomeAwayFlag}` : "";
  const recentRequestKey = open && match ? `${match.id}:${recentTournamentFlag}:${recentHomeAwayFlag}` : "";
  const staticLoading = Boolean(staticRequestKey) && staticRequest.key !== staticRequestKey;
  const historyLoading = Boolean(historyRequestKey) && historyRequest.key !== historyRequestKey;
  const recentLoading = Boolean(recentRequestKey) && recentRequest.key !== recentRequestKey;
  const staticData = staticRequest.key === staticRequestKey ? staticRequest.data : null;
  const staticError = staticRequest.key === staticRequestKey ? staticRequest.error : "";
  const history = historyRequest.key === historyRequestKey ? historyRequest.data : null;
  const historyError = historyRequest.key === historyRequestKey ? historyRequest.error : "";
  const recent = recentRequest.key === recentRequestKey ? recentRequest.data : null;
  const recentError = recentRequest.key === recentRequestKey ? recentRequest.error : "";
  const historyMatchRows = useMemo(() => filterNonFriendlyTournamentRows(
    asRows(history?.matchList),
    historyNonFriendlyFlag === 1,
  ), [history, historyNonFriendlyFlag]);

  useEffect(() => {
    if (!staticRequestKey || !match) return;
    let cancelled = false;
    fetchSportteryPreviewStatic(match.id)
      .then((result) => {
        if (!cancelled) setStaticRequest({ key: staticRequestKey, data: result, error: "" });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setStaticRequest({
          key: staticRequestKey,
          data: null,
          error: reason instanceof Error ? reason.message : "赛事前瞻加载失败",
        });
      });
    return () => { cancelled = true; };
  }, [match, staticRequestKey]);

  useEffect(() => {
    if (!historyRequestKey || !match) return;
    let cancelled = false;
    fetchSportteryHistory(match.id, { tournamentFlag: historyTournamentFlag, homeAwayFlag: historyHomeAwayFlag })
      .then((result) => {
        if (!cancelled) setHistoryRequest({ key: historyRequestKey, data: result, error: "" });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setHistoryRequest({
          key: historyRequestKey,
          data: null,
          error: reason instanceof Error ? reason.message : "历史交锋加载失败",
        });
      });
    return () => { cancelled = true; };
  }, [historyHomeAwayFlag, historyRequestKey, historyTournamentFlag, match]);

  useEffect(() => {
    if (!recentRequestKey || !match) return;
    let cancelled = false;
    fetchSportteryRecent(match.id, { tournamentFlag: recentTournamentFlag, homeAwayFlag: recentHomeAwayFlag })
      .then((result) => {
        if (!cancelled) setRecentRequest({ key: recentRequestKey, data: result, error: "" });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setRecentRequest({
          key: recentRequestKey,
          data: null,
          error: reason instanceof Error ? reason.message : "比赛近况加载失败",
        });
      });
    return () => { cancelled = true; };
  }, [match, recentHomeAwayFlag, recentRequestKey, recentTournamentFlag]);

  const tables = staticData?.tables ?? null;
  const players = staticData?.players ?? null;
  const injuries = staticData?.injuries ?? null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={1400}
      className="insight-modal"
      title={match ? <><span>{match.weekday}{match.code} · </span><TeamNameWithIcon name={match.home} index={teamNameIndex} /> <span>VS </span><TeamNameWithIcon name={match.away} index={teamNameIndex} iconPosition="before" aliasPosition="after" /><span> · 赛事前瞻</span></> : "赛事前瞻"}
      footer={<Button type="primary" onClick={onClose}>关闭</Button>}
    >
      <div className="insight-content">
        {staticError && (
          <Alert
            type="error"
            showIcon
            message={staticError}
            action={<Button size="small" icon={<ReloadOutlined />} onClick={() => setStaticReloadKey((value) => value + 1)}>重试</Button>}
          />
        )}
        <section className="insight-section">
          <div className="insight-section-title"><h3>特征分析</h3><Tag>近 10 场</Tag></div>
          <Spin spinning={staticLoading}><FeatureAnalysis data={staticData?.feature ?? null} /></Spin>
        </section>

        <section className="insight-section">
          <div className="insight-section-title">
            <h3>历史交锋</h3>
            <PreviewFilters
              nonFriendlyFlag={historyNonFriendlyFlag}
              tournamentFlag={historyTournamentFlag}
              homeAwayFlag={historyHomeAwayFlag}
              loading={historyLoading}
              onNonFriendlyChange={setHistoryNonFriendlyFlag}
              onTournamentChange={setHistoryTournamentFlag}
              onHomeAwayChange={setHistoryHomeAwayFlag}
            />
          </div>
          {historyError ? <Alert type="error" showIcon message={historyError} /> : (
            <Spin spinning={historyLoading}>
              <SummaryLine statistics={asRecord(history?.statistics)} />
              <MatchRowsTable rows={historyMatchRows} focusTeamName={text(history?.statistics && asRecord(history.statistics).teamShortName, "")} />
            </Spin>
          )}
        </section>

        <section className="insight-section">
          <div className="insight-section-title">
            <h3>积分榜 <small>{text(tables?.leagueShortName, "")} {text(tables?.seasonName, "")}</small></h3>
            {tables?.tournamentId ? (
              <Button
                type="link"
                icon={<ExportOutlined />}
                href={getSportteryStandingsUrl(tables.tournamentId)}
                target="_blank"
                rel="noreferrer"
              >
                查看更多
              </Button>
            ) : null}
          </div>
          <Spin spinning={staticLoading}>
            {tables ? (
              <div className="preview-two-columns">
                <StandingsTable side={asRecord(tables.homeTables)} />
                <StandingsTable side={asRecord(tables.awayTables)} />
              </div>
            ) : <EmptyBlock />}
          </Spin>
        </section>

        <section className="insight-section">
          <div className="insight-section-title">
            <h3>比赛近况</h3>
            <PreviewFilters
              nonFriendlyFlag={recentNonFriendlyFlag}
              tournamentFlag={recentTournamentFlag}
              homeAwayFlag={recentHomeAwayFlag}
              loading={recentLoading}
              onNonFriendlyChange={setRecentNonFriendlyFlag}
              onTournamentChange={setRecentTournamentFlag}
              onHomeAwayChange={setRecentHomeAwayFlag}
            />
          </div>
          {recentError ? <Alert type="error" showIcon message={recentError} /> : (
            <Spin spinning={recentLoading}>
              {recent ? (
                <div className="preview-two-columns">
                  <RecentTeam team={asRecord(recent.home)} nonFriendlyOnly={recentNonFriendlyFlag === 1} />
                  <RecentTeam team={asRecord(recent.away)} nonFriendlyOnly={recentNonFriendlyFlag === 1} />
                </div>
              ) : <EmptyBlock />}
            </Spin>
          )}
        </section>

        <section className="insight-section">
          <div className="insight-section-title">
            <h3>射手信息 <small>{text(players?.tournamentShortName, "")} {text(players?.seasonName, "")}</small></h3>
            <Tag>前 3 名</Tag>
          </div>
          <Spin spinning={staticLoading}>
            {players ? (
              <div className="preview-two-columns">
                <PlayersTable team={asRecord(players.home)} />
                <PlayersTable team={asRecord(players.away)} />
              </div>
            ) : <EmptyBlock />}
          </Spin>
        </section>

        <section className="insight-section">
          <div className="insight-section-title"><h3>伤停一览</h3></div>
          <Spin spinning={staticLoading}>
            {injuries ? (
              <div className="preview-two-columns">
                <InjuriesTable team={asRecord(injuries.home)} />
                <InjuriesTable team={asRecord(injuries.away)} />
              </div>
            ) : <EmptyBlock />}
          </Spin>
        </section>
        <p className="insight-note">注：赛事数据统计进行至全场 90 分钟（含伤停补时阶段）结果。</p>
      </div>
    </Modal>
  );
}
