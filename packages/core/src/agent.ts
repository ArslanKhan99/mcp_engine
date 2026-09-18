/**
 * MCP Data Agent — @mcp-data-agent/core
 * Created by Arslan Habib
 *
 * ---------------------------------------------------------------------------
 * FILE: agent.ts
 * PURPOSE:
 *   The main runtime. createMCPDataAgent() builds an MCPDataAgent that:
 *     1) Resolves auth + tenant from the host app
 *     2) Checks permissions
 *     3) Runs built-in or custom tools
 *     4) Validates SQL / redacts sensitive data
 *     5) Emits audit events
 *
 * PUBLIC API (host apps typically use):
 *   createMCPDataAgent(options)
 *   agent.registerTool(...)
 *   agent.defineEntity(...)
 *   agent.protectField(...)
 *   agent.invokeTool(name, input)
 *
 * This file is the "brain" of the framework; adapters and MCP are plugs.
 * ---------------------------------------------------------------------------
 */

import { AuthenticationError, ConfigurationError, McpDataAgentError } from "./errors.js";
import { assertPermission, Permissions } from "./permissions.js";
import {
  ensureLimit,
  validateReadOnlyQuery,
} from "./query-safety.js";
import {
  buildProtectedFieldSet,
  markSensitiveColumns,
  redactResultRows,
  redactSchemaForAi,
} from "./schema-safety.js";
import { assertTenantContext, rejectTenantOverride } from "./tenant.js";
import { ToolRegistry } from "./tool-registry.js";
import type {
  AgentOptions,
  AuditEvent,
  DatabaseSchema,
  EntityDefinition,
  ProtectFieldOptions,
  QueryResult,
  RequestContext,
  ToolDefinition,
} from "./types.js";

/**
 * Central agent instance.
 * Holds the DB adapter, tool registry, entities, and protected-field set.
 */
export class MCPDataAgent {
  private readonly options: AgentOptions;
  /** Registry of built-in + custom tools. */
  private readonly tools = new ToolRegistry();
  /** Columns that must never reach the AI (schema.table.column keys). */
  private readonly protectedFields: Set<string>;
  /** Business entities defined by the host app. */
  private readonly entities = new Map<string, EntityDefinition>();
  /** Cached sensitive column names used when redacting query rows. */
  private sensitiveColumnNames = new Set<string>();

  constructor(options: AgentOptions) {
    // --- Validate required wiring from the host application ---
    if (!options.database) {
      throw new ConfigurationError("database adapter is required");
    }
    if (!options.resolveContext) {
      throw new ConfigurationError("resolveContext is required");
    }

    // Secure defaults: small result sets, short timeouts, no writes
    this.options = {
      defaultLimit: 100,
      defaultTimeoutMs: 10_000,
      allowMutations: false,
      ...options,
    };
    this.protectedFields = buildProtectedFieldSet(options.protectedFields ?? []);
    this.registerBuiltInTools();
  }

  /** Register a custom domain tool (e.g. members.search). Chainable. */
  registerTool<TInput = unknown, TOutput = unknown>(
    tool: ToolDefinition<TInput, TOutput>,
  ): this {
    if (tool.mutates && !this.options.allowMutations) {
      throw new ConfigurationError(
        "Mutating tools are disabled. Set allowMutations: true to enable explicit write tools.",
      );
    }
    this.tools.register(tool);
    return this;
  }

  /** Attach business meaning to a table so the AI understands domain terms. */
  defineEntity(entity: EntityDefinition): this {
    if (!entity.name || !entity.table) {
      throw new ConfigurationError("Entity name and table are required");
    }
    this.entities.set(entity.name, entity);
    return this;
  }

  /** Explicitly mark a column as sensitive (in addition to name heuristics). */
  protectField(field: ProtectFieldOptions): this {
    this.protectedFields.add(
      `${field.schema ?? "public"}.${field.table}.${field.column}`.toLowerCase(),
    );
    return this;
  }

  /** List all tools (used by MCP bridge to expose custom tools). */
  listTools(): ToolDefinition[] {
    return this.tools.list();
  }

  /** List defined business entities. */
  listEntities(): EntityDefinition[] {
    return [...this.entities.values()];
  }

  /**
   * Resolve and validate the current request context.
   * Ensures userId exists and tenantId is valid.
   */
  async getContext(): Promise<RequestContext> {
    const context = await this.options.resolveContext();
    if (!context.auth?.userId) {
      throw new AuthenticationError();
    }
    assertTenantContext(context.tenant);
    return context;
  }

