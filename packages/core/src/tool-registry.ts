/**
 * MCP Data Agent — @mcp-data-agent/core
 * Created by Arslan Habib
 *
 * ---------------------------------------------------------------------------
 * FILE: tool-registry.ts
 * PURPOSE:
 *   In-memory registry of tools the agent can invoke. Built-in tools
 *   (database.schema, database.query) and custom tools (members.search, …)
 *   are stored here by unique name.
 *
 * RESPONSIBILITIES:
 *   - Prevent duplicate tool names
 *   - Reject mutating tools that misuse the read-only database.query permission
 * ---------------------------------------------------------------------------
 */

import { ConfigurationError } from "./errors.js";
import type { ToolDefinition } from "./types.js";

/** Map of tool name → ToolDefinition. Owned by MCPDataAgent. */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  /**
   * Registers a new tool. Throws if the name is missing or already taken.
   * Mutating tools must use an explicit write permission (not database.query).
   */
  register<TInput = unknown, TOutput = unknown>(
    tool: ToolDefinition<TInput, TOutput>,
  ): void {
    if (!tool.name?.trim()) {
      throw new ConfigurationError("Tool name is required");
    }
    if (this.tools.has(tool.name)) {
      throw new ConfigurationError(`Tool already registered: ${tool.name}`);
    }
    // database.query is reserved for read-only analytics
    if (tool.mutates && tool.permission === "database.query") {
      throw new ConfigurationError(
        "Mutating tools must use an explicit write permission, not database.query",
      );
    }
    this.tools.set(tool.name, tool as ToolDefinition);
  }

  /** Lookup a single tool by name (undefined if not registered). */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** All registered tools (used by MCP bridge to expose custom tools). */
  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Returns true if a tool with this name exists. */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}
