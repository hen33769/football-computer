import { fromCents, toCents } from "./money";
import {
  buildCumulativeFinanceTrend,
  normalizeFinanceTrendDateRange,
  shanghaiDateKey,
  type FinanceTrendDateRange,
  type FinanceTrendResponse,
} from "../finance-trend";

export type FinanceState = {
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

type FinanceCorrectionRow = {
  expense_correction_cents: number;
  income_correction_cents: number;
  revision: number;
  updated_at: string;
};

type OrderFinanceRow = {
  order_expense_cents: number | null;
  order_income_cents: number | null;
};

type FinanceTrendRow = {
  date: string;
  expense_cents: number | null;
  income_cents: number | null;
};

export async function ensureFinanceCorrections(d1: D1Database, userId: string, now = new Date().toISOString()) {
  await d1.prepare(`
    INSERT INTO user_finance_corrections (
      user_id, expense_correction_cents, income_correction_cents, revision, updated_at
    )
    VALUES (?1, 0, 0, 0, ?2)
    ON CONFLICT(user_id) DO NOTHING
  `).bind(userId, now).run();
}

export async function getOrderFinanceCents(d1: D1Database, userId: string) {
  const row = await d1.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN stake_cents ELSE 0 END), 0) AS order_expense_cents,
      COALESCE(SUM(CASE WHEN settled_at IS NOT NULL THEN COALESCE(settled_prize_cents, 0) ELSE 0 END), 0) AS order_income_cents
    FROM user_orders
    WHERE user_id = ?1
  `).bind(userId).first<OrderFinanceRow>();
  return {
    expenseCents: Math.round(Number(row?.order_expense_cents ?? 0)),
    incomeCents: Math.round(Number(row?.order_income_cents ?? 0)),
  };
}

export async function getFinanceState(d1: D1Database, userId: string): Promise<FinanceState> {
  await ensureFinanceCorrections(d1, userId);
  const [orders, correction] = await Promise.all([
    getOrderFinanceCents(d1, userId),
    d1.prepare(`
      SELECT expense_correction_cents, income_correction_cents, revision, updated_at
      FROM user_finance_corrections
      WHERE user_id = ?1
    `).bind(userId).first<FinanceCorrectionRow>(),
  ]);
  const expenseCorrectionCents = Math.round(Number(correction?.expense_correction_cents ?? 0));
  const incomeCorrectionCents = Math.round(Number(correction?.income_correction_cents ?? 0));
  return {
    expense: {
      orders: fromCents(orders.expenseCents),
      correction: fromCents(expenseCorrectionCents),
      total: fromCents(orders.expenseCents + expenseCorrectionCents),
    },
    income: {
      orders: fromCents(orders.incomeCents),
      correction: fromCents(incomeCorrectionCents),
      total: fromCents(orders.incomeCents + incomeCorrectionCents),
    },
    revision: correction?.revision ?? 0,
    updatedAt: correction?.updated_at ?? "",
  };
}

export async function getFinanceTrend(
  d1: D1Database,
  userId: string,
  rawRange: FinanceTrendDateRange = {},
): Promise<FinanceTrendResponse> {
  const range = normalizeFinanceTrendDateRange(rawRange);
  const [rows, correction] = await Promise.all([
    d1.prepare(`
      SELECT
        event_date AS date,
        COALESCE(SUM(expense_cents), 0) AS expense_cents,
        COALESCE(SUM(income_cents), 0) AS income_cents
      FROM (
        SELECT
          date(saved_at, '+8 hours') AS event_date,
          stake_cents AS expense_cents,
          0 AS income_cents
        FROM user_orders
        WHERE user_id = ?1 AND payment_status = 'paid'
        UNION ALL
        SELECT
          date(settled_at, '+8 hours') AS event_date,
          0 AS expense_cents,
          COALESCE(settled_prize_cents, 0) AS income_cents
        FROM user_orders
        WHERE user_id = ?1 AND settled_at IS NOT NULL
      ) AS finance_events
      WHERE (?2 IS NULL OR event_date <= ?2)
      GROUP BY event_date
      ORDER BY event_date ASC
    `).bind(userId, range.endDate ?? null).all<FinanceTrendRow>(),
    d1.prepare(`
      SELECT expense_correction_cents, income_correction_cents, revision, updated_at
      FROM user_finance_corrections
      WHERE user_id = ?1
    `).bind(userId).first<FinanceCorrectionRow>(),
  ]);

  return {
    points: buildCumulativeFinanceTrend(
      (rows.results ?? []).map((row) => ({
        date: row.date,
        expense: fromCents(Math.round(Number(row.expense_cents ?? 0))),
        income: fromCents(Math.round(Number(row.income_cents ?? 0))),
      })),
      {
        expenseCorrection: fromCents(Math.round(Number(correction?.expense_correction_cents ?? 0))),
        incomeCorrection: fromCents(Math.round(Number(correction?.income_correction_cents ?? 0))),
        date: correction?.updated_at ? shanghaiDateKey(correction.updated_at) : undefined,
      },
      range,
    ),
  };
}

export async function updateFinanceCorrections(
  d1: D1Database,
  userId: string,
  correction: { expenseCorrection: number; incomeCorrection: number },
  expectedRevision?: number,
): Promise<FinanceState> {
  const now = new Date().toISOString();
  await ensureFinanceCorrections(d1, userId, now);
  const orders = await getOrderFinanceCents(d1, userId);
  const expenseCorrectionCents = toCents(correction.expenseCorrection);
  const incomeCorrectionCents = toCents(correction.incomeCorrection);
  if (orders.expenseCents + expenseCorrectionCents < 0 || orders.incomeCents + incomeCorrectionCents < 0) {
    return Promise.reject(new Error("纠错后的最终收入或支出不能小于 0"));
  }
  const revisionGuard = Number.isInteger(expectedRevision) ? Number(expectedRevision) : null;
  const result = await d1.prepare(`
    UPDATE user_finance_corrections
    SET expense_correction_cents = ?1,
        income_correction_cents = ?2,
        revision = revision + 1,
        updated_at = ?3
    WHERE user_id = ?4
      AND (?5 IS NULL OR revision = ?5)
  `).bind(expenseCorrectionCents, incomeCorrectionCents, now, userId, revisionGuard).run();
  if ((result.meta.changes ?? 0) === 0) {
    const current = await getFinanceState(d1, userId);
    const error = new Error("云端财务纠错值已被其他设备更新，请刷新后重试");
    Object.assign(error, { status: 409, revision: current.revision });
    throw error;
  }
  return getFinanceState(d1, userId);
}
