import { CloudDatabase } from "@unfold/cloud";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { PublishingError, type Account, type Checkpoint, type CompletedExport, type Destination, type DestinationInput, type DestinationState, type Owner, type Platform, type Post, type Schedule } from "./types.ts";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const decode = <T>(row: Record<string, unknown> | undefined): T | null => row ? JSON.parse(String(row.body)) as T : null;
const copy = <T>(value: T): T => structuredClone(value);
const notFound = () => new PublishingError("NOT_FOUND", "Not found.", 404);
export type ConnectionAttempt = {
    id: string;
    ownerId: string;
    platform: Platform;
    stateHash: string;
    accountId: string;
    replaces?: string;
    expiresAt: number;
    consumedAt: number | null;
};
export type Claim = {
    destination: Destination;
    post: Post;
    token: string;
};
export type DeliveryGrant = {
    ownerId: string;
    projectId: string;
    postId: string;
    destinationId: string;
    fileKey: string;
    kind: "video" | "cover";
    expiresAt: number;
};
/** PostgreSQL scheduler; transactions serialize state transitions across worker instances. */
export class PostgresPublishingStore {
    private db: CloudDatabase;
    constructor(readonly databasePath: string, private now: () => number = Date.now, readonly leaseMs = 120000, databaseUrl?: string) { if (leaseMs < 1000 || !Number.isSafeInteger(leaseMs))
        throw new PublishingError("CONFIG", "Invalid publishing lease.", 503); this.db = new CloudDatabase(databaseUrl); }
    async close() { await this.db.close(); }
    async assertAdmission(owner: Owner, projectId: string) { if (await this.db.get("SELECT scope FROM publishing_admission WHERE owner_id=? AND scope IN ('*',?)", owner.id, projectId))
        throw new PublishingError("DELETION_PENDING", "This project or account is being removed. New posts are unavailable.", 409); }
    private tx<T>(fn: () => Promise<T>): Promise<T> { return this.db.transaction("publishing", fn); }
    private async saveDestination(d: Destination) {
        d.updatedAt = this.now();
        await this.db.run("UPDATE publishing_destinations SET state=?,available_at=?,lease_until=?,body=? WHERE id=?", d.state, d.availableAt, d.lease?.until ?? null, JSON.stringify(d), d.id);
    }
    private async destination(id: string) { const d = decode<Destination>(await this.db.get("SELECT body FROM publishing_destinations WHERE id=?", id)); if (!d)
        throw notFound(); return d; }
    private async fenced(id: string, token: string) { const d = await this.destination(id); if (!d.lease || d.lease.token !== token || d.lease.until <= this.now())
        throw new PublishingError("LEASE_LOST", "Publication ownership changed.", 409); return d; }
    private async post(owner: Owner, id: string) {
        const p = decode<Post>(await this.db.get("SELECT body FROM publishing_posts WHERE id=? AND owner_id=?", id, owner.id));
        if (!p)
            throw notFound();
        p.destinations = (await this.db.all("SELECT body FROM publishing_destinations WHERE post_id=? ORDER BY id", id)).map((r) => decode<Destination>(r)!);
        return p;
    }
    private async savePost(post: Post) {
        post.updatedAt = this.now();
        const body = JSON.stringify({ ...post, destinations: [] });
        await this.db.run("UPDATE publishing_posts SET body=? WHERE id=?", body, post.id);
        await this.db.run("INSERT INTO publishing_revisions(post_id,revision,body) VALUES (?,?,?)", post.id, post.revision, JSON.stringify(post));
    }
    async get(owner: Owner, id: string) { return copy(await this.post(owner, id)); }
    async list(owner: Owner) { return await Promise.all((await this.db.all("SELECT p.id FROM publishing_posts p WHERE p.owner_id=? ORDER BY CASE WHEN EXISTS(SELECT 1 FROM publishing_destinations d WHERE d.post_id=p.id AND d.state IN ('draft','scheduled','queued','publishing','processing','reconciling')) THEN 0 WHEN EXISTS(SELECT 1 FROM publishing_destinations d WHERE d.post_id=p.id AND d.state IN ('unknown','failed')) THEN 1 ELSE 2 END,p.rowid DESC LIMIT 300", owner.id)).map(async (r) => await this.get(owner, String(r.id)))); }
    async listAccounts(owner: Owner) { return (await this.db.all("SELECT body FROM publishing_accounts WHERE owner_id=? ORDER BY rowid", owner.id)).map((r) => decode<Account>(r)!); }
    async account(owner: Owner, id: string) { const a = decode<Account>(await this.db.get("SELECT body FROM publishing_accounts WHERE id=? AND owner_id=?", id, owner.id)); if (!a)
        throw notFound(); return a; }
    async accountDestinations(owner: Owner, id: string) { await this.account(owner, id); return (await this.db.all("SELECT id FROM publishing_destinations WHERE owner_id=? AND account_id=?", owner.id, id)).map((r) => String(r.id)); }
    async putAccount(account: Account) {
      return this.tx(async()=>{
        const prior = decode<Account>(await this.db.get("SELECT body FROM publishing_accounts WHERE id=?", account.id));
        if (prior && (prior.ownerId !== account.ownerId || prior.platform !== account.platform || prior.providerAccountId !== account.providerAccountId))
            throw notFound();
        if (prior?.status === "disconnected" && account.status !== "disconnected")
            throw new PublishingError("ACCOUNT_DISCONNECTED", "This account was disconnected. Connect it again to continue.", 409);
        if (prior && (!prior.identity || prior.verifiedAt === null) && account.status === "connected")
            throw new PublishingError("CONNECTION_INCOMPLETE", "Finish signing in through the connection window before publishing.", 409);
        await this.saveAccount(account);
      });
    }
    private async saveAccount(account: Account) { await this.db.run("INSERT INTO publishing_accounts(id,owner_id,platform,body) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body", account.id, account.ownerId, account.platform, JSON.stringify(account)); }
    async disconnect(owner: Owner, id: string) {
        return await this.tx(async () => {
            const a = await this.account(owner, id);
            a.status = "disconnected";
            await this.putAccount(a);
            for (const r of await this.db.all("SELECT body FROM publishing_destinations WHERE account_id=? AND owner_id=?", id, owner.id)) {
                const d = decode<Destination>(r)!;
                if (["draft", "scheduled", "queued"].includes(d.state) && !d.lease && !d.activeOperation) {
                    d.state = "cancelled";
                    await this.saveDestination(d);
                }
                await this.db.run("DELETE FROM publishing_delivery WHERE destination_id=?", d.id);
            }
            return copy(a);
        });
    }
    async beginConnection(owner: Owner, platform: Platform, accountId: string, replaces?: string) {
        if (replaces && (await this.account(owner, replaces)).platform !== platform)
            throw notFound();
        const state = randomBytes(32).toString("base64url"), attempt: ConnectionAttempt = { id: randomUUID(), ownerId: owner.id, platform, accountId, ...(replaces ? { replaces } : {}), stateHash: hash(state), expiresAt: this.now() + 600000, consumedAt: null };
        await this.db.run("INSERT INTO publishing_connections(id,owner_id,state_hash,expires_at,body) VALUES (?,?,?,?,?)", attempt.id, owner.id, attempt.stateHash, attempt.expiresAt, JSON.stringify(attempt));
        return { state, attempt };
    }
    async connection(owner: Owner, state: string) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(state))
            throw new PublishingError("INVALID_STATE", "This connection link is invalid or expired.", 400);
        const a = decode<ConnectionAttempt>(await this.db.get("SELECT body FROM publishing_connections WHERE state_hash=? AND owner_id=?", hash(state), owner.id));
        if (!a || a.expiresAt < this.now() || a.consumedAt)
            throw new PublishingError("INVALID_STATE", "This connection link is invalid or expired.", 400);
        return a;
    }
    async completeConnection(owner: Owner, state: string, account: Account) {
        return await this.tx(async () => {
            const a = await this.connection(owner, state), pending = await this.account(owner, a.accountId);
            if (a.accountId !== account.id || a.platform !== account.platform || account.ownerId !== owner.id || account.status !== "connected" || !account.identity || pending.providerAccountId !== account.providerAccountId || pending.providerUserId !== account.providerUserId || pending.authConfigId !== account.authConfigId)
                throw notFound();
            let result = account;
            if (a.replaces) {
                const previous = await this.account(owner, a.replaces);
                if (!previous.identity || previous.identity.id !== account.identity.id || previous.platform !== account.platform)
                    throw new PublishingError("RECONNECT_IDENTITY_CHANGED", "Reconnect the same social account to preserve existing scheduled posts. Connect a different account separately.", 409);
                result = { ...account, id: previous.id, createdAt: previous.createdAt };
                await this.db.run("UPDATE publishing_accounts SET body=? WHERE id=? AND owner_id=?", JSON.stringify(result), result.id, owner.id);
                await this.db.run("DELETE FROM publishing_accounts WHERE id=? AND owner_id=?", account.id, owner.id);
            }
            else
                await this.saveAccount(account);
            a.consumedAt = this.now();
            await this.db.run("UPDATE publishing_connections SET body=? WHERE id=?", JSON.stringify(a), a.id);
            return copy(result);
        });
    }
    async create(owner: Owner, media: CompletedExport, inputs: DestinationInput[], schedule: Schedule, key: string, draft = false): Promise<Post> {
        if (!/^[A-Za-z0-9_.:-]{8,160}$/.test(key))
            throw new PublishingError("INVALID_KEY", "Use a valid submission key.");
        const requestHash = hash(JSON.stringify({ media, inputs, schedule: { ...schedule, ...(schedule.mode === "now" ? { at: 0, localDateTime: "" } : {}) }, draft }));
        return await this.tx(async () => {
            await this.assertAdmission(owner, media.ref.projectId);
            const prior = await this.db.get("SELECT id,request_hash FROM publishing_posts WHERE owner_id=? AND request_key=?", owner.id, key);
            if (prior) {
                if (prior.request_hash !== requestHash)
                    throw new PublishingError("IDEMPOTENCY_CONFLICT", "This submission changed. Review and submit it again.", 409);
                return await this.get(owner, String(prior.id));
            }
            const active = Number((await this.db.get("SELECT COUNT(*) n FROM publishing_destinations WHERE owner_id=? AND state NOT IN ('published','cancelled','failed','unknown')", owner.id))?.n);
            if (active + inputs.length > 100)
                throw new PublishingError("SCHEDULE_LIMIT", "You have reached the limit of 100 pending destinations.", 429);
            const at = this.now(), id = randomUUID();
            const destinations: Destination[] = await Promise.all(inputs.map(async (input): Promise<Destination> => {
                const account = await this.account(owner, input.accountId);
                if (account.platform !== input.platform || (!draft && (account.status !== "connected" || !account.identity)))
                    throw new PublishingError("ACCOUNT_UNAVAILABLE", "Reconnect the selected account before publishing.", 409);
                return { id: randomUUID(), postId: id, ownerId: owner.id, revision: 1, input, state: draft ? "draft" : schedule.mode === "now" ? "queued" : "scheduled", availableAt: schedule.at, checkpoint: {}, error: null, lease: null, activeOperation: null, reconcileOnly: false, createdAt: at, updatedAt: at };
            }));
            const post: Post = { id, ownerId: owner.id, ownerMode: owner.dev ? "development" : "verified", revision: 1, export: media, schedule, createdAt: at, updatedAt: at, destinations };
            await this.db.run("INSERT INTO publishing_posts(id,owner_id,project_id,request_key,request_hash,body) VALUES (?,?,?,?,?,?)", id, owner.id, media.ref.projectId, key, requestHash, JSON.stringify({ ...post, destinations: [] }));
            for (const d of destinations)
                await this.db.run("INSERT INTO publishing_destinations(id,post_id,owner_id,account_id,state,available_at,body) VALUES (?,?,?,?,?,?,?)", d.id, id, owner.id, d.input.accountId, d.state, d.availableAt, JSON.stringify(d));
            await this.savePost(post);
            return copy(post);
        });
    }
    async revise(owner: Owner, id: string, revision: number, inputs: DestinationInput[], schedule: Schedule, draft = false) {
        return await this.tx(async () => {
            const p = await this.post(owner, id);
            await this.assertAdmission(owner, p.export.ref.projectId);
            if (p.revision !== revision)
                throw new PublishingError("REVISION_CONFLICT", "This post changed elsewhere. Reload before editing.", 409);
            if (p.destinations.some((d) => !["draft", "scheduled", "queued"].includes(d.state) || d.lease || d.activeOperation))
                throw new PublishingError("ALREADY_DISPATCHED", "This post has started publishing and can no longer be edited.", 409);
            if (inputs.length !== p.destinations.length || inputs.some((input) => !p.destinations.some((d) => d.input.accountId === input.accountId && d.input.platform === input.platform)))
                throw new PublishingError("DESTINATIONS_CHANGED", "Create a new post to change destinations.", 409);
            p.revision++;
            p.schedule = schedule;
            for (const d of p.destinations) {
                const account = await this.account(owner, d.input.accountId);
                if (!draft && account.status !== "connected")
                    throw new PublishingError("ACCOUNT_UNAVAILABLE", "Reconnect this account first.", 409);
                d.input = copy(inputs.find((input) => input.accountId === d.input.accountId)!);
                d.revision = p.revision;
                d.state = draft ? "draft" : schedule.mode === "now" ? "queued" : "scheduled";
                d.availableAt = schedule.at;
                d.checkpoint = {};
                d.reconcileOnly = false;
                await this.saveDestination(d);
            }
            await this.savePost(p);
            return copy(p);
        });
    }
    async cancel(owner: Owner, id: string, revision: number) {
        return await this.tx(async () => {
            const p = await this.post(owner, id);
            if (p.revision !== revision)
                throw new PublishingError("REVISION_CONFLICT", "This post changed elsewhere. Reload before cancelling.", 409);
            if (p.destinations.some((d) => d.lease || d.activeOperation || ["publishing", "processing", "reconciling", "unknown"].includes(d.state)))
                throw new PublishingError("ALREADY_DISPATCHED", "Publishing has started. Check each destination’s result; cancellation cannot undo a publication.", 409);
            for (const d of p.destinations)
                if (["draft", "scheduled", "queued", "failed"].includes(d.state)) {
                    d.state = "cancelled";
                    await this.saveDestination(d);
                }
            await this.db.run("DELETE FROM publishing_delivery WHERE post_id=?", id);
            p.revision++;
            await this.savePost(p);
            return copy(p);
        });
    }
    async retry(owner: Owner, postId: string, destinationId: string) {
        return await this.tx(async () => {
            const p = await this.post(owner, postId), d = p.destinations.find((item) => item.id === destinationId);
            if (!d)
                throw notFound();
            await this.assertAdmission(owner, p.export.ref.projectId);
            if (d.state !== "failed" || !d.error?.retryable || d.activeOperation || d.lease || d.checkpoint.postId)
                throw new PublishingError("RETRY_UNSAFE", "This destination cannot safely be retried. Check its result first.", 409);
            if ((await this.account(owner, d.input.accountId)).status !== "connected")
                throw new PublishingError("ACCOUNT_UNAVAILABLE", "Reconnect this account first.", 409);
            d.state = "queued";
            d.error = null;
            d.availableAt = this.now();
            d.reconcileOnly = false;
            await this.saveDestination(d);
            return await this.get(owner, postId);
        });
    }
    async cancelDestination(owner: Owner, postId: string, destinationId: string, revision: number) {
        return await this.tx(async () => {
            const p = await this.post(owner, postId), d = p.destinations.find((item) => item.id === destinationId);
            if (!d)
                throw notFound();
            if (p.revision !== revision)
                throw new PublishingError("REVISION_CONFLICT", "This post changed elsewhere. Reload before cancelling.", 409);
            if (!["draft", "scheduled", "queued"].includes(d.state) || d.lease || d.activeOperation)
                throw new PublishingError("ALREADY_DISPATCHED", "This destination has already started publishing.", 409);
            d.state = "cancelled";
            await this.saveDestination(d);
            await this.db.run("DELETE FROM publishing_delivery WHERE destination_id=?", d.id);
            p.revision++;
            await this.savePost(p);
            return await this.get(owner, postId);
        });
    }
    async reconcile(owner: Owner, postId: string, destinationId: string) {
        return await this.tx(async () => {
            const p = await this.post(owner, postId), d = p.destinations.find((item) => item.id === destinationId);
            if (!d)
                throw notFound();
            if (d.state !== "unknown" || d.lease || !(d.checkpoint.containerId || d.checkpoint.uploadId || d.checkpoint.postId))
                throw new PublishingError("STATUS_UNAVAILABLE", "This destination has no platform receipt to check. Review the connected account.", 409);
            if ((await this.account(owner, d.input.accountId)).status !== "connected")
                throw new PublishingError("ACCOUNT_UNAVAILABLE", "Reconnect the account before checking this publication.", 409);
            d.state = "reconciling";
            d.availableAt = this.now();
            d.reconcileOnly = true;
            await this.saveDestination(d);
            return await this.get(owner, postId);
        });
    }
    async heartbeat(workerId: string) { await this.db.run("INSERT INTO publishing_workers(id,seen_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at", workerId, this.now()); }
    async workerReady() { return Number((await this.db.get("SELECT MAX(seen_at) seen FROM publishing_workers"))?.seen ?? 0) > this.now() - 45000; }
    async claim(): Promise<Claim | null> {
        return await this.tx(async () => {
            // A dead process must never cause a second mutation after the first may have reached the provider.
            for (const row of await this.db.all("SELECT body FROM publishing_destinations WHERE lease_until<=?", this.now())) {
                const d = decode<Destination>(row)!;
                d.lease = null;
                if (d.activeOperation) {
                    await this.db.run("UPDATE publishing_operations SET state='ambiguous' WHERE id=? AND state='reserved'", d.activeOperation.id);
                    d.state = "reconciling";
                }
                else if (!["published", "failed", "cancelled", "unknown"].includes(d.state))
                    d.state = d.checkpoint.containerId || d.checkpoint.uploadId || d.checkpoint.postId ? "processing" : "queued";
                await this.saveDestination(d);
            }
            if (Number((await this.db.get("SELECT COUNT(*) n FROM publishing_destinations WHERE lease_until>?", this.now()))?.n) >= 2)
                return null;
            const rows = await this.db.all("SELECT body FROM publishing_destinations WHERE state IN ('scheduled','queued','processing','reconciling') AND available_at<=? AND lease_until IS NULL ORDER BY available_at,id LIMIT 40", this.now());
            for (const row of rows) {
                const d = decode<Destination>(row)!;
                const post = await this.post({ id: d.ownerId }, d.postId);
                if (await this.db.get("SELECT scope FROM publishing_admission WHERE owner_id=? AND scope IN ('*',?)", d.ownerId, post.export.ref.projectId) && !d.activeOperation && !d.checkpoint.postId)
                    continue;
                const account = await this.account({ id: d.ownerId }, d.input.accountId);
                if (account.status !== "connected") {
                    const accepted = Boolean(d.activeOperation || d.checkpoint.postId);
                    d.state = accepted ? "unknown" : "failed";
                    d.error = { code: "RECONNECT_REQUIRED", message: "Reconnect this account before checking or continuing publication.", retryable: !accepted };
                    await this.saveDestination(d);
                    continue;
                }
                const token = randomUUID();
                d.lease = { token, until: this.now() + this.leaseMs };
                if (["scheduled", "queued"].includes(d.state))
                    d.state = "publishing";
                await this.saveDestination(d);
                return { destination: copy(d), post: await this.get({ id: d.ownerId }, d.postId), token };
            }
            return null;
        });
    }
    async renew(id: string, token: string) { await this.tx(async () => { const d = await this.fenced(id, token); d.lease!.until = this.now() + this.leaseMs; await this.saveDestination(d); }); }
    async reserveOperation(id: string, token: string, kind: string) {
        return await this.tx(async () => {
            const d = await this.fenced(id, token);
            const p = await this.post({ id: d.ownerId }, d.postId);
            await this.assertAdmission({ id: d.ownerId }, p.export.ref.projectId);
            if ((await this.account({ id: d.ownerId }, d.input.accountId)).status !== "connected")
                throw new PublishingError("ACCOUNT_DISCONNECTED", "This account was disconnected before publication.", 409);
            if (d.activeOperation || await this.db.get("SELECT id FROM publishing_operations WHERE destination_id=? AND revision=? AND kind=? AND state IN ('reserved','ambiguous','succeeded')", id, d.revision, kind))
                throw new PublishingError("OPERATION_UNRESOLVED", "This operation needs verification before another attempt.", 409);
            const operation = { id: randomUUID(), kind, startedAt: this.now() };
            d.activeOperation = operation;
            await this.db.run("INSERT INTO publishing_operations(id,destination_id,revision,kind,state,started_at) VALUES (?,?,?,?,?,?)", operation.id, id, d.revision, kind, "reserved", operation.startedAt);
            await this.saveDestination(d);
            return operation.id;
        });
    }
    async completeOperation(id: string, token: string, operationId: string, checkpoint: Checkpoint) {
        await this.tx(async () => {
            const d = await this.fenced(id, token);
            if (d.activeOperation?.id !== operationId)
                throw new PublishingError("LEASE_LOST", "Publication ownership changed.", 409);
            d.checkpoint = { ...d.checkpoint, ...checkpoint };
            d.activeOperation = null;
            // Whitelisted IDs only: never persist response bodies, upload policies, URLs with capabilities, or tokens.
            await this.db.run("UPDATE publishing_operations SET state='succeeded',finished_at=?,receipt=? WHERE id=?", this.now(), JSON.stringify(checkpoint), operationId);
            await this.saveDestination(d);
        });
    }
    async checkpointOperation(id: string, token: string, operationId: string, checkpoint: Checkpoint) {
        await this.tx(async () => { const d = await this.fenced(id, token); if (d.activeOperation?.id !== operationId)
            throw new PublishingError("LEASE_LOST", "Publication ownership changed.", 409); d.checkpoint = { ...d.checkpoint, ...checkpoint }; const row = await this.db.get("SELECT receipt FROM publishing_operations WHERE id=?", operationId), prior = row?.receipt ? JSON.parse(String(row.receipt)) : {}; await this.db.run("UPDATE publishing_operations SET receipt=? WHERE id=?", JSON.stringify({ ...prior, ...checkpoint }), operationId); await this.saveDestination(d); });
    }
    async resolvePreparation(id: string, token: string, uploadId: string) {
        await this.tx(async () => {
            const d = await this.fenced(id, token);
            if (!d.activeOperation?.kind.startsWith("pinterest_prepare_") || d.checkpoint.uploadId !== uploadId)
                throw new PublishingError("UNPROVEN_RECEIPT", "This upload could not be verified.", 409);
            await this.db.run("UPDATE publishing_operations SET state='succeeded',finished_at=?,receipt=? WHERE id=?", this.now(), JSON.stringify({ uploadId }), d.activeOperation.id);
            d.activeOperation = null;
            await this.saveDestination(d);
        });
    }
    async rejectOperation(id: string, token: string, operationId: string) {
        await this.tx(async () => { const d = await this.fenced(id, token); if (d.activeOperation?.id !== operationId)
            throw new PublishingError("LEASE_LOST", "Publication ownership changed.", 409); await this.db.run("UPDATE publishing_operations SET state='rejected',finished_at=? WHERE id=?", this.now(), operationId); d.activeOperation = null; await this.saveDestination(d); });
    }
    async release(id: string, token: string, change: {
        state: DestinationState;
        checkpoint?: Checkpoint;
        error?: Destination["error"];
        delayMs?: number;
    }) {
        await this.tx(async () => {
            const d = await this.fenced(id, token);
            if (d.activeOperation && !["reconciling", "unknown"].includes(change.state))
                throw new PublishingError("OPERATION_UNRESOLVED", "Publication status needs verification.", 409);
            d.state = change.state;
            d.checkpoint = { ...d.checkpoint, ...change.checkpoint };
            d.error = change.error ?? null;
            d.availableAt = this.now() + (change.delayMs ?? 60000);
            d.lease = null;
            if (["published", "cancelled", "failed"].includes(d.state))
                await this.db.run("DELETE FROM publishing_delivery WHERE destination_id=?", id);
            await this.saveDestination(d);
        });
    }
    async resolveAmbiguous(id: string, token: string, checkpoint: Checkpoint) {
        await this.tx(async () => {
            const d = await this.fenced(id, token);
            if (!d.activeOperation)
                return;
            if (!checkpoint.postId)
                throw new PublishingError("UNPROVEN_RECEIPT", "The final publication has not been verified.", 409);
            await this.db.run("UPDATE publishing_operations SET state='succeeded',finished_at=?,receipt=? WHERE id=?", this.now(), JSON.stringify(checkpoint), d.activeOperation.id);
            d.activeOperation = null;
            d.checkpoint = { ...d.checkpoint, ...checkpoint };
            await this.saveDestination(d);
        });
    }
    async issueDelivery(id: string, token: string, grant: Omit<DeliveryGrant, "expiresAt" | "ownerId" | "destinationId" | "postId" | "projectId">, ttlMs = 6 * 3600000) {
        if (ttlMs < 1000 || ttlMs > 6 * 3600000)
            throw new PublishingError("INVALID_DELIVERY", "Invalid media delivery duration.");
        return await this.tx(async () => {
            const d = await this.fenced(id, token), p = await this.post({ id: d.ownerId }, d.postId);
            if (!grant.fileKey || (grant.kind === "video" && grant.fileKey !== p.export.ref.fileKey) || (grant.kind === "cover" && !/^cover_[A-Za-z0-9_-]+\.jpg$/.test(grant.fileKey)))
                throw new PublishingError("INVALID_DELIVERY", "Invalid media delivery reference.");
            const capability = randomBytes(32).toString("base64url"), value: DeliveryGrant = { ...grant, ownerId: d.ownerId, projectId: p.export.ref.projectId, postId: p.id, destinationId: d.id, expiresAt: this.now() + ttlMs };
            await this.db.run("INSERT INTO publishing_delivery(token_hash,owner_id,project_id,post_id,destination_id,expires_at,body) VALUES (?,?,?,?,?,?,?)", hash(capability), value.ownerId, value.projectId, p.id, d.id, value.expiresAt, JSON.stringify(value));
            return { capability, expiresAt: value.expiresAt };
        });
    }
    async delivery(capability: string) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(capability))
            throw notFound();
        const g = decode<DeliveryGrant>(await this.db.get("SELECT body FROM publishing_delivery WHERE token_hash=? AND expires_at>?", hash(capability), this.now()));
        if (!g)
            throw notFound();
        const d = await this.destination(g.destinationId);
        if (["cancelled", "failed"].includes(d.state) || (await this.account({ id: g.ownerId }, d.input.accountId)).status !== "connected")
            throw notFound();
        return g;
    }
    /** Durable admission fence; revocation commits even when an irreversible operation is unresolved. */
    async beginDeletion(owner: Owner, projectId?: string) {
        return await this.tx(async () => {
            await this.db.run("INSERT OR IGNORE INTO publishing_admission(owner_id,scope,closed_at) VALUES (?,?,?)", owner.id, projectId ?? "*", this.now());
            const posts = await Promise.all((await this.db.all(projectId ? "SELECT id FROM publishing_posts WHERE owner_id=? AND project_id=?" : "SELECT id FROM publishing_posts WHERE owner_id=?", ...(projectId ? [owner.id, projectId] : [owner.id]))).map(async (r) => await this.post(owner, String(r.id))));
            const unresolvedDestinationIds: string[] = [];
            for (const p of posts)
                for (const d of p.destinations) {
                    await this.db.run("DELETE FROM publishing_delivery WHERE destination_id=?", d.id);
                    if (d.lease || d.activeOperation || (d.checkpoint.postId && d.state !== "published") || d.state === "unknown")
                        unresolvedDestinationIds.push(d.id);
                    else if (["draft", "scheduled", "queued", "failed", "processing", "publishing", "reconciling"].includes(d.state)) {
                        d.state = "cancelled";
                        await this.saveDestination(d);
                    }
                }
            return { ready: unresolvedDestinationIds.length === 0, unresolvedDestinationIds };
        });
    }
    /** After private storage deletion succeeds, remove this feature's private records and preserve the tombstone. */
    async finalizeDeletion(owner: Owner, projectId?: string) {
        await this.tx(async () => {
            const gate = await this.db.get("SELECT scope FROM publishing_admission WHERE owner_id=? AND scope=?", owner.id, projectId ?? "*");
            if (!gate)
                throw new PublishingError("DELETION_NOT_STARTED", "Start removal before clearing publishing records.", 409);
            const posts = await Promise.all((await this.db.all(projectId ? "SELECT id FROM publishing_posts WHERE owner_id=? AND project_id=?" : "SELECT id FROM publishing_posts WHERE owner_id=?", ...(projectId ? [owner.id, projectId] : [owner.id]))).map(async (r) => await this.post(owner, String(r.id))));
            if (posts.some((p) => p.destinations.some((d) => d.lease || d.activeOperation || d.state === "unknown" || (d.checkpoint.postId && d.state !== "published"))))
                throw new PublishingError("PUBLICATION_UNRESOLVED", "A publication still needs verification before removal.", 409);
            for (const p of posts) {
                for (const d of p.destinations)
                    await this.db.run("DELETE FROM publishing_operations WHERE destination_id=?", d.id);
                await this.db.run("DELETE FROM publishing_delivery WHERE post_id=?", p.id);
                await this.db.run("DELETE FROM publishing_destinations WHERE post_id=?", p.id);
                await this.db.run("DELETE FROM publishing_revisions WHERE post_id=?", p.id);
                await this.db.run("DELETE FROM publishing_posts WHERE id=?", p.id);
            }
            if (!projectId) {
                await this.db.run("DELETE FROM publishing_connections WHERE owner_id=?", owner.id);
                await this.db.run("DELETE FROM publishing_accounts WHERE owner_id=?", owner.id);
            }
        });
    }
}
