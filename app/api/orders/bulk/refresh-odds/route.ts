import { getD1 } from "../../../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../../../cloud-server";
import { getCurrentMatches } from "../../../../server/matches-service";
import { refreshOrderOdds, type OrderRef } from "../../../../server/orders-service";

const parseRefs = (value: unknown): OrderRef[] => Array.isArray(value)
  ? value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const ref = item as Partial<OrderRef>;
    return typeof ref.id === "string" ? [{ id: ref.id, updatedAt: ref.updatedAt }] : [];
  })
  : [];

export async function POST(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const payload = await request.json() as { expectedOrders?: unknown };
    const refs = parseRefs(payload.expectedOrders);
    if (refs.length === 0) return Response.json({ error: "请传入当前可见订单 ID" }, { status: 400 });
    const d1 = getD1();
    const current = await getCurrentMatches(d1);
    return Response.json(await refreshOrderOdds(d1, authenticated.value.account.id, refs, current.matches));
  } catch (error) {
    return routeError(error);
  }
}
