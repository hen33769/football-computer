export type OrderColumnItem<T> = {
  order: T;
  orderIndex: number;
};

export function splitOrdersIntoColumns<T>(orders: readonly T[]): [OrderColumnItem<T>[], OrderColumnItem<T>[]] {
  const columns: [OrderColumnItem<T>[], OrderColumnItem<T>[]] = [[], []];
  orders.forEach((order, orderIndex) => {
    columns[orderIndex % columns.length].push({ order, orderIndex });
  });
  return columns;
}
