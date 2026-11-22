import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export type Owner = { id: string; dev?: boolean };
export type AssetRole = "primary" | "supporting" | "reference";
export type PrivateAsset = {
  assetId: string; videoId: string; projectId: string; primaryVideoId: string;
  role: AssetRole; description: string; filename: string; extension: string;
  status: "uploaded" | "analyzed"; createdAt: number;
};
export type Project = {
  version: 1; id: string; ownerId: string; title: string; createdAt: number; updatedAt: number;
  state: "active" | "deleting"; assets: Record<string, PrivateAsset>;
  plans: string[]; styles: string[]; exports: string[]; jobs: string[];
  leases: Record<string, { purpose: string; pid: number; expiresAt: number; tokenHash?: string; paths?: string[]; grantExpiresAt?: number }>;
};
export class StorageError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export class RevisionConflict extends StorageError {
  constructor(public currentRevision: number) { super(409, "This edit changed elsewhere. Reload before saving."); }
}
export const validId = (id: string) => /^[A-Za-z0-9_-]{1,100}$/.test(id);
function id(value: string) {
  if (!validId(value)) throw new StorageError(404, "Not found.");
  return value;
}
const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== "ESRCH"; }
};
const missing = () => new StorageError(404, "Not found.");

/** Persistent-volume implementation. Ownerless legacy files are deliberately outside this namespace. */
export class PrivateStorage {
  constructor(readonly root: string) {}
  projectDir(projectId: string) { return path.join(this.root, "projects", id(projectId)); }
  private manifestPath(projectId: string) { return path.join(this.projectDir(projectId), "project.json"); }
  private refPath(kind: string, resourceId: string) { return path.join(this.root, "refs", kind, `${id(resourceId)}.json`); }

  private async atomic(file: string, value: unknown) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
    finally { await handle.close(); }
    try {
      await rename(temporary, file);
      const directory = await open(path.dirname(file), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await rm(temporary, { force: true }); }
  }

  private async read<T>(file: string): Promise<T | null> {
    try { return JSON.parse(await readFile(file, "utf8")) as T; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  }

  private async locked<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    const lock = path.join(this.root, "locks", id(projectId));
    await mkdir(path.dirname(lock), { recursive: true, mode: 0o700 });
    const deadline = Date.now() + 10_000;
    for (;;) {
      try { await mkdir(lock, { mode: 0o700 }); break; }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        const owner = await this.read<{ pid: number }>(path.join(lock, "owner.json"));
        if (owner && !alive(owner.pid)) {
          // Only one reaper may remove a dead owner's lock. Re-read after acquiring it.
          const reaper = await open(`${lock}.reaper`, "wx", 0o600).catch((error: NodeJS.ErrnoException) => { if (error.code === "EEXIST") return null; throw error; });
          if (reaper) {
            try {
              const current = await this.read<{ pid: number }>(path.join(lock, "owner.json"));
              if (current && !alive(current.pid)) await rm(lock, { recursive: true, force: true });
            } finally { await reaper.close(); await rm(`${lock}.reaper`, { force: true }); }
          } else {
            if (Date.now() > deadline) throw new StorageError(409, "The project is busy. Try again shortly.");
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          continue;
        }
        const info = !owner ? await stat(lock).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; }) : null;
        if (!owner && !info) continue;
        if (Date.now() > deadline) throw new StorageError(409, "The project is busy. Try again shortly.");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    try { await this.atomic(path.join(lock, "owner.json"), { pid: process.pid }); return await work(); }
    finally { await rm(lock, { recursive: true, force: true }); }
  }

  async getProject(owner: Owner, projectId: string): Promise<Project> {
    const project = await this.read<Project>(this.manifestPath(projectId));
    if (!project || project.ownerId !== owner.id || project.state !== "active") throw missing();
    return project;
  }

