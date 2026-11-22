/** Operator-only, read-only verification. API key must already be in protected server environment. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPublishingConfig } from "../src/config.ts";
import { ComposioClient } from "../src/composio.ts";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const config = loadPublishingConfig(root);
if (!config.apiKey) { console.error("Add the integration API key through protected server configuration first."); process.exitCode = 1; }
else {
  const client = new ComposioClient(config);
  for (const platform of ["instagram", "pinterest"] as const) { const result = await client.capability(platform); console.log(JSON.stringify(result)); }
  try { console.log(JSON.stringify({ platform: "bluesky", ...await client.inspectBlueskyCatalog() })); }
  catch { console.error("Bluesky catalog verification could not be completed. No publishing action was attempted."); process.exitCode = 1; }
}
