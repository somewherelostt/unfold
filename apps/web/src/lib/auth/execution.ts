import "server-only";
import path from "node:path";
import { agentConfigFromEnv } from "@unfold/agent";
import { getStoredUserApiKey } from "./api-keys";
import { isDevNoAuth } from "./env";
import { CEREBRAS_MODEL } from "./providers";
import { startIsolatedGateway } from "./isolated-gateway";
import type { AppUser } from "./server";
import { StorageError } from "@/server/private-storage";

export async function createExecution(user: AppUser, signal?: AbortSignal) {
  if (user.dev && isDevNoAuth()) return { mode: "local-demo" as const, config: agentConfigFromEnv(), dispose: async () => {} };
  let key: string | null;
  try { key = await getStoredUserApiKey(user.id, "cerebras"); }
  catch { throw new StorageError(503, "Your saved key could not be read. Replace it in Settings and try again."); }
  if (!key) throw new StorageError(428, "Save a Cerebras key in Settings before generating an edit.");
  try {
    const execution = await startIsolatedGateway(key, {
      model: CEREBRAS_MODEL, baseUrl: process.env.CEREBRAS_BASE_URL ?? "https://api.cerebras.ai/v1",
      workspaceInstructions: path.resolve(process.cwd(), "../../agent-workspace/AGENTS.md"),
      signal, executable: process.env.UNFOLD_OPENCLAW_BIN,
    });
    return { mode: "user-key" as const, ...execution };
  } catch { throw new StorageError(503, "Your isolated OpenClaw connection is unavailable. Check server capacity and setup, then try again."); }
}
