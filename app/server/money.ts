export const toCents = (value: number) => Math.round(Number(value || 0) * 100);

export const fromCents = (value: number | null | undefined) => Math.round(Number(value ?? 0)) / 100;

export const clampFiniteMoney = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("金额数据无效");
  return parsed;
};
