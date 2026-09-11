"use client";

import { Alert, Button, Checkbox, Empty, Modal, Select } from "antd";
import type { ECharts, EChartsOption } from "echarts";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatLeagueHitRate, sortLeagueAccuracyLeagueNames, type LeagueAccuracyStat } from "./league-accuracy";

type LeagueAccuracyModalProps = {
  open: boolean;
  onClose: () => void;
  orderCount: number;
  stats: LeagueAccuracyStat[];
  leagueColors: Record<string, string>;
  excludeScore: boolean;
  onExcludeScoreChange: (checked: boolean) => void;
  countDuplicates: boolean;
  onCountDuplicatesChange: (checked: boolean) => void;
};

type ChartFormatterParam = {
  dataIndex?: number;
  marker?: string;
};

const SELECT_ALL_LEAGUES = "__select_all_leagues__";

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function chartOption(
  stats: LeagueAccuracyStat[],
  leagueColors: Record<string, string>,
  fixedMax: boolean,
  compact: boolean,
): EChartsOption {
  const dataMax = Math.max(...stats.map((stat) => stat.accuracy ?? 0));
  return {
    animationDuration: 260,
    aria: { enabled: true, decal: { show: false } },
    tooltip: {
      trigger: "item",
      formatter: (rawParam: unknown) => {
        const param = rawParam as ChartFormatterParam;
        const stat = stats[param.dataIndex ?? -1];
        if (!stat) return "";
        return [
          `<div class="league-accuracy-tooltip"><strong>${escapeHtml(stat.league)}</strong>`,
          `<span>${param.marker ?? ""}命中率<b>${formatLeagueHitRate(stat.accuracy)}</b></span>`,
          `<span>命中<b>${stat.hit}</b></span>`,
          `<span>未命中<b>${stat.miss}</b></span>`,
          `<span>未确认<b>${stat.unconfirmed}</b></span></div>`,
        ].join("");
      },
    },
    grid: {
      top: 44,
      right: compact ? 10 : 24,
      bottom: compact ? 60 : 52,
      left: compact ? 52 : 62,
    },
    xAxis: {
      type: "category",
      data: stats.map((stat) => stat.league),
      axisLabel: {
        interval: 0,
        rotate: stats.length > 6 ? (compact ? 45 : 28) : 0,
        color: "#758a90",
        fontSize: compact ? 9 : 12,
      },
      axisLine: { lineStyle: { color: "#dbe5e6" } },
      axisTick: { alignWithLabel: true },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: fixedMax ? 100 : Math.max(dataMax, 1),
      name: "命中率",
      nameTextStyle: { color: "#758a90", padding: [0, 0, 0, 8] },
      axisLabel: { color: "#758a90", formatter: (value: number) => formatLeagueHitRate(value) },
      splitLine: { lineStyle: { color: "#edf2f2", type: "dashed" } },
    },
    series: [{
      name: "命中率",
      type: "bar",
      barMaxWidth: compact ? 32 : 56,
      emphasis: { focus: "series" },
      label: {
        show: true,
        position: "top",
        color: "#31575a",
        fontWeight: 700,
        fontSize: compact ? 8 : 12,
        lineHeight: compact ? 11 : 16,
        formatter: (rawParam: unknown) => {
          const param = rawParam as ChartFormatterParam;
          const stat = stats[param.dataIndex ?? -1];
          if (!stat) return "";
          return `${formatLeagueHitRate(stat.accuracy)}\n${stat.hit + stat.miss}场`;
        },
      },
      data: stats.map((stat) => ({
        value: stat.accuracy ?? 0,
        itemStyle: {
          color: leagueColors[stat.league] ?? "#108a83",
          borderRadius: [6, 6, 0, 0],
        },
      })),
    }],
  };
}

