import { getD1 } from "../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../cloud-server";
import { updateFinanceCorrections } from "../../../server/finance-service";

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