  /**
   * Invoke a tool by name with optional input.
   * Pipeline: resolve context → permission check → reject tenant override
   * → run handler → audit success/failure.
   */
  async invokeTool<TOutput = unknown>(
    name: string,
    input: unknown = {},
  ): Promise<TOutput> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ConfigurationError(`Unknown tool: ${name}`);
    }

    const context = await this.getContext();
    const started = Date.now();

    try {
      // RBAC: user must have the tool's declared permission
      assertPermission(context.auth, tool.permission);

      // Multi-tenant: block AI from passing tenantId in args
      if (input && typeof input === "object" && !Array.isArray(input)) {
        rejectTenantOverride(input as Record<string, unknown>);
      }

      const result = (await tool.handler(input, context)) as TOutput;
      const resultMeta = extractResultMeta(result, Date.now() - started);

      // Audit successful invocation (no secrets — params are sanitized)
      await this.audit({
        timestamp: new Date().toISOString(),
        userId: context.auth.userId,
        tenantId: context.tenant.tenantId,
        tool: name,
        parameters: sanitizeParams(input),
        status: "success",
        resultMeta,
        ...(context.requestId !== undefined
          ? { requestId: context.requestId }
          : {}),
        ...(context.question !== undefined
          ? { question: context.question }
          : {}),
      });
      return result;
    } catch (error) {
      // Distinguish permission denial from other failures in the audit log
      const status =
        error instanceof McpDataAgentError && error.code === "AUTHORIZATION_DENIED"
          ? "denied"
          : "error";
      await this.audit({
        timestamp: new Date().toISOString(),
        userId: context.auth.userId,
        tenantId: context.tenant.tenantId,
        tool: name,
        parameters: sanitizeParams(input),
        status,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        ...(context.requestId !== undefined
          ? { requestId: context.requestId }
          : {}),
        ...(context.question !== undefined
          ? { question: context.question }
          : {}),
      });
      throw error;
    }
  }

  /**
   * Registers Phase-1 built-in tools:
   *   - database.schema  → safe schema + entities for the AI
   *   - database.query   → validated read-only SELECT
   */
  private registerBuiltInTools(): void {
    this.tools.register({
      name: "database.schema",
      description:
        "Return a safe, redacted database schema for the authenticated tenant context.",
      permission: Permissions.DATABASE_SCHEMA,
      handler: async (_input, _context) => this.getSafeSchema(),
    });

    this.tools.register({
      name: "database.query",
      description:
        "Execute a validated read-only SQL SELECT against the application database with tenant isolation enforced by the host adapter.",
      permission: Permissions.DATABASE_QUERY,
      inputSchema: {
        type: "object",
        properties: {
          sql: { type: "string", description: "Read-only SELECT SQL" },
          params: {
            type: "array",
            description: "Bound query parameters",
            items: {},
          },
          limit: { type: "number", description: "Max rows to return" },
        },
        required: ["sql"],
      },
      handler: async (input, context) => this.executeSafeQuery(input, context),
    });
  }

  /**
   * Loads schema from the adapter, marks sensitive columns, caches their
   * names for result redaction, and returns an AI-safe schema + entities.
   */
  private async getSafeSchema(): Promise<{
    schema: DatabaseSchema;
    entities: EntityDefinition[];
  }> {
    const raw = await this.options.database.getSchema({ includeSensitive: true });
    const marked = markSensitiveColumns(raw, this.protectedFields);
    this.sensitiveColumnNames = new Set(
      marked.tables.flatMap((t) =>
        t.columns.filter((c) => c.sensitive).map((c) => c.name.toLowerCase()),
      ),
    );
    return {
      schema: redactSchemaForAi(marked),
      entities: this.listEntities(),
    };
  }

  /**
   * Validates SQL → ensures LIMIT → runs adapter.query → redacts sensitive
   * columns from rows before returning to the caller/LLM.
   */
  private async executeSafeQuery(
    input: unknown,
    context: RequestContext,
  ): Promise<QueryResult> {
    const body = (input ?? {}) as {
      sql?: string;
      params?: unknown[];
      limit?: number;
      timeoutMs?: number;
    };

    const validated = validateReadOnlyQuery({
      sql: body.sql ?? "",
      ...(body.limit !== undefined ? { limit: body.limit } : {}),
      ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs } : {}),
      ...(this.options.defaultLimit !== undefined
        ? { defaultLimit: this.options.defaultLimit }
        : {}),
      ...(this.options.defaultTimeoutMs !== undefined
        ? { defaultTimeoutMs: this.options.defaultTimeoutMs }
        : {}),
    });

    const sql = ensureLimit(validated.sql, validated.limit);

    const result = await this.options.database.query(
      {
        sql,
        limit: validated.limit,
        timeoutMs: validated.timeoutMs,
        ...(body.params !== undefined ? { params: body.params } : {}),
      },
      context,
    );

    // If schema was never fetched, load it so we know which columns to strip
    if (this.sensitiveColumnNames.size === 0) {
      await this.getSafeSchema();
    }

    const rows = redactResultRows(result.rows, this.sensitiveColumnNames);
    return {
      ...result,
      rows,
      rowCount: rows.length,
    };
  }

  /** Forwards audit events to the host callback when configured. */
  private async audit(event: AuditEvent): Promise<void> {
    if (!this.options.audit) {
      return;
    }
    await this.options.audit(event);
  }
}

/**
 * Factory used by host applications:
 *   const agent = createMCPDataAgent({ database, resolveContext })
 */
export function createMCPDataAgent(options: AgentOptions): MCPDataAgent {
  return new MCPDataAgent(options);
}

/**
 * Redacts obvious secret-looking keys from audit parameter payloads
 * so logs never store passwords/tokens.
 */
function sanitizeParams(input: unknown): unknown {
  if (!input || typeof input !== "object") {
    return input;
  }
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (/password|secret|token|credential|api[_-]?key/i.test(key)) {
      clone[key] = "[redacted]";
    } else {
      clone[key] = value;
    }
  }
  return clone;
}

/** Builds lightweight result metadata for the audit trail (no row data). */
function extractResultMeta(
  result: unknown,
  executionMs: number,
): NonNullable<AuditEvent["resultMeta"]> {
  if (
    result &&
    typeof result === "object" &&
    "rowCount" in result
  ) {
    const r = result as QueryResult;
    return {
      rowCount: r.rowCount,
      ...(r.truncated !== undefined ? { truncated: r.truncated } : {}),
      executionMs: r.executionMs ?? executionMs,
    };
  }
  return { executionMs };
}
