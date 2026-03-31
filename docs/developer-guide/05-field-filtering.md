# Chapter 5: Field-Level Filtering

Granting access to a resource is not always binary. A user might be permitted to read a document — but not its internal audit notes. A billing manager might see invoice amounts — but not the customer's personal address. An API consumer might be allowed to list users — but not their hashed passwords or MFA secrets. Action-level authorization answers the question "can this person read this resource at all?" Field-level filtering answers the follow-up question: "if so, which parts of it?"

This chapter covers how Authwrite handles that second question through `FieldRule`, `evaluateRead()`, and `applyFieldFilter()`.

---

## The problem

Without field filtering, your application code has to handle this itself: check authorization, then manually strip fields before returning the response. That logic tends to scatter across handlers, serializers, and DTO mappers. It gets out of sync. Fields that should be redacted slip through.

Authwrite centralises field visibility rules in the same place as action rules. The same `match` mechanism applies. The same engine evaluates them. And the result — a list of permitted field names — is computed alongside the access decision.

---

## FieldRule anatomy

A **FieldRule** has four fields:

```typescript
import type { FieldRule } from '@daltonr/authwrite-core'

const rule: FieldRule = {
  id: 'owner-sees-all',
  match: (ctx) => ctx.resource?.ownerId === ctx.subject.id,
  expose: ['*'],
  redact: ['internalNotes'],
}
```

| Field | Required | Purpose |
|---|---|---|
| `id` | Yes | Unique identifier. Appears in debug output. |
| `match` | Yes | Same predicate mechanism as `PolicyRule.match`. If this returns `false`, the rule does not contribute to field visibility. |
| `expose` | Yes | Fields to make visible. `'*'` means all fields. |
| `redact` | Yes | Fields to hide. Applied after `expose`. Wins over everything. |

`expose` and `redact` are arrays of field name strings. Both are required — pass an empty array `[]` if one does not apply to a given rule.

---

## How expose and redact interact

The final set of allowed fields for a request is the union of all `expose` lists from all matching field rules, minus everything in any `redact` list from any matching field rule.

**Redact always wins over expose.** This is unconditional. If any matching field rule redacts `ssn`, the field `ssn` is absent from the allowed fields list regardless of what any other rule exposes. The same applies to `expose: ['*']` — even a wildcard expose does not override a specific redact.

```
Final allowed fields = union(all matching expose lists)
                       minus union(all matching redact lists)
```

This means you can write a generous baseline rule that exposes everything, and then layer targeted redact rules on top of it for sensitive fields:

```typescript
fieldRules: [
  {
    id: 'baseline-read',
    match: (ctx) => ctx.subject.roles.includes('member'),
    expose: ['id', 'title', 'summary', 'createdAt', 'updatedAt'],
    redact: [],
  },
  {
    id: 'owner-extended',
    match: (ctx) => ctx.resource?.ownerId === ctx.subject.id,
    expose: ['id', 'title', 'summary', 'content', 'createdAt', 'updatedAt'],
    redact: [],
  },
  {
    id: 'admin-all',
    match: (ctx) => ctx.subject.roles.includes('admin'),
    expose: ['*'],
    redact: [],
  },
]
```

---

## `evaluateRead()`: one call for access and fields

`evaluateRead()` checks whether the subject can read the resource and, if so, computes the allowed field list in a single call. You do not need to call `evaluate()` for access and then separately compute fields.

```typescript
import { createAuthEngine } from '@daltonr/authwrite-core'

const engine = createAuthEngine({ policy })

const result = await engine.evaluateRead({
  subject: { id: 'user-1', roles: ['member'] },
  resource: { type: 'document', id: 'doc-99', ownerId: 'user-1' },
})

// result.decision — the full Decision object for the 'read' action
// result.allowedFields — string[] of permitted field names
```

`evaluateRead()` returns an `EvaluateReadResult`:

```typescript
interface EvaluateReadResult {
  decision: Decision
  allowedFields: string[]
}
```

If `decision.allowed` is `false`, `allowedFields` will be empty. There is no point in filtering fields for a denied read — the resource should not be returned at all.

---

## `applyFieldFilter()`: strip a resource to permitted fields

Once you have `allowedFields`, use `applyFieldFilter()` to produce a new object containing only the permitted keys:

```typescript
import { applyFieldFilter } from '@daltonr/authwrite-core'

const document = await db.getDocument('doc-99')

const result = await engine.evaluateRead({
  subject,
  resource: { type: 'document', id: document.id, ownerId: document.ownerId },
})

if (!result.decision.allowed) {
  throw new ForbiddenError()
}

const safeDocument = applyFieldFilter(document, result.allowedFields)
// safeDocument is Partial<typeof document> — only permitted fields present
```

