/**
 * MCP Data Agent — @mcp-data-agent/core
 * Created by Arslan Habib
 *
 * ---------------------------------------------------------------------------
 * FILE: tenant.ts
 * PURPOSE:
 *   Multi-tenant safety helpers. SaaS apps isolate data by tenant_id; this
 *   module ensures tenant context is present and that AI/tool arguments
 *   cannot spoof or override which tenant is in scope.
 *
 * RULE:
 *   tenantId comes ONLY from the authenticated application session.
 * ---------------------------------------------------------------------------
 */

import { TenantIsolationError } from "./errors.js";
import type { TenantContext } from "./types.js";

/** Default column name used by many SaaS schemas for row-level tenancy. */
export const DEFAULT_TENANT_COLUMN = "tenant_id";

/**
 * Validates that tenant.tenantId is a non-empty string.
 * Called on every tool invocation via MCPDataAgent.getContext().
 */
export function assertTenantContext(tenant: TenantContext): void {
  if (!tenant.tenantId || typeof tenant.tenantId !== "string") {
    throw new TenantIsolationError(
      "tenantId must be derived from the authenticated session",
    );
  }
  if (tenant.tenantId.trim().length === 0) {
    throw new TenantIsolationError("tenantId cannot be empty");
  }
}

/** Returns the configured tenant column name, or the default "tenant_id". */
export function getTenantColumn(tenant: TenantContext): string {
  return tenant.tenantColumn ?? DEFAULT_TENANT_COLUMN;
}

/**
 * Reject AI/tool attempts to override tenant identity via parameters.
 * Example attack: { sql: "...", tenantId: "other_gym" } — this throws.
 */
export function rejectTenantOverride(
  params: Record<string, unknown>,
  reservedKeys: string[] = ["tenantId", "tenant_id", "tenant"],
): void {
  for (const key of reservedKeys) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      throw new TenantIsolationError(
        `Parameter "${key}" is not allowed; tenant context comes from the session`,
      );
    }
  }
}
