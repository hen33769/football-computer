"use client";

import { requestJson } from "./http";
import type { FinanceTrendDateRange, FinanceTrendResponse } from "../finance-trend";
import type {
  CreateFinanceCorrectionInput,
  FinanceCorrectionKind,
  FinanceCorrectionPage,
  FinanceCorrectionEntry,
} from "../finance-corrections";

export type FinanceResponse = {
  expense: {
    orders: number;
    correction: number;
    total: number;
  };
  income: {
    grossOrders: number;
    tax: number;
    orders: number;
    grossCorrection: number;
    taxCorrection: number;
    correction: number;
    grossTotal: number;
    taxTotal: number;
    total: number;
  };
  revision: number;
  updatedAt: string;
  activeLedgerId: string;
  dataRevision: number;
};

export type FinanceCorrectionMutationResponse = {
  finance: FinanceResponse;
  entry: FinanceCorrectionEntry;
};

export function getFinance() {
  return requestJson<FinanceResponse>("/api/finance");
}

export function getFinanceTrend(range: FinanceTrendDateRange = {}) {
  const search = new URLSearchParams();
  if (range.startDate) search.set("start_date", range.startDate);
  if (range.endDate) search.set("end_date", range.endDate);
  const query = search.toString();
  return requestJson<FinanceTrendResponse>(`/api/finance/trend${query ? `?${query}` : ""}`);
}

export function updateFinanceCorrections(
  correction: { expenseCorrection: number; incomeCorrection: number },
  expectedRevision?: number,
) {
  return requestJson<FinanceResponse>("/api/finance/corrections", {
    method: "PATCH",
    body: JSON.stringify({ ...correction, expectedRevision }),
  });
}

export function createFinanceCorrection(input: CreateFinanceCorrectionInput) {
  return requestJson<FinanceCorrectionMutationResponse>("/api/finance/corrections", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getFinanceCorrections(query: {
  kind?: FinanceCorrectionKind;
  ledgerId?: string;
  cursor?: string;
  limit?: number;
} = {}) {
  const search = new URLSearchParams();
  if (query.kind) search.set("kind", query.kind);
  if (query.ledgerId) search.set("ledger_id", query.ledgerId);
  if (query.cursor) search.set("cursor", query.cursor);
  if (query.limit) search.set("limit", String(query.limit));
  const suffix = search.toString();
  return requestJson<FinanceCorrectionPage>(`/api/finance/corrections${suffix ? `?${suffix}` : ""}`);
}
