# Your First Policy

This tutorial builds a complete authorization policy for a document management system. By the end you will have a working `AuthEngine`, a policy with layered rules, evaluated decisions, and an observer wiring audit output to the console.

## What you are building

A document system with three roles and two document states:

**Roles:**
1. **viewer** — may read documents
2. **editor** — may read and write documents they own
3. **admin** — may do anything

**Rules:**
1. Archived documents block all mutations (`write`, `delete`) — regardless of role
2. Owners may read, write, and delete their own documents
3. Admins may do anything
4. Everything else is denied by default

The archived-document rule sits at a higher priority than the owner rule, so archiving a document overrides even the owner's write access.

---

## Step 1 — Install

```bash
npm install @daltonr/authwrite-core
```

---

## Step 2 — Define your domain types

Authwrite is fully generic. Extend `Subject` and `Resource` with your own fields so rule predicates are type-safe throughout.

```typescript
import type { Subject, Resource } from '@daltonr/authwrite-core'

export interface User extends Subject {
  id: string
  roles: string[]
  department?: string
}

export interface Document extends Resource {
  type: 'document'
  id: string
  ownerId: string
  attributes: {
    status: 'draft' | 'published' | 'archived'
    title: string
  }
}
```

A few things to notice:

- `Subject` requires `id: string` and `roles: string[]`. Add any other fields your rules need.
- `Resource` requires `type: string`. `id` and `ownerId` are optional on the base type, but here we declare them required because every `Document` has both.
- Placing these in a shared types file lets your policy, your service layer, and your tests all import from a single source of truth.

---

## Step 3 — Write the policy

```typescript
import { type PolicyDefinition } from '@daltonr/authwrite-core'
import type { User, Document } from './types'

export const documentPolicy: PolicyDefinition<User, Document> = {
  id: 'documents',
  version: '1',
  defaultEffect: 'deny',

  rules: [
    {
      id: 'block-archived-mutations',
      description: 'Archived documents cannot be written or deleted by anyone.',
      priority: 20,
      match: (ctx) =>
        ctx.resource?.attributes?.status === 'archived',
      deny: ['write', 'delete'],
    },

    {
      id: 'admin-full-access',
      description: 'Admins may perform any action on any document.',
      priority: 10,
      match: (ctx) => ctx.subject.roles.includes('admin'),
      allow: ['read', 'write', 'delete', 'archive', 'restore'],
    },

    {
      id: 'owner-full-access',
      description: 'Document owners may read, write, and delete their own documents.',
      priority: 5,
      match: (ctx) => ctx.resource?.ownerId === ctx.subject.id,
      allow: ['read', 'write', 'delete'],
    },

    {
      id: 'viewer-read',
      description: 'Any authenticated user may read non-archived documents.',
      priority: 1,
      match: () => true,
      allow: ['read'],
    },
  ],
}
```

A few things to notice:

- `block-archived-mutations` has the highest priority (`20`). Because `deny` beats `allow` at equal priority, and it sits above the admin rule, even admins cannot write to archived documents unless you explicitly add a higher-priority allow rule for them.
- `viewer-read` uses `match: () => true` — it applies to every request that reaches it. Because it is lowest priority and only covers `read`, it does not widen access for other actions.
- `defaultEffect: 'deny'` ensures that any action not covered by a rule (for example, a newly introduced `publish` action) is automatically blocked until a rule is written for it.

---

## Step 4 — Evaluate decisions

Create the engine and start making checks.

