"use client";

import {
  Alert,
  Button,
  DatePicker,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
} from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CreateFinanceCorrectionInput,
  FinanceCorrectionEntry,
  FinanceCorrectionKind,
  FinanceCorrectionPage,
} from "../finance-corrections";

type Props = {
  open: boolean;
  initialView: "create" | "history";
  initialKind: FinanceCorrectionKind;
  revision: number;
  totals: { expense: number; income: number };
  corrections: { expense: number; income: number };
  onClose: () => void;
  onCreate: (input: CreateFinanceCorrectionInput) => Promise<unknown>;
  onLoad: (query: {
    kind?: FinanceCorrectionKind;
    ledgerId?: string;
    cursor?: string;
    limit?: number;
  }) => Promise<FinanceCorrectionPage>;
};

const currency = (value: number) => value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedMoney = (cents: number) => `${cents >= 0 ? "+" : "−"}¥${currency(Math.abs(cents) / 100)}`;

function parseYuanToCents(value: string) {
  const normalized = value.trim();
  if (!/^[+-]?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) throw new Error("请输入非零且最多两位小数的纠错差值");
  const negative = normalized.startsWith("-");
  const [integer, fraction = ""] = normalized.replace(/^[+-]/, "").split(".");
  const cents = Number(integer) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents === 0) throw new Error("请输入非零且最多两位小数的纠错差值");
  return negative ? -cents : cents;
}