  async listProjects(owner: Owner): Promise<Project[]> {
    const names = await readdir(path.join(this.root, "projects")).catch(() => []);
    const projects = await Promise.all(names.filter(validId).map((name) => this.getProject(owner, name).catch(() => null)));
    return projects.filter((project): project is Project => !!project).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async createProject(owner: Owner, projectId: string, title: string) {
    return this.locked(projectId, async () => {
      if (await this.read(this.manifestPath(projectId))) throw new StorageError(409, "Project already exists.");
      const now = Date.now();
      const project: Project = { version: 1, id: projectId, ownerId: owner.id, title: title.slice(0, 200), createdAt: now, updatedAt: now, state: "active", assets: {}, plans: [], styles: [], exports: [], jobs: [], leases: {} };
      await this.atomic(this.manifestPath(projectId), project);
      return project;
    });
  }

  private async mutate<T>(owner: Owner, projectId: string, change: (project: Project) => Promise<T> | T): Promise<T> {
    return this.locked(projectId, async () => {
      const project = await this.getProject(owner, projectId);
      const result = await change(project);
      project.updatedAt = Date.now();
      await this.atomic(this.manifestPath(projectId), project);
      return result;
    });
  }

  async addAsset(owner: Owner, projectId: string, asset: PrivateAsset) {
    return this.mutate(owner, projectId, async (project) => {
      if (asset.projectId !== project.id || asset.primaryVideoId !== project.id || asset.videoId !== asset.assetId) throw new StorageError(400, "Invalid asset association.");
      id(asset.assetId);
      if (asset.role === "supporting" && Object.values(project.assets).filter((item) => item.role === "supporting").length >= 4) throw new StorageError(409, "Remove an unused supporting video before adding another.");
      if (!/^\.[a-z0-9]{1,8}$/.test(asset.extension)) throw new StorageError(400, "Invalid media extension.");
      if (await this.read(this.refPath("assets", asset.assetId))) throw new StorageError(409, "Asset already exists.");
      project.assets[asset.assetId] = asset;
      await this.atomic(this.refPath("assets", asset.assetId), { projectId, ownerId: owner.id });
      return asset;
    });
  }

  async getAsset(owner: Owner, assetId: string): Promise<PrivateAsset> {
    const ref = await this.read<{ projectId: string; ownerId: string }>(this.refPath("assets", assetId));
    if (!ref || ref.ownerId !== owner.id) throw missing();
    const project = await this.getProject(owner, ref.projectId);
    const asset = project.assets[assetId];
    if (!asset) throw missing();
    return asset;
  }

  async updateAsset(owner: Owner, projectId: string, assetId: string, change: { description?: string; status?: PrivateAsset["status"] }) {
    return this.mutate(owner, projectId, (project) => {
      const asset = project.assets[id(assetId)];
      if (!asset) throw missing();
      if (change.description !== undefined) asset.description = change.description.slice(0, 500);
      if (change.status) asset.status = change.status;
      return asset;
    });
  }

  async deleteAsset(owner: Owner, projectId: string, assetId: string) {
    return this.locked(projectId, async () => {
      const project = await this.getProject(owner, projectId);
      const asset = project.assets[id(assetId)];
      if (!asset || asset.role !== "supporting") throw missing();
      if (project.jobs.length || Object.values(project.leases).some((lease) => lease.expiresAt > Date.now() || alive(lease.pid))) throw new StorageError(409, "Stop project work before removing footage.");
      for (const planId of project.plans) {
        const record = await this.read<{ editPlan?: { supporting?: { videoId: string }[] } }>(path.join(this.projectDir(projectId), "plans", `${id(planId)}.json`));
        if (record?.editPlan?.supporting?.some((item) => item.videoId === assetId)) throw new StorageError(409, "This footage is used by a saved edit. Keep it or delete the project.");
      }
      delete project.assets[assetId];
      project.updatedAt = Date.now();
      await this.atomic(this.manifestPath(projectId), project);
      await rm(this.refPath("assets", assetId), { force: true });
      await rm(path.join(this.projectDir(projectId), "uploads", `${assetId}${asset.extension}`), { force: true });
      await rm(path.join(this.projectDir(projectId), "media", assetId), { recursive: true, force: true });
      return { deleted: true, assetId };
    });
  }

  async assetPaths(owner: Owner, assetId: string) {
    const asset = await this.getAsset(owner, assetId);
    const base = this.projectDir(asset.projectId);
    return { asset, upload: path.join(base, "uploads", `${asset.assetId}${asset.extension}`), mediaDir: path.join(base, "media"), urlPrefix: `/media/${asset.projectId}` };
  }

  async putRecord<T>(owner: Owner, projectId: string, kind: "plans" | "styles", resourceId: string, value: T) {
    return this.mutate(owner, projectId, async (project) => {
      const existing = await this.read<{ projectId: string; ownerId: string }>(this.refPath(kind, resourceId));
      if (existing && (existing.projectId !== projectId || existing.ownerId !== owner.id)) throw missing();
      await this.atomic(path.join(this.projectDir(projectId), kind, `${id(resourceId)}.json`), value);
      await this.atomic(this.refPath(kind, resourceId), { projectId, ownerId: owner.id });
      if (!project[kind].includes(resourceId)) project[kind].push(resourceId);
      return value;
    });
  }

  async getRecord<T>(owner: Owner, kind: "plans" | "styles", resourceId: string): Promise<{ project: Project; value: T }> {
    const ref = await this.read<{ projectId: string; ownerId: string }>(this.refPath(kind, resourceId));
    if (!ref || ref.ownerId !== owner.id) throw missing();
    const project = await this.getProject(owner, ref.projectId);
    if (!project[kind].includes(resourceId)) throw missing();
    const value = await this.read<T>(path.join(this.projectDir(project.id), kind, `${id(resourceId)}.json`));
    if (!value) throw missing();
    return { project, value };
  }

  async reviseRecord<T extends { revision: number; updatedAt: number }>(owner: Owner, projectId: string, resourceId: string, revision: number, change: (current: T) => Promise<T>) {
    return this.mutate(owner, projectId, async (project) => {
      if (!project.plans.includes(resourceId)) throw missing();
      const file = path.join(this.projectDir(projectId), "plans", `${id(resourceId)}.json`);
      const current = await this.read<T>(file);
      if (!current) throw missing();
      if (current.revision !== revision) throw new RevisionConflict(current.revision);
      const updated = { ...await change(current), revision: revision + 1, updatedAt: Date.now() };
      await this.atomic(file, updated);
      return updated;
    });
  }

  async registerReference(owner: Owner, projectId: string, kind: "exports" | "jobs", resourceId: string) {
    if (kind === "exports") {
      if (resourceId.length > 250 || !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(mp4|json|png|jpg)$/.test(resourceId)) throw new StorageError(400, "Invalid export reference.");
    } else id(resourceId);
    await this.mutate(owner, projectId, (project) => { if (!project[kind].includes(resourceId)) project[kind].push(resourceId); });
  }

  async unregisterJob(owner: Owner, projectId: string, jobId: string) {
    id(jobId);
    await this.mutate(owner, projectId, (project) => { project.jobs = project.jobs.filter((value) => value !== jobId); });
  }

  /** Caller supplies a server-validated snapshot, never a credential or capability-bearing plan. */
  async putJobInput<T>(owner: Owner, projectId: string, snapshotId: string, value: T) {
    return this.mutate(owner, projectId, async () => {
      const file = path.join(this.projectDir(projectId), "job-inputs", `${id(snapshotId)}.json`);
      const revision = createHash("sha256").update(JSON.stringify(value)).digest("hex");
      const existing = await this.read<{ value: T; revision: string }>(file);
      if (existing && existing.revision !== revision) throw new StorageError(409, "Job snapshots are immutable.");
      if (!existing) await this.atomic(file, { value, revision });
      return { id: snapshotId, revision };
    });
  }

  async getJobInput<T>(owner: Owner, projectId: string, snapshotId: string, revision?: string): Promise<T> {
    await this.getProject(owner, projectId);
    const record = await this.read<{ value: T; revision: string }>(path.join(this.projectDir(projectId), "job-inputs", `${id(snapshotId)}.json`));
    if (!record) throw missing();
    if ((revision && revision !== record.revision) || createHash("sha256").update(JSON.stringify(record.value)).digest("hex") !== record.revision) throw new StorageError(409, "Job snapshot revision changed.");
    return record.value;
  }

  async deleteJobInput(owner: Owner, projectId: string, snapshotId: string) {
    return this.mutate(owner, projectId, async (project) => {
      if (project.jobs.length) throw new StorageError(409, "Release project jobs before removing snapshots.");
      await rm(path.join(this.projectDir(projectId), "job-inputs", `${id(snapshotId)}.json`), { force: true });
    });
  }

  async acquireLease(owner: Owner, projectId: string, purpose: string) {
    const leaseId = randomUUID();
    const refresh = () => this.mutate(owner, projectId, (project) => {
      project.leases[leaseId] = { ...project.leases[leaseId], purpose, pid: process.pid, expiresAt: Date.now() + 120_000 };
    });
    await refresh();
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 30_000);
    timer.unref();
    const release = async () => {
      clearInterval(timer);
      await this.mutate(owner, projectId, (project) => { delete project.leases[leaseId]; });
    };
    return Object.assign(release, { leaseId });
  }

