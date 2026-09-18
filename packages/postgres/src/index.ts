/**
 * MCP Data Agent — @mcp-data-agent/postgres
 * Created by Arslan Habib
 *
 * ---------------------------------------------------------------------------
 * FILE: index.ts
 * PURPOSE:
 *   Public entry point for the PostgreSQL adapter package.
 *
 *     import { createPostgresAdapter } from "@mcp-data-agent/postgres";
 * ---------------------------------------------------------------------------
 */

export {
  createPostgresAdapter,
  getTenantColumn,
  PostgresAdapter,
} from "./adapter.js";
export type { PostgresAdapterOptions } from "./adapter.js";
