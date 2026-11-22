import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sourceLoader } from "./test-loader.mjs";

/** Fixture-only preflight checks; these never execute the renderer or a model. */
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "unfold-export-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let accessCalls = 0, releases = 0, stream;
  let prepareAccess = async () => {};
  class StorageError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const deps = {
    "@/lib/auth/server": { requireUser: async () => ({ id: "fixture-owner" }) },
    "@/server/store": {
      PUBLIC_DIR: root, REPO_ROOT: root, getLibrary: async () => ({}),
      store: { getPlan: async () => ({ projectId: "fixture-project", editPlan: { id: "fixture-edit" } }) },
      storage: {
        projectDir: () => root,
        createRenderAccess: async () => { accessCalls++; await prepareAccess(); return { token: "fixture-only", release: async () => { releases++; } }; },
        registerReference: async () => {},
      },
    },
    "@/server/plan-access": { trustedPlanInputs: async () => ({}) },
    "@/server/export-plan": {
      ExportRequest: { safeParse: () => ({ success: true, data: { planId: "fixture-edit" } }) },
      prepareExportPlan: () => ({ source: { src: "/media/fixture-project/source.mp4" } }),
      exportFingerprints: async () => ({}),
    },
    "@/server/private-storage": { StorageError },
    "@/server/api-errors": { apiError: (error) => Response.json({ error: error.message }, { status: error.status ?? 500 }) },
    "@/server/sse": { sse: (run) => { stream = run; return new Response("fixture-only-stream"); } },
    "@unfold/video/render": { renderPlan: async () => {} },
    "@unfold/video/review": { reviewRenderedPlan: async () => { throw new Error("No render is performed by this fixture"); } },
  };
  const { POST } = sourceLoader(deps)("../app/api/export/route.ts");
  return {
    post: () => POST(new Request("http://localhost/api/export", { method: "POST", body: "{}" })),
    prepare: (fn) => { prepareAccess = fn; },
    finish: () => stream(() => {}, new AbortController().signal),
    calls: () => ({ accessCalls, releases }),
  };
}

test("export reserves its render slot before asynchronous capability creation", async (t) => {
  const h = await fixture(t);
  let enter, resume;
  const entered = new Promise((resolve) => { enter = resolve; });
  const gate = new Promise((resolve) => { resume = resolve; });
  h.prepare(async () => { enter(); await gate; });
  const first = h.post();
  await entered;
  assert.equal((await h.post()).status, 429);
  assert.equal(h.calls().accessCalls, 1);
  resume();
  assert.equal((await first).status, 200);
  assert.equal((await h.post()).status, 429);
  await h.finish();
  assert.equal(h.calls().releases, 1);
  assert.equal((await h.post()).status, 200);
  await h.finish();
});

test("a failed export preflight releases only its own slot for retry", async (t) => {
  const h = await fixture(t);
  h.prepare(async () => { throw new Error("Capability unavailable"); });
  assert.equal((await h.post()).status, 500);
  h.prepare(async () => {});
  assert.equal((await h.post()).status, 200);
  await h.finish();
  assert.equal(h.calls().releases, 1);
});