  async createRenderAccess(owner: Owner, projectId: string, paths: string[], lifetimeMs = 30 * 60_000) {
    for (const url of paths) {
      if (!url.startsWith(`/media/${projectId}/`) || url.includes("?") || url.includes("#")) throw missing();
      await this.mediaPath(owner, url.slice("/media/".length).split("/"));
    }
    if (!(lifetimeMs > 0 && lifetimeMs <= 30 * 60_000)) throw new StorageError(400, "Invalid render access lifetime.");
    const release = await this.acquireLease(owner, projectId, "render");
    const secret = randomBytes(32).toString("hex");
    try {
      await this.mutate(owner, projectId, (project) => {
        Object.assign(project.leases[release.leaseId], { tokenHash: createHash("sha256").update(secret).digest("hex"), paths: [...new Set(paths)], grantExpiresAt: Date.now() + lifetimeMs });
      });
    } catch (error) { await release(); throw error; }
    return { token: `${release.leaseId}.${secret}`, release };
  }

  async renderMediaPath(parts: string[], token: string) {
    if (parts.length < 3 || token.length > 150) throw missing();
    const [leaseId, secret] = token.split(".");
    const project = await this.read<Project>(this.manifestPath(parts[0]));
    const lease = project?.leases[leaseId];
    const hash = createHash("sha256").update(secret ?? "").digest();
    const expected = Buffer.from(lease?.tokenHash ?? "", "hex");
    if (!project || project.state !== "active" || !lease || lease.purpose !== "render" || !lease.grantExpiresAt || lease.grantExpiresAt < Date.now() || lease.expiresAt < Date.now() || expected.length !== hash.length || !timingSafeEqual(expected, hash) || !lease.paths?.includes(`/media/${parts.join("/")}`)) throw missing();
    return this.mediaPath({ id: project.ownerId }, parts);
  }

