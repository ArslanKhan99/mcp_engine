/**
 * MCP Data Agent — @mcp-data-agent/core
 * Created by Arslan Habib
 *
 * ---------------------------------------------------------------------------
 * FILE: schema-safety.ts
 * PURPOSE:
 *   Prevents sensitive columns (passwords, tokens, salaries, etc.) from
 *   reaching the LLM. Works in two stages:
 *     1) mark columns as sensitive (patterns + developer protectField list)
 *     2) redact them from schema and from query result rows
 *
 * WHY:
 *   Even a valid SELECT might return password_hash. We strip those keys
 *   before returning data to AI tools.
 * ---------------------------------------------------------------------------
 */

import type {
  ColumnSchema,
  DatabaseSchema,
  ProtectFieldOptions,
  TableSchema,
} from "./types.js";

/**
 * Heuristic name patterns treated as sensitive by default.
 * Developers can add more via agent.protectField().
 */
const DEFAULT_SENSITIVE_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /api[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /private[_-]?key/i,
  /credit[_-]?card/i,
  /card[_-]?number/i,
  /ssn/i,
  /salary/i,
  /password_hash/i,
];

/** Builds a stable key: "schema.table.column" (lowercased). */
function fieldKey(schema: string | undefined, table: string, column: string): string {
  return `${schema ?? "public"}.${table}.${column}`.toLowerCase();
}

/** Returns true if the column name looks sensitive based on default patterns. */
export function isLikelySensitiveColumn(columnName: string): boolean {
  return DEFAULT_SENSITIVE_PATTERNS.some((pattern) => pattern.test(columnName));
}

/** Converts protectField() options into a Set for O(1) lookups. */
export function buildProtectedFieldSet(
  fields: ProtectFieldOptions[] = [],
): Set<string> {
  return new Set(
    fields.map((f) => fieldKey(f.schema, f.table, f.column)),
  );
}

/**
 * Walks the schema and sets `sensitive: true` on columns that match
 * patterns or the developer's protected-field list.
 */
export function markSensitiveColumns(
  schema: DatabaseSchema,
  protectedFields: Set<string>,
): DatabaseSchema {
  const tables = schema.tables.map((table) => {
    const columns = table.columns.map((col) => {
      const key = fieldKey(table.schema, table.name, col.name);
      const sensitive =
        col.sensitive === true ||
        protectedFields.has(key) ||
        isLikelySensitiveColumn(col.name);
      return sensitive ? { ...col, sensitive: true } : col;
    });
    return { ...table, columns };
  });
  return { ...schema, tables };
}

/**
 * Returns a copy of the schema with sensitive columns removed entirely.
 * This is what database.schema returns to the AI.
 */
export function redactSchemaForAi(schema: DatabaseSchema): DatabaseSchema {
  const tables: TableSchema[] = schema.tables.map((table) => {
    const columns: ColumnSchema[] = table.columns.filter((c) => !c.sensitive);
    return { ...table, columns };
  });
  return { ...schema, tables };
}

/**
 * Removes sensitive keys from each result row (by column name, case-insensitive).
 * Applied after database.query so leaked SELECT columns never reach the LLM.
 */
export function redactResultRows(
  rows: Record<string, unknown>[],
  sensitiveColumnNames: Set<string>,
): Record<string, unknown>[] {
  if (sensitiveColumnNames.size === 0) {
    return rows;
  }
  return rows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!sensitiveColumnNames.has(key.toLowerCase())) {
        next[key] = value;
      }
    }
    return next;
  });
}
