export const AUTO_RESULT_MAX_RETRIES = 3;
export const AUTO_RESULT_REQUEST_INTERVAL_MS = 2 * 1000;
export const AUTO_RESULT_UNFINISHED_RETRY_DELAY_MS = 10 * 60 * 1000;
export const AUTO_RESULT_ERROR_RETRY_DELAY_MS = 60 * 1000;

export type AutoResultRetryKind = "unfinished" | "error";
export type AutoResultRetryState = {
  retryCount: number;
  nextAttemptAt: number;
};

/** 返回下一次自动赛果尝试；达到重试上限时返回 null。 */
export function scheduleAutoResultRetry(
  retryCount: number,
  kind: AutoResultRetryKind,
  now = Date.now(),
): AutoResultRetryState | null {
  if (retryCount >= AUTO_RESULT_MAX_RETRIES) return null;
  return {
    retryCount: retryCount + 1,
    nextAttemptAt: now + (kind === "unfinished" ? AUTO_RESULT_UNFINISHED_RETRY_DELAY_MS : AUTO_RESULT_ERROR_RETRY_DELAY_MS),
  };
}
