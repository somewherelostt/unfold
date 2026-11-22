import { RevisionConflict, StorageError } from "./private-storage";

export function apiError(error: unknown): Response {
  if (error instanceof RevisionConflict) return Response.json({ error: error.message, currentRevision: error.currentRevision }, { status: 409 });
  if (error instanceof StorageError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: "The request could not be completed." }, { status: 500 });
}
