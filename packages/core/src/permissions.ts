/**
 * MCP Data Agent — @mcp-data-agent/core
 * Created by Arslan Habib
 *
 * ---------------------------------------------------------------------------
 * FILE: permissions.ts
 * PURPOSE:
 *   Role-based access control (RBAC) helpers. Every tool declares a required
 *   permission; these functions check the authenticated user's permission
 *   list before the tool handler runs.
 *
 * FLOW:
 *   invokeTool() → assertPermission(auth, tool.permission) → handler
 *
 * NOTE:
 *   Permission "*" grants all tools (useful for admin/dev only — avoid in
 *   production unless intentional).
 * ---------------------------------------------------------------------------
 */

import { AuthorizationError } from "./errors.js";
import type { AuthContext, Permission } from "./types.js";

/**
 * Well-known permission strings for built-in tools and Phase-2 report/chart
 * contexts. Host apps can define their own (e.g. "members.read").
 */
export const Permissions = {
  DATABASE_SCHEMA: "database.schema",
  DATABASE_QUERY: "database.query",
  REPORTS_READ: "reports.read",
  CHARTS_READ: "charts.read",
} as const;

/**
 * Returns true if the user has the given permission (or wildcard "*").
 * Returns false if there is no userId.
 */
export function hasPermission(
  auth: AuthContext,
  permission: Permission,
): boolean {
  if (!auth.userId) {
    return false;
  }
  return auth.permissions.includes(permission) || auth.permissions.includes("*");
}

/**
 * Throws AuthorizationError when the user is missing the required permission.
 * Used by MCPDataAgent.invokeTool before running a tool handler.
 */
export function assertPermission(
  auth: AuthContext,
  permission: Permission,
): void {
  if (!hasPermission(auth, permission)) {
    throw new AuthorizationError(permission);
  }
}

/**
 * Returns the subset of `required` permissions that the user actually has.
 * Useful for UIs that show which capabilities are available.
 */
export function filterPermissions(
  auth: AuthContext,
  required: Permission[],
): Permission[] {
  return required.filter((p) => hasPermission(auth, p));
}
