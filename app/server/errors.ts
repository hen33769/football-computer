export function httpError(message: string, status = 400, extra: Record<string, unknown> = {}) {
  const error = new Error(message);
  Object.assign(error, { status, ...extra });
  return error;
}

export function orderConflict(orderIds: string[]) {
  return httpError("订单数据异常，请刷新获取最新数据", 409, {
    code: "ORDER_CONFLICT",
    conflictOrderIds: [...new Set(orderIds)],
  });
}
