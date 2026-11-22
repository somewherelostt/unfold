/** Safe domain types. Provider credentials and delivery capabilities never belong in these records. */
export const PLATFORMS = ["instagram", "pinterest", "bluesky"] as const;
export type Platform = typeof PLATFORMS[number];
export type Owner = { id: string; dev?: boolean };
export type MediaProperties = {
  bytes: number; duration: number; width: number; height: number; fps: number;
  mime: "video/mp4"; videoCodec: string; audioCodec: string | null;
};
export type CompletedExportRef = { projectId: string; fileKey: string };
export type CompletedExport = {
  ref: CompletedExportRef; mediaContentSha256: string; renderedPlanFingerprint?: string;
  settings?: { resolution: "720p" | "1080p"; burnCaptions: boolean };
  properties: MediaProperties; previewUrl: string;
};
export type AccountStatus = "connecting" | "connected" | "reconnect_required" | "disconnected";
export type Account = {
  id: string; ownerId: string; platform: Platform; providerAccountId: string; providerUserId: string; authConfigId: string;
  status: AccountStatus; identity: { id: string; handle: string; name: string; accountType?: string } | null;
  requestedScopes: string[]; verifiedAt: number | null; createdAt: number;
};
export type AccountView = Omit<Account, "ownerId" | "providerAccountId" | "providerUserId" | "authConfigId">;
export const accountView = ({ ownerId: _o, providerAccountId: _p, providerUserId: _u, authConfigId: _c, ...value }: Account): AccountView => value;
export type DestinationInput = {
  accountId: string; platform: Platform; text: string;
  instagram?: { shareToFeed: boolean; thumbnailMs: number };
  pinterest?: { boardId: string; title: string; altText: string; link?: string; coverFrameMs: number };
  bluesky?: { altText: string; languages: string[] };
};
export type ScheduleInput = { mode: "now" } | {
  mode: "scheduled"; localDateTime: string; timeZone: string; disambiguation?: "earlier" | "later";
};
export type Schedule = {
  mode: "now" | "scheduled"; at: number; timeZone: string; localDateTime: string; offsetMinutes: number;
};
export type DestinationState = "draft" | "scheduled" | "queued" | "publishing" | "processing" | "reconciling" | "unknown" | "published" | "failed" | "cancelled";
export type Checkpoint = { containerId?: string; uploadId?: string; postId?: string; permalink?: string; processingStartedAt?: number; coverKey?: string; stagedFileId?: string; stagedAt?: number };
export type Destination = {
  id: string; postId: string; ownerId: string; revision: number; input: DestinationInput; state: DestinationState;
  availableAt: number; checkpoint: Checkpoint; error: { code: string; message: string; retryable: boolean } | null;
  lease: { token: string; until: number } | null; activeOperation: { id: string; kind: string; startedAt: number } | null;
  reconcileOnly: boolean;
  createdAt: number; updatedAt: number;
};
export type Post = {
  id: string; ownerId: string; ownerMode: "verified" | "development"; revision: number; export: CompletedExport; schedule: Schedule;
  createdAt: number; updatedAt: number; destinations: Destination[];
};
export type PostView = Omit<Post, "ownerId" | "ownerMode" | "destinations"> & {
  destinations: (Omit<Destination, "ownerId" | "lease" | "activeOperation" | "reconcileOnly" | "checkpoint"> & { checkpoint: Pick<Checkpoint, "containerId" | "uploadId" | "postId" | "permalink" | "processingStartedAt"> })[];
};
export const postView = (post: Post): PostView => {
  const { ownerId: _o, ownerMode: _m, destinations, ...rest } = post;
  return { ...rest, destinations: destinations.map(({ ownerId: _u, lease: _l, activeOperation: _a, reconcileOnly: _r, checkpoint, ...d }) => ({ ...d, checkpoint: { ...(checkpoint.containerId ? { containerId: checkpoint.containerId } : {}), ...(checkpoint.uploadId ? { uploadId: checkpoint.uploadId } : {}), ...(checkpoint.postId ? { postId: checkpoint.postId } : {}), ...(checkpoint.permalink ? { permalink: checkpoint.permalink } : {}), ...(checkpoint.processingStartedAt ? { processingStartedAt: checkpoint.processingStartedAt } : {}) } })) };
};
export class PublishingError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); this.name = "PublishingError"; }
}
export const ID = /^[A-Za-z0-9_-]{1,100}$/;
export const isPlatform = (value: unknown): value is Platform => PLATFORMS.includes(value as Platform);
export const terminal = (state: DestinationState) => ["published", "failed", "cancelled", "unknown"].includes(state);