```typescript
import { createAuthEngine } from '@daltonr/authwrite-core'
import { documentPolicy } from './policy'
import type { User, Document } from './types'

const engine = createAuthEngine({ policy: documentPolicy })

const alice: User = { id: 'u-alice', roles: ['editor'] }
const bob: User   = { id: 'u-bob',   roles: ['viewer'] }

const draft: Document = {
  type: 'document',
  id: 'doc-1',
  ownerId: 'u-alice',
  attributes: { status: 'draft', title: 'Q1 Report' },
}

const archived: Document = {
  type: 'document',
  id: 'doc-2',
  ownerId: 'u-alice',
  attributes: { status: 'archived', title: 'Old Report' },
}

// Alice owns the draft — write is allowed
const d1 = await engine.evaluate({ subject: alice, resource: draft, action: 'write' })
console.log(d1.allowed, d1.reason)   // true  'owner-full-access'

// Alice owns the archived doc — write is blocked
const d2 = await engine.evaluate({ subject: alice, resource: archived, action: 'write' })
console.log(d2.allowed, d2.reason)   // false 'block-archived-mutations'

// Bob is a viewer — read is allowed
const d3 = await engine.evaluate({ subject: bob, resource: draft, action: 'read' })
console.log(d3.allowed, d3.reason)   // true  'viewer-read'

// Bob tries to write — denied by default (no rule matched for write)
const d4 = await engine.evaluate({ subject: bob, resource: draft, action: 'write' })
console.log(d4.allowed, d4.reason)   // false 'default'
console.log(d4.defaulted)            // true
```

---

## Step 5 — Understand the decision object

Every call to `evaluate` returns a `Decision`. It is never a bare boolean.

```typescript
const decision = await engine.evaluate({
  subject: alice,
  resource: draft,
  action: 'write',
})

// decision:
// {
//   allowed: true,
//   effect: 'allow',
//   reason: 'owner-full-access',
//   rule: { id: 'owner-full-access', ... },
//   policy: 'documents@1',
//   context: { subject: alice, resource: draft, action: 'write' },
//   evaluatedAt: Date,
//   durationMs: 0.12,
//   defaulted: false,
// }
```

A few things to notice:

- `reason` is the `id` of the rule that decided. When `defaulted` is `true`, reason is `'default'` — a useful signal that a new action was evaluated before any rule was written to cover it.
- `policy` combines the policy `id` and `version` as `"id@version"`, giving you a stable reference to attach to audit records.
- `durationMs` measures the time spent inside the engine. Useful for spotting expensive `match` or `condition` predicates in high-throughput paths.
- The full `context` (subject, resource, action, env) is embedded in the decision. Observers receive a self-contained event and do not need to perform additional lookups.

---

## Step 6 — Add an observer for audit logging

Attach an observer to receive every decision after it is evaluated. Observers do not affect the outcome.

```typescript
import { createAuthEngine, type AuthObserver } from '@daltonr/authwrite-core'
import { documentPolicy } from './policy'

const auditObserver: AuthObserver = {
  onDecision(event) {
    const { decision } = event
    const line = [
      decision.evaluatedAt.toISOString(),
      decision.context.subject.id,
      decision.context.action,
      decision.context.resource?.id ?? '(no resource)',
      decision.allowed ? 'ALLOW' : 'DENY',
      decision.reason,
    ].join(' | ')

    console.log(line)
    // 2026-03-30T09:15:00.000Z | u-alice | write | doc-1 | ALLOW | owner-full-access
  },

  onError(err, ctx) {
    console.error('Auth evaluation error', { err, ctx })
  },
}

const engine = createAuthEngine({
  policy: documentPolicy,
  observers: [auditObserver],
})
```

A few things to notice:

- `observers` is an array — you can attach multiple observers (audit log, metrics, tracing) without coupling them to each other.
- `onDecision` may return a `Promise`. The engine awaits it before resolving the `evaluate` call, so async writes to a database or external log sink are safe.
- In production, replace `console.log` with a structured logger or use `@daltonr/authwrite-observer-otel` to emit OpenTelemetry spans directly.

---

## Evaluating multiple actions at once

When building a UI that needs to know which actions to render, use `evaluateAll` to check several actions in a single call.

```typescript
const decisions = await engine.evaluateAll({
  subject: alice,
  resource: draft,
  actions: ['read', 'write', 'delete', 'archive'],
})

// decisions is Record<Action, Decision>
console.log(decisions['read'].allowed)    // true
console.log(decisions['archive'].allowed) // false — no rule covers 'archive' for non-admins
```

---

## What's next

- **Developer guide** — covers rule priority in depth, field filtering with `evaluateRead`, the `Enforcer` and its three modes, hot-reloading policies at runtime, and writing policy tests with `@daltonr/authwrite-testing`.
- **Reference** — full type definitions and API surface for every package.

---

© 2026 Devjoy Ltd. MIT License.
