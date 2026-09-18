/**
 * MCP Data Agent — @mcp-data-agent/mcp
 * Created by Arslan Habib
 *
 * ---------------------------------------------------------------------------
 * FILE: server.ts
 * PURPOSE:
 *   Bridges MCPDataAgent tools to the Model Context Protocol so AI assistants
 *   (Cursor, Claude Desktop, custom MCP clients) can call them.
 *
 * WHAT IT DOES:
 *   - Creates an McpServer (official TypeScript SDK v2)
 *   - Registers database_schema and database_query MCP tools
 *   - Optionally mirrors custom agent tools (dots → underscores in names)
 *   - Returns JSON text content (or structured errors) to the client
 *
 * AUTH / TENANT:
 *   Still resolved by agent.resolveContext on every invoke — MCP args never
 *   supply tenantId.
 * ---------------------------------------------------------------------------
 */

import type { MCPDataAgent } from "@mcp-data-agent/core";
import { McpDataAgentError } from "@mcp-data-agent/core";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

/** Options for createMcpDataAgentServer(). */
export interface CreateMcpServerOptions {
  /** Fully configured MCPDataAgent instance. */
  agent: MCPDataAgent;
  /** MCP server name shown to clients. */
  name?: string;
  /** MCP server version shown to clients. */
  version?: string;
  /**
   * When true, register every custom tool currently on the agent.
   * Register custom tools BEFORE calling this factory.
   */
  includeCustomTools?: boolean;
}

/** Wrap successful tool output as MCP text content (JSON). */
function toTextResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/** Wrap failures as MCP error content with a stable error code when possible. */
function toErrorResult(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unknown tool execution error";
  const code =
    error instanceof McpDataAgentError ? error.code : "TOOL_EXECUTION_ERROR";
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: code, message }, null, 2),
      },
    ],
  };
}

/**
 * Build an MCP server that exposes MCP Data Agent tools to AI assistants.
 * Connect it with StdioServerTransport or an HTTP transport in the host app.
 */
export function createMcpDataAgentServer(
  options: CreateMcpServerOptions,
): McpServer {
  const {
    agent,
    name = "mcp-data-agent",
    version = "0.1.0",
    includeCustomTools = true,
  } = options;

  const server = new McpServer({ name, version });

  // --- Built-in: safe schema for the authenticated user ---
  server.registerTool(
    "database_schema",
    {
      description:
        "Return a safe, redacted database schema and business entities for the authenticated user.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const result = await agent.invokeTool("database.schema", {});
        return toTextResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  // --- Built-in: validated read-only SQL ---
  server.registerTool(
    "database_query",
    {
      description:
        "Execute a validated read-only SQL SELECT. Tenant isolation and permissions are enforced by the host application session — do not pass tenantId.",
      inputSchema: z.object({
        sql: z.string().describe("Read-only SELECT (or WITH … SELECT) SQL"),
        params: z
          .array(z.unknown())
          .optional()
          .describe("Bound parameters for the query"),
        limit: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe("Maximum rows to return"),
      }),
    },
    async ({ sql, params, limit }) => {
      try {
        const result = await agent.invokeTool("database.query", {
          sql,
          params,
          limit,
        });
        return toTextResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  // --- Custom tools registered on the agent (e.g. members.statistics) ---
  if (includeCustomTools) {
    for (const tool of agent.listTools()) {
      // Skip built-ins already registered above under MCP-friendly names
      if (tool.name === "database.schema" || tool.name === "database.query") {
        continue;
      }
      // MCP tool names typically use underscores: members.statistics → members_statistics
      const mcpName = tool.name.replace(/\./g, "_");
      server.registerTool(
        mcpName,
        {
          description: tool.description,
          // Passthrough object: domain tools define their own shapes
          inputSchema: z.object({}).passthrough(),
        },
        async (args) => {
          try {
            const result = await agent.invokeTool(tool.name, args);
            return toTextResult(result);
          } catch (error) {
            return toErrorResult(error);
          }
        },
      );
    }
  }

  return server;
}
