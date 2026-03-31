# HATEOAS API Reference

This reference covers `@daltonr/authwrite-hateoas` — permission-aware hypermedia link building for `@daltonr/authwrite-core`.

---

## `buildLinks(config)`

```typescript
export async function buildLinks<
  S extends Subject = Subject,
  R extends Resource = Resource,
>(config: BuildLinksConfig<S, R>): Promise<LinkMap>
```

Evaluates every action in `config.actions` using `engine.permissions()` and returns a `LinkMap` containing only the links the subject is permitted to follow. Does not fire observers — use `evaluate()` or `evaluateAll()` directly when you need an audited decision.

### `BuildLinksConfig` options

| Option | Type | Default | Description |
|---|---|---|---|
| `engine` | `AuthEvaluator<S, R>` | required | The evaluator used to make authorization decisions. |
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

## `linksFromDecisions(permissions, actions)`

```typescript
export function linksFromDecisions(
  permissions: Record<string, boolean>,
  actions:     Record<Action, LinkTemplate>,
): LinkMap
```

Synchronous variant for cases where you have already called `engine.permissions()` and want to build links without an additional async round-trip.

```typescript
const perms = await engine.permissions(subject, resource, ['read', 'write', 'delete'])
// { read: true, write: true, delete: false }

const links = linksFromDecisions(perms, {
  read:   { href: '/documents/doc-1', method: 'GET'    },
  write:  { href: '/documents/doc-1', method: 'PUT'    },
  delete: { href: '/documents/doc-1', method: 'DELETE' },
})
// { read: { href: '...' }, write: { href: '...' } }
// delete absent — not permitted
```

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

### `engine.permissions()` is called once

`buildLinks` and `embedLinks` call `engine.permissions()` once with all action names from the `actions` map. This does not fire observers — it is a UI rendering query, not an enforcement decision.

### `self` is unconditional

The `self` link in `embedLinks` is not subject to policy evaluation. It is included whenever provided, because the resource has already been fetched and returned to the client.

### Non-mutating

`embedLinks` returns a new object (`{ ...data, _links }`). The original `data` argument is never modified.

### Engine mode effects

| Mode | Behaviour |
|---|---|
| `enforce` | Links reflect real policy decisions. |
| `audit` | All actions return `true` from `permissions()` — all links are included. |
| `suspended` | All actions return `false` — no action links are included. `self` is still included by `embedLinks` when provided. |
| `lockdown` | All actions return `false` without evaluation — no action links are included. `self` is still included by `embedLinks` when provided. |

---

## Example

```typescript
import { buildLinks, embedLinks, linksFromDecisions } from '@daltonr/authwrite-hateoas'
import { createAuthEngine } from '@daltonr/authwrite-core'

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
// links.read present; write/delete/archive absent (editor of another's doc)

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

const perms = await engine.permissions(
  { id: 'u1', roles: ['editor'] },
  { type: 'document', id: 'doc-1', ownerId: 'other' },
  ['read', 'write', 'delete'],
)

const links2 = linksFromDecisions(perms, {
  read:   { href: '/documents/doc-1', method: 'GET'    },
  write:  { href: '/documents/doc-1', method: 'PUT'    },
  delete: { href: '/documents/doc-1', method: 'DELETE' },
})
```

---

© 2026 Devjoy Ltd. MIT License.
