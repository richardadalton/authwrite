# Core Concepts

## What is Authwrite?

Authwrite is a **zero-dependency TypeScript authorization library**. It evaluates whether a subject (a user, service, or token) may perform an action, produces a structured decision with a machine-readable reason, and notifies observers so every check is auditable.

The problem it solves is the one that appears in almost every application past a certain size: authorization logic scattered across route handlers, service methods, and middleware — each check a one-off `if/else`, none of them testable in isolation, and no record of why access was denied when something goes wrong. Authwrite centralises that logic into a single evaluated policy, so every authorization check goes through one path, produces one structured result, and leaves a trace.

---

## Zero dependencies — what that means in practice

`@authwrite/core` ships no runtime dependencies. No lodash, no reflect-metadata, no class-transformer. This has three practical consequences:

- It installs instantly and adds nothing to your bundle beyond its own ~4 kB.
- It runs anywhere JavaScript runs: Node, Deno, Bun, and modern browsers.
- It makes no assumptions about your framework, ORM, or logging stack. Observability, adapters, and loaders are all optional packages.

---

## The five key concepts

### PolicyDefinition

A `PolicyDefinition` is a plain object that describes your authorization rules, a default outcome, and optionally which fields a subject may read from a resource.

```typescript
const policy: PolicyDefinition = {
  id: 'documents-policy',
  version: '1',
  defaultEffect: 'deny',   // deny anything not explicitly matched
  rules: [ /* ... */ ],
  fieldRules: [ /* ... */ ],
}
```

A few things to notice:

- `defaultEffect` is required and should almost always be `'deny'`. Deny-by-default means new actions are blocked until a rule explicitly allows them, rather than accidentally permitted.
- `id` and `version` together appear on every `Decision`, giving you a stable reference for audit records.
- `fieldRules` are optional. They control which fields of a resource a subject may read when you call `evaluateRead`.

---

### PolicyRule

A `PolicyRule` is the unit of authorization logic. Each rule declares which actions it covers, a `match` predicate that determines when it applies, and an optional `condition` for secondary checks.

```typescript
const rule: PolicyRule<User, Document> = {
  id: 'owner-full-access',
  priority: 10,
  match: (ctx) => ctx.resource?.ownerId === ctx.subject.id,
  allow: ['read', 'write', 'delete'],
}
```

A few things to notice:

- `priority` controls which rule wins when more than one matches. Higher numbers win. At equal priority, `deny` beats `allow`.
- `match` is a synchronous predicate. It receives the full `AuthContext` and returns a boolean.
- `condition` is a second predicate evaluated only when `match` returns `true`. Use it to separate structural matching (does this rule apply to this resource type?) from contextual checks (is the document in the right state?).

---

### AuthContext

An `AuthContext` is the complete picture of a single authorization check — who is asking, what they want to do, and what they want to do it to.

```typescript
const ctx: AuthContext<User, Document> = {
  subject: { id: 'u-1', roles: ['editor'] },
  resource: { type: 'document', id: 'doc-42', ownerId: 'u-1' },
  action: 'write',
  env: { ip: '203.0.113.4', timestamp: new Date() },
}
```

The three action categories map to different resource shapes:

| Category | Has `resource`? | Has `resource.id`? | Example action |
| --- | --- | --- | --- |
| Instance | Yes | Yes | `read`, `write`, `delete` on a specific document |
| Type | Yes | No | `create` — the resource exists as a type but no instance yet |
| Subject | No | — | `change-password`, `view-own-profile` |

`env` is an open record. Pass anything context-dependent — IP address, timestamp, feature flags — and read it inside rule predicates.

---

### Decision

A `Decision` is the structured result of every evaluation. It is never a bare boolean.

```typescript
interface Decision {
  allowed: boolean
  effect: 'allow' | 'deny'
  reason: string        // rule id that decided, or 'default'
  rule?: PolicyRule
  policy: string        // "policy-id@version"
  context: AuthContext
  evaluatedAt: Date
  durationMs: number
  defaulted?: boolean   // true when no rule matched
  override?: 'permissive' | 'lockdown'
  error?: Error
}
```

A few things to notice:

- `reason` is the `id` of the winning rule, or `'default'` when `defaultEffect` applied with no rule match. This makes denial messages actionable: you always know which rule (or the lack of one) caused the outcome.
- `defaulted: true` is a signal worth logging. It often means a new action was introduced but no rule was written for it yet.
- `override` is set when an `Enforcer` in `lockdown` or `permissive` mode overrode the policy outcome.
- The full `context` is embedded in the decision, so observers receive a self-contained event requiring no additional lookups.

---

### Observers

An `AuthObserver` is a listener that receives every decision after it is evaluated. Observers are the integration point for audit logs, metrics, alerting, and tracing — they do not affect the decision outcome.

```typescript
const observer: AuthObserver = {
  onDecision(event) {
    auditLog.write(event)
  },
  onError(err, ctx) {
    errorTracker.capture(err, { ctx })
  },
  onPolicyReload(policy) {
    logger.info(`Policy reloaded: ${policy.id}@${policy.version}`)
  },
}
```

A few things to notice:

- `onDecision` may return a `Promise`. The engine awaits it before resolving the evaluation call, so observers can perform async writes without fire-and-forget race conditions.
- `onError` receives both the error and the context that triggered it, giving you enough information to reproduce the failing check.
- `onPolicyReload` fires when `engine.reload(policy)` is called at runtime, useful for confirming hot-reload propagation in long-running services.

---

## How they relate

```
PolicyDefinition
   │
   │  loaded into
   ▼
┌─────────────────────────────────────────┐
│              AuthEngine                 │
│                                         │
│  evaluate(ctx)                          │
│    │                                    │
│    ├─ sorts rules by priority           │
│    ├─ runs match() for each rule        │
│    ├─ runs condition() if match passes  │
│    └─ applies defaultEffect if no match │
└──────────────────┬──────────────────────┘
                   │
                   │  produces
                   ▼
             Decision
               │
               │  dispatched to
               ▼
         AuthObserver(s)
           onDecision(event)
```

---

## Mental model

| Concept | Analogy |
| --- | --- |
| `PolicyDefinition` | The rulebook — written once, read on every check |
| `PolicyRule` | A single statute — scoped, prioritised, testable in isolation |
| `AuthContext` | The case file — everything known about this specific request |
| `Decision` | The verdict — structured, reasoned, timestamped |
| `AuthObserver` | The court reporter — records proceedings without influencing them |

---

## The Enforcer

An `Enforcer` wraps an `AuthEngine` and adds a runtime mode switch. It implements the same `AuthEvaluator` interface, so you can drop it in wherever an engine is accepted.

| Mode | Behaviour |
| --- | --- |
| `enforce` | Normal — policy decisions are returned as-is |
| `audit` | Policy is evaluated but all decisions are forced to `allowed: true`; override is recorded |
| `lockdown` | All decisions are forced to `allowed: false` regardless of policy; override is recorded |

`audit` mode is useful during a policy rollout: you can ship the policy, observe what would have been denied in production, and tighten rules before switching to `enforce`.

---

© 2026 Devjoy Ltd. MIT License.
