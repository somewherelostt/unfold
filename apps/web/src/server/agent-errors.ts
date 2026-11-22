import { AgentServiceError, isAgentServiceError, type AgentErrorCode } from "@unfold/agent";

export type AgentErrorPayload = { message: string; errorCode?: AgentErrorCode; retryable: boolean };
const CODES: readonly AgentErrorCode[] = ["RATE_LIMITED", "UNAVAILABLE", "AUTH_REJECTED", "CANCELLED", "CONNECTION", "INVALID_RESPONSE"];
const knownCode = (code: unknown): code is AgentErrorCode => typeof code === "string" && CODES.some((known) => known === code);

/** Rebuild fixed public messages; never forward provider text or infer status from it. */
export function agentErrorPayload(error: unknown, signal?: AbortSignal): AgentErrorPayload {
  const code = signal?.aborted ? "CANCELLED" : isAgentServiceError(error) && knownCode(error.code) ? error.code : undefined;
  if (!code) return { message: "The editing request could not be completed. Please try again.", retryable: false };
  const safe = new AgentServiceError(code);
  return { message: safe.message, errorCode: safe.code, retryable: safe.retryable };
}

export function variantErrorPayload(code: unknown, signal?: AbortSignal): AgentErrorPayload {
  return agentErrorPayload(knownCode(code) ? new AgentServiceError(code) : undefined, signal);
}
