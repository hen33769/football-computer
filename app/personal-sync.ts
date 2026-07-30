import type { AppSettings } from "./settings";
import type { CloudPersonalData } from "./cloud";
import type { SavedSlip } from "./types";

export type PersonalSyncIntent = {
  upsertOrders: SavedSlip[];
  deleteOrderIds: string[];
  finance?: CloudPersonalData["finance"];
  settings?: AppSettings;
};

export type CloudPersonalMutation = PersonalSyncIntent & {
  expectedRevision: number;
};

export function emptyPersonalSyncIntent(): PersonalSyncIntent {
  return { upsertOrders: [], deleteOrderIds: [] };
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function orderMap(orders: SavedSlip[]) {
  return new Map(orders.flatMap((order) => order.id ? [[order.id, order] as const] : []));
}

export function hasPersonalSyncIntent(intent: PersonalSyncIntent) {
  return intent.upsertOrders.length > 0
    || intent.deleteOrderIds.length > 0
    || Boolean(intent.finance)
    || Boolean(intent.settings);
}

export function createPersonalSyncIntent(
  previous: CloudPersonalData,
  next: CloudPersonalData,
): PersonalSyncIntent {
  const previousOrders = orderMap(previous.orders);
  const nextOrders = orderMap(next.orders);
  const upsertOrders = [...nextOrders].flatMap(([id, order]) => {
    const existing = previousOrders.get(id);
    return !existing || !sameValue(existing, order) ? [order] : [];
  });
  const deleteOrderIds = [...previousOrders.keys()].filter((id) => !nextOrders.has(id));

  return {
    upsertOrders,
    deleteOrderIds,
    finance: sameValue(previous.finance, next.finance) ? undefined : structuredClone(next.finance),
    settings: sameValue(previous.settings, next.settings) ? undefined : structuredClone(next.settings),
  };
}

export function mergePersonalSyncIntents(
  current: PersonalSyncIntent,
  incoming: PersonalSyncIntent,
): PersonalSyncIntent {
  const upserts = orderMap(current.upsertOrders);
  const deletes = new Set(current.deleteOrderIds);

  incoming.upsertOrders.forEach((order) => {
    if (!order.id) return;
    upserts.set(order.id, structuredClone(order));
    deletes.delete(order.id);
  });
  incoming.deleteOrderIds.forEach((id) => {
    upserts.delete(id);
    deletes.add(id);
  });

  return {
    upsertOrders: [...upserts.values()],
    deleteOrderIds: [...deletes],
    finance: incoming.finance ? structuredClone(incoming.finance) : current.finance,
    settings: incoming.settings ? structuredClone(incoming.settings) : current.settings,
  };
}

export function applyPersonalSyncIntent(
  current: CloudPersonalData,
  intent: PersonalSyncIntent,
): CloudPersonalData {
  const orders = orderMap(current.orders);
  intent.deleteOrderIds.forEach((id) => orders.delete(id));
  intent.upsertOrders.forEach((order) => {
    if (order.id) orders.set(order.id, structuredClone(order));
  });

  return {
    orders: [...orders.values()].sort((left, right) => (
      new Date(right.savedAt).getTime() - new Date(left.savedAt).getTime()
    )),
    finance: intent.finance ? structuredClone(intent.finance) : structuredClone(current.finance),
    settings: intent.settings ? structuredClone(intent.settings) : structuredClone(current.settings),
  };
}

export function fullPersonalSyncIntent(personal: CloudPersonalData): PersonalSyncIntent {
  return {
    upsertOrders: structuredClone(personal.orders),
    deleteOrderIds: [],
    finance: structuredClone(personal.finance),
    settings: structuredClone(personal.settings),
  };
}

/**
 * 页面启动以云端快照为基准。只有已经持久化的精确增量意图，或调用方明确
 * 允许的首次空账号迁移，才可以叠加本地数据；普通本地缓存不会参与解析。
 */
export function resolvePersonalBootstrapState(
  serverPersonal: CloudPersonalData,
  hasServerPersonalData: boolean,
  durablePendingIntent: PersonalSyncIntent | null,
  initialMigrationPersonal?: CloudPersonalData,
) {
  const intent = durablePendingIntent && hasPersonalSyncIntent(durablePendingIntent)
    ? structuredClone(durablePendingIntent)
    : !hasServerPersonalData && initialMigrationPersonal
      ? fullPersonalSyncIntent(initialMigrationPersonal)
      : emptyPersonalSyncIntent();
  return {
    intent,
    personal: applyPersonalSyncIntent(serverPersonal, intent),
  };
}
