# MCP Data Agent

> Open-source MCP framework for securely connecting AI assistants to application databases.

## Created by

**Arslan Habib**  
Creator, Founder & Lead Maintainer

> MCP Data Agent is an open-source project created and maintained by Arslan Habib, designed to connect AI assistants with application data through secure, permission-aware MCP tools.

---

## Project overview

**MCP Data Agent** lets developers connect an existing application database to AI assistants through the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). Authenticated users can ask natural-language questions about their business data while the framework enforces authentication, authorization, tenant isolation, and safe tool-based access.

Example:

> How many active gym members do we have?

The system understands application context, runs controlled tools (not unrestricted SQL), respects permissions and tenancy, and returns a useful answer.

This is a **reusable framework** — not a gym-specific app. Gym examples are illustrative only.

---

## Why MCP Data Agent

| Problem | Approach |
| --- | --- |
| LLMs with raw DB access are unsafe | Controlled MCP tools + permissions |
| SaaS data leakage across customers | Tenant context from the session only |
| Role confusion (receptionist vs finance) | RBAC on every tool |
| Sensitive columns exposed to models | Field protection + schema redaction |
| One-off glue code per app | Small, typed, extensible core |

---

## Architecture

```text
User
  ↓
AI Assistant / LLM
  ↓
MCP Client
  ↓
MCP Data Agent
  ↓
Authentication & Authorization
  ↓
Business Context
  ↓
Query / Tool Engine
  ↓
Database Adapter
  ↓
Database
  ↓
Structured Result
  ↓
AI Response
```

The AI never receives unrestricted direct database access.

---

## Features (Phase 1)

- TypeScript-first core (`@mcp-data-agent/core`)
- MCP server bridge (`@mcp-data-agent/mcp`)
- PostgreSQL adapter (`@mcp-data-agent/postgres`)
- Schema inspection with sensitive-field redaction
- Read-only query validation (SELECT / CTE only)
- Auth context + RBAC permission checks
- Multi-tenant context derived from the host session
- Custom tool registration (`agent.registerTool`)
- Business entity definitions (`agent.defineEntity`)
- Audit event hooks (no secrets logged)
- Secure defaults: read-only, mutations opt-in

---

## Security model

Every database operation is intended to pass through:

1. Authentication  
2. Authorization (permissions)  
3. Tenant isolation  
4. Schema / field redaction  
5. Query validation  
6. Tool permissions  
7. Database permissions (prefer read-only credentials)  
8. Timeouts and result-size limits  

**Defaults**

- AI database access is **read-only**
- Destructive SQL is blocked
- `tenantId` from tool/AI parameters is **rejected**
- Sensitive columns (e.g. `password_hash`, `api_key`) are withheld
- Write tools require `allowMutations: true` and explicit permissions

---

## Multi-tenancy

Tenant identity must come from the authenticated application session:

```ts
tenant: { tenantId: "gym_001" } // from session — never from the LLM
```

A user from Tenant A must never retrieve Tenant B data. The Postgres adapter sets session GUCs (`app.tenant_id`, `app.user_id`) suitable for Row Level Security policies.

---

## Installation

**MCP Data Agent — Created by Arslan Habib**

This section covers everything you need to install and wire the library into a Node.js / TypeScript app.

### Requirements

| Requirement | Version |
| --- | --- |
| Node.js | **20+** (recommended: current LTS) |
| Package manager | npm, pnpm, or yarn |
| TypeScript (recommended) | 5.x |
| PostgreSQL (for the Postgres adapter) | 13+ |

Confirm Node:

```bash
node -v   # should print v20.x or higher
npm -v
```

### Packages

Install only what you need:

| Package | Purpose |
| --- | --- |
| `@mcp-data-agent/core` | **Required** — agent, auth context, RBAC, tools, query safety |
| `@mcp-data-agent/postgres` | PostgreSQL database adapter |
| `@mcp-data-agent/mcp` | MCP server bridge for AI assistants |

### Option A — Install in your application (recommended)

From your app directory:

```bash
npm install @mcp-data-agent/core @mcp-data-agent/postgres @mcp-data-agent/mcp
```

Install **peer dependencies** (required at runtime):

```bash
npm install pg @modelcontextprotocol/server zod
```

For TypeScript projects, also install types for `pg`:

```bash
npm install -D @types/pg typescript
```

**pnpm**

```bash
pnpm add @mcp-data-agent/core @mcp-data-agent/postgres @mcp-data-agent/mcp
pnpm add pg @modelcontextprotocol/server zod
pnpm add -D @types/pg typescript
```

**yarn**

```bash
yarn add @mcp-data-agent/core @mcp-data-agent/postgres @mcp-data-agent/mcp
yarn add pg @modelcontextprotocol/server zod
yarn add -D @types/pg typescript
```

