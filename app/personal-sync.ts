import type { AppSettings } from "./settings";
import type { CloudPersonalData } from "./cloud";
import type { SavedSlip } from "./types";

export type PersonalSyncIntent = {
  upsertOrders: SavedSlip[];
  deleteOrderIds: string[];
  finance?: CloudPersonalData["finance"];
  settings?: AppSettings;
};

export type OrderSyncIntent = Pick<PersonalSyncIntent, "upsertOrders" | "deleteOrderIds">;

export type CloudPersonalMutation = PersonalSyncIntent & {
  expectedRevision: number;
  orderMutationVersion?: 1;
};

export function emptyPersonalSyncIntent(): PersonalSyncIntent {
  return { upsertOrders: [], deleteOrderIds: [] };
}

/**
 * v2 队列可能包含旧版完整订单快照推断出的写入与删除，无法证明每项修改都
 * 来自明确操作。升级时整批丢弃，以当前云端快照为基准。
 */
export function migrateLegacyPersonalSyncIntent(): PersonalSyncIntent {
  return emptyPersonalSyncIntent();
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

/**
 * 普通页面状态同步只能更新收支与设置，不能根据订单快照缺项推断删除。
 * 订单必须由调用方通过明确的 upsertOrders / deleteOrderIds 单独提交。
 */
export function createPersonalMetadataSyncIntent(
  previous: CloudPersonalData,
  next: CloudPersonalData,
): PersonalSyncIntent {
  return {
    upsertOrders: [],
    deleteOrderIds: [],
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

/** 仅按 mutation 中明确给出的订单 ID 修改本地或云端快照。 */
export function applyOrderSyncIntent(
  currentOrders: SavedSlip[],
  intent: OrderSyncIntent,
): SavedSlip[] {
  const deletes = new Set(intent.deleteOrderIds);
  const upserts = orderMap(intent.upsertOrders.filter((order) => order.id && !deletes.has(order.id)));
  const existingIds = new Set(currentOrders.flatMap((order) => order.id ? [order.id] : []));
  const addedOrders = [...upserts].flatMap(([id, order]) => (
    existingIds.has(id) ? [] : [structuredClone(order)]
  ));
  const retainedOrders = currentOrders.flatMap((order) => {
    if (order.id && deletes.has(order.id)) return [];
    const updated = order.id ? upserts.get(order.id) : undefined;
    return [updated ? structuredClone(updated) : order];
  });
  return [...addedOrders, ...retainedOrders];
}

export function applyPersonalSyncIntent(
  current: CloudPersonalData,
  intent: PersonalSyncIntent,
): CloudPersonalData {
  return {
    orders: applyOrderSyncIntent(current.orders, intent).sort((left, right) => (
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