export function FinanceCorrectionsModal({
  open,
  initialView,
  initialKind,
  revision,
  totals,
  corrections,
  onClose,
  onCreate,
  onLoad,
}: Props) {
  const [view, setView] = useState<"create" | "history">(initialView);
  const [kind, setKind] = useState<FinanceCorrectionKind>(initialKind);
  const [amount, setAmount] = useState("");
  const [effectiveDate, setEffectiveDate] = useState<Dayjs | null>(null);
  const [note, setNote] = useState("");
  const [adjustsEntry, setAdjustsEntry] = useState<FinanceCorrectionEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [page, setPage] = useState<FinanceCorrectionPage | null>(null);
  const [historyKind, setHistoryKind] = useState<FinanceCorrectionKind | undefined>();
  const [ledgerId, setLedgerId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const requestRef = useRef(0);
  const submitRequestRef = useRef({ id: crypto.randomUUID(), payload: "" });

  const resetForm = useCallback((nextKind = initialKind) => {
    setKind(nextKind);
    setAmount("");
    setEffectiveDate(null);
    setNote("");
    setAdjustsEntry(null);
    setFormError("");
    submitRequestRef.current = { id: crypto.randomUUID(), payload: "" };
  }, [initialKind]);

  const load = useCallback(async (append = false) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setHistoryError("");
    try {
      const next = await onLoad({
        kind: historyKind,
        ledgerId,
        cursor: append ? page?.nextCursor ?? undefined : undefined,
        limit: 20,
      });
      if (requestId !== requestRef.current) return;
      setPage(append && page ? { ...next, entries: [...page.entries, ...next.entries] } : next);
      if (!ledgerId) setLedgerId(next.activeLedgerId);
    } catch (error) {
      if (requestId === requestRef.current) setHistoryError(error instanceof Error ? error.message : "纠错记录加载失败");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [historyKind, ledgerId, onLoad, page]);

  useEffect(() => {
    if (!open || view !== "history" || page || loading) return;
    const timer = window.setTimeout(() => { void load(false); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, loading, open, page, view]);

  const parsedCents = useMemo(() => {
    try { return parseYuanToCents(amount); } catch { return null; }
  }, [amount]);
  const currentTotal = totals[kind];
  const currentCorrection = corrections[kind];
  const wouldBeNegative = parsedCents !== null && currentTotal + parsedCents / 100 < 0;

  const submit = async () => {
    if (saving) return;
    setFormError("");
    try {
      const deltaCents = parseYuanToCents(amount);
      const payloadKey = JSON.stringify({
        kind,
        deltaCents,
        effectiveDate: effectiveDate?.format("YYYY-MM-DD") ?? null,
        note: note.normalize("NFKC").trim(),
        adjustsEntryId: adjustsEntry?.id ?? null,
      });
      if (submitRequestRef.current.payload !== payloadKey) {
        submitRequestRef.current = { id: crypto.randomUUID(), payload: payloadKey };
      }
      setSaving(true);
      await onCreate({
        kind,
        deltaCents,
        effectiveDate: effectiveDate?.format("YYYY-MM-DD") ?? null,
        note,
        requestId: submitRequestRef.current.id,
        expectedRevision: revision,
        adjustsEntryId: adjustsEntry?.id ?? null,
      });
      resetForm(kind);
      setView("history");
      setPage(null);
      setLedgerId(undefined);
    } catch (error) {
      if (Number((error as Error & { status?: unknown }).status) === 409) {
        setPage(null);
        setLedgerId(undefined);
      }
      setFormError(error instanceof Error ? error.message : "纠错保存失败");
    } finally {
      setSaving(false);
    }
  };

  const startAdjustment = (entry: FinanceCorrectionEntry) => {
    setView("create");
    setKind(entry.kind);
    setEffectiveDate(entry.effectiveDate ? dayjs(entry.effectiveDate) : null);
    setAmount("");
    setNote("");
    setAdjustsEntry(entry);
    setFormError("");
  };

  const activeLedger = !page || !ledgerId || page.activeLedgerId === ledgerId;
  return (
    <Modal open={open} onCancel={onClose} footer={null} width={860} title="财务纠错" destroyOnHidden>
      <Segmented
        block
        value={view}
        options={[{ label: "新增纠错", value: "create" }, { label: "纠错记录", value: "history" }]}
        onChange={(value) => setView(value as "create" | "history")}
      />
      {view === "create" ? (
        <div className="finance-correction-form">
          {adjustsEntry && <Alert showIcon type="info" title={`正在补差：${adjustsEntry.kind === "income" ? "收入" : "支出"} ${signedMoney(adjustsEntry.deltaCents)}${adjustsEntry.effectiveDate ? ` · ${adjustsEntry.effectiveDate}` : " · 初值"}`} />}
          <label><span>纠错类型</span><Segmented block value={kind} options={[{ label: "支出", value: "expense" }, { label: "税后收入", value: "income" }]} onChange={(value) => setKind(value as FinanceCorrectionKind)} /></label>
          <label><span>本次纠错差值</span><Input value={amount} prefix="¥" inputMode="decimal" placeholder="正数增加，负数减少，例如 -20" onChange={(event) => setAmount(event.target.value)} /></label>
          <label><span>归属日期（可选）</span><DatePicker allowClear value={effectiveDate} maxDate={dayjs().endOf("day")} placeholder="不选则计入初值" onChange={setEffectiveDate} /></label>
          <label><span>备注（可选）</span><Input.TextArea value={note} maxLength={200} showCount autoSize={{ minRows: 2, maxRows: 5 }} onChange={(event) => setNote(event.target.value)} /></label>
          <div className="finance-correction-preview">
            <span>{kind === "income" ? "当前税后收入" : "当前支出"}<b>¥{currency(currentTotal)}</b></span>
            <span>本次差值<b>{parsedCents === null ? "—" : signedMoney(parsedCents)}</b></span>
            <span>调整后<b>¥{currency(currentTotal + (parsedCents ?? 0) / 100)}</b></span>
            <small>{effectiveDate ? `计入 ${effectiveDate.format("YYYY-MM-DD")} 的${kind === "income" ? "收入" : "支出"}` : "无归属日期，计入累计初值"}；累计纠错 {signedMoney(Math.round(currentCorrection * 100))} → {signedMoney(Math.round(currentCorrection * 100) + (parsedCents ?? 0))}</small>
          </div>
          {wouldBeNegative && <Alert showIcon type="warning" title="纠错后的最终收入或支出不能小于 0" />}
          {formError && <Alert showIcon type="error" title={formError} />}
          <Space><Button type="primary" icon={<PlusOutlined />} loading={saving} disabled={wouldBeNegative} onClick={() => { void submit(); }}>确认新增纠错</Button><Button disabled={saving} onClick={() => resetForm(kind)}>清空</Button></Space>
        </div>
      ) : (
        <div className="finance-correction-history">
          <Space wrap>
            <Select allowClear placeholder="全部类型" value={historyKind} style={{ width: 140 }} options={[{ label: "支出", value: "expense" }, { label: "税后收入", value: "income" }]} onChange={(value) => { setHistoryKind(value); setPage(null); }} />
            {page && page.ledgers.length > 1 && <Select value={ledgerId ?? page.activeLedgerId} style={{ width: 220 }} options={page.ledgers.map((ledger) => ({ label: ledger.status === "active" ? "当前账本" : `归档 · ${dayjs(ledger.archivedAt ?? ledger.createdAt).format("YYYY-MM-DD HH:mm")}`, value: ledger.id }))} onChange={(value) => { setLedgerId(value); setPage(null); }} />}
            <Button icon={<ReloadOutlined />} onClick={() => { setPage(null); void load(false); }}>刷新</Button>
          </Space>
          {historyError && <Alert showIcon type="error" title={historyError} />}
          {loading && !page ? <div className="finance-correction-loading"><Spin /></div> : page && page.entries.length > 0 ? (
            <div className="finance-correction-record-list">
              {page.entries.map((entry) => (
                <section className="finance-correction-record" key={entry.id}>
                  <div className="finance-correction-record-main">
                    <Space wrap><Tag color={entry.kind === "income" ? "green" : "red"}>{entry.kind === "income" ? "收入" : "支出"}</Tag><b className={entry.deltaCents >= 0 ? "positive" : "negative"}>{signedMoney(entry.deltaCents)}</b><span>{entry.effectiveDate ?? "无日期 · 初值"}</span></Space>
                    <div className="finance-correction-record-description"><span>{dayjs(entry.createdAt).format("YYYY-MM-DD HH:mm:ss")}</span>{entry.note && <p>{entry.note}</p>}<small>累计纠错 {signedMoney(entry.correctionBeforeCents)} → {signedMoney(entry.correctionAfterCents)}{entry.adjustsEntryId ? " · 补差记录" : ""}{entry.source !== "manual" ? ` · ${entry.source}` : ""}</small></div>
                  </div>
                  {activeLedger && <Button type="link" onClick={() => startAdjustment(entry)}>补差</Button>}
                </section>
              ))}
            </div>
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无纠错记录" />}
          {page?.nextCursor && <Button block loading={loading} onClick={() => { void load(true); }}>加载更多</Button>}
        </div>
      )}
    </Modal>
  );
}
