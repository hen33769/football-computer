export const ORDER_TAX_THRESHOLD_CENTS = 1_000_000;
export const ORDER_TAX_RATE_PERCENT = 20;

const finiteMoneyCents = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100);
const fromCents = (value: number) => Math.round(value) / 100;

export function calculatePrizeTax(prize: number) {
  const prizeCents = Math.max(0, finiteMoneyCents(prize));
  if (prizeCents <= ORDER_TAX_THRESHOLD_CENTS) return 0;
  return fromCents(Math.round(prizeCents * ORDER_TAX_RATE_PERCENT / 100));
}

export function resolvePrizeTax(prize: number, savedTax?: number) {
  if (typeof savedTax === "number" && Number.isFinite(savedTax)) return fromCents(finiteMoneyCents(savedTax));
  return calculatePrizeTax(prize);
}

export function afterTaxPrize(prize: number, tax: number) {
  return fromCents(Math.max(0, finiteMoneyCents(prize) - finiteMoneyCents(tax)));
}

export function isValidTaxAmount(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
}

export function appliedOrderTax(
  order: { settledAt?: string; settledPrize?: number; taxAmount?: number },
  status: "success" | "hopeful" | "failed",
) {
  const prize = order.settledPrize ?? 0;
  if (!order.settledAt || status !== "success" || finiteMoneyCents(prize) <= ORDER_TAX_THRESHOLD_CENTS) return 0;
  return resolvePrizeTax(prize, order.taxAmount);
}
