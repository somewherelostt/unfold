/** API-key providers users can connect in Settings. Safe for client and server. */
export const PROVIDERS = {
  cerebras: {
    label: "Cerebras",
    required: false,
    description: "Save a Cerebras key and check access to Kimi K3.1 Pro.",
    placeholder: "csk-…",
    docsUrl: "https://cloud.cerebras.ai" as string | null,
    testable: true,
  },
  gpu: {
    label: "Comparison model provider",
    required: false,
    description: "Reserved for a future speed comparison.",
    placeholder: "API key",
    docsUrl: null as string | null,
    testable: false,
  },
} as const;

export type Provider = keyof typeof PROVIDERS;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as Provider[];

export function isProvider(v: unknown): v is Provider {
  return typeof v === "string" && Object.hasOwn(PROVIDERS, v);
}

export const CEREBRAS_MODEL = process.env.UNFOLD_MODEL || "moonshotai-kimi-k3.1-pro-trial";
