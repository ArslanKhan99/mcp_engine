/**
 * MCP Data Agent — @mcp-data-agent/core
 * Created by Arslan Habib
 *
 * ---------------------------------------------------------------------------
 * FILE: errors.ts
 * PURPOSE:
 *   Typed error classes used across the framework so callers can distinguish
 *   auth failures, permission denials, bad SQL, tenant violations, and
 *   misconfiguration — instead of catching a generic Error.
 *
 * HOW TO USE:
 *   - Catch McpDataAgentError and inspect `error.code`
 *   - MCP bridge maps these into structured tool error responses
 * ---------------------------------------------------------------------------
 */

/** Base error for all MCP Data Agent failures. Includes a stable `code`. */
export class McpDataAgentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "McpDataAgentError";
    this.code = code;
  }
}

/** Thrown when resolveContext() returns no authenticated userId. */
export class AuthenticationError extends McpDataAgentError {
  constructor(message = "Authentication required") {
    super("AUTHENTICATION_REQUIRED", message);
    this.name = "AuthenticationError";
  }
}

/** Thrown when the user lacks the permission required by a tool. */
export class AuthorizationError extends McpDataAgentError {
  constructor(permission: string, message?: string) {
    super(
      "AUTHORIZATION_DENIED",
      message ?? `Missing required permission: ${permission}`,
    );
    this.name = "AuthorizationError";
  }
}

/**
 * Thrown when tenant context is missing/invalid, or when tool params try
 * to override tenantId (cross-tenant attack prevention).
 */
export class TenantIsolationError extends McpDataAgentError {
  constructor(message = "Tenant context is missing or invalid") {
    super("TENANT_ISOLATION", message);
    this.name = "TenantIsolationError";
  }
}

/** Thrown when SQL fails read-only / single-statement validation. */
export class QueryValidationError extends McpDataAgentError {
  constructor(message: string) {
    super("QUERY_VALIDATION", message);
    this.name = "QueryValidationError";
  }
}

/** Thrown for bad agent setup (missing adapter, duplicate tools, etc.). */
export class ConfigurationError extends McpDataAgentError {
  constructor(message: string) {
    super("CONFIGURATION", message);
    this.name = "ConfigurationError";
  }
}
