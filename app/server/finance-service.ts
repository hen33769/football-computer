import { fromCents, toCents } from "./money";
import { httpError } from "./errors";
import {
  isFinanceCorrectionKind,
  normalizeCorrectionDeltaCents,
  normalizeFinanceCorrectionDate,
  normalizeFinanceCorrectionNote,
  type CreateFinanceCorrectionInput,
  type FinanceCorrectionEntry,
  type FinanceCorrectionKind,
  type FinanceCorrectionPage,
  type FinanceLedgerSummary,
} from "../finance-corrections";
import {
  ensurePersonalDataRevision,
  getPersonalDataRevision,
  incrementPersonalDataRevisionStatement,
} from "./personal-data-revision-service";
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
    grossOrders: number;
    tax: number;
    orders: number;
    correction: number;
    total: number;
  };
  revision: number;
  updatedAt: string;
  activeLedgerId: string;
  dataRevision: number;
};

type FinanceCorrectionRow = {
  expense_correction_cents: number;
  income_correction_cents: number;
  revision: number;
  updated_at: string;
  active_ledger_id: string | null;
};

type FinanceCorrectionEntryRow = {
  id: string;
  ledger_id: string;
  kind: FinanceCorrectionKind;
  delta_cents: number;
  effective_date: string | null;
  note: string;
  source: string;
  created_at: string;
  source_created_at: string | null;
  correction_before_cents: number;
  correction_after_cents: number;
  revision_after: number;
  adjusts_entry_id: string | null;
};

type FinanceLedgerRow = {
  id: string;
  status: "active" | "archived";
  source: string;
  created_at: string;
  archived_at: string | null;
};

type OrderFinanceRow = {
  order_expense_cents: number | null;
  order_gross_income_cents: number | null;
  order_tax_cents: number | null;
  order_income_cents: number | null;
};

type FinanceTrendRow = {
  date: string;
  expense_cents: number | null;
  tax_cents: number | null;
  income_cents: number | null;
};

type FinanceTrendCorrectionRow = {
  date: string;
  expense_correction_cents: number | null;
  income_correction_cents: number | null;
};

type FinanceTrendInitialRow = {
  expense_correction_cents: number | null;
  income_correction_cents: number | null;
};

export async function ensureFinanceCorrections(d1: D1Database, userId: string, now = new Date().toISOString()) {
  await ensurePersonalDataRevision(d1, userId, now);
  const initialLedgerId = `initial-ledger:${userId}`;
  await d1.prepare(`
    INSERT INTO user_finance_ledgers (id, user_id, status, source, created_at)
    SELECT ?1, ?2, 'active', 'native', ?3
    WHERE NOT EXISTS (
      SELECT 1 FROM user_finance_ledgers WHERE user_id = ?2 AND status = 'active'
    )
    ON CONFLICT(id) DO NOTHING
  `).bind(initialLedgerId, userId, now).run();
  const ledger = await d1.prepare(`
    SELECT id FROM user_finance_ledgers
    WHERE user_id = ?1 AND status = 'active'
  `).bind(userId).first<{ id: string }>();
  if (!ledger?.id) throw new Error("无法初始化财务账本");
  await d1.prepare(`
    INSERT INTO user_finance_corrections (
      user_id, expense_correction_cents, income_correction_cents, revision, updated_at, active_ledger_id
    )
    VALUES (?1, 0, 0, 0, ?2, ?3)
    ON CONFLICT(user_id) DO NOTHING
  `).bind(userId, now, ledger.id).run();
  await d1.prepare(`
    UPDATE user_finance_corrections
    SET active_ledger_id = ?1
    WHERE user_id = ?2 AND active_ledger_id IS NULL
  `).bind(ledger.id, userId).run();
}

