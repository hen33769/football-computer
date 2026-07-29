import { desc, eq } from "drizzle-orm";
import { createDefaultSettings, normalizeAppSettings } from "../../../settings";
import type { MatchItem, SavedSlip } from "../../../types";
import { getDb } from "../../../../db";
import { sharedMatches, userOrders, userStates } from "../../../../db/schema";
import { findAuthenticatedCloudAccount, parseJson, routeError } from "../../../cloud-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const db = getDb();
    const authenticated = await findAuthenticatedCloudAccount(request);
    const matchRows = await db.select().from(sharedMatches).orderBy(sharedMatches.businessDate, sharedMatches.matchId);
    const matches = matchRows.flatMap((row) => {
      const match = parseJson<MatchItem | null>(row.dataJson, null);
      return match ? [match] : [];
    });

    if (authenticated.kind === "anonymous") {
      return Response.json({
        requiresAccount: true,
        matches,
      });
    }

    const { account } = authenticated.value;
    const [stateRows, orderRows] = await Promise.all([
      db.select().from(userStates).where(eq(userStates.userId, account.id)).limit(1),
      db.select().from(userOrders).where(eq(userOrders.userId, account.id)).orderBy(desc(userOrders.savedAt)),
    ]);
    const state = stateRows[0];
    const orders = orderRows.flatMap((row) => {
      const order = parseJson<SavedSlip | null>(row.dataJson, null);
      return order ? [order] : [];
    });

    return Response.json({
      requiresAccount: false,
      account,
      hasPersonalData: Boolean(state) || orders.length > 0,
      personal: {
        revision: state?.revision ?? 0,
        orders,
        finance: {
          expenseTotal: (state?.expenseCents ?? 0) / 100,
          incomeTotal: (state?.incomeCents ?? 0) / 100,
        },
        settings: state
          ? normalizeAppSettings(parseJson(state.settingsJson, createDefaultSettings()))
          : createDefaultSettings(),
      },
      matches,
    });
  } catch (error) {
    return routeError(error);
  }
}
