# Chapter 3: Actions, Subjects, and Resources

Every authorization check is a question with the same shape: "Can this person do this thing to this target?" Authwrite makes that shape explicit through three interfaces — `Subject`, `Resource`, and `Action` — and through the `AuthContext` that binds them together. Before writing rules for a real system you need to understand the three categories of action that exist, because each category changes which fields are present on the context, and a rule that does not account for this will behave incorrectly.

---

## The three action categories

Not every action has a resource. Not every action has a resource with an id. Authwrite models three distinct categories:

**Instance action** — the subject acts on a specific, existing resource. The resource has a `type` and an `id`. Examples: reading a document, updating an invoice, deleting a comment.

**Type action** — the subject acts on a resource type, not a specific instance. The resource has a `type` but no `id` because the instance does not exist yet. The canonical example is `create`: you cannot attach an id to something that has not been created.

**Subject action** — the subject acts on themselves and no resource is involved at all. The resource is absent from the context entirely. Examples: `change-password`, `logout`, `generate-api-key`.

```
Instance action:   subject + resource (type + id)   →  "user-1 wants to delete doc-99"
Type action:       subject + resource (type only)    →  "user-1 wants to create a document"
Subject action:    subject only                      →  "user-1 wants to change their password"
```

These are not a formal type system — they are a way of thinking about what to put in your `evaluate()` call.

---

## All three as `evaluate()` calls

```typescript
import { createAuthEngine } from '@authwrite/core'

const engine = createAuthEngine({ policy })

// Instance action — resource has id
const deleteDecision = await engine.evaluate({
  subject: { id: 'user-1', roles: ['member'] },
  resource: { type: 'document', id: 'doc-99', ownerId: 'user-1' },
  action: 'delete',
})

// Type action — resource has type but no id
const createDecision = await engine.evaluate({
  subject: { id: 'user-1', roles: ['member'] },
  resource: { type: 'document' },
  action: 'create',
})

// Subject action — no resource at all
const passwordDecision = await engine.evaluate({
  subject: { id: 'user-1', roles: ['member'] },
  action: 'change-password',
})
```

A few things to notice:

- For type actions, pass a `resource` with only `type`. Do not invent a placeholder id.
- For subject actions, omit `resource` entirely. The `AuthContext` type marks it optional for exactly this reason.
- The `action` string is yours to define. Use a consistent naming scheme across your system — `verb` or `verb-noun` work well (`read`, `create`, `delete`, `change-password`).

---

## Subject: the "who"

**Subject** represents the entity making the request. It has three fields:

```typescript
export interface Subject {
  id: string                              // unique identifier for the entity
  roles: string[]                         // role names; may be empty
  attributes?: Record<string, unknown>    // arbitrary extra data
}
```

Extend it to carry your application's user model:

```typescript
interface AppUser extends Subject {
  roles: string[]
  attributes?: {
    department?: string
    tier?: 'free' | 'pro' | 'enterprise'
    mfaVerified?: boolean
  }
}
```

A few things to notice:

- `roles` is always an array, never a single string. A user may have multiple roles. Rules should use `roles.includes('admin')`, not `roles === 'admin'`.
- `attributes` is a typed escape hatch for anything that does not fit into roles. Use it for per-user feature flags, subscription tier, verified state, or department membership.
- `id` is a required string. It should be stable and unique — a database UUID or an external identity provider subject ID.

---

## Resource: the "what"

**Resource** represents the thing being acted on. It has four fields:

```typescript
export interface Resource {
  type: string                             // the resource category ('document', 'invoice', etc.)
  id?: string                              // absent for type actions (create)
  ownerId?: string                         // optional ownership reference
  attributes?: Record<string, unknown>     // arbitrary extra data
}
```

Extend it per resource type:

```typescript
interface DocumentResource extends Resource {
  type: 'document'
  ownerId?: string
  attributes?: {
    archived?: boolean
    visibility?: 'public' | 'private'
    classification?: 'internal' | 'confidential' | 'public'
  }
}

interface InvoiceResource extends Resource {
  type: 'invoice'
  ownerId?: string
  attributes?: {
    status?: 'draft' | 'sent' | 'paid' | 'overdue'
    amount?: number
  }
}
```

