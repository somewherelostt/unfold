import type { ChatMessage } from "./prompt";

/**
 * Streams a completion from the Unfold agent running in the OpenClaw Gateway
 * (standard /v1/chat/completions endpoint, model "openclaw/<agentId>"), which runs
 * Kimi K3.1 Pro on Cerebras. Measures speed the way the hackathon does:
 * TPS = (output tokens - 1) / (last token time - first token time).
 */
export type StreamStats = {
  queueMs: number; // request start → first visible token (platform queue + prompt + hidden reasoning)
  genMs: number; // first visible token → last token
  totalMs: number;
  outputTokens: number; // visible output tokens (completion minus reasoning)
  reasoningTokens: number;
  cachedPromptTokens: number;
  tps: number; // (outputTokens - 1) / genSeconds, the hackathon's TPS formula
  model: string;
};

export type StreamCallbacks = { onDelta?: (text: string, soFar: string) => void };

export type AgentConfig = { url: string; token: string; agentId: string };

export type AgentErrorCode = "RATE_LIMITED" | "UNAVAILABLE" | "AUTH_REJECTED" | "CANCELLED" | "CONNECTION" | "INVALID_RESPONSE";
const SAFE_ERRORS: Record<AgentErrorCode, string> = {
  RATE_LIMITED: "Cerebras is busy or rate-limited. Please try again shortly.",
  UNAVAILABLE: "The editing service is temporarily unavailable. Please try again shortly.",
  AUTH_REJECTED: "The editing service could not authenticate. Check the connection settings and try again.",
  CANCELLED: "Editing was cancelled.",
  CONNECTION: "The editing service could not be reached. Check the connection and try again.",
  INVALID_RESPONSE: "The editing service returned no usable edit. Please try again.",
};
const SERVICE_ERROR_BRAND = Symbol.for("@unfold/agent/AgentServiceError");

/** Only fixed public messages cross the agent/API boundary, never upstream response text. */
export class AgentServiceError extends Error {
  declare readonly [SERVICE_ERROR_BRAND]: true;
  readonly retryable: boolean;
  constructor(readonly code: AgentErrorCode) {
    super(SAFE_ERRORS[code]);
    Object.defineProperty(this, SERVICE_ERROR_BRAND, { value: true });
    this.name = "AgentServiceError";
    this.retryable = code !== "AUTH_REJECTED" && code !== "CANCELLED";
  }
}
export function isAgentServiceError(error: unknown): error is AgentServiceError {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Record<PropertyKey, unknown>;
  const code = candidate.code;
  return candidate[SERVICE_ERROR_BRAND] === true && typeof code === "string" && Object.hasOwn(SAFE_ERRORS, code)
    && candidate.message === SAFE_ERRORS[code as AgentErrorCode]
    && candidate.retryable === (code !== "AUTH_REJECTED" && code !== "CANCELLED");
}
export function classifyAgentError(error: unknown): AgentServiceError {
  if (isAgentServiceError(error)) return error;
  if ((error as { name?: string })?.name === "AbortError") return new AgentServiceError("CANCELLED");
  return new AgentServiceError("INVALID_RESPONSE");
}

function statusError(status: number): AgentServiceError | undefined {
  if (status === 429) return new AgentServiceError("RATE_LIMITED");
  if ([502, 503, 504].includes(status)) return new AgentServiceError("UNAVAILABLE");
  if ([401, 403].includes(status)) return new AgentServiceError("AUTH_REJECTED");
  return undefined;
}

function payloadError(payload: any): AgentServiceError | undefined {
  const error = payload?.error ?? payload;
  for (const value of [error?.status, error?.statusCode, error?.code, payload?.status]) {
    const known = statusError(Number(value));
    if (known) return known;
  }
  const code = String(error?.code ?? error?.type ?? "").toLowerCase();
  if (["rate_limit_exceeded", "rate_limit_error", "too_many_requests"].includes(code)) return new AgentServiceError("RATE_LIMITED");
  if (["overloaded_error", "service_unavailable", "server_overloaded"].includes(code)) return new AgentServiceError("UNAVAILABLE");
  if (["authentication_error", "invalid_api_key", "permission_denied"].includes(code)) return new AgentServiceError("AUTH_REJECTED");
  // Some gateways retain a status only as the numeric prefix of their error message.
  const prefix = String(error?.message ?? "").match(/^\s*(?:HTTP\s+)?(429|502|503|504|401|403)\b/i);
  return prefix ? statusError(Number(prefix[1])) : undefined;
}

