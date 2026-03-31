# HATEOAS API Reference

This reference covers `@authwrite/hateoas` — permission-aware hypermedia link building for `@authwrite/core`.

---

## `buildLinks(config)`

```typescript
export async function buildLinks<
  S extends Subject = Subject,
  R extends Resource = Resource,
>(config: BuildLinksConfig<S, R>): Promise<LinkMap>
```

Evaluates every action in `config.actions` using `engine.evaluateAll()` and returns a `LinkMap` containing only the links the subject is permitted to follow.

### `BuildLinksConfig` options

| Option | Type | Default | Description |
|---|---|---|---|
| `engine` | `AuthEvaluator<S, R>` | required | The evaluator used to make authorization decisions. Accepts an `AuthEngine` or `Enforcer`. |
| `subject` | `S` | required | The subject whose permissions are evaluated. |
| `resource` | `R` | — | (optional) The resource being acted upon. Omit for subject-level actions. |
| `actions` | `Record<Action, LinkTemplate>` | required | Map of action name to link template. Only entries whose action is permitted appear in the result. |

---

## `embedLinks(data, config)`

```typescript
export async function embedLinks<
  T extends object,
  S extends Subject = Subject,
  R extends Resource = Resource,
>(data: T, config: EmbedLinksConfig<S, R>): Promise<T & { _links: LinkMap }>
```

Builds permission-aware links and merges them into `data` as a `_links` property, following [HAL](https://stateless.co/hal_spec.html) conventions. Does not mutate the original `data` object.

### `EmbedLinksConfig` options

Extends `BuildLinksConfig` with one additional field:

| Option | Type | Default | Description |
|---|---|---|---|
| `self` | `LinkTemplate` | — | (optional) A link added unconditionally as `_links.self`. Not subject to policy evaluation. |
| *(plus all `BuildLinksConfig` options)* | | | |

---

## `linksFromDecisions(decisions, actions)`

```typescript
export function linksFromDecisions(
  decisions: Record<string, { allowed: boolean }>,
  actions:   Record<Action, LinkTemplate>,
): LinkMap
```

Synchronous variant. Filters `actions` using a pre-fetched `evaluateAll` result. Only actions whose decision has `allowed: true` and that have a corresponding template are included.

This avoids a second async round-trip when you have already called `evaluateAll()` for another purpose.

---

## Types

### `LinkTemplate`

```typescript
export interface LinkTemplate {
  href:    string
  method?: string
  title?:  string
  [key: string]: unknown
}
```

| Field | Type | Description |
|---|---|---|
| `href` | `string` | The URL for this action. |
| `method` | `string` | HTTP method. Defaults to `'GET'` by convention if omitted. |
| `title` | `string` | Human-readable label, useful for UI rendering. |
| `[key]` | `unknown` | Any additional HAL extension fields (`templated`, `type`, etc.) are passed through unchanged. |

### `LinkMap`

```typescript
export type LinkMap = Record<string, LinkTemplate>
```

A map of action name to link template. Only permitted actions are present.

---

## Behaviour notes

### `evaluateAll` is called once

`buildLinks` and `embedLinks` call `engine.evaluateAll()` once with all action names from the `actions` map. The engine evaluates the full policy a single time, regardless of how many actions are passed.

### `self` is unconditional

The `self` link in `embedLinks` is not subject to policy evaluation. It is included whenever provided, because the resource has already been fetched and returned to the client.

### Non-mutating

`embedLinks` returns a new object (`{ ...data, _links }`). The original `data` argument is never modified.

### Enforcer modes

All three functions respect the Enforcer mode:

| Mode | Behaviour |
|---|---|
| `enforce` | Links reflect real policy decisions. |
| `audit` | All decisions are `allowed: true` — all action links are returned. |
| `lockdown` | All decisions are `allowed: false` — no action links are returned. `self` is still included by `embedLinks` when provided. |

---

## Example

```typescript
import { buildLinks, embedLinks, linksFromDecisions } from '@authwrite/hateoas'
import { createAuthEngine } from '@authwrite/core'

const engine = createAuthEngine({ policy: documentPolicy })

// ── buildLinks ────────────────────────────────────────────────────────────────

const links = await buildLinks({
  engine,
  subject:  { id: 'u1', roles: ['editor'] },
  resource: { type: 'document', id: 'doc-1', status: 'published', ownerId: 'other' },
  actions: {
    read:    { href: '/documents/doc-1', method: 'GET'    },
    write:   { href: '/documents/doc-1', method: 'PUT'    },
    delete:  { href: '/documents/doc-1', method: 'DELETE' },
    archive: { href: '/documents/doc-1/archive', method: 'POST' },
  },
})
// links.read present; write/delete/archive absent

// ── embedLinks ────────────────────────────────────────────────────────────────

const body = await embedLinks(document, {
  engine,
  subject:  { id: 'u1', roles: ['editor'] },
  resource: document,
  self:     { href: '/documents/doc-1', method: 'GET' },
  actions: {
    write:   { href: '/documents/doc-1', method: 'PUT'    },
    delete:  { href: '/documents/doc-1', method: 'DELETE' },
  },
})
// body._links.self always present; write/delete only if permitted

// ── linksFromDecisions ────────────────────────────────────────────────────────

const decisions = await engine.evaluateAll({
  subject:  { id: 'u1', roles: ['editor'] },
  resource: document,
  actions:  ['read', 'write', 'delete'],
})

const links2 = linksFromDecisions(decisions, {
  read:   { href: '/documents/doc-1', method: 'GET'    },
  write:  { href: '/documents/doc-1', method: 'PUT'    },
  delete: { href: '/documents/doc-1', method: 'DELETE' },
})
```

---

© 2026 Devjoy Ltd. MIT License.
