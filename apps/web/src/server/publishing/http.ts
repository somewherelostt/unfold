import "server-only";
import { requireUser } from "@/lib/auth/server";
import { createPublishingApi, publishingBody, publishingError, publishingJson, requireSameOrigin } from "./api.ts";
import { getPublishingRuntime } from "./runtime.ts";
import { servePublishingDelivery } from "./media.ts";
import { serveAccountAvatar } from "./avatar.ts";
import { PublishingError } from "../../../../../services/publishing/src/types.ts";
export async function handlePublishingRequest(request: Request, action: string[]): Promise<Response> {
  try {
    if (action[0] === "delivery" && action.length === 2 && ["GET", "HEAD"].includes(request.method)) { const runtime = getPublishingRuntime(); return await servePublishingDelivery(request, action[1], runtime.storage, runtime.store, runtime.config); }
    const owner = await requireUser(); if (owner instanceof Response) return owner;
    const runtime = getPublishingRuntime();
    const api = createPublishingApi(runtime), path = action.join("/"), url = new URL(request.url);
    if (request.method === "GET") {
      if (!path) return publishingJson(await api.workspace(owner));
      if (action[0] === "connections" && action[2] === "avatar" && action.length === 3) return await serveAccountAvatar(owner, action[1], runtime.store, runtime.client);
      if (path === "connections/callback") {
        try { await api.callback(owner, url.searchParams.get("state") ?? ""); }
        catch { return Response.redirect(new URL("/app/publishing?connection=incomplete", runtime.config.appOrigin ?? url.origin), 303); }
        return Response.redirect(new URL("/app/publishing?connection=connected", runtime.config.appOrigin ?? url.origin), 303);
      }
      if (action[0] === "connections" && action[2] === "boards" && action.length === 3) return publishingJson(await api.boards(owner, action[1], url.searchParams.get("bookmark") ?? undefined));
    }
    requireSameOrigin(request, runtime.config.appOrigin);
    const body = await publishingBody(request);
    if (request.method === "POST") {
      if (path === "exports/inspect") return publishingJson(await api.inspect(owner, body));
      if (path === "preview") return publishingJson(await api.preview(owner, body));
      if (path === "posts") return publishingJson(await api.create(owner, body), 201);
      if (path === "connections") return publishingJson(await api.connect(owner, body), 201);
      if (action[0] === "connections" && action[2] === "refresh" && action.length === 3) return publishingJson(await api.refresh(owner, action[1]));
      if (action[0] === "posts" && action[2] === "cancel" && action.length === 3) return publishingJson(await api.cancel(owner, action[1], body));
      if (action[0] === "posts" && action[2] === "destinations" && action[4] === "cancel" && action.length === 5) return publishingJson(await api.cancelDestination(owner, action[1], action[3], body));
      if (action[0] === "posts" && action[2] === "destinations" && ["retry", "reconcile"].includes(action[4]) && action.length === 5) return publishingJson(await api.destinationAction(owner, action[1], action[3], action[4] as "retry" | "reconcile"));
    }
    if (request.method === "PATCH" && action[0] === "posts" && action.length === 2) return publishingJson(await api.revise(owner, action[1], body));
    if (request.method === "DELETE" && action[0] === "connections" && action.length === 2) return publishingJson(await api.disconnect(owner, action[1]));
    throw new PublishingError("NOT_FOUND", "Not found.", 404);
  } catch (error) { return publishingError(error); }
}
