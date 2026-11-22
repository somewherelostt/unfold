/// <reference path="./sqlite.d.ts" />
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PublishingError, type Account, type Checkpoint, type CompletedExport, type Destination, type DestinationInput, type DestinationState, type Owner, type Platform, type Post, type Schedule } from "./types.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const decode = <T>(row: Record<string, unknown> | undefined): T | null => row ? JSON.parse(String(row.body)) as T : null;
const copy = <T>(value: T): T => structuredClone(value);
const notFound = () => new PublishingError("NOT_FOUND", "Not found.", 404);
export type ConnectionAttempt = { id: string; ownerId: string; platform: Platform; stateHash: string; accountId: string; replaces?: string; expiresAt: number; consumedAt: number | null };
export type Claim = { destination: Destination; post: Post; token: string };
export type DeliveryGrant = { ownerId: string; projectId: string; postId: string; destinationId: string; fileKey: string; kind: "video" | "cover"; expiresAt: number };

/** A separate, single-host durable scheduler. It deliberately shares no render-job schema. */
export class PublishingStore {
  private db: DatabaseSync;
  constructor(readonly databasePath: string, private now: () => number = Date.now, readonly leaseMs = 120_000) {
    if (leaseMs < 1000 || !Number.isSafeInteger(leaseMs)) throw new PublishingError("CONFIG", "Invalid publishing lease.", 503);
    mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(databasePath); chmodSync(databasePath, 0o600);
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version > 1) { this.db.close(); throw new PublishingError("SCHEMA_TOO_NEW", "Publishing storage requires a newer worker.", 503); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS publishing_accounts(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,platform TEXT NOT NULL,body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS publishing_accounts_owner ON publishing_accounts(owner_id);
      CREATE TABLE IF NOT EXISTS publishing_connections(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,state_hash TEXT UNIQUE NOT NULL,expires_at INTEGER NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publishing_posts(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,request_key TEXT NOT NULL,request_hash TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(owner_id,request_key));
      CREATE INDEX IF NOT EXISTS publishing_posts_owner ON publishing_posts(owner_id,project_id);
      CREATE TABLE IF NOT EXISTS publishing_revisions(post_id TEXT NOT NULL REFERENCES publishing_posts(id),revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(post_id,revision));
      CREATE TABLE IF NOT EXISTS publishing_destinations(id TEXT PRIMARY KEY,post_id TEXT NOT NULL REFERENCES publishing_posts(id),owner_id TEXT NOT NULL,account_id TEXT NOT NULL,state TEXT NOT NULL,available_at INTEGER NOT NULL,lease_until INTEGER,body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS publishing_dispatch ON publishing_destinations(state,available_at);
      CREATE INDEX IF NOT EXISTS publishing_destination_accounts ON publishing_destinations(owner_id,account_id);
      CREATE TABLE IF NOT EXISTS publishing_operations(id TEXT PRIMARY KEY,destination_id TEXT NOT NULL,revision INTEGER NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,started_at INTEGER NOT NULL,finished_at INTEGER,receipt TEXT);
      CREATE TABLE IF NOT EXISTS publishing_delivery(token_hash TEXT PRIMARY KEY,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,post_id TEXT NOT NULL,destination_id TEXT NOT NULL,expires_at INTEGER NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publishing_workers(id TEXT PRIMARY KEY,seen_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS publishing_admission(owner_id TEXT NOT NULL,scope TEXT NOT NULL,closed_at INTEGER NOT NULL,PRIMARY KEY(owner_id,scope));
      PRAGMA user_version=1;
    `);
  }
  close() { this.db.close(); }
  assertAdmission(owner: Owner, projectId: string) { if (this.db.prepare("SELECT scope FROM publishing_admission WHERE owner_id=? AND scope IN ('*',?)").get(owner.id, projectId)) throw new PublishingError("DELETION_PENDING", "This project or account is being removed. New posts are unavailable.", 409); }
  private tx<T>(fn: () => T): T { this.db.exec("BEGIN IMMEDIATE"); try { const value = fn(); this.db.exec("COMMIT"); return value; } catch (e) { this.db.exec("ROLLBACK"); throw e; } }
  private saveDestination(d: Destination) {
    d.updatedAt = this.now(); this.db.prepare("UPDATE publishing_destinations SET state=?,available_at=?,lease_until=?,body=? WHERE id=?").run(d.state, d.availableAt, d.lease?.until ?? null, JSON.stringify(d), d.id);
  }
  private destination(id: string) { const d = decode<Destination>(this.db.prepare("SELECT body FROM publishing_destinations WHERE id=?").get(id)); if (!d) throw notFound(); return d; }
  private fenced(id: string, token: string) { const d = this.destination(id); if (!d.lease || d.lease.token !== token || d.lease.until <= this.now()) throw new PublishingError("LEASE_LOST", "Publication ownership changed.", 409); return d; }
  private post(owner: Owner, id: string) {
    const p = decode<Post>(this.db.prepare("SELECT body FROM publishing_posts WHERE id=? AND owner_id=?").get(id, owner.id)); if (!p) throw notFound();
    p.destinations = this.db.prepare("SELECT body FROM publishing_destinations WHERE post_id=? ORDER BY id").all(id).map((r) => decode<Destination>(r)!); return p;
  }
  private savePost(post: Post) {
    post.updatedAt = this.now(); const body = JSON.stringify({ ...post, destinations: [] });
    this.db.prepare("UPDATE publishing_posts SET body=? WHERE id=?").run(body, post.id);
    this.db.prepare("INSERT INTO publishing_revisions(post_id,revision,body) VALUES (?,?,?)").run(post.id, post.revision, JSON.stringify(post));
  }
  get(owner: Owner, id: string) { return copy(this.post(owner, id)); }
  list(owner: Owner) { return this.db.prepare("SELECT p.id FROM publishing_posts p WHERE p.owner_id=? ORDER BY CASE WHEN EXISTS(SELECT 1 FROM publishing_destinations d WHERE d.post_id=p.id AND d.state IN ('draft','scheduled','queued','publishing','processing','reconciling')) THEN 0 WHEN EXISTS(SELECT 1 FROM publishing_destinations d WHERE d.post_id=p.id AND d.state IN ('unknown','failed')) THEN 1 ELSE 2 END,p.rowid DESC LIMIT 300").all(owner.id).map((r) => this.get(owner, String(r.id))); }
  listAccounts(owner: Owner) { return this.db.prepare("SELECT body FROM publishing_accounts WHERE owner_id=? ORDER BY rowid").all(owner.id).map((r) => decode<Account>(r)!); }
  account(owner: Owner, id: string) { const a = decode<Account>(this.db.prepare("SELECT body FROM publishing_accounts WHERE id=? AND owner_id=?").get(id, owner.id)); if (!a) throw notFound(); return a; }
  accountDestinations(owner: Owner, id: string) { this.account(owner, id); return this.db.prepare("SELECT id FROM publishing_destinations WHERE owner_id=? AND account_id=?").all(owner.id, id).map((r) => String(r.id)); }
  putAccount(account: Account) {
    const prior = decode<Account>(this.db.prepare("SELECT body FROM publishing_accounts WHERE id=?").get(account.id));
    if (prior && (prior.ownerId !== account.ownerId || prior.platform !== account.platform || prior.providerAccountId !== account.providerAccountId)) throw notFound();
    if (prior?.status === "disconnected" && account.status !== "disconnected") throw new PublishingError("ACCOUNT_DISCONNECTED", "This account was disconnected. Connect it again to continue.", 409);
    if (prior && (!prior.identity || prior.verifiedAt === null) && account.status === "connected") throw new PublishingError("CONNECTION_INCOMPLETE", "Finish signing in through the connection window before publishing.", 409);
    this.saveAccount(account);
  }
  private saveAccount(account: Account) { this.db.prepare("INSERT INTO publishing_accounts(id,owner_id,platform,body) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(account.id, account.ownerId, account.platform, JSON.stringify(account)); }
  disconnect(owner: Owner, id: string) {
    return this.tx(() => {
      const a = this.account(owner, id); a.status = "disconnected"; this.putAccount(a);
      for (const r of this.db.prepare("SELECT body FROM publishing_destinations WHERE account_id=? AND owner_id=?").all(id, owner.id)) {
        const d = decode<Destination>(r)!;
        if (["draft", "scheduled", "queued"].includes(d.state) && !d.lease && !d.activeOperation) { d.state = "cancelled"; this.saveDestination(d); }
        this.db.prepare("DELETE FROM publishing_delivery WHERE destination_id=?").run(d.id);
      }
      return copy(a);
    });
  }
  beginConnection(owner: Owner, platform: Platform, accountId: string, replaces?: string) {
    if (replaces && this.account(owner, replaces).platform !== platform) throw notFound();
    const state = randomBytes(32).toString("base64url"), attempt: ConnectionAttempt = { id: randomUUID(), ownerId: owner.id, platform, accountId, ...(replaces ? { replaces } : {}), stateHash: hash(state), expiresAt: this.now() + 600_000, consumedAt: null };
    this.db.prepare("INSERT INTO publishing_connections(id,owner_id,state_hash,expires_at,body) VALUES (?,?,?,?,?)").run(attempt.id, owner.id, attempt.stateHash, attempt.expiresAt, JSON.stringify(attempt)); return { state, attempt };
  }
  connection(owner: Owner, state: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new PublishingError("INVALID_STATE", "This connection link is invalid or expired.", 400);
    const a = decode<ConnectionAttempt>(this.db.prepare("SELECT body FROM publishing_connections WHERE state_hash=? AND owner_id=?").get(hash(state), owner.id));
    if (!a || a.expiresAt < this.now() || a.consumedAt) throw new PublishingError("INVALID_STATE", "This connection link is invalid or expired.", 400); return a;
  }
  completeConnection(owner: Owner, state: string, account: Account) {
    return this.tx(() => { const a = this.connection(owner, state), pending = this.account(owner, a.accountId); if (a.accountId !== account.id || a.platform !== account.platform || account.ownerId !== owner.id || account.status !== "connected" || !account.identity || pending.providerAccountId !== account.providerAccountId || pending.providerUserId !== account.providerUserId || pending.authConfigId !== account.authConfigId) throw notFound();
      let result = account;
      if (a.replaces) {
        const previous = this.account(owner, a.replaces);
        if (!previous.identity || previous.identity.id !== account.identity.id || previous.platform !== account.platform) throw new PublishingError("RECONNECT_IDENTITY_CHANGED", "Reconnect the same social account to preserve existing scheduled posts. Connect a different account separately.", 409);
        result = { ...account, id: previous.id, createdAt: previous.createdAt };
        this.db.prepare("UPDATE publishing_accounts SET body=? WHERE id=? AND owner_id=?").run(JSON.stringify(result), result.id, owner.id);
        this.db.prepare("DELETE FROM publishing_accounts WHERE id=? AND owner_id=?").run(account.id, owner.id);
      } else this.saveAccount(account);
      a.consumedAt = this.now(); this.db.prepare("UPDATE publishing_connections SET body=? WHERE id=?").run(JSON.stringify(a), a.id); return copy(result);
    });
  }
  create(owner: Owner, media: CompletedExport, inputs: DestinationInput[], schedule: Schedule, key: string, draft = false): Post {
    if (!/^[A-Za-z0-9_.:-]{8,160}$/.test(key)) throw new PublishingError("INVALID_KEY", "Use a valid submission key.");
    const requestHash = hash(JSON.stringify({ media, inputs, schedule: { ...schedule, ...(schedule.mode === "now" ? { at: 0, localDateTime: "" } : {}) }, draft }));
    return this.tx(() => {
      this.assertAdmission(owner, media.ref.projectId);
      const prior = this.db.prepare("SELECT id,request_hash FROM publishing_posts WHERE owner_id=? AND request_key=?").get(owner.id, key);
      if (prior) { if (prior.request_hash !== requestHash) throw new PublishingError("IDEMPOTENCY_CONFLICT", "This submission changed. Review and submit it again.", 409); return this.get(owner, String(prior.id)); }
      const active = Number(this.db.prepare("SELECT COUNT(*) n FROM publishing_destinations WHERE owner_id=? AND state NOT IN ('published','cancelled','failed','unknown')").get(owner.id)?.n);
      if (active + inputs.length > 100) throw new PublishingError("SCHEDULE_LIMIT", "You have reached the limit of 100 pending destinations.", 429);
      const at = this.now(), id = randomUUID();
      const destinations = inputs.map((input): Destination => {
        const account = this.account(owner, input.accountId);
        if (account.platform !== input.platform || (!draft && (account.status !== "connected" || !account.identity))) throw new PublishingError("ACCOUNT_UNAVAILABLE", "Reconnect the selected account before publishing.", 409);
        return { id: randomUUID(), postId: id, ownerId: owner.id, revision: 1, input, state: draft ? "draft" : schedule.mode === "now" ? "queued" : "scheduled", availableAt: schedule.at, checkpoint: {}, error: null, lease: null, activeOperation: null, reconcileOnly: false, createdAt: at, updatedAt: at };
      });
      const post: Post = { id, ownerId: owner.id, ownerMode: owner.dev ? "development" : "verified", revision: 1, export: media, schedule, createdAt: at, updatedAt: at, destinations };
      this.db.prepare("INSERT INTO publishing_posts(id,owner_id,project_id,request_key,request_hash,body) VALUES (?,?,?,?,?,?)").run(id, owner.id, media.ref.projectId, key, requestHash, JSON.stringify({ ...post, destinations: [] }));
      for (const d of destinations) this.db.prepare("INSERT INTO publishing_destinations(id,post_id,owner_id,account_id,state,available_at,body) VALUES (?,?,?,?,?,?,?)").run(d.id, id, owner.id, d.input.accountId, d.state, d.availableAt, JSON.stringify(d));
      this.savePost(post); return copy(post);
    });
  }
  revise(owner: Owner, id: string, revision: number, inputs: DestinationInput[], schedule: Schedule, draft = false) {
    return this.tx(() => {
      const p = this.post(owner, id);
      this.assertAdmission(owner, p.export.ref.projectId);
      if (p.revision !== revision) throw new PublishingError("REVISION_CONFLICT", "This post changed elsewhere. Reload before editing.", 409);
      if (p.destinations.some((d) => !["draft", "scheduled", "queued"].includes(d.state) || d.lease || d.activeOperation)) throw new PublishingError("ALREADY_DISPATCHED", "This post has started publishing and can no longer be edited.", 409);
      if (inputs.length !== p.destinations.length || inputs.some((input) => !p.destinations.some((d) => d.input.accountId === input.accountId && d.input.platform === input.platform))) throw new PublishingError("DESTINATIONS_CHANGED", "Create a new post to change destinations.", 409);
      p.revision++; p.schedule = schedule;
      for (const d of p.destinations) {
        const account = this.account(owner, d.input.accountId); if (!draft && account.status !== "connected") throw new PublishingError("ACCOUNT_UNAVAILABLE", "Reconnect this account first.", 409);
        d.input = copy(inputs.find((input) => input.accountId === d.input.accountId)!); d.revision = p.revision; d.state = draft ? "draft" : schedule.mode === "now" ? "queued" : "scheduled"; d.availableAt = schedule.at; d.checkpoint = {}; d.reconcileOnly = false; this.saveDestination(d);
      }
      this.savePost(p); return copy(p);
    });
  }
  cancel(owner: Owner, id: string, revision: number) {
    return this.tx(() => {
      const p = this.post(owner, id);
      if (p.revision !== revision) throw new PublishingError("REVISION_CONFLICT", "This post changed elsewhere. Reload before cancelling.", 409);
      if (p.destinations.some((d) => d.lease || d.activeOperation || ["publishing", "processing", "reconciling", "unknown"].includes(d.state))) throw new PublishingError("ALREADY_DISPATCHED", "Publishing has started. Check each destination’s result; cancellation cannot undo a publication.", 409);
      for (const d of p.destinations) if (["draft", "scheduled", "queued", "failed"].includes(d.state)) { d.state = "cancelled"; this.saveDestination(d); }
      this.db.prepare("DELETE FROM publishing_delivery WHERE post_id=?").run(id); p.revision++; this.savePost(p); return copy(p);
    });
  }
  retry(owner: Owner, postId: string, destinationId: string) {
    return this.tx(() => {
      const p = this.post(owner, postId), d = p.destinations.find((item) => item.id === destinationId); if (!d) throw notFound();
      this.assertAdmission(owner, p.export.ref.projectId);
      if (d.state !== "failed" || !d.error?.retryable || d.activeOperation || d.lease || d.checkpoint.postId) throw new PublishingError("RETRY_UNSAFE", "This destination cannot safely be retried. Check its result first.", 409);
      if (this.account(owner, d.input.accountId).status !== "connected") throw new PublishingError("ACCOUNT_UNAVAILABLE", "Reconnect this account first.", 409);
      d.state = "queued"; d.error = null; d.availableAt = this.now(); d.reconcileOnly = false; this.saveDestination(d); return this.get(owner, postId);
    });
  }
  cancelDestination(owner: Owner, postId: string, destinationId: string, revision: number) {
    return this.tx(() => { const p = this.post(owner, postId), d = p.destinations.find((item) => item.id === destinationId); if (!d) throw notFound();
      if (p.revision !== revision) throw new PublishingError("REVISION_CONFLICT", "This post changed elsewhere. Reload before cancelling.", 409);
      if (!["draft", "scheduled", "queued"].includes(d.state) || d.lease || d.activeOperation) throw new PublishingError("ALREADY_DISPATCHED", "This destination has already started publishing.", 409);
      d.state = "cancelled"; this.saveDestination(d); this.db.prepare("DELETE FROM publishing_delivery WHERE destination_id=?").run(d.id); p.revision++; this.savePost(p); return this.get(owner, postId);
    });
  }
  reconcile(owner: Owner, postId: string, destinationId: string) {
    return this.tx(() => { const p = this.post(owner, postId), d = p.destinations.find((item) => item.id === destinationId); if (!d) throw notFound();
      if (d.state !== "unknown" || d.lease || !(d.checkpoint.containerId || d.checkpoint.uploadId || d.checkpoint.postId)) throw new PublishingError("STATUS_UNAVAILABLE", "This destination has no platform receipt to check. Review the connected account.", 409);
      if (this.account(owner, d.input.accountId).status !== "connected") throw new PublishingError("ACCOUNT_UNAVAILABLE", "Reconnect the account before checking this publication.", 409);
      d.state = "reconciling"; d.availableAt = this.now(); d.reconcileOnly = true; this.saveDestination(d); return this.get(owner, postId);
    });
  }
  heartbeat(workerId: string) { this.db.prepare("INSERT INTO publishing_workers(id,seen_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at").run(workerId, this.now()); }
  workerReady() { return Number(this.db.prepare("SELECT MAX(seen_at) seen FROM publishing_workers").get()?.seen ?? 0) > this.now() - 45_000; }
  claim(): Claim | null {
    return this.tx(() => {
      // A dead process must never cause a second mutation after the first may have reached the provider.
      for (const row of this.db.prepare("SELECT body FROM publishing_destinations WHERE lease_until<=?").all(this.now())) {
        const d = decode<Destination>(row)!; d.lease = null;
        if (d.activeOperation) { this.db.prepare("UPDATE publishing_operations SET state='ambiguous' WHERE id=? AND state='reserved'").run(d.activeOperation.id); d.state = "reconciling"; }
        else if (!["published", "failed", "cancelled", "unknown"].includes(d.state)) d.state = d.checkpoint.containerId || d.checkpoint.uploadId || d.checkpoint.postId ? "processing" : "queued";
        this.saveDestination(d);
      }
      if (Number(this.db.prepare("SELECT COUNT(*) n FROM publishing_destinations WHERE lease_until>?").get(this.now())?.n) >= 2) return null;
      const rows = this.db.prepare("SELECT body FROM publishing_destinations WHERE state IN ('scheduled','queued','processing','reconciling') AND available_at<=? AND lease_until IS NULL ORDER BY available_at,id LIMIT 40").all(this.now());
      for (const row of rows) {
        const d = decode<Destination>(row)!;
        const post = this.post({ id: d.ownerId }, d.postId);
        if (this.db.prepare("SELECT scope FROM publishing_admission WHERE owner_id=? AND scope IN ('*',?)").get(d.ownerId, post.export.ref.projectId) && !d.activeOperation && !d.checkpoint.postId) continue;
        const account = this.account({ id: d.ownerId }, d.input.accountId);
        if (account.status !== "connected") { const accepted = Boolean(d.activeOperation || d.checkpoint.postId); d.state = accepted ? "unknown" : "failed"; d.error = { code: "RECONNECT_REQUIRED", message: "Reconnect this account before checking or continuing publication.", retryable: !accepted }; this.saveDestination(d); continue; }
        const token = randomUUID(); d.lease = { token, until: this.now() + this.leaseMs }; if (["scheduled", "queued"].includes(d.state)) d.state = "publishing"; this.saveDestination(d);
        return { destination: copy(d), post: this.get({ id: d.ownerId }, d.postId), token };
      }
      return null;
    });
  }
  renew(id: string, token: string) { this.tx(() => { const d = this.fenced(id, token); d.lease!.until = this.now() + this.leaseMs; this.saveDestination(d); }); }
  reserveOperation(id: string, token: string, kind: string) {
    return this.tx(() => {
      const d = this.fenced(id, token);
      const p = this.post({ id: d.ownerId }, d.postId); this.assertAdmission({ id: d.ownerId }, p.export.ref.projectId);
      if (this.account({ id: d.ownerId }, d.input.accountId).status !== "connected") throw new PublishingError("ACCOUNT_DISCONNECTED", "This account was disconnected before publication.", 409);
      if (d.activeOperation || this.db.prepare("SELECT id FROM publishing_operations WHERE destination_id=? AND revision=? AND kind=? AND state IN ('reserved','ambiguous','succeeded')").get(id, d.revision, kind)) throw new PublishingError("OPERATION_UNRESOLVED", "This operation needs verification before another attempt.", 409);
      const operation = { id: randomUUID(), kind, startedAt: this.now() }; d.activeOperation = operation;
      this.db.prepare("INSERT INTO publishing_operations(id,destination_id,revision,kind,state,started_at) VALUES (?,?,?,?,?,?)").run(operation.id, id, d.revision, kind, "reserved", operation.startedAt); this.saveDestination(d); return operation.id;
    });
  }
  completeOperation(id: string, token: string, operationId: string, checkpoint: Checkpoint) {
    this.tx(() => { const d = this.fenced(id, token); if (d.activeOperation?.id !== operationId) throw new PublishingError("LEASE_LOST", "Publication ownership changed.", 409);
      d.checkpoint = { ...d.checkpoint, ...checkpoint }; d.activeOperation = null;
      // Whitelisted IDs only: never persist response bodies, upload policies, URLs with capabilities, or tokens.
      this.db.prepare("UPDATE publishing_operations SET state='succeeded',finished_at=?,receipt=? WHERE id=?").run(this.now(), JSON.stringify(checkpoint), operationId); this.saveDestination(d);
    });
  }
  checkpointOperation(id: string, token: string, operationId: string, checkpoint: Checkpoint) {
    this.tx(() => { const d = this.fenced(id, token); if (d.activeOperation?.id !== operationId) throw new PublishingError("LEASE_LOST", "Publication ownership changed.", 409); d.checkpoint = { ...d.checkpoint, ...checkpoint }; const row = this.db.prepare("SELECT receipt FROM publishing_operations WHERE id=?").get(operationId), prior = row?.receipt ? JSON.parse(String(row.receipt)) : {}; this.db.prepare("UPDATE publishing_operations SET receipt=? WHERE id=?").run(JSON.stringify({ ...prior, ...checkpoint }), operationId); this.saveDestination(d); });
  }
  resolvePreparation(id: string, token: string, uploadId: string) {
    this.tx(() => { const d = this.fenced(id, token); if (!d.activeOperation?.kind.startsWith("pinterest_prepare_") || d.checkpoint.uploadId !== uploadId) throw new PublishingError("UNPROVEN_RECEIPT", "This upload could not be verified.", 409);
      this.db.prepare("UPDATE publishing_operations SET state='succeeded',finished_at=?,receipt=? WHERE id=?").run(this.now(), JSON.stringify({ uploadId }), d.activeOperation.id); d.activeOperation = null; this.saveDestination(d); });
  }
  rejectOperation(id: string, token: string, operationId: string) {
    this.tx(() => { const d = this.fenced(id, token); if (d.activeOperation?.id !== operationId) throw new PublishingError("LEASE_LOST", "Publication ownership changed.", 409); this.db.prepare("UPDATE publishing_operations SET state='rejected',finished_at=? WHERE id=?").run(this.now(), operationId); d.activeOperation = null; this.saveDestination(d); });
  }
  release(id: string, token: string, change: { state: DestinationState; checkpoint?: Checkpoint; error?: Destination["error"]; delayMs?: number }) {
    this.tx(() => { const d = this.fenced(id, token); if (d.activeOperation && !["reconciling", "unknown"].includes(change.state)) throw new PublishingError("OPERATION_UNRESOLVED", "Publication status needs verification.", 409);
      d.state = change.state; d.checkpoint = { ...d.checkpoint, ...change.checkpoint }; d.error = change.error ?? null; d.availableAt = this.now() + (change.delayMs ?? 60_000); d.lease = null;
      if (["published", "cancelled", "failed"].includes(d.state)) this.db.prepare("DELETE FROM publishing_delivery WHERE destination_id=?").run(id); this.saveDestination(d);
    });
  }
  resolveAmbiguous(id: string, token: string, checkpoint: Checkpoint) {
    this.tx(() => { const d = this.fenced(id, token); if (!d.activeOperation) return; if (!checkpoint.postId) throw new PublishingError("UNPROVEN_RECEIPT", "The final publication has not been verified.", 409);
      this.db.prepare("UPDATE publishing_operations SET state='succeeded',finished_at=?,receipt=? WHERE id=?").run(this.now(), JSON.stringify(checkpoint), d.activeOperation.id); d.activeOperation = null; d.checkpoint = { ...d.checkpoint, ...checkpoint }; this.saveDestination(d); });
  }
  issueDelivery(id: string, token: string, grant: Omit<DeliveryGrant, "expiresAt" | "ownerId" | "destinationId" | "postId" | "projectId">, ttlMs = 6 * 3_600_000) {
    if (ttlMs < 1000 || ttlMs > 6 * 3_600_000) throw new PublishingError("INVALID_DELIVERY", "Invalid media delivery duration.");
    return this.tx(() => { const d = this.fenced(id, token), p = this.post({ id: d.ownerId }, d.postId);
      if (!grant.fileKey || (grant.kind === "video" && grant.fileKey !== p.export.ref.fileKey) || (grant.kind === "cover" && !/^cover_[A-Za-z0-9_-]+\.jpg$/.test(grant.fileKey))) throw new PublishingError("INVALID_DELIVERY", "Invalid media delivery reference.");
      const capability = randomBytes(32).toString("base64url"), value: DeliveryGrant = { ...grant, ownerId: d.ownerId, projectId: p.export.ref.projectId, postId: p.id, destinationId: d.id, expiresAt: this.now() + ttlMs };
      this.db.prepare("INSERT INTO publishing_delivery(token_hash,owner_id,project_id,post_id,destination_id,expires_at,body) VALUES (?,?,?,?,?,?,?)").run(hash(capability), value.ownerId, value.projectId, p.id, d.id, value.expiresAt, JSON.stringify(value)); return { capability, expiresAt: value.expiresAt };
    });
  }
  delivery(capability: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(capability)) throw notFound();
    const g = decode<DeliveryGrant>(this.db.prepare("SELECT body FROM publishing_delivery WHERE token_hash=? AND expires_at>?").get(hash(capability), this.now())); if (!g) throw notFound();
    const d = this.destination(g.destinationId); if (["cancelled", "failed"].includes(d.state) || this.account({ id: g.ownerId }, d.input.accountId).status !== "connected") throw notFound(); return g;
  }
  /** Durable admission fence; revocation commits even when an irreversible operation is unresolved. */
  beginDeletion(owner: Owner, projectId?: string) {
    return this.tx(() => {
      this.db.prepare("INSERT OR IGNORE INTO publishing_admission(owner_id,scope,closed_at) VALUES (?,?,?)").run(owner.id, projectId ?? "*", this.now());
      const posts = this.db.prepare(projectId ? "SELECT id FROM publishing_posts WHERE owner_id=? AND project_id=?" : "SELECT id FROM publishing_posts WHERE owner_id=?").all(...(projectId ? [owner.id, projectId] : [owner.id])).map((r) => this.post(owner, String(r.id)));
      const unresolvedDestinationIds: string[] = [];
      for (const p of posts) for (const d of p.destinations) {
        this.db.prepare("DELETE FROM publishing_delivery WHERE destination_id=?").run(d.id);
        if (d.lease || d.activeOperation || (d.checkpoint.postId && d.state !== "published") || d.state === "unknown") unresolvedDestinationIds.push(d.id);
        else if (["draft", "scheduled", "queued", "failed", "processing", "publishing", "reconciling"].includes(d.state)) { d.state = "cancelled"; this.saveDestination(d); }
      }
      return { ready: unresolvedDestinationIds.length === 0, unresolvedDestinationIds };
    });
  }
  /** After private storage deletion succeeds, remove this feature's private records and preserve the tombstone. */
  finalizeDeletion(owner: Owner, projectId?: string) {
    this.tx(() => {
      const gate = this.db.prepare("SELECT scope FROM publishing_admission WHERE owner_id=? AND scope=?").get(owner.id, projectId ?? "*"); if (!gate) throw new PublishingError("DELETION_NOT_STARTED", "Start removal before clearing publishing records.", 409);
      const posts = this.db.prepare(projectId ? "SELECT id FROM publishing_posts WHERE owner_id=? AND project_id=?" : "SELECT id FROM publishing_posts WHERE owner_id=?").all(...(projectId ? [owner.id, projectId] : [owner.id])).map((r) => this.post(owner, String(r.id)));
      if (posts.some((p) => p.destinations.some((d) => d.lease || d.activeOperation || d.state === "unknown" || (d.checkpoint.postId && d.state !== "published")))) throw new PublishingError("PUBLICATION_UNRESOLVED", "A publication still needs verification before removal.", 409);
      for (const p of posts) {
        for (const d of p.destinations) this.db.prepare("DELETE FROM publishing_operations WHERE destination_id=?").run(d.id);
        this.db.prepare("DELETE FROM publishing_delivery WHERE post_id=?").run(p.id); this.db.prepare("DELETE FROM publishing_destinations WHERE post_id=?").run(p.id); this.db.prepare("DELETE FROM publishing_revisions WHERE post_id=?").run(p.id); this.db.prepare("DELETE FROM publishing_posts WHERE id=?").run(p.id);
      }
      if (!projectId) { this.db.prepare("DELETE FROM publishing_connections WHERE owner_id=?").run(owner.id); this.db.prepare("DELETE FROM publishing_accounts WHERE owner_id=?").run(owner.id); }
    });
  }
}