> **Note:** Until packages are published to the npm registry, use **Option B** (install from this repository) or link local workspaces.

### Option B — Install from this repository (local development)

Clone and build the monorepo:

```bash
git clone <your-repo-url> mcp_engine
cd mcp_engine
npm install
npm run build
npm test
```

#### Use the packages from another project on your machine

**npm link**

```bash
# In this repo, after build:
cd packages/core && npm link
cd ../postgres && npm link
cd ../mcp && npm link

# In your application:
npm link @mcp-data-agent/core @mcp-data-agent/postgres @mcp-data-agent/mcp
npm install pg @modelcontextprotocol/server zod
```

**Or point `package.json` at local paths**

```json
{
  "dependencies": {
    "@mcp-data-agent/core": "file:../mcp_engine/packages/core",
    "@mcp-data-agent/postgres": "file:../mcp_engine/packages/postgres",
    "@mcp-data-agent/mcp": "file:../mcp_engine/packages/mcp",
    "pg": "^8.14.0",
    "@modelcontextprotocol/server": "^2.0.0",
    "zod": "^4.0.0"
  }
}
```

Then in your app:

```bash
npm install
```

### Peer dependencies explained

| Peer | Used by | Why |
| --- | --- | --- |
| `pg` | `@mcp-data-agent/postgres` | PostgreSQL driver |
| `@modelcontextprotocol/server` | `@mcp-data-agent/mcp` | Official MCP TypeScript SDK (v2) |
| `zod` | `@mcp-data-agent/mcp` | Tool input schemas for MCP |

These are peers so your app controls versions and avoids duplicate drivers.

### Environment configuration

Copy the example env file when working from this repo:

```bash
cp .env.example .env
```

Set at least:

```bash
DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/YOUR_DATABASE
```

Prefer a **read-only** database user for AI/analytical access. Never commit real credentials or `.env` files.

### TypeScript setup

Use ESM-friendly settings (packages ship as `"type": "module"`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "types": ["node"]
  }
}
```

### Verify the installation

Create a small smoke file (e.g. `smoke.mjs` or `smoke.ts`):

```ts
import { createMCPDataAgent, Permissions } from "@mcp-data-agent/core";
import { createPostgresAdapter } from "@mcp-data-agent/postgres";

const database = createPostgresAdapter({
  connectionString: process.env.DATABASE_URL!,
});

const agent = createMCPDataAgent({
  database,
  resolveContext: () => ({
    auth: {
      userId: "install-check",
      permissions: [Permissions.DATABASE_SCHEMA],
    },
    tenant: { tenantId: "gym_001" },
  }),
});

const schema = await agent.invokeTool("database.schema");
console.log("Installed OK — tables:", schema.schema.tables.length);
await database.close?.();
```

Run it (with `DATABASE_URL` set):

```bash
npx tsx smoke.ts
# or, after compiling: node dist/smoke.js
```

### Run the included example

From the monorepo root:

```bash
npm install
npm run build
cp .env.example .env   # edit DATABASE_URL
npm start -w @mcp-data-agent/example-basic
```

The example starts an MCP server over stdio. Point your MCP client (e.g. Cursor) at that command.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| `Cannot find module '@mcp-data-agent/...'` | Run `npm run build` in the monorepo, or use `file:` / `npm link` correctly |
| Peer dependency warnings | Install `pg`, `@modelcontextprotocol/server`, and `zod` in your app |
| `ECONNREFUSED` on Postgres | Check `DATABASE_URL`, that Postgres is running, and network/firewall |
| Node version errors | Upgrade to Node.js 20+ |
| ESM / `require` errors | Use `"type": "module"` or import from ESM entry points |

### Minimal install (core only)

If you only need the agent API and will supply your own adapter:

```bash
npm install @mcp-data-agent/core
```

You must implement `DatabaseAdapter` yourself (see [Database adapters](#database-adapters)).

---

## Quick start

```ts
import { createMCPDataAgent, Permissions } from "@mcp-data-agent/core";
import { createPostgresAdapter } from "@mcp-data-agent/postgres";
import { createMcpDataAgentServer } from "@mcp-data-agent/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

const database = createPostgresAdapter({
  connectionString: process.env.DATABASE_URL!,
});

const agent = createMCPDataAgent({
  database,
  resolveContext: async () => ({
    // Wire this to your real auth/session middleware
    auth: {
      userId: "user_123",
      permissions: [
        Permissions.DATABASE_SCHEMA,
        Permissions.DATABASE_QUERY,
        "members.read",
      ],
    },
    tenant: { tenantId: "gym_001" },
  }),
  audit: (event) => console.error("[audit]", event),
});

