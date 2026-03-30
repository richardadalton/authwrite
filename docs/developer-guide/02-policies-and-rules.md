# Chapter 2: Policies and Rules

The policy is the heart of Authwrite. Everything else — decisions, observers, field filtering — exists in service of evaluating policy rules. This chapter explains the structure of a `PolicyDefinition`, the anatomy of a `PolicyRule`, and the design choices that make rules composable and testable. By the end you will be able to write a complete, production-grade policy from scratch.

---

## PolicyDefinition is a plain TypeScript object

There is no DSL, no YAML, no schema registry, and no proprietary configuration language. A **PolicyDefinition** is a TypeScript object literal. Your IDE understands it fully: autocomplete works, type errors surface immediately, and you can jump to definition on every field.

```typescript
import type { PolicyDefinition } from '@authwrite/core'

const policy: PolicyDefinition = {
  id: 'app-policy',
  version: '1',
  description: 'Main access policy for the application',
  defaultEffect: 'deny',
  rules: [],
  fieldRules: [],
}
```

A few things to notice:

- `id` is a required string. It appears in every `Decision` as part of the `policy` field (`"app-policy@1"`), so make it meaningful.
- `version` is optional but strongly recommended. When you reload a policy at runtime, the version surfaces in decision logs and makes auditing across deployments tractable.
- `defaultEffect` is the decision that applies when no rule matches. More on this below.
- `rules` and `fieldRules` are plain arrays. Order within the array does not affect evaluation — priority does. You can organise them however you like.

---

## `defaultEffect: 'deny'` — the safe default

**defaultEffect** is what happens when the engine evaluates a request and no rule matches. It is either `'allow'` or `'deny'`.

Set it to `'deny'`. This is the secure default for almost every system.

The reasoning is straightforward: if a rule is missing, that is almost certainly a mistake. A missing rule should fail closed. An `'allow'` default means every new action type, every new resource type, and every new role combination is silently permitted until someone remembers to write a deny rule. That is the wrong direction.

```
defaultEffect: 'deny'   →  access is closed until a rule explicitly opens it
defaultEffect: 'allow'  →  access is open until a rule explicitly closes it
```

The only legitimate use of `defaultEffect: 'allow'` is an internal tooling policy where you own all the subjects and have no external exposure. Even then, be deliberate about it.

---

## PolicyRule anatomy

A **PolicyRule** has six fields:

```typescript
import type { PolicyRule } from '@authwrite/core'

const rule: PolicyRule = {
  id: 'owner-full-access',
  description: 'Document owners can read and update their own documents',
  priority: 10,
  match: (ctx) => ctx.resource?.ownerId === ctx.subject.id,
  allow: ['read', 'update'],
  condition: (ctx) => ctx.resource?.attributes?.archived !== true,
}
```

| Field | Required | Purpose |
|---|---|---|
| `id` | Yes | Unique identifier. Appears in `Decision.reason`. Make it human-readable. |
| `description` | No | Prose note for maintainers. Has no effect on evaluation. |
| `priority` | No | Numeric. Higher wins. Default is `0`. See Chapter 4. |
| `match` | Yes | Primary predicate. If this returns `false`, the rule is skipped entirely. |
| `allow` | No | Actions this rule permits. `'*'` permits all actions. |
| `deny` | No | Actions this rule blocks. `'*'` blocks all actions. |
| `condition` | No | Secondary predicate. If `match` returns `true` but `condition` returns `false`, the rule is skipped. |

A rule must have at least one of `allow` or `deny`. A rule with neither is inert.

---

## The `match` function

**match** receives the full `AuthContext` and returns a boolean. It is the primary gate on a rule: if it returns `false`, the rule is not considered at all.

```typescript
// Match by role
match: (ctx) => ctx.subject.roles.includes('admin')

// Match by resource type
match: (ctx) => ctx.resource?.type === 'document'

// Match by ownership
match: (ctx) => ctx.resource?.ownerId === ctx.subject.id

// Match by resource type AND role
match: (ctx) =>
  ctx.resource?.type === 'invoice' &&
  ctx.subject.roles.includes('billing')
```

`match` is evaluated for every rule on every request, so keep it cheap. Avoid network calls or heavy computation inside match functions. The full `AuthContext` — including `env` fields like IP and timestamp — is available if you need it.

---

## The difference between `match` and `condition`

This distinction trips up most people the first time.

**match** determines whether a rule is relevant to this request. It answers the question: "Is this rule even in play here?"

**condition** is a secondary guard that determines whether the rule applies given the current state. It answers the question: "Given that this rule is in play, does the current context satisfy it?"

The practical difference is how they interact with priority resolution (covered in detail in Chapter 4). A rule whose `match` returns `false` is excluded from consideration entirely. A rule whose `condition` returns `false` is also excluded — but `condition` is evaluated after `match`, and it does not participate in the priority race. It is a filter, not a competitor.

```typescript
// match: is this rule relevant?
// condition: does the current context pass the secondary check?

{
  id: 'editor-update',
  match: (ctx) => ctx.subject.roles.includes('editor'),
  allow: ['update'],
  condition: (ctx) => ctx.resource?.attributes?.locked !== true,
}
```

Here: if the subject is not an editor, `match` returns `false` and the rule is skipped immediately. If the subject is an editor but the resource is locked, `match` returns `true` but `condition` returns `false` — the rule is skipped. Only an editor acting on an unlocked resource has this rule apply.

