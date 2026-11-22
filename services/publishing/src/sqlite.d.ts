declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      get(...values: (string | number | null)[]): Record<string, unknown> | undefined;
      all(...values: (string | number | null)[]): Record<string, unknown>[];
      run(...values: (string | number | null)[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    };
    close(): void;
  }
}
