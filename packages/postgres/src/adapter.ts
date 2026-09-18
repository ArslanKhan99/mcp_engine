/**
 * MCP Data Agent — @mcp-data-agent/postgres
 * Created by Arslan Habib
 *
 * ---------------------------------------------------------------------------
 * FILE: adapter.ts
 * PURPOSE:
 *   PostgreSQL implementation of DatabaseAdapter. Responsibilities:
 *     1) Inspect information_schema → normalized DatabaseSchema
 *     2) Run validated read-only queries inside a READ ONLY transaction
 *     3) Set session GUCs (app.tenant_id, app.user_id) for Postgres RLS
 *
 * SECURITY:
 *   Prefer a read-only DB role. Enable RLS policies that read
 *   current_setting('app.tenant_id', true) so tenant isolation is enforced
 *   at the database layer, not only in application code.
 * ---------------------------------------------------------------------------
 */

import type {
  ColumnDataType,
  DatabaseAdapter,
  DatabaseSchema,
  QueryRequest,
  QueryResult,
  RequestContext,
  TableSchema,
} from "@mcp-data-agent/core";
import {
  ConfigurationError,
  getTenantColumn,
  TenantIsolationError,
} from "@mcp-data-agent/core";
import pg from "pg";

const { Pool } = pg;

/** Configuration for createPostgresAdapter / PostgresAdapter. */
export interface PostgresAdapterOptions {
  /** Connection string. Prefer env vars (DATABASE_URL) in production. */
  connectionString?: string;
  /** Reuse an existing pg Pool owned by the host app. */
  pool?: pg.Pool;
  /** Passed to `new Pool(...)` when connectionString is not set. */
  poolConfig?: pg.PoolConfig;
  /** Schemas to inspect. Default: ["public"]. */
  schemas?: string[];
  /**
   * When true (default), require tenant context and set app.tenant_id /
   * app.user_id session variables for RLS policies.
   */
  enforceTenant?: boolean;
}

/**
 * Maps PostgreSQL udt_name values to the framework's normalized ColumnDataType.
 * Keeps AI-facing schema DB-agnostic.
 */
function mapDataType(udtName: string): ColumnDataType {
  switch (udtName) {
    case "int2":
    case "int4":
    case "int8":
    case "numeric":
    case "float4":
    case "float8":
    case "money":
      return "number";
    case "bool":
      return "boolean";
    case "date":
      return "date";
    case "timestamp":
    case "timestamptz":
    case "time":
    case "timetz":
      return "datetime";
    case "json":
    case "jsonb":
      return "json";
    case "bytea":
      return "binary";
    case "text":
    case "varchar":
    case "bpchar":
    case "uuid":
    case "citext":
      return "string";
    default:
      return "unknown";
  }
}

/**
 * PostgreSQL DatabaseAdapter.
 * Implements getSchema() and query() for @mcp-data-agent/core.
 */
export class PostgresAdapter implements DatabaseAdapter {
  readonly name = "postgres";
  private readonly pool: pg.Pool;
  private readonly schemas: string[];
  private readonly enforceTenant: boolean;
  /** True when this adapter created the pool and must close it. */
  private readonly ownsPool: boolean;

  constructor(options: PostgresAdapterOptions = {}) {
    // Prefer an injected pool (host apps often share one across services)
    if (options.pool) {
      this.pool = options.pool;
      this.ownsPool = false;
    } else if (options.connectionString || options.poolConfig) {
      this.pool = new Pool(
        options.connectionString
          ? { connectionString: options.connectionString }
          : options.poolConfig,
      );
      this.ownsPool = true;
    } else {
      throw new ConfigurationError(
        "PostgresAdapter requires connectionString, poolConfig, or an existing pool",
      );
    }
    this.schemas = options.schemas ?? ["public"];
    this.enforceTenant = options.enforceTenant ?? true;
  }

