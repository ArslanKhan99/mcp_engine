/**
 * MCP Data Agent — @mcp-data-agent/core
 * Created by Arslan Habib
 *
 * ---------------------------------------------------------------------------
 * FILE: types.ts
 * PURPOSE:
 *   Shared TypeScript contracts for the whole framework. Every package
 *   (postgres, mcp, host apps) depends on these shapes so adapters, tools,
 *   and the agent speak the same language.
 *
 * WHAT LIVES HERE:
 *   - Auth / tenant / request context (who is calling, which tenant)
 *   - Database schema + query request/result types
 *   - DatabaseAdapter interface (what every DB driver must implement)
 *   - Tool definitions, audit events, entities, agent options
 *
 * SECURITY NOTES:
 *   - AuthContext and TenantContext must come from the host session.
 *   - Never populate tenantId from AI/tool arguments.
 * ---------------------------------------------------------------------------
 */

/** Permission string, e.g. "members.read" or "database.query". */
export type Permission = string;

/**
 * Who is authenticated for this request.
 * Provided by the host application after it verifies the user session.
 */
export interface AuthContext {
  /** Authenticated application user id — never trust AI-supplied values. */
  userId: string;
  /** Optional display name for audit logs. */
  displayName?: string;
  /** Roles assigned by the host application. */
  roles?: string[];
  /** Effective permission set for this session. */
  permissions: Permission[];
  /** Opaque session identifier from the host app. */
  sessionId?: string;
  /** Additional host-app claims (non-sensitive). */
  claims?: Record<string, string | number | boolean>;
}

/**
 * Which SaaS tenant this request belongs to.
 * Must be derived from the authenticated session — never from the LLM.
 */
export interface TenantContext {
  /** Tenant id derived from the authenticated session — never from AI params. */
  tenantId: string;
  /** Column used for tenant isolation (default: tenant_id). */
  tenantColumn?: string;
}

/**
 * Full per-request context passed into tools and adapters.
 * Combines identity (auth) + tenancy + optional question/correlation ids.
 */
export interface RequestContext {
  auth: AuthContext;
  tenant: TenantContext;
  /** Correlation id for audit trails. */
  requestId?: string;
  /** Original natural-language question when available. */
  question?: string;
}

/** Normalized column types exposed to AI-facing schema (DB-agnostic). */
export type ColumnDataType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "json"
  | "binary"
  | "unknown";

/** One column in a table schema returned by an adapter. */
export interface ColumnSchema {
  name: string;
  dataType: ColumnDataType;
  /** Original DB type name (e.g. "timestamptz", "varchar"). */
  nativeType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  /** Present when this column references another table. */
  references?: {
    table: string;
    column: string;
  };
  description?: string;
  /** When true, field is withheld from AI-facing schema/tools. */
  sensitive?: boolean;
}

/** One table (or collection) in the inspected database schema. */
export interface TableSchema {
  name: string;
  /** DB schema/namespace, e.g. "public" in PostgreSQL. */
  schema?: string;
  columns: ColumnSchema[];
  description?: string;
  primaryKey?: string[];
}

/** Full schema snapshot returned by DatabaseAdapter.getSchema(). */
export interface DatabaseSchema {
  tables: TableSchema[];
  /** e.g. "postgresql", "mysql". */
  dialect: string;
  /** ISO timestamp of when the schema was inspected. */
  inspectedAt: string;
}

/** Phase 1 only allows read (SELECT) operations by default. */
export type QueryOperation = "select";

/**
 * A query the agent asks an adapter to run.
 * SQL must already be validated as read-only before reaching the adapter.
 */
export interface QueryRequest {
  /** Validated SQL (or dialect query) — must be read-only by default. */
  sql: string;
  /** Bound parameters — never interpolate user/AI text into SQL. */
  params?: unknown[];
  /** Max rows returned to the caller. */
  limit?: number;
  /** Query timeout in milliseconds. */
  timeoutMs?: number;
}

export interface QueryResultColumn {
  name: string;
  dataType: ColumnDataType;
}

/** Structured result returned to tools / MCP / the LLM. */
export interface QueryResult {
  columns: QueryResultColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  /** True if more rows existed than we returned (limit applied). */
  truncated: boolean;
  executionMs?: number;
}

/**
 * DatabaseAdapter — pluggable DB driver contract.
 * Postgres/MySQL/MongoDB adapters all implement this so the core stays
 * database-agnostic.
 */
export interface DatabaseAdapter {
  readonly name: string;
  getSchema(options?: { includeSensitive?: boolean }): Promise<DatabaseSchema>;
  query(request: QueryRequest, context: RequestContext): Promise<QueryResult>;
  /** Optional cleanup (e.g. close connection pool). */
  close?(): Promise<void>;
}

/**
 * A named capability the AI can call (built-in or custom).
 * Each tool declares the permission required to run it.
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  /** Permission required to invoke this tool (e.g. database.query). */
  permission: Permission;
  /** Whether the tool may mutate data. Default false. */
  mutates?: boolean;
  /** Optional JSON-Schema-like description of inputs. */
  inputSchema?: Record<string, unknown>;
  handler: (input: TInput, context: RequestContext) => Promise<TOutput>;
}

/**
 * One audit-log entry for an AI tool invocation.
 * Never put passwords, tokens, or connection strings in these fields.
 */
export interface AuditEvent {
  timestamp: string;
  requestId?: string;
  userId: string;
  tenantId: string;
  question?: string;
  tool: string;
  parameters?: unknown;
  status: "success" | "denied" | "error";
  errorMessage?: string;
  resultMeta?: {
    rowCount?: number;
    truncated?: boolean;
    executionMs?: number;
  };
}

/** Host-provided callback that receives audit events. */
export type AuditLogger = (event: AuditEvent) => void | Promise<void>;

/**
 * Business meaning for a table — helps the AI understand domain language
 * (e.g. "Member" maps to table "members").
 */
export interface EntityDefinition {
  name: string;
  table: string;
  description?: string;
  schema?: string;
  relationships?: Array<{
    name: string;
    entity: string;
    type: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
  }>;
}

/** Marks a column that must never be shown to AI tools. */
export interface ProtectFieldOptions {
  table: string;
  column: string;
  schema?: string;
  reason?: string;
}

/**
 * Options passed to createMCPDataAgent().
 * This is the main configuration surface for host applications.
 */
export interface AgentOptions {
  database: DatabaseAdapter;
  /**
   * Resolve auth + tenant for each request.
   * Tenant MUST come from the authenticated session, never from AI parameters.
   */
  resolveContext: () => Promise<RequestContext> | RequestContext;
  /** Default max rows for analytical queries. */
  defaultLimit?: number;
  /** Default query timeout in ms. */
  defaultTimeoutMs?: number;
  /** Fields that must never be exposed to AI tools. */
  protectedFields?: ProtectFieldOptions[];
  /** Optional audit sink. Secrets must never be logged. */
  audit?: AuditLogger;
  /** Allow write tools only when explicitly enabled. Default false. */
  allowMutations?: boolean;
}
