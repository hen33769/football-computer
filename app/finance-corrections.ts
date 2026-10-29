import { isFinanceTrendDate, shanghaiDateKey } from "./finance-trend";

export type FinanceCorrectionKind = "expense" | "income";
export type FinanceLedgerStatus = "active" | "archived";

export type FinanceCorrectionEntry = {
  id: string;
  ledgerId: string;
  kind: FinanceCorrectionKind;
  amountDeltaCents: number;
  taxDeltaCents: number;
  netDeltaCents: number;
  /** 兼容旧客户端：支出差值或收入税后净差值。 */
  deltaCents: number;
  effectiveDate: string | null;
  note: string;
  source: string;
  createdAt: string;
  sourceCreatedAt: string | null;
  correctionBeforeCents: number;
  correctionAfterCents: number;
  taxCorrectionBeforeCents: number;
  taxCorrectionAfterCents: number;
  revisionAfter: number;
  adjustsEntryId: string | null;
};

export type FinanceLedgerSummary = {
  id: string;
  status: FinanceLedgerStatus;
  source: string;
  createdAt: string;
  archivedAt: string | null;
};

export type FinanceCorrectionPage = {
  entries: FinanceCorrectionEntry[];
  nextCursor: string | null;
  activeLedgerId: string;
  ledgers: FinanceLedgerSummary[];
};

export type CreateFinanceCorrectionInput = {
  kind: FinanceCorrectionKind;
  amountDeltaCents?: number;
  taxDeltaCents?: number;
  /** 兼容 v1.39 及更早客户端，按税额 0 的净差值处理。 */
  deltaCents?: number;
  effectiveDate: string | null;
  note: string;
  requestId: string;
  expectedRevision: number;
  adjustsEntryId?: string | null;
};

export const FINANCE_CORRECTION_NOTE_MAX_LENGTH = 200;

export function normalizeFinanceCorrectionDate(value: unknown, now = new Date()) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const date = String(value).trim();
  if (!isFinanceTrendDate(date)) throw new Error("纠错归属日期无效");
  if (date > shanghaiDateKey(now.toISOString())) throw new Error("纠错归属日期不能晚于今天");
  return date;
}

export function normalizeFinanceCorrectionNote(value: unknown) {
  const note = String(value ?? "").normalize("NFKC").trim();
  if (note.length > FINANCE_CORRECTION_NOTE_MAX_LENGTH) {
    throw new Error(`纠错备注最多 ${FINANCE_CORRECTION_NOTE_MAX_LENGTH} 字`);
  }
  return note;
}

export function isFinanceCorrectionKind(value: unknown): value is FinanceCorrectionKind {
  return value === "expense" || value === "income";
}

export function normalizeCorrectionDeltaCents(value: unknown) {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents === 0) throw new Error("纠错差值必须是非零且最多两位小数的有效金额");
  return cents;
}

export type NormalizedFinanceCorrectionAmounts = {
  amountDeltaCents: number;
  taxDeltaCents: number;
  netDeltaCents: number;
};

const safeSignedCents = (value: unknown, label: string) => {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents)) throw new Error(`${label}必须是最多两位小数的有效金额`);
  return cents;
};

export function normalizeFinanceCorrectionAmounts(
  kind: FinanceCorrectionKind,
  input: Pick<CreateFinanceCorrectionInput, "amountDeltaCents" | "taxDeltaCents" | "deltaCents">,
): NormalizedFinanceCorrectionAmounts {
  if (input.amountDeltaCents === undefined) {
    if (input.taxDeltaCents !== undefined && Number(input.taxDeltaCents) !== 0) {
      throw new Error("填写税额差值时必须同时提供收入差值");
    }
    const legacyDeltaCents = normalizeCorrectionDeltaCents(input.deltaCents);
    return {
      amountDeltaCents: legacyDeltaCents,
      taxDeltaCents: 0,
      netDeltaCents: legacyDeltaCents,
    };
  }

  const amountDeltaCents = safeSignedCents(
    input.amountDeltaCents,
    kind === "income" ? "收入差值" : "支出差值",
  );
  const taxDeltaCents = safeSignedCents(input.taxDeltaCents ?? 0, "税额差值");
  if (kind === "expense") {
    if (taxDeltaCents !== 0) throw new Error("支出纠错不能填写税额");
    if (amountDeltaCents === 0) throw new Error("支出差值不能为 0");
    return { amountDeltaCents, taxDeltaCents: 0, netDeltaCents: amountDeltaCents };
  }
  if (amountDeltaCents === 0 && taxDeltaCents === 0) throw new Error("收入差值和税额差值不能同时为 0");
  const netDeltaCents = amountDeltaCents - taxDeltaCents;
  if (!Number.isSafeInteger(netDeltaCents)) throw new Error("收入税后差值超出有效金额范围");
  return { amountDeltaCents, taxDeltaCents, netDeltaCents };
}