  /**
   * Reads tables, columns, primary keys, and foreign keys from
   * information_schema and returns a normalized DatabaseSchema.
   */
  async getSchema(): Promise<DatabaseSchema> {
    const client = await this.pool.connect();
    try {
      // --- Base tables in configured schemas ---
      const tablesResult = await client.query<{
        table_schema: string;
        table_name: string;
      }>(
        `
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema = ANY($1::text[])
        ORDER BY table_schema, table_name
        `,
        [this.schemas],
      );

      // --- Columns with native Postgres types ---
      const columnsResult = await client.query<{
        table_schema: string;
        table_name: string;
        column_name: string;
        is_nullable: string;
        udt_name: string;
        ordinal_position: number;
      }>(
        `
        SELECT table_schema, table_name, column_name, is_nullable, udt_name, ordinal_position
        FROM information_schema.columns
        WHERE table_schema = ANY($1::text[])
        ORDER BY table_schema, table_name, ordinal_position
        `,
        [this.schemas],
      );

      // --- Primary key columns ---
      const pkResult = await client.query<{
        table_schema: string;
        table_name: string;
        column_name: string;
      }>(
        `
        SELECT tc.table_schema, tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = ANY($1::text[])
        `,
        [this.schemas],
      );

      // --- Foreign key relationships ---
      const fkResult = await client.query<{
        table_schema: string;
        table_name: string;
        column_name: string;
        foreign_table_name: string;
        foreign_column_name: string;
      }>(
        `
        SELECT
          tc.table_schema,
          tc.table_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = ANY($1::text[])
        `,
        [this.schemas],
      );

      // Index PK/FK for fast lookup while assembling ColumnSchema objects
      const pkSet = new Set(
        pkResult.rows.map(
          (r) => `${r.table_schema}.${r.table_name}.${r.column_name}`,
        ),
      );
      const fkMap = new Map(
        fkResult.rows.map((r) => [
          `${r.table_schema}.${r.table_name}.${r.column_name}`,
          { table: r.foreign_table_name, column: r.foreign_column_name },
        ]),
      );

      // Group columns by table
      const columnsByTable = new Map<string, TableSchema["columns"]>();
      for (const col of columnsResult.rows) {
        const key = `${col.table_schema}.${col.table_name}`;
        const list = columnsByTable.get(key) ?? [];
        const full = `${col.table_schema}.${col.table_name}.${col.column_name}`;
        const fk = fkMap.get(full);
        list.push({
          name: col.column_name,
          dataType: mapDataType(col.udt_name),
          nativeType: col.udt_name,
          nullable: col.is_nullable === "YES",
          isPrimaryKey: pkSet.has(full),
          isForeignKey: Boolean(fk),
          ...(fk ? { references: fk } : {}),
        });
        columnsByTable.set(key, list);
      }

      const tables: TableSchema[] = tablesResult.rows.map((t) => {
        const key = `${t.table_schema}.${t.table_name}`;
        const columns = columnsByTable.get(key) ?? [];
        const primaryKey = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
        return {
          name: t.table_name,
          schema: t.table_schema,
          columns,
          ...(primaryKey.length ? { primaryKey } : {}),
        };
      });

      return {
        dialect: "postgresql",
        inspectedAt: new Date().toISOString(),
        tables,
      };
    } finally {
      // Always return the client to the pool
      client.release();
    }
  }

  /**
   * Executes a (already validated) read-only query.
   * Opens BEGIN READ ONLY, sets tenant/user GUCs, applies statement_timeout,
   * runs the query with bound params, then commits.
   */
  async query(
    request: QueryRequest,
    context: RequestContext,
  ): Promise<QueryResult> {
    if (this.enforceTenant) {
      if (!context.tenant?.tenantId) {
        throw new TenantIsolationError();
      }
    }

    const client = await this.pool.connect();
    const started = Date.now();
    try {
      // READ ONLY transaction: DB rejects writes even if SQL slipped through
      await client.query("BEGIN READ ONLY");

      if (this.enforceTenant) {
        // Local-to-transaction GUCs for RLS:
        //   current_setting('app.tenant_id', true)
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          context.tenant.tenantId,
        ]);
        await client.query(`SELECT set_config('app.user_id', $1, true)`, [
          context.auth.userId,
        ]);
      }

      if (request.timeoutMs) {
        await client.query(`SET LOCAL statement_timeout = $1`, [
          request.timeoutMs,
        ]);
      }

      // Always use bound parameters — never interpolate AI text into SQL
      const result = await client.query(request.sql, request.params ?? []);
      await client.query("COMMIT");

      // Apply row limit in memory as a second safety net
      const limit = request.limit ?? result.rowCount ?? 0;
      const rows = result.rows.slice(0, limit).map((row) => {
        const record: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
          record[key] = value;
        }
        return record;
      });

      return {
        columns: result.fields.map((f) => ({
          name: f.name,
          dataType: "unknown" as const,
        })),
        rows,
        rowCount: rows.length,
        truncated: (result.rowCount ?? 0) > rows.length,
        executionMs: Date.now() - started,
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback errors; rethrow the original failure
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /** Closes the pool only if this adapter created it. */
  async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }
}

/** Convenience factory: createPostgresAdapter({ connectionString }). */
export function createPostgresAdapter(
  options: PostgresAdapterOptions,
): PostgresAdapter {
  return new PostgresAdapter(options);
}

/** Re-export for host apps writing RLS policies. */
export { getTenantColumn };
