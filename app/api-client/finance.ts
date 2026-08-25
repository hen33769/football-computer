"use client";

import { requestJson } from "./http";
import type { FinanceTrendDateRange, FinanceTrendResponse } from "../finance-trend";

export type FinanceResponse = {
  expense: {
    orders: number;
    correction: number;
    total: number;
  };
  income: {
    orders: number;
    correction: number;
    total: number;
  };
  revision: number;
  updatedAt: string;
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
