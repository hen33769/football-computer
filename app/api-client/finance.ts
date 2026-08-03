"use client";

import { requestJson } from "./http";

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

export function updateFinanceCorrections(
  correction: { expenseCorrection: number; incomeCorrection: number },
  expectedRevision?: number,
) {
  return requestJson<FinanceResponse>("/api/finance/corrections", {
    method: "PATCH",
    body: JSON.stringify({ ...correction, expectedRevision }),
  });
}
