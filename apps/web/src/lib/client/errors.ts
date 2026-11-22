const SERVICE_CODES = new Set(["RATE_LIMITED", "UNAVAILABLE", "AUTH_REJECTED", "CANCELLED", "CONNECTION", "INVALID_RESPONSE"]);

export function serviceErrorFields(error: unknown): { errorCode?: string; retryable?: boolean } {
  const value = error as { errorCode?: unknown; retryable?: unknown } | null;
  if (typeof value?.errorCode !== "string" || !SERVICE_CODES.has(value.errorCode)) return value?.retryable === false ? { retryable: false } : {};
  return { errorCode: value.errorCode, retryable: typeof value.retryable === "boolean" ? value.retryable : undefined };
}

export function generationErrorTitle(run: { status: string; interrupted?: boolean; errorCode?: string }): string {
  if (run.interrupted) return "Request interrupted";
  if (run.status === "cancelled" || run.errorCode === "CANCELLED") return "Cancelled";
  if (run.errorCode === "RATE_LIMITED") return "The editing service is busy";
  if (run.errorCode === "UNAVAILABLE") return "The editing service is unavailable";
  if (run.errorCode === "AUTH_REJECTED") return "The connection needs attention";
  if (run.errorCode === "CONNECTION") return "Connection interrupted";
  if (run.errorCode === "INVALID_RESPONSE") return "Couldn't read the edit";
  return "That didn't work";
}
