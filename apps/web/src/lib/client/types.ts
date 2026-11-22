import type { AgentPlan, Aspect, CaptionPreset, EditPlan, StylePreset, StyleProfile, TransitionType } from "@unfold/core";

/** Per-call agent stats from the API (packages/agent StreamStats). Speed shown = genMs + tps. */
export type ApiStats = {
  queueMs?: number; // Cerebras platform queue + prompt + hidden reasoning
  genMs: number; // first visible token → last
  totalMs?: number;
  outputTokens: number;
  reasoningTokens?: number;
  cachedPromptTokens?: number;
  tps: number;
  model: string;
};
/** @deprecated alias kept for older imports */
export type PlanStats = ApiStats;

/** What the user picked in the style modal / preset chips. */
export type StyleChoice =
  | { kind: "preset"; preset: Exclude<StylePreset, "custom"> }
  | { kind: "link"; url: string }
  | { kind: "file"; name: string }
  | { kind: "auto" };

export type GenerateRequest = {
  videoId: string;
  prompt: string;
  styleId?: string; // from POST /api/reference
  aspect?: Aspect;
  count: number;
};

/** SSE events from POST /api/variants. */
export type VariantsEvent =
  | { type: "start"; count: number; startedAt: number }
  | { type: "variant"; index: number; direction?: string; editPlan: EditPlan; agentPlan?: AgentPlan; stats: ApiStats }
  | { type: "variant-error"; index: number; message: string }
  | { type: "summary"; count: number; ok: number; wallMs: number; outputTokens: number; avgTps: number }
  | { type: "error"; message: string };

/** SSE events from POST /api/remix. */
export type RemixEvent =
  | { type: "delta"; text: string }
  | { type: "plan"; editPlan: EditPlan; agentPlan?: AgentPlan; stats: ApiStats; reply?: string }
  | { type: "error"; message: string };

/** SSE events from POST /api/export. */
export type ExportEvent = { type: "progress"; progress: number } | { type: "ready"; url: string } | { type: "error"; message: string };

export type ReferenceResult = {
  styleId: string;
  profile: StyleProfile;
  cutStats?: { cutsPerMinute: number; avgShotSec: number };
  title: string | null;
  stats?: ApiStats;
};

/** Manual, client-side edits layered on top of the agent's plan (editor panels). */
export type Overrides = {
  captions?: boolean;
  captionPreset?: CaptionPreset;
  captionPosition?: "upper" | "center" | "lower";
  uppercase?: boolean;
  highlightColor?: string;
  wordsPerLine?: number;
  hookText?: string | null;
  music?: boolean;
  trackId?: string;
  volume?: number;
  sfx?: boolean;
  sfxRemoved?: number[]; // indices in the agent's sound-effect list
  sfxAdded?: { at: number; sfxId: string; url: string; name: string; volume: number }[];
  transitions?: boolean;
  transitionTypes?: Record<number, TransitionType>; // by cut index
  zooms?: boolean;
  aspect?: Aspect;
};

export type ChatMsg =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "agent";
      text: string;
      stats?: ApiStats;
      pending?: boolean;
      draft?: string;
      startedAt?: number;
      workedMs?: number;
      steps?: string[];
      /** What the remix changed; `revertTo` restores the plan from before it. */
      change?: { items: string[]; state: "open" | "kept" | "reverted"; revertTo?: { base: EditPlan; overrides: Overrides; serverId: string } };
    };
