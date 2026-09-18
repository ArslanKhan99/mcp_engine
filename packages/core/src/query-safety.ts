/**
 * MCP Data Agent — @mcp-data-agent/core
 * Created by Arslan Habib
 *
 * ---------------------------------------------------------------------------
 * FILE: query-safety.ts
 * PURPOSE:
 *   Defense-in-depth SQL validation before any query reaches a database
 *   adapter. Blocks writes, multi-statements, locking clauses, and caps
 *   result size / timeout.
 *
 * IMPORTANT:
 *   Regex validation is NOT enough alone. Host apps should also:
 *   - Use read-only DB credentials for AI analytics
 *   - Use bound parameters (never string-concat AI text into SQL)
 *   - Enforce tenant isolation at the DB (e.g. Postgres RLS)
 * ---------------------------------------------------------------------------
 */

import { QueryValidationError } from "./errors.js";

/**
 * Keywords that indicate a mutating or dangerous statement.
 * Matched as whole words (case-insensitive).
 */
const FORBIDDEN_KEYWORDS =
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|execute|merge|replace|attach|detach|pragma|vacuum|reindex|cluster|comment|security|owner|load|import|export|into\s+outfile|load_file)\b/i;

/** Detects a second statement after a semicolon (SQL injection pattern). */
const MULTI_STATEMENT = /;\s*\S/;

/** Result of a successful validation pass. */
export interface ValidatedQuery {
  sql: string;
  limit: number;
  timeoutMs: number;
}

/** Inputs accepted by validateReadOnlyQuery(). */
export interface ValidateQueryOptions {
  sql: string;
  limit?: number;
  timeoutMs?: number;
  defaultLimit?: number;
  defaultTimeoutMs?: number;
  maxLimit?: number;
  maxTimeoutMs?: number;
}

/**
 * Validate that a query is a single read-only SELECT (or WITH … SELECT).
 * Throws QueryValidationError on anything unsafe.
 */
export function validateReadOnlyQuery(
  options: ValidateQueryOptions,
): ValidatedQuery {
  const raw = options.sql?.trim() ?? "";
  if (!raw) {
    throw new QueryValidationError("Query SQL is required");
  }

  // Block "SELECT 1; DROP TABLE ..." style attacks
  if (MULTI_STATEMENT.test(raw)) {
    throw new QueryValidationError("Multiple SQL statements are not allowed");
  }

  // Allow a single trailing semicolon; strip it for further checks
  const sql = raw.replace(/;\s*$/, "");

  if (FORBIDDEN_KEYWORDS.test(sql)) {
    throw new QueryValidationError(
      "Only read-only SELECT queries are allowed by default",
    );
  }

  // Must start with SELECT or WITH (common table expressions)
  const normalized = sql.replace(/^\s*\(/, "").trimStart();
  const isSelect =
    /^select\b/i.test(normalized) ||
    /^with\b/i.test(normalized);

  if (!isSelect) {
    throw new QueryValidationError(
      "Query must be a SELECT or WITH (CTE) statement",
    );
  }

  // SELECT INTO can create tables — blocked in Phase 1
  if (/\binto\b/i.test(sql) && !/\binto\s+temp(orary)?\b/i.test(sql)) {
    throw new QueryValidationError("SELECT INTO is not allowed");
  }

  // Row locks are not needed for analytics and can block writers
  if (/\bfor\s+update\b/i.test(sql) || /\block\s+in\s+share\b/i.test(sql)) {
    throw new QueryValidationError("Locking clauses are not allowed");
  }

  // Clamp limit and timeout to safe ranges
  const maxLimit = options.maxLimit ?? 1000;
  const maxTimeout = options.maxTimeoutMs ?? 30_000;
  const defaultLimit = options.defaultLimit ?? 100;
  const defaultTimeout = options.defaultTimeoutMs ?? 10_000;

  const limit = Math.min(
    Math.max(1, options.limit ?? defaultLimit),
    maxLimit,
  );
  const timeoutMs = Math.min(
    Math.max(100, options.timeoutMs ?? defaultTimeout),
    maxTimeout,
  );

  return { sql, limit, timeoutMs };
}

/**
 * Ensure a LIMIT clause exists without rewriting complex SQL aggressively.
 * If the query already has LIMIT, leave it; otherwise append one.
 */
export function ensureLimit(sql: string, limit: number): string {
  if (/\blimit\s+\d+/i.test(sql)) {
    return sql;
  }
  return `${sql} LIMIT ${limit}`;
}