export async function getOrderFinanceCents(d1: D1Database, userId: string) {
  const row = await d1.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN stake_cents ELSE 0 END), 0) AS order_expense_cents,
      COALESCE(SUM(CASE WHEN settled_at IS NOT NULL AND status = 'success' THEN COALESCE(settled_prize_cents, 0) ELSE 0 END), 0) AS order_gross_income_cents,
      COALESCE(SUM(CASE
        WHEN settled_at IS NOT NULL AND status = 'success' AND COALESCE(settled_prize_cents, 0) > 1000000
          THEN COALESCE(tax_cents, CAST(ROUND(settled_prize_cents * 0.2) AS INTEGER))
        ELSE 0
      END), 0) AS order_tax_cents,
      COALESCE(SUM(CASE WHEN settled_at IS NOT NULL AND status = 'success' THEN COALESCE(settled_prize_cents, 0) ELSE 0 END), 0)
        - COALESCE(SUM(CASE
          WHEN settled_at IS NOT NULL AND status = 'success' AND COALESCE(settled_prize_cents, 0) > 1000000
            THEN COALESCE(tax_cents, CAST(ROUND(settled_prize_cents * 0.2) AS INTEGER))
          ELSE 0
        END), 0) AS order_income_cents
    FROM user_orders
    WHERE user_id = ?1
  `).bind(userId).first<OrderFinanceRow>();
  return {
    expenseCents: Math.round(Number(row?.order_expense_cents ?? 0)),
    grossIncomeCents: Math.round(Number(row?.order_gross_income_cents ?? 0)),
    taxCents: Math.round(Number(row?.order_tax_cents ?? 0)),
    incomeCents: Math.round(Number(row?.order_income_cents ?? 0)),
  };
}

export async function getFinanceState(d1: D1Database, userId: string): Promise<FinanceState> {
  await ensureFinanceCorrections(d1, userId);
  const [orders, correction, dataRevision] = await Promise.all([
    getOrderFinanceCents(d1, userId),
    d1.prepare(`
      SELECT expense_correction_cents, income_correction_cents, revision, updated_at, active_ledger_id
      FROM user_finance_corrections
      WHERE user_id = ?1
    `).bind(userId).first<FinanceCorrectionRow>(),
    getPersonalDataRevision(d1, userId),
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
      grossOrders: fromCents(orders.grossIncomeCents),
      tax: fromCents(orders.taxCents),
      orders: fromCents(orders.incomeCents),
      correction: fromCents(incomeCorrectionCents),
      total: fromCents(orders.incomeCents + incomeCorrectionCents),
    },
    revision: correction?.revision ?? 0,
    updatedAt: correction?.updated_at ?? "",
    activeLedgerId: correction?.active_ledger_id ?? "",
    dataRevision: dataRevision.revision,
  };
}

const correctionEntryFromRow = (row: FinanceCorrectionEntryRow): FinanceCorrectionEntry => ({
  id: row.id,
  ledgerId: row.ledger_id,
  kind: row.kind,
  deltaCents: Math.round(Number(row.delta_cents)),
  effectiveDate: row.effective_date,
  note: row.note,
  source: row.source,
  createdAt: row.created_at,
  sourceCreatedAt: row.source_created_at,
  correctionBeforeCents: Math.round(Number(row.correction_before_cents)),
  correctionAfterCents: Math.round(Number(row.correction_after_cents)),
  revisionAfter: Math.round(Number(row.revision_after)),
  adjustsEntryId: row.adjusts_entry_id,
});

const ledgerFromRow = (row: FinanceLedgerRow): FinanceLedgerSummary => ({
  id: row.id,
  status: row.status,
  source: row.source,
  createdAt: row.created_at,
  archivedAt: row.archived_at,
});

type CorrectionCursor = { createdAt: string; id: string };

function encodeCorrectionCursor(cursor: CorrectionCursor) {
  return btoa(JSON.stringify(cursor));
}

function decodeCorrectionCursor(value: string | undefined): CorrectionCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(atob(value)) as Partial<CorrectionCursor>;
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") throw new Error("invalid");
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw httpError("纠错记录游标无效", 400);
  }
}

export async function listFinanceCorrectionEntries(
  d1: D1Database,
  userId: string,
  query: { kind?: FinanceCorrectionKind; ledgerId?: string; cursor?: string; limit?: number } = {},
): Promise<FinanceCorrectionPage> {
  await ensureFinanceCorrections(d1, userId);
  if (query.kind !== undefined && !isFinanceCorrectionKind(query.kind)) throw httpError("纠错类型无效", 400);
  const limit = Math.min(100, Math.max(1, Number.isSafeInteger(query.limit) ? Number(query.limit) : 20));
  const cursor = decodeCorrectionCursor(query.cursor);
  const summary = await d1.prepare(`
    SELECT active_ledger_id FROM user_finance_corrections WHERE user_id = ?1
  `).bind(userId).first<{ active_ledger_id: string }>();
  const activeLedgerId = summary?.active_ledger_id ?? "";
  const ledgerId = query.ledgerId?.trim() || activeLedgerId;
  const ledger = await d1.prepare(`
    SELECT id FROM user_finance_ledgers WHERE id = ?1 AND user_id = ?2
  `).bind(ledgerId, userId).first<{ id: string }>();
  if (!ledger) throw httpError("找不到财务账本", 404);
  const [rows, ledgerRows] = await Promise.all([
    d1.prepare(`
      SELECT id, ledger_id, kind, delta_cents, effective_date, note, source, created_at,
             source_created_at, correction_before_cents, correction_after_cents,
             revision_after, adjusts_entry_id
      FROM user_finance_correction_entries
      WHERE user_id = ?1 AND ledger_id = ?2
        AND (?3 IS NULL OR kind = ?3)
        AND (?4 IS NULL OR created_at < ?4 OR (created_at = ?4 AND id < ?5))
      ORDER BY created_at DESC, id DESC
      LIMIT ?6
    `).bind(userId, ledgerId, query.kind ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1)
      .all<FinanceCorrectionEntryRow>(),
    d1.prepare(`
      SELECT id, status, source, created_at, archived_at
      FROM user_finance_ledgers
      WHERE user_id = ?1
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC, id DESC
    `).bind(userId).all<FinanceLedgerRow>(),
  ]);
  const allEntries = (rows.results ?? []).map(correctionEntryFromRow);
  const entries = allEntries.slice(0, limit);
  const last = entries.at(-1);
  return {
    entries,
    nextCursor: allEntries.length > limit && last ? encodeCorrectionCursor({ createdAt: last.createdAt, id: last.id }) : null,
    activeLedgerId,
    ledgers: (ledgerRows.results ?? []).map(ledgerFromRow),
  };
}

async function financeCorrectionEntryByRequest(d1: D1Database, userId: string, requestId: string) {
  const row = await d1.prepare(`
    SELECT id, ledger_id, kind, delta_cents, effective_date, note, source, created_at,
           source_created_at, correction_before_cents, correction_after_cents,
           revision_after, adjusts_entry_id
    FROM user_finance_correction_entries
    WHERE user_id = ?1 AND request_id = ?2
  `).bind(userId, requestId).first<FinanceCorrectionEntryRow>();
  return row ? correctionEntryFromRow(row) : null;
}

function sameCorrectionRequest(entry: FinanceCorrectionEntry, input: CreateFinanceCorrectionInput) {
  return entry.kind === input.kind
    && entry.deltaCents === input.deltaCents
    && entry.effectiveDate === input.effectiveDate
    && entry.note === input.note
    && entry.adjustsEntryId === (input.adjustsEntryId ?? null);
}

export async function createFinanceCorrectionEntry(
  d1: D1Database,
  userId: string,
  rawInput: CreateFinanceCorrectionInput,
  now = new Date(),
) {
  const kind = rawInput.kind;
  if (!isFinanceCorrectionKind(kind)) throw httpError("纠错类型无效", 400);
  const deltaCents = normalizeCorrectionDeltaCents(rawInput.deltaCents);
  const effectiveDate = normalizeFinanceCorrectionDate(rawInput.effectiveDate, now);
  const note = normalizeFinanceCorrectionNote(rawInput.note);
  const requestId = String(rawInput.requestId ?? "").trim();
  if (!requestId || requestId.length > 100) throw httpError("纠错请求标识无效", 400);
  if (!Number.isSafeInteger(rawInput.expectedRevision) || rawInput.expectedRevision < 0) {
    throw httpError("财务版本号无效", 400);
  }
  const adjustsEntryId = rawInput.adjustsEntryId?.trim() || null;
  const input: CreateFinanceCorrectionInput = {
    kind, deltaCents, effectiveDate, note, requestId,
    expectedRevision: rawInput.expectedRevision,
    adjustsEntryId,
  };
  await ensureFinanceCorrections(d1, userId, now.toISOString());
  const existingRequest = await financeCorrectionEntryByRequest(d1, userId, requestId);
  if (existingRequest) {
    if (!sameCorrectionRequest(existingRequest, input)) throw httpError("纠错请求标识已用于其他内容", 409);
    return { finance: await getFinanceState(d1, userId), entry: existingRequest };
  }
  const [correction, personal] = await Promise.all([
    d1.prepare(`
      SELECT expense_correction_cents, income_correction_cents, revision, updated_at, active_ledger_id
      FROM user_finance_corrections WHERE user_id = ?1
    `).bind(userId).first<FinanceCorrectionRow>(),
    getPersonalDataRevision(d1, userId),
  ]);
  if (!correction?.active_ledger_id) throw new Error("财务账本尚未初始化");
  if (correction.revision !== input.expectedRevision) {
    throw httpError("云端财务已被其他设备更新，请刷新后重试", 409, { revision: correction.revision });
  }
  if (adjustsEntryId) {
    const adjusted = await d1.prepare(`
      SELECT id FROM user_finance_correction_entries
      WHERE id = ?1 AND user_id = ?2 AND ledger_id = ?3 AND kind = ?4
    `).bind(adjustsEntryId, userId, correction.active_ledger_id, kind).first<{ id: string }>();
    if (!adjusted) throw httpError("补差关联的原纠错记录无效", 400);
  }
  const orders = await getOrderFinanceCents(d1, userId);
  const beforeCents = kind === "expense"
    ? Math.round(Number(correction.expense_correction_cents))
    : Math.round(Number(correction.income_correction_cents));
  const afterCents = beforeCents + deltaCents;
  const orderCents = kind === "expense" ? orders.expenseCents : orders.incomeCents;
  if (orderCents + afterCents < 0) throw httpError("纠错后的最终收入或支出不能小于 0", 400);
  const entryId = crypto.randomUUID();
  const createdAt = now.toISOString();
  const nextRevision = correction.revision + 1;
  const guardTotalSql = kind === "expense" ? `
    SELECT CASE WHEN (
      COALESCE((SELECT SUM(CASE WHEN payment_status = 'paid' THEN stake_cents ELSE 0 END)
        FROM user_orders WHERE user_id = ?1), 0)
      + (SELECT expense_correction_cents FROM user_finance_corrections WHERE user_id = ?1)
      + ?2
    ) >= 0 THEN json('null') ELSE json('') END
  ` : `
    SELECT CASE WHEN (
      COALESCE((SELECT SUM(CASE WHEN settled_at IS NOT NULL AND status = 'success'
        THEN COALESCE(settled_prize_cents, 0) - CASE WHEN COALESCE(settled_prize_cents, 0) > 1000000
          THEN COALESCE(tax_cents, CAST(ROUND(settled_prize_cents * 0.2) AS INTEGER)) ELSE 0 END
        ELSE 0 END) FROM user_orders WHERE user_id = ?1), 0)
      + (SELECT income_correction_cents FROM user_finance_corrections WHERE user_id = ?1)
      + ?2
    ) >= 0 THEN json('null') ELSE json('') END
  `;
  try {
    await d1.batch([
      d1.prepare(`
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM user_finance_corrections
          WHERE user_id = ?1 AND revision = ?2 AND active_ledger_id = ?3
        ) THEN json('null') ELSE json('') END
      `).bind(userId, input.expectedRevision, correction.active_ledger_id),
      d1.prepare(guardTotalSql).bind(userId, deltaCents),
      d1.prepare(`
        INSERT INTO user_finance_correction_entries (
          id, user_id, ledger_id, origin_id, origin_entry_id, kind, delta_cents,
          effective_date, note, source, request_id, created_at, source_created_at,
          correction_before_cents, correction_after_cents, revision_after, adjusts_entry_id
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'manual', ?10, ?11, NULL, ?12, ?13, ?14, ?15)
      `).bind(
        entryId, userId, correction.active_ledger_id, personal.originId, entryId, kind, deltaCents,
        effectiveDate, note, requestId, createdAt, beforeCents, afterCents, nextRevision, adjustsEntryId,
      ),
      d1.prepare(kind === "expense" ? `
        UPDATE user_finance_corrections
        SET expense_correction_cents = expense_correction_cents + ?1,
            revision = revision + 1, updated_at = ?2
        WHERE user_id = ?3 AND revision = ?4
      ` : `
        UPDATE user_finance_corrections
        SET income_correction_cents = income_correction_cents + ?1,
            revision = revision + 1, updated_at = ?2
        WHERE user_id = ?3 AND revision = ?4
      `).bind(deltaCents, createdAt, userId, input.expectedRevision),
      incrementPersonalDataRevisionStatement(d1, userId, createdAt),
    ]);
  } catch (error) {
    const repeated = await financeCorrectionEntryByRequest(d1, userId, requestId);
    if (repeated) {
      if (!sameCorrectionRequest(repeated, input)) throw httpError("纠错请求标识已用于其他内容", 409);
      return { finance: await getFinanceState(d1, userId), entry: repeated };
    }
    const latest = await getFinanceState(d1, userId);
    if (latest.revision !== input.expectedRevision) {
      throw httpError("云端财务已被其他设备更新，请刷新后重试", 409, { revision: latest.revision });
    }
    const latestOrderCents = kind === "expense" ? toCents(latest.expense.orders) : toCents(latest.income.orders);
    const latestCorrectionCents = kind === "expense" ? toCents(latest.expense.correction) : toCents(latest.income.correction);
    if (latestOrderCents + latestCorrectionCents + deltaCents < 0) {
      throw httpError("纠错后的最终收入或支出不能小于 0", 400);
    }
    throw error;
  }
  const entry = await d1.prepare(`
    SELECT id, ledger_id, kind, delta_cents, effective_date, note, source, created_at,
           source_created_at, correction_before_cents, correction_after_cents,
           revision_after, adjusts_entry_id
    FROM user_finance_correction_entries WHERE id = ?1 AND user_id = ?2
  `).bind(entryId, userId).first<FinanceCorrectionEntryRow>();
  if (!entry) throw new Error("纠错记录保存后无法读取");
  return { finance: await getFinanceState(d1, userId), entry: correctionEntryFromRow(entry) };
}

export async function getFinanceTrend(
  d1: D1Database,
  userId: string,
  rawRange: FinanceTrendDateRange = {},
): Promise<FinanceTrendResponse> {
  const range = normalizeFinanceTrendDateRange(rawRange);
  await ensureFinanceCorrections(d1, userId);
  const [rows, datedCorrections, initialCorrection, summary] = await Promise.all([
    d1.prepare(`
      SELECT
        event_date AS date,
        COALESCE(SUM(expense_cents), 0) AS expense_cents,
        COALESCE(SUM(tax_cents), 0) AS tax_cents,
        COALESCE(SUM(income_cents), 0) AS income_cents
      FROM (
        SELECT
          date(saved_at, '+8 hours') AS event_date,
          stake_cents AS expense_cents,
          0 AS tax_cents,
          0 AS income_cents
        FROM user_orders
        WHERE user_id = ?1 AND payment_status = 'paid'
        UNION ALL
        SELECT
          date(settled_at, '+8 hours') AS event_date,
          0 AS expense_cents,
          CASE
            WHEN status = 'success' AND COALESCE(settled_prize_cents, 0) > 1000000
              THEN COALESCE(tax_cents, CAST(ROUND(settled_prize_cents * 0.2) AS INTEGER))
            ELSE 0
          END AS tax_cents,
          CASE WHEN status = 'success' THEN COALESCE(settled_prize_cents, 0) ELSE 0 END
            - CASE
              WHEN status = 'success' AND COALESCE(settled_prize_cents, 0) > 1000000
                THEN COALESCE(tax_cents, CAST(ROUND(settled_prize_cents * 0.2) AS INTEGER))
              ELSE 0
            END AS income_cents
        FROM user_orders
        WHERE user_id = ?1 AND settled_at IS NOT NULL
      ) AS finance_events
      WHERE (?2 IS NULL OR event_date <= ?2)
      GROUP BY event_date
      ORDER BY event_date ASC
    `).bind(userId, range.endDate ?? null).all<FinanceTrendRow>(),
    d1.prepare(`
      SELECT
        effective_date AS date,
        COALESCE(SUM(CASE WHEN kind = 'expense' THEN delta_cents ELSE 0 END), 0) AS expense_correction_cents,
        COALESCE(SUM(CASE WHEN kind = 'income' THEN delta_cents ELSE 0 END), 0) AS income_correction_cents
      FROM user_finance_correction_entries
      WHERE ledger_id = (
        SELECT active_ledger_id FROM user_finance_corrections WHERE user_id = ?1
      )
        AND effective_date IS NOT NULL
        AND (?2 IS NULL OR effective_date <= ?2)
      GROUP BY effective_date
      ORDER BY effective_date ASC
    `).bind(userId, range.endDate ?? null).all<FinanceTrendCorrectionRow>(),
    d1.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN kind = 'expense' THEN delta_cents ELSE 0 END), 0) AS expense_correction_cents,
        COALESCE(SUM(CASE WHEN kind = 'income' THEN delta_cents ELSE 0 END), 0) AS income_correction_cents
      FROM user_finance_correction_entries
      WHERE ledger_id = (
        SELECT active_ledger_id FROM user_finance_corrections WHERE user_id = ?1
      ) AND effective_date IS NULL
    `).bind(userId).first<FinanceTrendInitialRow>(),
    d1.prepare(`
      SELECT updated_at FROM user_finance_corrections WHERE user_id = ?1
    `).bind(userId).first<{ updated_at: string }>(),
  ]);

  const amounts = new Map<string, {
    orderExpenseCents: number;
    expenseCorrectionCents: number;
    taxCents: number;
    orderIncomeCents: number;
    incomeCorrectionCents: number;
  }>();
  const amountsFor = (date: string) => {
    const current = amounts.get(date) ?? {
      orderExpenseCents: 0,
      expenseCorrectionCents: 0,
      taxCents: 0,
      orderIncomeCents: 0,
      incomeCorrectionCents: 0,
    };
    amounts.set(date, current);
    return current;
  };
  for (const row of rows.results ?? []) {
    const current = amountsFor(row.date);
    current.orderExpenseCents += Math.round(Number(row.expense_cents ?? 0));
    current.taxCents += Math.round(Number(row.tax_cents ?? 0));
    current.orderIncomeCents += Math.round(Number(row.income_cents ?? 0));
  }
  for (const row of datedCorrections.results ?? []) {
    const current = amountsFor(row.date);
    current.expenseCorrectionCents += Math.round(Number(row.expense_correction_cents ?? 0));
    current.incomeCorrectionCents += Math.round(Number(row.income_correction_cents ?? 0));
  }
  const initialExpense = Math.round(Number(initialCorrection?.expense_correction_cents ?? 0));
  const initialIncome = Math.round(Number(initialCorrection?.income_correction_cents ?? 0));

  return {
    points: buildCumulativeFinanceTrend(
      [...amounts.entries()].map(([date, amount]) => ({
        date,
        expense: fromCents(amount.orderExpenseCents + amount.expenseCorrectionCents),
        orderExpense: fromCents(amount.orderExpenseCents),
        expenseCorrection: fromCents(amount.expenseCorrectionCents),
        tax: fromCents(amount.taxCents),
        income: fromCents(amount.orderIncomeCents + amount.incomeCorrectionCents),
        orderIncome: fromCents(amount.orderIncomeCents),
        incomeCorrection: fromCents(amount.incomeCorrectionCents),
      })),
      {
        expenseCorrection: fromCents(initialExpense),
        incomeCorrection: fromCents(initialIncome),
        date: initialExpense !== 0 || initialIncome !== 0
          ? shanghaiDateKey(summary?.updated_at || new Date().toISOString())
          : undefined,
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
  if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0) {
    throw httpError("财务版本号无效，请刷新后重试", 400);
  }
  const [orders, current, personal] = await Promise.all([
    getOrderFinanceCents(d1, userId),
    d1.prepare(`
      SELECT expense_correction_cents, income_correction_cents, revision, updated_at, active_ledger_id
      FROM user_finance_corrections WHERE user_id = ?1
    `).bind(userId).first<FinanceCorrectionRow>(),
    getPersonalDataRevision(d1, userId),
  ]);
  if (!current?.active_ledger_id) throw new Error("财务账本尚未初始化");
  const expenseCorrectionCents = toCents(correction.expenseCorrection);
  const incomeCorrectionCents = toCents(correction.incomeCorrection);
  if (orders.expenseCents + expenseCorrectionCents < 0 || orders.incomeCents + incomeCorrectionCents < 0) {
    throw httpError("纠错后的最终收入或支出不能小于 0", 400);
  }
  const expenseBefore = Math.round(Number(current.expense_correction_cents));
  const incomeBefore = Math.round(Number(current.income_correction_cents));
  const expenseDelta = expenseCorrectionCents - expenseBefore;
  const incomeDelta = incomeCorrectionCents - incomeBefore;
  if (expenseDelta === 0 && incomeDelta === 0) return getFinanceState(d1, userId);
  if (current.revision !== expectedRevision) {
    throw httpError("云端财务纠错值已被其他设备更新，请刷新后重试", 409, { revision: current.revision });
  }
  const nextRevision = current.revision + 1;
  const statements = [
    d1.prepare(`
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM user_finance_corrections
        WHERE user_id = ?1 AND revision = ?2 AND active_ledger_id = ?3
      ) THEN json('null') ELSE json('') END
    `).bind(userId, expectedRevision, current.active_ledger_id),
  ];
  if (expenseDelta !== 0) {
    const id = crypto.randomUUID();
    statements.push(d1.prepare(`
      INSERT INTO user_finance_correction_entries (
        id, user_id, ledger_id, origin_id, origin_entry_id, kind, delta_cents,
        effective_date, note, source, request_id, created_at, source_created_at,
        correction_before_cents, correction_after_cents, revision_after, adjusts_entry_id
      ) VALUES (?1, ?2, ?3, ?4, ?1, 'expense', ?5, NULL, '', 'legacy-client', NULL, ?6, NULL, ?7, ?8, ?9, NULL)
    `).bind(id, userId, current.active_ledger_id, personal.originId, expenseDelta, now, expenseBefore, expenseCorrectionCents, nextRevision));
  }
  if (incomeDelta !== 0) {
    const id = crypto.randomUUID();
    statements.push(d1.prepare(`
      INSERT INTO user_finance_correction_entries (
        id, user_id, ledger_id, origin_id, origin_entry_id, kind, delta_cents,
        effective_date, note, source, request_id, created_at, source_created_at,
        correction_before_cents, correction_after_cents, revision_after, adjusts_entry_id
      ) VALUES (?1, ?2, ?3, ?4, ?1, 'income', ?5, NULL, '', 'legacy-client', NULL, ?6, NULL, ?7, ?8, ?9, NULL)
    `).bind(id, userId, current.active_ledger_id, personal.originId, incomeDelta, now, incomeBefore, incomeCorrectionCents, nextRevision));
  }
  statements.push(d1.prepare(`
    UPDATE user_finance_corrections
    SET expense_correction_cents = ?1,
        income_correction_cents = ?2,
        revision = revision + 1,
        updated_at = ?3
    WHERE user_id = ?4 AND revision = ?5
  `).bind(expenseCorrectionCents, incomeCorrectionCents, now, userId, expectedRevision));
  statements.push(incrementPersonalDataRevisionStatement(d1, userId, now));
  try {
    await d1.batch(statements);
  } catch (error) {
    const latest = await getFinanceState(d1, userId);
    if (latest.revision !== expectedRevision) {
      throw httpError("云端财务纠错值已被其他设备更新，请刷新后重试", 409, { revision: latest.revision });
    }
    throw error;
  }
  return getFinanceState(d1, userId);
}