Use `match` to scope a rule to a role, resource type, or action category. Use `condition` for runtime state checks — locked flags, expiry dates, attribute values that depend on the actual resource data.

---

## `allow: ['*']` for wildcard

When a role should be permitted every action on a matched resource, use the wildcard:

```typescript
{
  id: 'admin-all',
  match: (ctx) => ctx.subject.roles.includes('admin'),
  allow: ['*'],
}
```

`'*'` in the `allow` array means all actions. The same applies to `deny: ['*']` — it blocks all actions for any rule that matches.

---

## A real-world policy: document access

Here is a complete policy for a document management system. It covers four common patterns: ownership, role-based override, archived state blocking mutations, and a catch-all deny.

```typescript
import { createAuthEngine } from '@authwrite/core'
import type { PolicyDefinition, Subject, Resource } from '@authwrite/core'

interface AppSubject extends Subject {
  roles: string[]
}

interface DocumentResource extends Resource {
  type: 'document'
  ownerId?: string
  attributes?: {
    archived?: boolean
    visibility?: 'public' | 'private'
  }
}

const documentPolicy: PolicyDefinition<AppSubject, DocumentResource> = {
  id: 'document-policy',
  version: '2',
  defaultEffect: 'deny',
  rules: [
    {
      id: 'admin-override',
      description: 'Admins can do anything to any document',
      priority: 100,
      match: (ctx) => ctx.subject.roles.includes('admin'),
      allow: ['*'],
    },
    {
      id: 'archived-block-mutation',
      description: 'Nobody can mutate an archived document (except admins, handled above)',
      priority: 50,
      match: (ctx) => ctx.resource?.attributes?.archived === true,
      deny: ['update', 'delete', 'publish'],
    },
    {
      id: 'owner-full-access',
      description: 'Document owners can read, update, and delete their own documents',
      priority: 10,
      match: (ctx) => ctx.resource?.ownerId === ctx.subject.id,
      allow: ['read', 'update', 'delete'],
    },
    {
      id: 'public-read',
      description: 'Any authenticated user can read public documents',
      priority: 5,
      match: (ctx) => ctx.resource?.attributes?.visibility === 'public',
      allow: ['read'],
    },
  ],
}

const engine = createAuthEngine({ policy: documentPolicy })
```

A few things to notice:

- `admin-override` sits at priority `100`. It wins against everything else for admins. Chapter 4 covers the priority algorithm in full.
- `archived-block-mutation` at priority `50` is a deny rule. It fires before `owner-full-access` at priority `10`. An owner cannot mutate their own archived document.
- `defaultEffect: 'deny'` means any action not explicitly permitted — such as a viewer trying to `publish` — is blocked without needing an explicit deny rule.
- Every rule has a human-readable `id` and `description`. When a decision is denied with `reason: 'archived-block-mutation'`, the cause is immediately clear in logs.

---

## Why rules are functions, not configuration

Many authorization systems use YAML or JSON for policies. Authwrite uses TypeScript functions. This is a deliberate design choice.

**Type safety.** Your `match` function receives a fully-typed `AuthContext`. If you rename a field on `DocumentResource`, TypeScript tells you immediately which rules need updating. A YAML policy cannot do that.

**Composability.** Functions compose. You can extract predicates, import them from a shared module, and reuse them across rules and policies without copy-pasting strings.

**Testability.** A rule is a plain object with plain functions. You can unit-test a single rule by calling its `match` and `condition` functions directly with a constructed context, without spinning up an engine.

---

## Rule reuse: extracting predicates

As your policy grows, `match` functions repeat themselves. Extract them:

```typescript
// predicates.ts
import type { AuthContext } from '@authwrite/core'
import type { AppSubject, DocumentResource } from './types'

type AppCtx = AuthContext<AppSubject, DocumentResource>

export const isAdmin = (ctx: AppCtx) =>
  ctx.subject.roles.includes('admin')

export const isOwner = (ctx: AppCtx) =>
  ctx.resource?.ownerId === ctx.subject.id

export const isArchived = (ctx: AppCtx) =>
  ctx.resource?.attributes?.archived === true

export const isPublic = (ctx: AppCtx) =>
  ctx.resource?.attributes?.visibility === 'public'
```

```typescript
// document-policy.ts
import { isAdmin, isOwner, isArchived, isPublic } from './predicates'

const documentPolicy: PolicyDefinition<AppSubject, DocumentResource> = {
  id: 'document-policy',
  version: '3',
  defaultEffect: 'deny',
  rules: [
    { id: 'admin-override',          priority: 100, match: isAdmin,    allow: ['*'] },
    { id: 'archived-block-mutation', priority: 50,  match: isArchived, deny: ['update', 'delete', 'publish'] },
    { id: 'owner-full-access',       priority: 10,  match: isOwner,    allow: ['read', 'update', 'delete'] },
    { id: 'public-read',             priority: 5,   match: isPublic,   allow: ['read'] },
  ],
}
```

A few things to notice:

- Predicate functions are just `(ctx: AuthContext) => boolean`. They have no dependency on Authwrite internals.
- Unit-testing a predicate is two lines: construct a context object, call the function, assert the result.
- Shared predicates are easy to audit: a security reviewer can read `predicates.ts` and understand the entire access model without reading the full policy.

---

Chapter 3 covers actions, subjects, and resources in detail — what the three action categories are, how to model them with the `Subject` and `Resource` interfaces, and the common mistakes to avoid when writing rules that span action types.

© 2026 Devjoy Ltd. MIT License.
