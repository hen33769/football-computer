export type OrderColumnItem<T> = {
  order: T;
  batchIndex: number;
};

export function splitOrderBatchIntoColumns<T>(orders: readonly T[]): [OrderColumnItem<T>[], OrderColumnItem<T>[]] {
  const columns: [OrderColumnItem<T>[], OrderColumnItem<T>[]] = [[], []];
  orders.forEach((order, batchIndex) => {
    columns[batchIndex % columns.length].push({ order, batchIndex });
  });
  return columns;
}