`type` is the primary discriminant. Most rules begin by checking `ctx.resource?.type`, which lets you write a single policy file covering multiple resource types without rules accidentally cross-applying.

---

## `AuthContext.env` for request-level context

**env** is the escape hatch for request-level metadata that is not part of the subject or resource model. It carries the context in which the request is happening:

```typescript
const decision = await engine.evaluate({
  subject,
  resource,
  action: 'export',
  env: {
    ip: '203.0.113.42',
    userAgent: 'Mozilla/5.0 ...',
    timestamp: new Date(),
    region: 'eu-west-1',
  },
})
```

`env` is typed as:

```typescript
env?: { ip?: string; userAgent?: string; timestamp?: Date; [key: string]: unknown }
```

The index signature means you can add any key. Use it for geo-restriction rules, time-based access windows, trusted-network checks, and rate-limiting signals.

---

## Real-world rule examples for each category

### Instance action rule

```typescript
{
  id: 'owner-delete',
  description: 'Owners can delete their own documents',
  match: (ctx) =>
    ctx.resource?.type === 'document' &&
    ctx.resource?.id !== undefined &&         // confirm an instance exists
    ctx.resource?.ownerId === ctx.subject.id,
  allow: ['delete'],
}
```

### Type action rule

```typescript
{
  id: 'member-create-document',
  description: 'Members can create documents',
  match: (ctx) =>
    ctx.resource?.type === 'document' &&
    ctx.resource?.id === undefined &&          // no id — this is a type action
    ctx.subject.roles.includes('member'),
  allow: ['create'],
}
```

### Subject action rule

```typescript
{
  id: 'self-password-change',
  description: 'Any authenticated user can change their own password',
  match: (ctx) =>
    ctx.resource === undefined &&              // subject action — no resource
    ctx.subject.id !== undefined,
  allow: ['change-password'],
}
```

---

## The common mistake: checking `resource.id` without optional chaining

A rule that checks `ctx.resource.ownerId` without optional chaining will throw a `TypeError` when called for a subject action, because `ctx.resource` is `undefined`. The engine's `onError` policy catches this — but the rule will never match, and you will see `error` populated on the resulting decision.

**Incorrect:**

```typescript
match: (ctx) => ctx.resource.ownerId === ctx.subject.id
//              ^^^^^^^^^^^^ TypeError if resource is absent
```

**Correct:**

```typescript
match: (ctx) => ctx.resource?.ownerId === ctx.subject.id
```

More broadly: any rule that is scoped to instance actions should guard against the type and subject action cases by checking `ctx.resource?.type` and `ctx.resource?.id` with optional chaining. A rule written for documents should not silently apply when there is no resource at all.

```typescript
// Defensive instance-action rule pattern
match: (ctx) =>
  ctx.resource?.type === 'document' &&     // right resource type
  ctx.resource?.id !== undefined &&         // an instance, not a type action
  ctx.resource?.ownerId === ctx.subject.id  // ownership check
```

This pattern is slightly verbose but eliminates an entire class of accidental cross-category matches.

---

## Modelling `env` in rules

```typescript
{
  id: 'mfa-required-for-export',
  description: 'Export requires MFA verification within the last hour',
  match: (ctx) => ctx.action === 'export',
  allow: ['export'],
  condition: (ctx) => {
    const verified = ctx.subject.attributes?.mfaVerifiedAt as Date | undefined
    if (!verified) return false
    const ageMs = (ctx.env?.timestamp ?? new Date()).getTime() - verified.getTime()
    return ageMs < 60 * 60 * 1000  // within the last hour
  },
}
```

A few things to notice:

- `ctx.env?.timestamp` is used as the reference time so rules can be tested with fixed timestamps.
- `condition` is the right home for this check — it is stateful (depends on the current time relative to a stored date) rather than structural (depends on the shape of the subject or resource).
- The rule expresses the allow case, not the deny case. Absence of a matching allow rule causes `defaultEffect: 'deny'` to apply automatically.

---

Chapter 4 covers priority and conflict resolution — what happens when two rules both match and say different things, how the engine picks a winner, and how to use priority to model override scenarios like emergency freeze rules.

© 2026 Devjoy Ltd. MIT License.