export function agentConfigFromEnv(env: Record<string, string | undefined> = process.env): AgentConfig {
  const url = env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18890";
  const token = env.OPENCLAW_GATEWAY_TOKEN;
  if (!token) throw new Error("OPENCLAW_GATEWAY_TOKEN is not set (see agent-workspace/README.md)");
  return { url, token, agentId: env.OPENCLAW_AGENT_ID ?? "unfold" };
}

export async function streamChat(
  messages: ChatMessage[],
  cfg: AgentConfig,
  cb: StreamCallbacks = {},
  opts: { sessionUser?: string; signal?: AbortSignal; maxTokens?: number } = {},
): Promise<{ text: string; stats: StreamStats }> {
  const t0 = performance.now();
  const res = await fetch(`${cfg.url}/v1/chat/completions`, {
    method: "POST",
    signal: opts.signal,
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `openclaw/${cfg.agentId}`,
      stream: true,
      stream_options: { include_usage: true },
      messages,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      ...(opts.sessionUser ? { user: opts.sessionUser } : {}),
    }),
  }).catch((error) => {
    if (opts.signal?.aborted || error?.name === "AbortError") throw new AgentServiceError("CANCELLED");
    throw new AgentServiceError("CONNECTION");
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw statusError(res.status) ?? payloadError(body) ?? new AgentServiceError("INVALID_RESPONSE");
  }
  if (res.headers.get("content-type")?.includes("application/json")) {
    const body = await res.json().catch(() => null);
    throw payloadError(body) ?? new AgentServiceError("INVALID_RESPONSE");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let first = 0;
  let last = 0;
  let deltas = 0;
  let usageTokens: number | null = null;
  let reasoningTokens = 0;
  let cachedPromptTokens = 0;
  let model = "moonshotai-kimi-k3.1-pro-trial";

  const processLine = (line: string) => {
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      let j: any;
      try {
        j = JSON.parse(data);
      } catch {
        throw new AgentServiceError("INVALID_RESPONSE");
      }
      if (j.error || j.type === "error") throw payloadError(j) ?? new AgentServiceError("INVALID_RESPONSE");
      if (j.usage?.completion_tokens) {
        reasoningTokens = j.usage.completion_tokens_details?.reasoning_tokens ?? 0;
        usageTokens = j.usage.completion_tokens - reasoningTokens;
        cachedPromptTokens = j.usage.prompt_tokens_details?.cached_tokens ?? 0;
      }
      if (j.model) model = j.model;
      for (const c of j.choices ?? []) {
        const s: string | undefined = c.delta?.content;
        if (s) {
          const now = performance.now();
          if (!first) first = now;
          last = now;
          deltas++;
          text += s;
          cb.onDelta?.(s, text);
        }
      }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read().catch((error) => {
        if (opts.signal?.aborted || error?.name === "AbortError") throw new AgentServiceError("CANCELLED");
        throw new AgentServiceError("CONNECTION");
      });
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        processLine(buf.slice(0, nl).trim());
        buf = buf.slice(nl + 1);
      }
    }
    buf += decoder.decode();
    if (buf.trim()) processLine(buf.trim());
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (opts.signal?.aborted) throw new AgentServiceError("CANCELLED");
  if (!text.trim()) throw new AgentServiceError("INVALID_RESPONSE");
  const end = performance.now();
  // Fall back to a char-based estimate if the gateway doesn't forward usage.
  const outputTokens = usageTokens ?? Math.max(deltas, Math.round(text.length / 3.6));
  const genMs = first && last > first ? last - first : 0;
  return {
    text,
    stats: {
      queueMs: Math.round((first || end) - t0),
      genMs: Math.round(genMs),
      totalMs: Math.round(end - t0),
      outputTokens,
      reasoningTokens,
      cachedPromptTokens,
      tps: genMs > 0 ? Math.round((outputTokens - 1) / (genMs / 1000)) : 0,
      model,
    },
  };
}

/** Pull the first JSON object out of a model reply (tolerates code fences or stray prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1] : text;
  const start = src.indexOf("{");
  if (start < 0) throw new AgentServiceError("INVALID_RESPONSE");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try { return JSON.parse(src.slice(start, i + 1)); }
      catch { throw new AgentServiceError("INVALID_RESPONSE"); }
    }
  }
  throw new AgentServiceError("INVALID_RESPONSE");
}
