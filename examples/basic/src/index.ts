/**
 * MCP Data Agent — basic integration example
 * Created by Arslan Habib
 *
 * ---------------------------------------------------------------------------
 * FILE: examples/basic/src/index.ts
 * PURPOSE:
 *   End-to-end sketch showing how a host app wires:
 *     Postgres adapter → createMCPDataAgent → createMcpDataAgentServer → stdio
 *
 * HOW TO RUN (from monorepo root):
 *   1. Copy .env.example → .env and set DATABASE_URL
 *   2. npm run build
 *   3. npm start -w @mcp-data-agent/example-basic
 *
 * Replace resolveContext() with your real session/auth middleware before
 * production use. Never accept tenantId from the LLM.
 * ---------------------------------------------------------------------------
 */

import {
  createMCPDataAgent,
  Permissions,
  type RequestContext,
} from "@mcp-data-agent/core";
import { createMcpDataAgentServer } from "@mcp-data-agent/mcp";
import { createPostgresAdapter } from "@mcp-data-agent/postgres";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

/**
 * DEMO ONLY — simulates what your auth middleware would return.
 * In production: read the logged-in user + tenant from the session cookie/JWT.
 */
async function resolveContext(): Promise<RequestContext> {
  return {
    auth: {
      userId: process.env.DEMO_USER_ID ?? "demo-user",
      displayName: "Demo User",
      roles: ["receptionist"],
      // Receptionist-style permissions (no revenue/expenses)
      permissions: [
        Permissions.DATABASE_SCHEMA,
        Permissions.DATABASE_QUERY,
        "members.read",
        "attendance.read",
      ],
    },
    tenant: {
      // From session — never from tool arguments
      tenantId: process.env.DEMO_TENANT_ID ?? "gym_001",
    },
    question: process.env.DEMO_QUESTION,
  };
}

async function main() {
  // --- 1) Database adapter (prefer read-only DB credentials) ---
  const database = createPostgresAdapter({
    connectionString:
      process.env.DATABASE_URL ?? "postgres://localhost:5432/mcp_data_agent",
  });

  // --- 2) Core agent with auth resolution + audit logging ---
  const agent = createMCPDataAgent({
    database,
    resolveContext,
    audit: (event) => {
      // Log to stderr so stdout stays free for MCP stdio protocol
      console.error("[audit]", JSON.stringify(event));
    },
  });

  // --- 3) Business context, field protection, custom domain tool ---
  agent
    .defineEntity({
      name: "Member",
      table: "members",
      description: "A person registered at the gym",
      relationships: [
        { name: "memberships", entity: "Membership", type: "one-to-many" },
        { name: "attendance", entity: "Attendance", type: "one-to-many" },
      ],
    })
    .protectField({ table: "members", column: "password_hash" })
    .registerTool({
      name: "members.statistics",
      description: "Return basic member statistics for the current tenant",
      permission: "members.read",
      handler: async (_input, context) => {
        // Prefer dedicated domain tools over free-form SQL when possible
        return {
          tenantId: context.tenant.tenantId,
          note: "Wire this to your domain service or a constrained adapter query.",
        };
      },
    });

  // --- 4) Expose tools over MCP stdio for AI assistants ---
  const server = createMcpDataAgentServer({ agent });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
