import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { AgentConfig } from "@unfold/agent";

let active = 0;
export type GatewayExecution = { config: AgentConfig; dispose: () => Promise<void> };

// A separate supervisor survives a web-process crash long enough to terminate its process group.
const supervisor = String.raw`
const { spawn } = require("node:child_process");
const { rm } = require("node:fs/promises");
const child = spawn(process.argv[1], process.argv.slice(2), { env: process.env, stdio: "ignore" });
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  try { process.kill(-process.pid, "SIGTERM"); } catch {}
  setTimeout(() => { try { process.kill(-process.pid, "SIGKILL"); } catch {} }, 2000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
const watch = setInterval(() => {
  if (process.ppid !== Number(process.env.UNFOLD_EXECUTION_PARENT_PID) || Date.now() > Number(process.env.UNFOLD_EXECUTION_DEADLINE)) stop();
}, 1000);
async function finish(code) {
  clearInterval(watch);
  await rm(process.env.OPENCLAW_STATE_DIR, { recursive: true, force: true });
  process.exit(code);
}
child.once("error", () => { void finish(1); });
child.once("exit", (code) => { void finish(code ?? 0); });
`;

/** Credentials stay in one child environment; this never changes an existing gateway profile. */
export function isolatedConfig(directory: string, port: number, model: string, baseUrl: string) {
  const secret = (name: string) => ({ source: "env", provider: "default", id: name });
  return {
    logging: { level: "warn", file: path.join(directory, "gateway.log") },
    gateway: { mode: "local", bind: "loopback", port, auth: { mode: "token", token: secret("OPENCLAW_GATEWAY_TOKEN") }, http: { endpoints: { chatCompletions: { enabled: true } } } },
    models: { mode: "replace", providers: { cerebras: { baseUrl, api: "openai-completions", apiKey: secret("CEREBRAS_API_KEY"), models: [{ id: model, name: "Kimi K3.1 Pro", reasoning: true, input: ["text", "image"], contextWindow: 262144, maxTokens: 8192 }] } } },
    agents: { ownership: "explicit", defaults: { workspace: path.join(directory, "workspace"), skipBootstrap: true, thinkingDefault: "low", maxConcurrent: 1, model: { primary: `cerebras/${model}`, fallbacks: [] }, skills: [] }, entries: { unfold: { agentDir: path.join(directory, "agents", "unfold", "agent"), tools: { deny: ["*"] }, skills: [] } } },
    tools: { deny: ["*"] },
  };
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

export async function startIsolatedGateway(key: string, options: { model: string; baseUrl: string; workspaceInstructions: string; signal?: AbortSignal; executable?: string }): Promise<GatewayExecution> {
  if (process.platform === "win32" || active >= 2) throw new Error("Isolated editing capacity is unavailable. Try again shortly.");
  options.signal?.throwIfAborted();
  active++;
  let directory: string | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  const dispose = () => disposal ??= (async () => {
    disposed = true;
    options.signal?.removeEventListener("abort", abort);
    if (child?.pid && child.exitCode === null) {
      const stopped = once(child, "exit").catch(() => {});
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already stopped. */ }
      await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 2000))]);
      if (child.exitCode === null) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already stopped. */ }
        await stopped;
      }
    }
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { active--; }
  })();
  const abort = () => { void dispose(); };
  try {
    directory = await mkdtemp(path.join(os.tmpdir(), "unfold-execution-"));
    await chmod(directory, 0o700);
    const workspace = path.join(directory, "workspace");
    await mkdir(workspace, { mode: 0o700 });
    await writeFile(path.join(workspace, "AGENTS.md"), await readFile(options.workspaceInstructions), { mode: 0o600 });
    const port = await freePort();
    const token = randomBytes(32).toString("hex");
    const configPath = path.join(directory, "openclaw.json");
    await writeFile(configPath, JSON.stringify(isolatedConfig(directory, port, options.model, options.baseUrl)), { mode: 0o600 });
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      PATH: process.env.PATH, LANG: process.env.LANG ?? "en_US.UTF-8", TZ: "UTC",
      OPENCLAW_STATE_DIR: directory, OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_AGENT_DIR: path.join(directory, "agents", "unfold", "agent"),
      OPENCLAW_WORKSPACE_DIR: workspace,
      OPENCLAW_GATEWAY_TOKEN: token, CEREBRAS_API_KEY: key,
      UNFOLD_EXECUTION_PARENT_PID: String(process.pid), UNFOLD_EXECUTION_DEADLINE: String(Date.now() + 10 * 60_000),
    };
    child = spawn(process.execPath, ["-e", supervisor, options.executable ?? "openclaw", "gateway", "run", "--port", String(port), "--bind", "loopback"], { env, cwd: workspace, detached: true, stdio: "ignore" });
    let failed = false;
    child.on("error", () => { failed = true; });
    options.signal?.addEventListener("abort", abort, { once: true });
    const config = { url: `http://127.0.0.1:${port}`, token, agentId: "unfold" };
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      options.signal?.throwIfAborted();
      if (failed || child.exitCode !== null || disposed) throw new Error("The isolated OpenClaw process could not start.");
      const ready = await fetch(`${config.url}/v1/models`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) }).catch(() => null);
      if (ready?.ok) return { config, dispose };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("The isolated OpenClaw process did not become ready.");
  } catch (error) { await dispose(); throw error; }
}
