/**
 * MCP Data Agent — @mcp-data-agent/core
 * Created by Arslan Habib
 *
 * ---------------------------------------------------------------------------
 * FILE: agent.test.ts
 * PURPOSE:
 *   Unit tests for core security behaviors without a real database:
 *     - Read-only SQL validation
 *     - Sensitive column redaction (schema + query results)
 *     - Permission enforcement
 *     - Rejection of tenantId overrides from tool params
 *     - Custom tools, entities, and audit hooks
 *
 * Uses a mock DatabaseAdapter so tests stay fast and offline.
 * ---------------------------------------------------------------------------
 */

import { describe, expect, it, vi } from "vitest";
import {
  AuthorizationError,
  createMCPDataAgent,
  QueryValidationError,
  TenantIsolationError,
  validateReadOnlyQuery,
} from "./index.js";
import type { DatabaseAdapter, QueryResult, RequestContext } from "./types.js";

/**
 * Fake adapter that returns a members table including a sensitive
 * password_hash column — used to assert redaction works.
 */
function mockAdapter(overrides?: Partial<DatabaseAdapter>): DatabaseAdapter {
  return {
    name: "mock",
    getSchema: async () => ({
      dialect: "mock",
      inspectedAt: new Date().toISOString(),
      tables: [
        {
          name: "members",
          schema: "public",
          columns: [
            {
              name: "id",
              dataType: "number",
              nativeType: "int",
              nullable: false,
              isPrimaryKey: true,
              isForeignKey: false,
            },
            {
              name: "tenant_id",
              dataType: "string",
              nativeType: "text",
              nullable: false,
              isPrimaryKey: false,
              isForeignKey: false,
            },
            {
              name: "password_hash",
              dataType: "string",
              nativeType: "text",
              nullable: false,
              isPrimaryKey: false,
              isForeignKey: false,
            },
            {
              name: "email",
              dataType: "string",
              nativeType: "text",
              nullable: false,
              isPrimaryKey: false,
              isForeignKey: false,
            },
          ],
        },
      ],
    }),
    // Deliberately returns password_hash so we can assert it is stripped
    query: async (): Promise<QueryResult> => ({
      columns: [
        { name: "email", dataType: "string" },
        { name: "password_hash", dataType: "string" },
      ],
      rows: [{ email: "a@example.com", password_hash: "secret" }],
      rowCount: 1,
      truncated: false,
    }),
    ...overrides,
  };
}

/** Helper: build a RequestContext with the given permissions. */
function context(perms: string[]): RequestContext {
  return {
    auth: {
      userId: "user-1",
      permissions: perms,
    },
    tenant: { tenantId: "gym_001" },
  };
}

describe("validateReadOnlyQuery", () => {
  it("allows SELECT", () => {
    const result = validateReadOnlyQuery({
      sql: "SELECT id FROM members WHERE active = true",
    });
    expect(result.sql).toContain("SELECT");
  });

  it("rejects DELETE", () => {
    expect(() =>
      validateReadOnlyQuery({ sql: "DELETE FROM members" }),
    ).toThrow(QueryValidationError);
  });

  it("rejects multi-statement", () => {
    expect(() =>
      validateReadOnlyQuery({
        sql: "SELECT 1; DROP TABLE members",
      }),
    ).toThrow(QueryValidationError);
  });
});

describe("createMCPDataAgent", () => {
  it("redacts sensitive columns from schema", async () => {
    const agent = createMCPDataAgent({
      database: mockAdapter(),
      resolveContext: () => context(["database.schema"]),
    });

    const result = await agent.invokeTool<{
      schema: { tables: Array<{ columns: Array<{ name: string }> }> };
    }>("database.schema");

    const names = result.schema.tables[0]?.columns.map((c) => c.name) ?? [];
    expect(names).toContain("email");
    expect(names).not.toContain("password_hash");
  });

  it("redacts sensitive columns from query results", async () => {
    const agent = createMCPDataAgent({
      database: mockAdapter(),
      resolveContext: () => context(["database.query"]),
    });

    const result = await agent.invokeTool<{
      rows: Array<Record<string, unknown>>;
    }>("database.query", {
      sql: "SELECT email, password_hash FROM members",
    });

    expect(result.rows[0]?.email).toBe("a@example.com");
    expect(result.rows[0]?.password_hash).toBeUndefined();
  });

  it("enforces permissions", async () => {
    // User only has members.read — database.query must be denied
    const agent = createMCPDataAgent({
      database: mockAdapter(),
      resolveContext: () => context(["members.read"]),
    });

    await expect(
      agent.invokeTool("database.query", { sql: "SELECT 1" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects tenant overrides from tool params", async () => {
    const agent = createMCPDataAgent({
      database: mockAdapter(),
      resolveContext: () => context(["database.query"]),
    });

    await expect(
      agent.invokeTool("database.query", {
        sql: "SELECT 1",
        tenantId: "gym_002", // attack attempt — must throw
      }),
    ).rejects.toBeInstanceOf(TenantIsolationError);
  });

  it("supports custom tools and entities", async () => {
    const audit = vi.fn();
    const agent = createMCPDataAgent({
      database: mockAdapter(),
      resolveContext: () => context(["members.read"]),
      audit,
    });

    agent.defineEntity({
      name: "Member",
      table: "members",
      description: "A gym member",
    });

    agent.registerTool({
      name: "members.search",
      description: "Search members",
      permission: "members.read",
      handler: async () => ({ items: [] }),
    });

    const result = await agent.invokeTool("members.search", { q: "ada" });
    expect(result).toEqual({ items: [] });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "members.search", status: "success" }),
    );
  });
});
