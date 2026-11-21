/** API-key providers users can connect in Settings. Safe for client and server. */
export const PROVIDERS = {
  cerebras: {
    label: "Cerebras",
    required: true,
    description: "Runs the Unfold agent on Kimi K3.1 Pro. Required to generate edits.",
    placeholder: "csk-…",
    docsUrl: "https://cloud.cerebras.ai" as string | null,
    testable: true,
  },
  gpu: {
    label: "Comparison model provider",
    required: false,
    description: "Optional. Runs the same plan on a GPU-hosted model for the side-by-side speed comparison.",
    placeholder: "API key",
    docsUrl: null as string | null,
    testable: false,
  },
} as const;

export type Provider = keyof typeof PROVIDERS;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as Provider[];

export function isProvider(v: unknown): v is Provider {
  return typeof v === "string" && v in PROVIDERS;
}

export const CEREBRAS_MODEL = process.env.UNFOLD_MODEL || "moonshotai-kimi-k3.1-pro-trial";