`applyFieldFilter` is a pure function. It takes any object and a field list and returns a new object — it does not mutate the original. The return type is `Partial<T>` where `T` is the type of the input object.

---

## Full workflow example: owner, viewer, admin

Here is a complete example with three roles seeing different cuts of the same document:

```typescript
import { createAuthEngine, applyFieldFilter } from '@daltonr/authwrite-core'
import type { PolicyDefinition, Subject, Resource } from '@daltonr/authwrite-core'

interface AppSubject extends Subject {
  roles: string[]
}

interface DocumentResource extends Resource {
  type: 'document'
  ownerId?: string
}

const policy: PolicyDefinition<AppSubject, DocumentResource> = {
  id: 'document-policy',
  version: '1',
  defaultEffect: 'deny',
  rules: [
    {
      id: 'admin-all',
      priority: 100,
      match: (ctx) => ctx.subject.roles.includes('admin'),
      allow: ['*'],
    },
    {
      id: 'owner-read',
      priority: 10,
      match: (ctx) => ctx.resource?.ownerId === ctx.subject.id,
      allow: ['read'],
    },
    {
      id: 'viewer-read',
      priority: 5,
      match: (ctx) => ctx.subject.roles.includes('viewer'),
      allow: ['read'],
    },
  ],
  fieldRules: [
    {
      // Admins see everything, including internal fields
      id: 'admin-sees-all',
      match: (ctx) => ctx.subject.roles.includes('admin'),
      expose: ['*'],
      redact: [],
    },
    {
      // Owners see their full document but not internal audit notes
      id: 'owner-sees-content',
      match: (ctx) => ctx.resource?.ownerId === ctx.subject.id,
      expose: ['id', 'title', 'content', 'summary', 'createdAt', 'updatedAt', 'tags'],
      redact: ['internalNotes', 'auditLog'],
    },
    {
      // Viewers see only the public-facing fields
      id: 'viewer-sees-summary',
      match: (ctx) => ctx.subject.roles.includes('viewer'),
      expose: ['id', 'title', 'summary', 'createdAt', 'tags'],
      redact: ['content', 'internalNotes', 'auditLog'],
    },
  ],
}

const engine = createAuthEngine({ policy })

async function getDocumentForUser(documentId: string, subject: AppSubject) {
  const document = await db.getDocument(documentId)

  const resource: DocumentResource = {
    type: 'document',
    id: document.id,
    ownerId: document.ownerId,
  }

  const { decision, allowedFields } = await engine.evaluateRead({ subject, resource })

  if (!decision.allowed) {
    throw new ForbiddenError(`Access denied: ${decision.reason}`)
  }

  return applyFieldFilter(document, allowedFields)
}
```

A few things to notice:

- Field rules and access rules are evaluated together in `evaluateRead()`. You write one set of configuration; the engine handles both checks.
- The `resource` passed to `evaluateRead()` is a lightweight descriptor — it does not need to be the full document. Load the full document only after the access check passes.
- The `ForbiddenError` message includes `decision.reason`. Even for end-user-facing errors you can log the reason internally for audit purposes.
- `applyFieldFilter` returns a new object. The original `document` is unchanged.

---

## The empty fieldRules case

When `fieldRules` is absent or an empty array, `evaluateRead()` returns all fields. There is no field filtering by default — field visibility is permissive unless you opt in by adding field rules.

This is intentional. Adding `fieldRules: []` to a policy does not restrict anything. You must add at least one field rule with a non-empty `expose` list for field filtering to take effect.

This means you can adopt field filtering incrementally: add `fieldRules` to an existing policy without changing any existing behaviour until you add rules that match real subjects.

```
fieldRules absent or []  →  allowedFields contains all fields
fieldRules present        →  allowedFields is computed from matching rules
no rules match            →  allowedFields is empty (no expose, no redact)
```

The third case — field rules are present but none match the current request — results in an empty `allowedFields`. If `evaluateRead()` returns an empty `allowedFields` alongside `decision.allowed: true`, the subject has read access but no field rules cover them. This is likely a policy gap. Use it as a signal to add a field rule.

---

Chapter 6 covers the Enforcer — the runtime mode layer that sits above the policy engine and controls whether the policy decision is honoured, overridden permissively, or locked down entirely.

© 2026 Devjoy Ltd. MIT License.