  async deleteProject(owner: Owner, projectId: string, stopJobs?: (jobIds: string[]) => Promise<void>) {
    const snapshot = await this.getProject(owner, projectId);
    if (snapshot.jobs.length) {
      if (!stopJobs) throw new StorageError(409, "Cancel project jobs before deleting it.");
      await stopJobs([...snapshot.jobs]);
    }
    return this.locked(projectId, async () => {
      const project = await this.getProject(owner, projectId);
      if (Object.values(project.leases).some((lease) => lease.expiresAt > Date.now() || alive(lease.pid))) throw new StorageError(409, "Stop active project work before deleting it.");
      if (project.jobs.some((jobId) => !snapshot.jobs.includes(jobId)) || (project.jobs.length && !stopJobs)) throw new StorageError(409, "Cancel project jobs before deleting it.");
      project.state = "deleting";
      await this.atomic(this.manifestPath(projectId), project);
      const trash = path.join(this.root, "trash", `${id(projectId)}-${randomUUID()}`);
      await mkdir(path.dirname(trash), { recursive: true, mode: 0o700 });
      await rename(this.projectDir(projectId), trash);
      for (const [kind, names] of [["assets", Object.keys(project.assets)], ["plans", project.plans], ["styles", project.styles]] as const) {
        for (const name of names) await rm(this.refPath(kind, name), { force: true });
      }
      await rm(trash, { recursive: true, force: true });
      return { deleted: true, projectId, jobIds: project.jobs };
    });
  }

  async mediaPath(owner: Owner, parts: string[]) {
    if (parts.length < 3 || parts.some((part) => !part || part === "." || part === ".." || part.includes("\\") || part.includes("/") || part.includes("\0"))) throw missing();
    const [projectId, resourceId, ...rest] = parts;
    const project = await this.getProject(owner, projectId);
    if (resourceId === "exports") {
      if (!project.exports.includes(rest.join("/"))) throw missing();
    } else if (!project.assets[resourceId]) throw missing();
    const base = path.join(this.projectDir(projectId), "media");
    const file = path.resolve(base, resourceId, ...rest);
    const canonical = await realpath(file).catch(() => null);
    const root = await realpath(base).catch(() => null);
    if (!canonical || !root || !canonical.startsWith(root + path.sep)) throw missing();
    return canonical;
  }
}
