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
  totals: { expense: number; grossIncome: number; tax: number; income: number };
  corrections: { expense: number; grossIncome: number; tax: number; income: number };
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

function parseYuanToCents(value: string, options: { allowZero?: boolean; label?: string } = {}) {
  const normalized = value.trim();
  const label = options.label ?? "纠错差值";
  if (!/^[+-]?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) throw new Error(`请输入最多两位小数的${label}`);
  const negative = normalized.startsWith("-");
  const [integer, fraction = ""] = normalized.replace(/^[+-]/, "").split(".");
  const cents = Number(integer) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || (!options.allowZero && cents === 0)) throw new Error(`请输入${options.allowZero ? "" : "非零且"}最多两位小数的${label}`);
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
  const [taxAmount, setTaxAmount] = useState("0");
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
    setTaxAmount("0");
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
    try { return parseYuanToCents(amount, { allowZero: kind === "income", label: kind === "income" ? "收入差值" : "支出差值" }); } catch { return null; }
  }, [amount, kind]);
  const parsedTaxCents = useMemo(() => {
    if (kind === "expense") return 0;
    try { return parseYuanToCents(taxAmount, { allowZero: true, label: "税额差值" }); } catch { return null; }
  }, [kind, taxAmount]);
  const parsedNetCents = parsedCents !== null && parsedTaxCents !== null ? parsedCents - parsedTaxCents : null;
  const bothIncomeAmountsZero = kind === "income" && parsedCents === 0 && parsedTaxCents === 0;
  const wouldBeNegative = parsedCents !== null && parsedTaxCents !== null && (kind === "expense"
    ? totals.expense + parsedCents / 100 < 0
    : totals.grossIncome + parsedCents / 100 < 0
      || totals.tax + parsedTaxCents / 100 < 0
      || totals.income + (parsedNetCents ?? 0) / 100 < 0);

  const submit = async () => {
    if (saving) return;
    setFormError("");
    try {
      const amountDeltaCents = parseYuanToCents(amount, { allowZero: kind === "income", label: kind === "income" ? "收入差值" : "支出差值" });
      const taxDeltaCents = kind === "income"
        ? parseYuanToCents(taxAmount, { allowZero: true, label: "税额差值" })
        : 0;
      if (kind === "income" && amountDeltaCents === 0 && taxDeltaCents === 0) throw new Error("收入差值和税额差值不能同时为 0");
      const payloadKey = JSON.stringify({
        kind,
        amountDeltaCents,
        taxDeltaCents,
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
        amountDeltaCents,
        taxDeltaCents,
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
    setTaxAmount("0");
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
          {adjustsEntry && <Alert showIcon type="info" title={adjustsEntry.kind === "income"
            ? `正在补差：收入税前 ${signedMoney(adjustsEntry.amountDeltaCents)} · 税额 ${signedMoney(adjustsEntry.taxDeltaCents)}${adjustsEntry.effectiveDate ? ` · ${adjustsEntry.effectiveDate}` : " · 初值"}`
            : `正在补差：支出 ${signedMoney(adjustsEntry.amountDeltaCents)}${adjustsEntry.effectiveDate ? ` · ${adjustsEntry.effectiveDate}` : " · 初值"}`} />}
          <label><span>纠错类型</span><Segmented block value={kind} options={[{ label: "支出", value: "expense" }, { label: "收入", value: "income" }]} onChange={(value) => {
            const nextKind = value as FinanceCorrectionKind;
            setKind(nextKind);
            if (nextKind === "expense") setTaxAmount("0");
          }} /></label>
          <label><span>{kind === "income" ? "收入差值（税前）" : "支出差值"}</span><Input value={amount} prefix="¥" inputMode="decimal" placeholder={kind === "income" ? "可填 0；正数增加收入，负数减少" : "正数增加，负数减少，例如 -20"} onChange={(event) => setAmount(event.target.value)} /></label>
          {kind === "income" && <label><span>税额差值</span><Input value={taxAmount} prefix="¥" inputMode="decimal" placeholder="正数增加税额，负数减少税额" onChange={(event) => setTaxAmount(event.target.value)} /><small>税额不自动计算；只纠正税额时，收入差值可填 0。</small></label>}
          <label><span>归属日期（可选）</span><DatePicker allowClear value={effectiveDate} maxDate={dayjs().endOf("day")} placeholder="不选则计入初值" onChange={setEffectiveDate} /></label>
          <label><span>备注（可选）</span><Input.TextArea value={note} maxLength={200} showCount autoSize={{ minRows: 2, maxRows: 5 }} onChange={(event) => setNote(event.target.value)} /></label>
          {kind === "expense" ? <div className="finance-correction-preview">
            <span>当前支出<b>¥{currency(totals.expense)}</b></span>
            <span>本次差值<b>{parsedCents === null ? "—" : signedMoney(parsedCents)}</b></span>
            <span>调整后<b>¥{currency(totals.expense + (parsedCents ?? 0) / 100)}</b></span>
            <small>{effectiveDate ? `计入 ${effectiveDate.format("YYYY-MM-DD")} 的支出` : "无归属日期，计入累计初值"}；累计纠错 {signedMoney(Math.round(corrections.expense * 100))} → {signedMoney(Math.round(corrections.expense * 100) + (parsedCents ?? 0))}</small>
          </div> : <div className="finance-correction-preview finance-correction-income-preview">
            <span>税前收入<b>¥{currency(totals.grossIncome)} → ¥{currency(totals.grossIncome + (parsedCents ?? 0) / 100)}</b></span>
            <span>税额<b>¥{currency(totals.tax)} → ¥{currency(totals.tax + (parsedTaxCents ?? 0) / 100)}</b></span>
            <span>税后收入<b>¥{currency(totals.income)} → ¥{currency(totals.income + (parsedNetCents ?? 0) / 100)}</b></span>
            <small>本次税后净影响 {parsedNetCents === null ? "—" : signedMoney(parsedNetCents)}；{effectiveDate ? `计入 ${effectiveDate.format("YYYY-MM-DD")} 的收入` : "无归属日期，计入累计初值"}。累计税前纠错 {signedMoney(Math.round(corrections.grossIncome * 100))}，税额纠错 {signedMoney(Math.round(corrections.tax * 100))}，税后纠错 {signedMoney(Math.round(corrections.income * 100))}。</small>
          </div>}
          {bothIncomeAmountsZero && <Alert showIcon type="warning" title="收入差值和税额差值不能同时为 0" />}
          {wouldBeNegative && <Alert showIcon type="warning" title={kind === "income" ? "纠错后的最终税前收入、税额或税后收入不能小于 0" : "纠错后的最终支出不能小于 0"} />}
          {formError && <Alert showIcon type="error" title={formError} />}
          <Space><Button type="primary" icon={<PlusOutlined />} loading={saving} disabled={wouldBeNegative || bothIncomeAmountsZero || parsedCents === null || parsedTaxCents === null} onClick={() => { void submit(); }}>确认新增纠错</Button><Button disabled={saving} onClick={() => resetForm(kind)}>清空</Button></Space>
        </div>
      ) : (
        <div className="finance-correction-history">
          <Space wrap>
            <Select allowClear placeholder="全部类型" value={historyKind} style={{ width: 140 }} options={[{ label: "支出", value: "expense" }, { label: "收入", value: "income" }]} onChange={(value) => { setHistoryKind(value); setPage(null); }} />
            {page && page.ledgers.length > 1 && <Select value={ledgerId ?? page.activeLedgerId} style={{ width: 220 }} options={page.ledgers.map((ledger) => ({ label: ledger.status === "active" ? "当前账本" : `归档 · ${dayjs(ledger.archivedAt ?? ledger.createdAt).format("YYYY-MM-DD HH:mm")}`, value: ledger.id }))} onChange={(value) => { setLedgerId(value); setPage(null); }} />}
            <Button icon={<ReloadOutlined />} onClick={() => { setPage(null); void load(false); }}>刷新</Button>
          </Space>
          {historyError && <Alert showIcon type="error" title={historyError} />}
          {loading && !page ? <div className="finance-correction-loading"><Spin /></div> : page && page.entries.length > 0 ? (
            <div className="finance-correction-record-list">
              {page.entries.map((entry) => (
                <section className="finance-correction-record" key={entry.id}>
                  <div className="finance-correction-record-main">
                    <Space wrap><Tag color={entry.kind === "income" ? "green" : "red"}>{entry.kind === "income" ? "收入" : "支出"}</Tag><b className={entry.amountDeltaCents >= 0 ? "positive" : "negative"}>{entry.kind === "income" ? `税前 ${signedMoney(entry.amountDeltaCents)}` : signedMoney(entry.amountDeltaCents)}</b><span>{entry.effectiveDate ?? "无日期 · 初值"}</span></Space>
                    <div className="finance-correction-record-description"><span>{dayjs(entry.createdAt).format("YYYY-MM-DD HH:mm:ss")}</span>{entry.kind === "income" && <small>税额 {signedMoney(entry.taxDeltaCents)} · 税后净值 {signedMoney(entry.netDeltaCents)}</small>}{entry.note && <p>{entry.note}</p>}<small>{entry.kind === "income" ? `累计税后纠错 ${signedMoney(entry.correctionBeforeCents)} → ${signedMoney(entry.correctionAfterCents)} · 累计纠错税额 ${signedMoney(entry.taxCorrectionBeforeCents)} → ${signedMoney(entry.taxCorrectionAfterCents)}` : `累计纠错 ${signedMoney(entry.correctionBeforeCents)} → ${signedMoney(entry.correctionAfterCents)}`}{entry.adjustsEntryId ? " · 补差记录" : ""}{entry.source !== "manual" ? ` · ${entry.source}` : ""}</small></div>
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
