import { getD1 } from "../../../db";
import { requireAuthenticatedCloudAccount, routeError } from "../../cloud-server";
import { createOrder, listOrders, type OrderProgressQuery } from "../../server/orders-service";

export const dynamic = "force-dynamic";

const parseStatuses = (value: string | null) => (value ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const parseProgress = (value: string | null): OrderProgressQuery => (
  value === "settled" || value === "unsettled" || value === "unpaid" || value === "paid" ? value : null
);

export async function GET(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const url = new URL(request.url);
    return Response.json(await listOrders(getD1(), authenticated.value.account.id, {
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      progress: parseProgress(url.searchParams.get("progress")),
      statuses: parseStatuses(url.searchParams.get("status")),
      limit: Number(url.searchParams.get("limit") ?? 500),
      offset: Number(url.searchParams.get("offset") ?? 0),
    }));
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const authenticated = await requireAuthenticatedCloudAccount(request);
    if (!authenticated.value) return authenticated.response!;
    const payload = await request.json() as { order?: unknown };
    if (!payload.order) return Response.json({ error: "订单数据无效" }, { status: 400 });
    return Response.json({ order: await createOrder(getD1(), authenticated.value.account.id, payload.order as Parameters<typeof createOrder>[2]) }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
