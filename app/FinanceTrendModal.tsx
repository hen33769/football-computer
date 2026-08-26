"use client";

import { Alert, Button, Empty, Modal, Spin } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { ECharts, EChartsOption } from "echarts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FinanceTrendPoint, FinanceTrendResponse } from "./finance-trend";

type FinanceTrendModalProps = {
  open: boolean;
  onClose: () => void;
  loadTrend: () => Promise<FinanceTrendResponse>;
};

type TooltipParam = {
  axisValue?: unknown;
  marker?: string;
  seriesName?: string;
  data?: unknown;
  value?: unknown;
};

const EXPENSE_COLOR = "#c9494f";
const INCOME_COLOR = "#128767";
const PROFIT_COLOR = "#e58a2b";
const DAILY_EXPENSE_COLOR = "#e7a1a5";
const DAILY_INCOME_COLOR = "#7fc6b2";
const DAILY_PROFIT_COLOR = "#f1bd7d";

const currency = (value: number) => value.toLocaleString("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const monthDay = (value: unknown) => {
  const date = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(5) : date;
};

const tooltipValue = (param: TooltipParam) => {
  if (Array.isArray(param.data)) return Number(param.data[1] ?? 0);
  if (Array.isArray(param.value)) return Number(param.value[1] ?? 0);
  return Number(param.value ?? 0);
};

function chartOption(points: FinanceTrendPoint[]): EChartsOption {
  const showSymbol = points.length <= 31;
  const series = [
    { name: "累计支出", color: EXPENSE_COLOR, values: points.map((point) => point.cumulativeExpense), daily: false },
    { name: "累计收入", color: INCOME_COLOR, values: points.map((point) => point.cumulativeIncome), daily: false },
    { name: "累计利润", color: PROFIT_COLOR, values: points.map((point) => point.cumulativeProfit), daily: false },
    { name: "当日支出", color: DAILY_EXPENSE_COLOR, values: points.map((point) => point.expense), daily: true },
    { name: "当日收入", color: DAILY_INCOME_COLOR, values: points.map((point) => point.income), daily: true },
    { name: "当日利润", color: DAILY_PROFIT_COLOR, values: points.map((point) => point.profit), daily: true },
  ];
  return {
    animationDuration: 260,
    aria: { enabled: true, decal: { show: false } },
    color: series.map((item) => item.color),
    legend: {
      top: 0,
      data: series.map((item) => item.name),
      selected: {
        累计支出: true,
        累计收入: true,
        累计利润: true,
        当日支出: false,
        当日收入: false,
        当日利润: false,
      },
      textStyle: { color: "#526c72" },
    },
    tooltip: {
      trigger: "axis",
      triggerOn: "mousemove|click",
      axisPointer: { type: "line", snap: true, label: { show: true } },
      formatter: (rawParams: unknown) => {
        const params = (Array.isArray(rawParams) ? rawParams : [rawParams]) as TooltipParam[];
        const lines = params.map((param) => (
          `${param.marker ?? ""}${param.seriesName ?? ""}<b>¥${currency(tooltipValue(param))}</b>`
        ));
        return `<div class="finance-trend-tooltip"><strong>${monthDay(params[0]?.axisValue)}</strong>${lines.map((line) => `<span>${line}</span>`).join("")}</div>`;
      },
    },
    grid: { top: 48, right: 28, bottom: 72, left: 74 },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: points.map((point) => point.date),
      axisLabel: { formatter: (value: string) => monthDay(value), color: "#758a90", hideOverlap: true },
      axisLine: { lineStyle: { color: "#dbe5e6" } },
      axisPointer: { show: true, snap: true, label: { show: true, formatter: ({ value }) => monthDay(value) } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: "金额（元）",
      nameTextStyle: { color: "#758a90", padding: [0, 0, 0, 8] },
      axisLabel: {
        color: "#758a90",
        formatter: (value: number) => `¥${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`,
      },
      splitLine: { lineStyle: { color: "#edf2f2", type: "dashed" } },
    },
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: 0,
        filterMode: "none",
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        preventDefaultMouseMove: true,
      },
      {
        type: "slider",
        xAxisIndex: 0,
        filterMode: "none",
        height: 24,
        bottom: 14,
        brushSelect: false,
        borderColor: "#d9e4e5",
        fillerColor: "rgba(18,135,103,.12)",
        handleStyle: { color: "#128767", borderColor: "#128767" },
        moveHandleStyle: { color: "#93aaa9" },
        textStyle: { color: "#758a90" },
        labelFormatter: (_value: number, value: string) => monthDay(value),
      },
    ],
    series: series.map((item) => ({
      name: item.name,
      type: "line",
      smooth: false,
      showSymbol,
      symbol: "circle",
      symbolSize: item.daily ? 4 : 6,
      lineStyle: { width: item.daily ? 1.5 : 2.2, color: item.color },
      itemStyle: { color: item.color },
      emphasis: { focus: "series" },
      data: item.values,
    })),
  };
}

export function FinanceTrendModal({ open, onClose, loadTrend }: FinanceTrendModalProps) {
  const chartElementRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<FinanceTrendPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const response = await loadTrend();
      if (requestId === requestIdRef.current) setPoints(response.points);
    } catch (loadError) {
      if (requestId === requestIdRef.current) {
        setPoints([]);
        setError(loadError instanceof Error ? loadError.message : "趋势数据加载失败");
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [loadTrend]);

  useEffect(() => {
    if (!open || loading || error || points.length === 0 || !chartElementRef.current) return undefined;
    let cancelled = false;
    let chart: ECharts | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame = 0;
    const resize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => chart?.resize());
    };

    void import("echarts").then((echarts) => {
      if (cancelled || !chartElementRef.current) return;
      chart = echarts.init(chartElementRef.current);
      chart.setOption(chartOption(points));
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(chartElementRef.current);
      } else {
        window.addEventListener("resize", resize);
      }
    }).catch((loadError: unknown) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : "图表组件加载失败");
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      window.cancelAnimationFrame(resizeFrame);
      window.removeEventListener("resize", resize);
      chart?.dispose();
    };
  }, [error, loading, open, points]);

  return (
    <Modal
      open={open}
      onCancel={() => {
        requestIdRef.current += 1;
        onClose();
      }}
      afterOpenChange={(visible) => {
        if (visible) void refresh();
        else requestIdRef.current += 1;
      }}
      footer={null}
      width={1000}
      title="支出、收入与利润趋势"
      className="finance-trend-modal"
      destroyOnHidden
    >
      <p className="finance-trend-note">累计支出与累计收入分别以对应纠错值为初始值，并按日累加订单支出与结账收入；三条浅色当日线可在图例中开启。</p>
      {loading ? (
        <div className="finance-trend-loading"><Spin size="large" description="正在加载趋势数据…" /></div>
      ) : error ? (
        <Alert
          type="error"
          showIcon
          message="趋势数据加载失败"
          description={error}
          action={<Button size="small" icon={<ReloadOutlined />} onClick={() => { void refresh(); }}>重试</Button>}
        />
      ) : points.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无收支趋势数据" />
      ) : (
        <div ref={chartElementRef} className="finance-trend-chart" role="img" aria-label="支出、收入与利润的每日及累计六条趋势折线图" />
      )}
    </Modal>
  );
}