export function LeagueAccuracyModal({
  open,
  onClose,
  orderCount,
  stats,
  leagueColors,
  excludeScore,
  onExcludeScoreChange,
  countDuplicates,
  onCountDuplicatesChange,
}: LeagueAccuracyModalProps) {
  const chartElementRef = useRef<HTMLDivElement>(null);
  const [selectedLeagueNames, setSelectedLeagueNames] = useState<string[] | null>(null);
  const [fixedMax, setFixedMax] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [chartError, setChartError] = useState("");
  const [chartReloadKey, setChartReloadKey] = useState(0);
  const statByLeague = useMemo(() => new Map(stats.map((stat) => [stat.league, stat])), [stats]);
  const availableLeagueNames = useMemo(() => sortLeagueAccuracyLeagueNames(stats.map((stat) => stat.league)), [stats]);
  const availableLeagueNameSet = useMemo(() => new Set(availableLeagueNames), [availableLeagueNames]);
  const effectiveSelectedLeagueNames = useMemo(() => (
    selectedLeagueNames === null
      ? availableLeagueNames
      : selectedLeagueNames.filter((leagueName) => availableLeagueNameSet.has(leagueName))
  ), [availableLeagueNameSet, availableLeagueNames, selectedLeagueNames]);
  const selectedStats = useMemo(() => effectiveSelectedLeagueNames.flatMap((leagueName) => {
    const stat = statByLeague.get(leagueName);
    return stat ? [stat] : [];
  }), [effectiveSelectedLeagueNames, statByLeague]);

  useEffect(() => {
    if (!open || !modalVisible || chartError || selectedStats.length === 0 || !chartElementRef.current) return undefined;
    let cancelled = false;
    let chart: ECharts | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame = 0;
    const resize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => chart?.resize());
    };

    void import("echarts")
      .then((echarts) => {
        if (cancelled || !chartElementRef.current) return;
        chart = echarts.init(chartElementRef.current);
        chart.setOption(chartOption(
          selectedStats,
          leagueColors,
          fixedMax,
          chartElementRef.current.clientWidth < 480,
        ));
        chart.on("click", (rawParam: unknown) => {
          const param = rawParam as ChartFormatterParam;
          const stat = selectedStats[param.dataIndex ?? -1];
          if (!stat) return;
          setSelectedLeagueNames((current) => (
            (current ?? availableLeagueNames).filter((leagueName) => leagueName !== stat.league)
          ));
        });
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(resize);
          resizeObserver.observe(chartElementRef.current);
        } else {
          window.addEventListener("resize", resize);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setChartError(loadError instanceof Error ? loadError.message : "图表组件加载失败");
      });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      window.cancelAnimationFrame(resizeFrame);
      window.removeEventListener("resize", resize);
      chart?.dispose();
    };
  }, [availableLeagueNames, chartError, chartReloadKey, fixedMax, leagueColors, modalVisible, open, selectedStats]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={1000}
      title="联赛命中率"
      className="league-accuracy-modal"
      destroyOnHidden
      afterOpenChange={(visible) => {
        setModalVisible(visible);
        if (visible) setChartError("");
      }}
    >
      <div className="league-accuracy-controls">
        <label className="league-accuracy-league-select">
          <span>联赛</span>
          <Select
            aria-label="选择统计联赛"
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder="请选择联赛"
            value={effectiveSelectedLeagueNames}
            options={[
              { value: SELECT_ALL_LEAGUES, label: "全选" },
              ...availableLeagueNames.map((leagueName) => ({ value: leagueName, label: leagueName })),
            ]}
            onChange={(values) => {
              if (values.includes(SELECT_ALL_LEAGUES)) {
                setSelectedLeagueNames(availableLeagueNames);
                return;
              }
              setSelectedLeagueNames(values.filter((leagueName) => availableLeagueNameSet.has(leagueName)));
            }}
          />
        </label>
        <div className="league-accuracy-options">
          <Checkbox checked={excludeScore} onChange={(event) => onExcludeScoreChange(event.target.checked)}>不统计比分</Checkbox>
          <Checkbox checked={countDuplicates} onChange={(event) => onCountDuplicatesChange(event.target.checked)}>重复计数</Checkbox>
          <Checkbox checked={fixedMax} onChange={(event) => setFixedMax(event.target.checked)}>固定 Max</Checkbox>
        </div>
      </div>
      <p className="league-accuracy-note">
        基于当前筛选的 {orderCount} 个订单，按每场比赛的已选玩法统计；命中率不包含未确认结果，点击柱子可取消该联赛。
      </p>
      {availableLeagueNames.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选订单暂无可统计的联赛投注" />
      ) : selectedStats.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择至少一个联赛" />
      ) : chartError ? (
        <Alert
          type="error"
          showIcon
          message="命中率图表加载失败"
          description={chartError}
          action={<Button size="small" onClick={() => {
            setChartError("");
            setChartReloadKey((value) => value + 1);
          }}>重试</Button>}
        />
      ) : (
        <div ref={chartElementRef} className="league-accuracy-chart" role="img" aria-label="当前筛选订单按联赛统计的投注命中率柱状图" />
      )}
    </Modal>
  );
}
