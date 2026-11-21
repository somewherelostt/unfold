# OpenClaw setup for Unfold

Unfold's editing agent runs in an isolated OpenClaw profile (`unfold`), so it doesn't touch your main OpenClaw config.

- Config: `~/.openclaw-unfold/openclaw.json` (agent `unfold`, model `cerebras/moonshotai-kimi-k3.1-pro-trial`, thinking `low`, tools restricted, Gateway on 127.0.0.1:18890 with token auth, standard `/v1/chat/completions` enabled).
- Cerebras key: `~/.openclaw-unfold/.env` (`CEREBRAS_API_KEY=...`).
- Agent instructions: `agent-workspace/AGENTS.md`.

Start the gateway:
```bash
openclaw --profile unfold gateway run --port 18890
```

The web app calls it with `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_AGENT_ID=unfold` from `.env` (model `openclaw/unfold`).
