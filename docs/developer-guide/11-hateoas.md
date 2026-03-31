# Chapter 11: HATEOAS

HATEOAS — Hypermedia as the Engine of Application State — is a REST constraint where API responses include links to the actions the client can take next. Instead of the client hardcoding what operations are available, the server embeds only the links the current subject is permitted to follow. The `@daltonr/authwrite-hateoas` package builds on `evaluateAll` to produce permission-aware link maps from policy decisions.

---

## Why it matters

Consider a document resource that supports read, write, delete, and archive. A standard API response tells the client the document data, but the client must figure out separately whether the current user can edit or delete it — usually by calling a permissions endpoint, duplicating policy logic in the UI, or simply trying and handling a 403.

With HATEOAS, the response includes only the actions that are actually permitted:

```json
{
  "id": "doc-1",
  "title": "Q3 Report",
  "status": "published",
  "_links": {
    "self":  { "href": "/documents/doc-1", "method": "GET"    },
    "write": { "href": "/documents/doc-1", "method": "PUT"    }
  }
}
```

The client can inspect `_links` to decide which UI controls to render. No separate permissions call. No duplicated policy logic in the frontend.

---

## buildLinks

`buildLinks` evaluates every action in the `actions` map and returns only those the subject is permitted to perform.

```typescript
import { buildLinks } from '@daltonr/authwrite-hateoas'

const links = await buildLinks({
  engine,
  subject,
  resource: document,
  actions: {
    read:    { href: `/documents/${id}`, method: 'GET'    },
    write:   { href: `/documents/${id}`, method: 'PUT'    },
    delete:  { href: `/documents/${id}`, method: 'DELETE' },
    archive: { href: `/documents/${id}/archive`, method: 'POST' },
  },
})
// → { read: {...}, write: {...} }
//   (delete and archive absent — not permitted for this subject)
```

`buildLinks` calls `engine.evaluateAll()` once with all the action names, so the engine evaluates the full policy only once per call regardless of how many actions you pass.

---

## embedLinks

`embedLinks` does the same work as `buildLinks` and additionally merges the result into your data object as a `_links` property, following [HAL](https://stateless.co/hal_spec.html) conventions.

```typescript
import { embedLinks } from '@daltonr/authwrite-hateoas'

const body = await embedLinks(document, {
  engine,
  subject,
  resource: document,
  self:    { href: `/documents/${document.id}`, method: 'GET' },
  actions: {
    write:   { href: `/documents/${document.id}`, method: 'PUT'    },
    delete:  { href: `/documents/${document.id}`, method: 'DELETE' },
    archive: { href: `/documents/${document.id}/archive`, method: 'POST' },
  },
})
// → { ...document, _links: { self: {...}, write: {...} } }
```

A few things to notice:

- `self` is always included in `_links` when provided. It is not subject to policy evaluation — the resource has already been fetched and returned, so the client clearly has read access.
- `embedLinks` does not mutate the original `data` object. It returns a new object.
- The `data` type is preserved — TypeScript knows the result type is `T & { _links: LinkMap }`.

---

## linksFromDecisions

`linksFromDecisions` is a synchronous variant for cases where you have already called `evaluateAll()` and want to build links without a second async round-trip. This is useful when you are computing links alongside other per-resource work.

```typescript
import { linksFromDecisions } from '@daltonr/authwrite-hateoas'

// You may already have decisions from an earlier evaluateAll call
const decisions = await engine.evaluateAll({
  subject,
  resource: document,
  actions: ['read', 'write', 'delete'],
})

const links = linksFromDecisions(decisions, {
  read:   { href: `/documents/${id}`, method: 'GET'    },
  write:  { href: `/documents/${id}`, method: 'PUT'    },
  delete: { href: `/documents/${id}`, method: 'DELETE' },
})
```

If a decision key has no matching template, it is silently ignored. If a template key has no matching decision, it is omitted from the result.

---

## Link templates

Every action maps to a `LinkTemplate`:

```typescript
interface LinkTemplate {
  href:    string
  method?: string   // HTTP method; defaults to 'GET' by convention
  title?:  string   // Human-readable label for UI rendering
  [key: string]:  unknown  // Any extra HAL fields (templated, type, etc.)
}
```

All properties beyond `href` are passed through unchanged. You can include any HAL extension fields and they will appear in the output.

---

## Enforcer modes

Because `buildLinks` and `embedLinks` delegate to whatever `AuthEvaluator` they receive, they respect the Enforcer's mode automatically:

- **`enforce` mode** (default): links reflect real policy decisions.
- **`audit` mode**: all decisions are overridden to `allowed: true` — all links are returned. Useful during rollout to see what links would be visible without blocking users.
- **`suspended` mode**: all decisions are overridden to `allowed: false` (policy still evaluates) — no action links are returned.
- **`lockdown` mode**: engine bypassed entirely — no action links returned, no observers fired. Useful during incidents.

```typescript
import { createEnforcer } from '@daltonr/authwrite-core'

const enforcer = createEnforcer(engine, { mode: 'audit' })

const links = await buildLinks({ engine: enforcer, subject, resource, actions })
// → all links present, regardless of policy
```

---

## Express route example

```typescript
import express from 'express'
import { createAuthEngine } from '@daltonr/authwrite-core'
import { createAuthMiddleware } from '@daltonr/authwrite-express'
import { embedLinks } from '@daltonr/authwrite-hateoas'

const engine = createAuthEngine({ policy: documentPolicy })

const authMiddleware = createAuthMiddleware<Subject, Resource>({
  engine,
  subject:  (req) => req.user as Subject,
  resource: async (req) => db.documents.findById(req.params.id),
  action:   'read',
})

app.get('/documents/:id', authMiddleware, async (req, res) => {
  const doc = await db.documents.findById(req.params.id)

  const body = await embedLinks(doc, {
    engine,
    subject:  req.user as Subject,
    resource: doc,
    self:     { href: `/documents/${doc.id}`, method: 'GET' },
    actions: {
      write:   { href: `/documents/${doc.id}`, method: 'PUT'    },
      delete:  { href: `/documents/${doc.id}`, method: 'DELETE' },
      archive: { href: `/documents/${doc.id}/archive`, method: 'POST' },
    },
  })

  res.json(body)
})
```

The authorization middleware runs `evaluate()` to gate access; the route handler then calls `evaluateAll()` via `embedLinks` to build the links. These are two separate engine calls, but the policy is the same — the engine's deny-by-default logic applies consistently in both places.

---

© 2026 Devjoy Ltd. MIT License.
