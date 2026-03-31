# Observer PG API Reference

This reference covers `@daltonr/authwrite-observer-pg` — a Postgres audit log observer for `@daltonr/authwrite-core`.

> **Peer dependency.** Requires `pg >= 8.0.0`.

---

## `createPgObserver(config)`

```typescript
export function createPgObserver(config: PgObserverConfig): AuthObserver
```

Creates an `AuthObserver` that writes every authorization decision to a Postgres table as an append-only audit record. Pass it to `createAuthEngine({ observers })` or `engine.addObserver()`.

Database writes are fire-and-forget — a slow or unavailable database never blocks request handling. Failures are reported through the optional `onError` callback.

```typescript
import pg from 'pg'
import { createPgObserver } from '@daltonr/authwrite-observer-pg'
import { createAuthEngine } from '@daltonr/authwrite-core'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const engine = createAuthEngine({
  policy,
  observers: [
    createPgObserver({ client: pool }),
  ],
})
```

### `PgObserverConfig`

| Option | Type | Default | Description |
|---|---|---|---|
| `client` | `QueryClient` | required | A `pg.Pool`, `pg.Client`, or any object with a compatible `query(text, values)` method. |
| `table` | `string` | `'authz_decisions'` | Name of the table to write records to. Accepts `identifier` or `schema.identifier` form. |
| `onError` | `(err: Error) => void` | — | Called when a database write fails. Omit to silently discard write errors. |

---

## `QueryClient`

```typescript
export interface QueryClient {
  query(text: string, values?: unknown[]): Promise<unknown>
}
```

Duck-typed interface. Any `pg.Pool` or `pg.Client` satisfies it out of the box. You can also pass a test double or a wrapper around another Postgres library.

---

## Table schema

Run this migration once before starting the observer:

```sql
CREATE TABLE authz_decisions (
  id            bigserial    PRIMARY KEY,
  decided_at    timestamptz  NOT NULL DEFAULT now(),
  subject_id    text         NOT NULL,
  resource_type text,
  resource_id   text,
  action        text         NOT NULL,
  policy_id     text         NOT NULL,
  allowed       boolean      NOT NULL,
  reason        text         NOT NULL,
  defaulted     boolean      NOT NULL DEFAULT false,
  duration_ms   real         NOT NULL,
  override      text,
  error_message text,
  source        text,
  subject       jsonb,
  resource      jsonb
);

CREATE INDEX ON authz_decisions (subject_id, action);
CREATE INDEX ON authz_decisions (decided_at);
```

### Column reference

| Column | Type | Description |
|---|---|---|
| `id` | `bigserial` | Auto-incrementing surrogate key. |
| `decided_at` | `timestamptz` | Set by the database at insert time (`DEFAULT now()`). |
| `subject_id` | `text` | `decision.context.subject.id` |
| `resource_type` | `text` | `decision.context.resource?.type` — `null` for subject-only evaluations. |
| `resource_id` | `text` | `decision.context.resource?.id` — `null` for subject-only evaluations. |
| `action` | `text` | `decision.context.action` |
| `policy_id` | `text` | `decision.policy` — the policy ID that produced the decision. |
| `allowed` | `boolean` | `decision.allowed` — the final outcome after any enforcer mode override. |
| `reason` | `text` | `decision.reason` — the rule ID that decided, or `'default'`. |
| `defaulted` | `boolean` | `decision.defaulted` — `true` when no rule matched and the default effect applied. |
| `duration_ms` | `real` | `decision.durationMs` — evaluation time in milliseconds. |
| `override` | `text` | `decision.override` — `'permissive'`, `'suspended'`, or `'lockdown'` when an enforcer mode changed the outcome. |
| `error_message` | `text` | `decision.error?.message` — set when the engine caught an error during evaluation. |
| `source` | `text` | `event.source` — the middleware or caller that triggered the evaluation. |
| `subject` | `jsonb` | Full `decision.context.subject` serialized as JSON. |
| `resource` | `jsonb` | Full `decision.context.resource` serialized as JSON. `null` for subject-only evaluations. |

---

## Behaviour notes

### Fire-and-forget writes

`onDecision` starts the INSERT and returns immediately without awaiting the result. This ensures that a Postgres outage or slow write never adds latency to authorization checks. If the INSERT fails, the error is passed to `config.onError` (if provided) and otherwise discarded.

### `onPolicyReload` is a no-op

The observer is an append-only audit log. Policy reloads are not recorded — they have no effect on past decisions already in the table. Each new decision will carry the current `policy_id` automatically.

### `onError` forwards engine errors

If the engine encounters an error during policy evaluation, `onError` is called with that error. The observer passes it to `config.onError` without writing anything to the database.

### Table name validation

The `table` config option is validated against `/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/` at construction time. Passing an invalid identifier (e.g. containing semicolons or spaces) throws immediately before any queries are made.

---

## Example — custom table and error logging

```typescript
import pg from 'pg'
import { createPgObserver } from '@daltonr/authwrite-observer-pg'
import { createAuthEngine } from '@daltonr/authwrite-core'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const pgObserver = createPgObserver({
  client: pool,
  table:  'audit.authz_decisions',
  onError: (err) => {
    console.error('[authwrite/observer-pg] write failed:', err.message)
  },
})

const engine = createAuthEngine({
  policy,
  observers: [pgObserver],
})
```

---

## Example — using a `pg.Client` instead of a pool

```typescript
import { Client } from 'pg'

const client = new Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

const observer = createPgObserver({ client })
```

Any object that implements `QueryClient` (i.e. has a `query(text, values)` method) is accepted — you are not required to use `node-postgres` specifically.

---

© 2026 Devjoy Ltd. MIT License.
