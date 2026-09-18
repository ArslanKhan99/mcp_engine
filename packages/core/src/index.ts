/**
 * MCP Data Agent — @mcp-data-agent/core
 * Created by Arslan Habib
 *
 * ---------------------------------------------------------------------------
 * FILE: index.ts
 * PURPOSE:
 *   Public entry point for @mcp-data-agent/core.
 *   Re-exports the agent factory, errors, helpers, and TypeScript types so
 *   consumers can import everything from one place:
 *
 *     import { createMCPDataAgent, Permissions } from "@mcp-data-agent/core";
 * ---------------------------------------------------------------------------
 */

// --- Agent runtime ---
export { createMCPDataAgent, MCPDataAgent } from "./agent.js";

// --- Typed errors ---
export {
  AuthenticationError,
  AuthorizationError,
  ConfigurationError,
  McpDataAgentError,
  QueryValidationError,
  TenantIsolationError,
} from "./errors.js";

// --- RBAC ---
export { assertPermission, hasPermission, Permissions } from "./permissions.js";

// --- SQL safety ---
export {
  ensureLimit,
  validateReadOnlyQuery,
} from "./query-safety.js";

// --- Sensitive-field / schema redaction ---
export {
  buildProtectedFieldSet,
  isLikelySensitiveColumn,
  markSensitiveColumns,
  redactResultRows,
  redactSchemaForAi,
} from "./schema-safety.js";

// --- Multi-tenancy ---
export {
  assertTenantContext,
  DEFAULT_TENANT_COLUMN,
  getTenantColumn,
  rejectTenantOverride,
} from "./tenant.js";

// --- Tool registry (advanced / custom integrations) ---
export { ToolRegistry } from "./tool-registry.js";

// --- Shared types ---
export type {
  AgentOptions,
  AuditEvent,
  AuditLogger,
  AuthContext,
  ColumnDataType,
  ColumnSchema,
  DatabaseAdapter,
  DatabaseSchema,
  EntityDefinition,
  Permission,
  ProtectFieldOptions,
  QueryRequest,
  QueryResult,
  QueryResultColumn,
  RequestContext,
  TableSchema,
  TenantContext,
  ToolDefinition,
} from "./types.js";
