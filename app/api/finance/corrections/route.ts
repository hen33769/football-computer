import { getD1 } from "../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../cloud-server";
import {
  createFinanceCorrectionEntry,
  listFinanceCorrectionEntries,
  updateFinanceCorrections,
} from "../../../server/finance-service";
import type { FinanceCorrectionKind } from "../../../finance-corrections";

export async function GET(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit");
    return Response.json(await listFinanceCorrectionEntries(
      getD1(),
      authenticated.value.account.id,
      {
        kind: (url.searchParams.get("kind") || undefined) as FinanceCorrectionKind | undefined,
        ledgerId: url.searchParams.get("ledger_id") || undefined,
        cursor: url.searchParams.get("cursor") || undefined,
        limit: rawLimit === null ? undefined : Number(rawLimit),
      },
    ));
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const payload = await request.json() as Record<string, unknown>;
    return Response.json(await createFinanceCorrectionEntry(
      getD1(),
      authenticated.value.account.id,
      {
        kind: payload.kind as FinanceCorrectionKind,
        amountDeltaCents: payload.amountDeltaCents === undefined ? undefined : Number(payload.amountDeltaCents),
        taxDeltaCents: payload.taxDeltaCents === undefined ? undefined : Number(payload.taxDeltaCents),
        deltaCents: payload.deltaCents === undefined ? undefined : Number(payload.deltaCents),
        effectiveDate: payload.effectiveDate === null ? null : String(payload.effectiveDate ?? ""),
        note: String(payload.note ?? ""),
        requestId: String(payload.requestId ?? ""),
        expectedRevision: Number(payload.expectedRevision),
        adjustsEntryId: payload.adjustsEntryId == null ? null : String(payload.adjustsEntryId),
      },
    ), { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const payload = await request.json() as {
      expenseCorrection?: unknown;
      incomeCorrection?: unknown;
      expectedRevision?: unknown;
    };
    const expenseCorrection = Number(payload.expenseCorrection);
    const incomeCorrection = Number(payload.incomeCorrection);
    if (!Number.isFinite(expenseCorrection) || !Number.isFinite(incomeCorrection)) {
      return Response.json({ error: "纠错金额无效" }, { status: 400 });
    }
    const expectedRevision = Number.isInteger(payload.expectedRevision) ? Number(payload.expectedRevision) : undefined;
    return Response.json(await updateFinanceCorrections(
      getD1(),
      authenticated.value.account.id,
      { expenseCorrection, incomeCorrection },
      expectedRevision,
    ));
  } catch (error) {
    return routeError(error);
  }
}
