import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { SUPABASE_CA } from './supabase-ca.ts';

export class CloudDatabaseError extends Error {
  constructor(readonly code?: string) { super('The cloud database request could not be completed.'); this.name = 'CloudDatabaseError'; }
}
export type AsyncCompatible<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R | Promise<Awaited<R>> : T[K] };
const tables = ['jobs', 'job_events', 'job_resources', 'worker_heartbeats', 'publishing_accounts', 'publishing_connections', 'publishing_posts', 'publishing_revisions', 'publishing_destinations', 'publishing_operations', 'publishing_delivery', 'publishing_workers', 'publishing_admission'];
/** Internal fixed SQL only. Values always travel separately as parameters. */
export function postgresSql(sql: string) {
  let index = 0;
  let result = sql.replace(/\?/g, () => '$' + (++index));
  for (const table of tables) result = result.replace(new RegExp('(?<![.\\w])' + table + '(?![\\w])', 'g'), 'unfold.' + table);
  result = result.replace(/\browid\b/g, 'row_no');
  if (/^\s*INSERT OR IGNORE /i.test(result)) result = result.replace('INSERT OR IGNORE', 'INSERT') + ' ON CONFLICT DO NOTHING';
  return result;
}
/** A dedicated connection per transaction, scoped through AsyncLocalStorage. No process-wide mutable client. */
export class CloudDatabase {
  private pool: Pool;
  private current = new AsyncLocalStorage<PoolClient>();
  constructor(connectionString = process.env.UNFOLD_DATABASE_URL ?? '') {
    if (!connectionString) throw new CloudDatabaseError('CONFIG');
    let url: URL; try { url = new URL(connectionString); } catch { throw new CloudDatabaseError('CONFIG'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new CloudDatabaseError('CONFIG');
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (!local) for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
    const max = Number(process.env.UNFOLD_DATABASE_POOL_SIZE ?? 1);
    if (!Number.isInteger(max) || max < 1 || max > 5) throw new CloudDatabaseError('CONFIG');
    const supabase = url.hostname.endsWith('.pooler.supabase.com') || url.hostname.endsWith('.supabase.co');
    this.pool = new Pool({ connectionString: url.href, max, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 20_000, query_timeout: 15_000, ssl: local ? undefined : { rejectUnauthorized: true, ...(supabase ? { ca: SUPABASE_CA } : {}) } });
    this.pool.on('error', () => { /* Pool failures are surfaced by bounded queries; never log DSNs. */ });
  }
  async query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) {
    try { return await (this.current.getStore() ?? this.pool).query<T>(postgresSql(sql), values); }
    catch (error) { throw new CloudDatabaseError(error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined); }
  }
  async get(sql: string, ...values: unknown[]): Promise<Record<string, unknown> | undefined> { return (await this.query(sql, values)).rows[0]; }
  async all(sql: string, ...values: unknown[]): Promise<Record<string, unknown>[]> { return (await this.query(sql, values)).rows; }
  async run(sql: string, ...values: unknown[]) {
    const event = /^\s*INSERT INTO job_events\b/i.test(sql);
    const result = await this.query(sql + (event ? ' RETURNING id' : ''), values);
    return { changes: result.rowCount ?? 0, lastInsertRowid: event ? Number(result.rows[0].id) : 0 };
  }
  async transaction<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (this.current.getStore()) return work();
    let client: PoolClient;
    try { client = await this.pool.connect(); } catch { throw new CloudDatabaseError('CONNECTION'); }
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['unfold:' + key]);
      const result = await this.current.run(client, work);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async close() { await this.pool.end(); }
}
export const cloudEnabled = () => process.env.UNFOLD_BACKEND === 'supabase';
