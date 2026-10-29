import { isFinanceTrendDate, shanghaiDateKey } from "./finance-trend";

export type FinanceCorrectionKind = "expense" | "income";
export type FinanceLedgerStatus = "active" | "archived";

export type FinanceCorrectionEntry = {
  id: string;
  ledgerId: string;
  kind: FinanceCorrectionKind;
  deltaCents: number;
  effectiveDate: string | null;
  note: string;
  source: string;
  createdAt: string;
  sourceCreatedAt: string | null;
  correctionBeforeCents: number;
  correctionAfterCents: number;
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
  deltaCents: number;
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
