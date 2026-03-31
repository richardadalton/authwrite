# Loader DB API Reference

This reference covers `@daltonr/authwrite-loader-db` — a database-agnostic hot-reloadable policy loader for `@daltonr/authwrite-core`.

---

## `createDbLoader(config)`

```typescript
export function createDbLoader<
  S extends Subject = Subject,
  R extends Resource = Resource,
>(config: DbLoaderConfig<S, R>): PolicyLoader<S, R>
```

Creates a `PolicyLoader` that fetches policy data from a database by calling a `query` function you provide. The loader is DB-agnostic — you supply the query function and wire it to whichever database client your application uses (Postgres, MySQL, SQLite, etc.).

```typescript
import { createDbLoader } from '@daltonr/authwrite-loader-db'
import { createAuthEngine, fromLoader } from '@daltonr/authwrite-core'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const loader = createDbLoader({
  query: async () => {
    const { rows } = await pool.query('SELECT data FROM policies WHERE id = $1', ['documents'])
    return rows[0].data   // must match the serializable policy schema
  },
  rules: myRegistry,
  pollInterval: 30_000,
})

const engine = createAuthEngine({ policy: await fromLoader(loader) })
```

### `DbLoaderConfig`

| Option | Type | Default | Description |
|---|---|---|---|
| `query` | `() => Promise<unknown>` | required | Called on each load and poll. Must return an object matching the policy schema below. |
| `rules` | `RuleRegistry<S, R>` | required | Maps rule IDs (from the query result) to their runtime `match`/`condition` implementations. |
| `pollInterval` | `number` | `30000` | How often to poll for policy changes, in milliseconds. |

---

## Policy schema

The object returned by `query` must follow this structure:

```typescript
{
  id:            string               // required
  defaultEffect: 'allow' | 'deny'    // required
  rules: [
    {
      id:          string             // required — must exist in the rules registry
      description?: string
      priority?:    number
      allow?:       string[]          // action names, or ['*'] for all
      deny?:        string[]
    }
  ]
  fieldRules?: [                      // optional
    {
      id:      string                 // required — must exist in the rules registry
      expose:  string[]
      redact:  string[]
    }
  ]
  version?:     string
  description?: string
}
```

The schema mirrors the [YAML/JSON schema](loader-yaml-api.md#schema) used by `@daltonr/authwrite-loader-yaml`. The same rule registry pattern applies: `match` and `condition` functions are provided through `rules`, not stored in the database.

---

## `RuleFn` and `RuleRegistry`

```typescript
export interface RuleFn<S extends Subject, R extends Resource> {
  match:      (ctx: AuthContext<S, R>) => boolean
  condition?: (ctx: AuthContext<S, R>) => boolean
}

export type RuleRegistry<
  S extends Subject = Subject,
  R extends Resource = Resource,
> = Record<string, RuleFn<S, R>>
```

Same interface as `@daltonr/authwrite-loader-yaml`. Rules are keyed by ID. If the query result references a rule ID that is not in the registry, `load()` throws.

---

## Polling

`watch(cb)` starts a `setInterval` loop that calls `query()` every `pollInterval` milliseconds. When the query succeeds, it calls `cb` with the loaded policy. Transient query failures are swallowed — the next poll interval will retry.

Use `fromLoader(loader, onReload?)` from `@daltonr/authwrite-core` to wire up automatic engine reloads:

```typescript
const engine = createAuthEngine({
  policy: await fromLoader(loader, () => {
    console.log('policy reloaded')
  }),
})
```

---

## Behaviour notes

### DB-agnostic by design

`loader-db` has no database dependency. The `query` function is your integration point — you own the connection, the SQL, and the result shape. The loader just validates the return value and merges the registry functions.

### Schema stored as JSON/JSONB

The most common pattern is a `jsonb` column containing a policy object. You can also reconstruct the shape from relational tables in the query function:

```typescript
query: async () => {
  const policy = await db.policies.findFirst({ where: { id: 'documents' } })
  const rules   = await db.rules.findMany({ where: { policyId: 'documents' } })
  return { ...policy, rules }
}
```

### `load()` always re-fetches

`load()` calls `query()` every time it is invoked. There is no in-memory cache. If you need to avoid repeated DB round-trips on startup, call `load()` once and pass the result to `createAuthEngine({ policy })` directly. Use `fromLoader` only when you want watch-based live reloads.

### Validation errors

`load()` throws synchronously after the query resolves if the returned data fails validation or references a missing registry entry. These errors propagate to the caller. Errors during polling (inside `watch`) are swallowed.

---

## Example — full setup

```typescript
import { createDbLoader, RuleRegistry } from '@daltonr/authwrite-loader-db'
import { createAuthEngine, fromLoader }  from '@daltonr/authwrite-core'
import pg from 'pg'
import type { Subject, Resource, AuthContext } from '@daltonr/authwrite-core'

type User = Subject & { orgId: string }
type Doc  = Resource & { ownerId: string; orgId: string }

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const registry: RuleRegistry<User, Doc> = {
  'owner-read-write': {
    match: ({ subject, resource }) => resource?.ownerId === subject.id,
  },
  'org-read': {
    match: ({ subject, resource }) => resource?.orgId === subject.orgId,
  },
  'admin-full': {
    match: ({ subject }) => subject.roles.includes('admin'),
  },
}

const loader = createDbLoader<User, Doc>({
  query: async () => {
    const { rows } = await pool.query(
      'SELECT policy_data FROM active_policies WHERE scope = $1',
      ['documents'],
    )
    if (!rows[0]) throw new Error('No active policy found for scope "documents"')
    return rows[0].policy_data
  },
  rules: registry,
  pollInterval: 60_000,
})

const engine = createAuthEngine({ policy: await fromLoader(loader) })
```

---

© 2026 Devjoy Ltd. MIT License.