agent
  .defineEntity({
    name: "Member",
    table: "members",
    description: "A person registered at the gym",
  })
  .protectField({ table: "members", column: "password_hash" });

const server = createMcpDataAgentServer({ agent });
await server.connect(new StdioServerTransport());
```

See `examples/basic` for a runnable sketch.

---

## Configuration

| Option | Description |
| --- | --- |
| `database` | `DatabaseAdapter` implementation |
| `resolveContext` | Returns `auth` + `tenant` per request |
| `defaultLimit` | Max rows (default `100`) |
| `defaultTimeoutMs` | Query timeout (default `10000`) |
| `protectedFields` | Extra columns to redact |
| `audit` | Audit logger callback |
| `allowMutations` | Enable explicit write tools (default `false`) |

Use environment variables for secrets. Never commit credentials.

---

## MCP integration

Built-in MCP tools:

| MCP tool | Agent tool | Permission |
| --- | --- | --- |
| `database_schema` | `database.schema` | `database.schema` |
| `database_query` | `database.query` | `database.query` |

Custom tools registered on the agent are exposed with dots replaced by underscores (e.g. `members.statistics` → `members_statistics`).

---

## Database adapters

| Package | Status |
| --- | --- |
| `@mcp-data-agent/postgres` | Phase 1 |
| `@mcp-data-agent/mysql` | Planned |
| `@mcp-data-agent/mongodb` | Planned |

Adapter contract:

```ts
interface DatabaseAdapter {
  getSchema(): Promise<DatabaseSchema>;
  query(request: QueryRequest, context: RequestContext): Promise<QueryResult>;
}
```

---

## Authentication

The host application authenticates users. MCP Data Agent receives an `AuthContext`:

```ts
{
  userId: string;
  permissions: string[];
  roles?: string[];
  sessionId?: string;
}
```

The framework does not replace your identity provider — it consumes the session you already trust.

---

## Authorization

Example permissions:

```text
members.read
members.write
attendance.read
employees.read
revenue.read
expenses.read
reports.read
database.schema
database.query
```

Tools declare a required permission. A receptionist with `members.read` + `attendance.read` does not automatically receive `revenue.read`.

---

## Examples

- `examples/basic` — Postgres + MCP stdio server sketch  
- Domain tools such as `members.statistics` show how to prefer constrained tools over free-form SQL  

---

## AI contexts (roadmap)

| Context | Purpose | Example shape |
| --- | --- | --- |
| Decision | “What needs my attention?” | Actionable cards |
| Report | “Customer aging” | `{ type: "table", columns, rows }` |
| Graph | “Revenue vs expenses” | `{ type: "chart", chart: "line", series }` |

Phase 1 focuses on secure schema + query tools. Structured decision/report/graph contexts land in Phase 2.

---

## Custom tools

```ts
agent.registerTool({
  name: "payments.overdue",
  description: "List overdue payments for the current tenant",
  permission: "payments.read",
  handler: async (_input, context) => {
    // Use context.tenant.tenantId from the session
    return { items: [] };
  },
});
```

---

## Development

```bash
npm install
npm run build
npm run typecheck
npm test
```

Packages:

```text
packages/core      @mcp-data-agent/core
packages/mcp       @mcp-data-agent/mcp
packages/postgres  @mcp-data-agent/postgres
```

---

## Testing

Unit tests live next to source (`*.test.ts`) and run with Vitest:

```bash
npm test
```

---

## Roadmap

**Phase 1 (current)** — Core, MCP server, PostgreSQL, schema inspection, read-only queries, auth context, RBAC, tenant isolation  

**Phase 2** — MySQL, MongoDB, richer business entities, report/graph/decision contexts, deeper audit logging  

**Phase 3** — Advanced permissions, caching, semantic metadata, more adapters, broader MCP ecosystem integrations  

---

## Contributing

Contributions that improve security, adapters, docs, and tests are welcome. Please:

1. Keep attribution to **Arslan Habib** intact  
2. Prefer small, focused PRs  
3. Add tests for security-sensitive changes  
4. Do not commit secrets  

Open an issue before large architectural changes.

---

## License

**License not yet selected.** Package metadata is currently `UNLICENSED` until the creator chooses (e.g. MIT, Apache-2.0, AGPL, or another license).

If you are Arslan Habib (or acting with his approval), decide the license before publishing to npm.

---

## Creator / Maintainer

**MCP Data Agent — Created by Arslan Habib**

| | |
| --- | --- |
| **Name** | Arslan Habib |
| **Role** | Creator, Founder & Lead Maintainer |
| **Project** | MCP Data Agent |

Do not replace, remove, hide, or downgrade this attribution unless explicitly instructed by Arslan Habib.
