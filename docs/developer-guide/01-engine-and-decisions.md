# Chapter 1: How the Engine Works

Before writing a single policy rule, it is worth spending ten minutes understanding how Authwrite is structured. The library has four concepts that appear everywhere, and if you conflate any of them the rules you write will be harder to reason about and harder to test. This chapter builds the mental model. Everything in later chapters builds on it.

---

## The four things

Authwrite has four distinct concepts. Keep them separate.

**PolicyDefinition** is pure data describing your access rules. It is a plain TypeScript object you construct at startup and hand to the engine. It does nothing on its own — it is inert until the engine evaluates it.

**AuthContext** is the question you ask the engine. It carries three things: who is asking (the subject), what they want to act on (the resource, if relevant), and what they want to do (the action). It may also carry environment metadata such as IP address and timestamp.

**Decision** is the engine's answer. It is a structured object telling you not just whether access is allowed, but which rule decided it, how long evaluation took, and what policy was in effect. A Decision is never just a boolean.

**AuthObserver** is how you attach side effects — logging, audit trails, metrics — without touching the evaluation logic. Observers receive every decision as an event and run asynchronously.

The flow looks like this:

```
PolicyDefinition
     │
     ▼
 AuthEngine  ◄──  AuthContext (subject + resource + action)
     │
     ▼
  Decision  ──►  AuthObserver (logging, audit)
```

A few things to notice:

- `PolicyDefinition` flows in once, at startup (or on reload). `AuthContext` flows in on every request.
- `Decision` flows out synchronously from evaluation. Observers run independently and do not block the caller.
- The engine holds no mutable request state. You can share a single engine instance safely across concurrent requests.

---

## Running the engine in pure TypeScript

Authwrite has no framework dependencies. You can run it in a test file, a Node script, an edge function, or a Lambda. Here is the minimal example:

```typescript
import { createAuthEngine } from '@daltonr/authwrite-core'
import type { PolicyDefinition, Subject, Resource } from '@daltonr/authwrite-core'

interface AppSubject extends Subject {
  roles: string[]
}

interface AppResource extends Resource {
  type: 'document'
  ownerId?: string
}

const policy: PolicyDefinition<AppSubject, AppResource> = {
  id: 'app-policy',
  version: '1',
  defaultEffect: 'deny',
  rules: [
    {
      id: 'owner-read',
      match: (ctx) => ctx.resource?.ownerId === ctx.subject.id,
      allow: ['read'],
    },
  ],
}

const engine = createAuthEngine({ policy })

const decision = await engine.evaluate({
  subject: { id: 'user-1', roles: ['member'] },
  resource: { type: 'document', id: 'doc-99', ownerId: 'user-1' },
  action: 'read',
})

console.log(decision.allowed)  // true
console.log(decision.reason)   // 'owner-read'
```

A few things to notice:

- `createAuthEngine` accepts a config object. The `policy` property is the `PolicyDefinition` you define.
- `engine.evaluate()` is async. It returns a `Decision` — never throws for policy reasons (throws are caught and turned into decisions; see `onError` below).
- Extending `Subject` and `Resource` with your own interface gives you full type safety inside every `match` and `condition` function.

---

## The Decision object

Think of a `Decision` the way you think of a database query result: structured, traceable, and telling you not just the answer but how it was reached. A plain boolean says "no." A `Decision` says "no, because rule `archived-block` matched at priority 50, evaluated at 14:23:01.443, and took 0.2 ms."

Here is every field and what it means:

| Field | Type | Meaning |
|---|---|---|
| `allowed` | `boolean` | The final answer |
| `effect` | `'allow' \| 'deny'` | The winning effect |
| `reason` | `string` | The `id` of the rule that decided, or `'default'` when `defaultEffect` was applied |
| `rule` | `PolicyRule \| undefined` | The full rule object when a rule matched (absent when defaulted) |
| `policy` | `string` | `"policy-id@version"` label — useful when multiple policies are in use |
| `context` | `AuthContext` | The original question — echoed back so you can log it alongside the decision |
| `evaluatedAt` | `Date` | When evaluation ran |
| `durationMs` | `number` | Evaluation duration in milliseconds |
| `defaulted` | `boolean \| undefined` | `true` when no rule matched and `defaultEffect` was applied |
| `override` | `'permissive' \| 'suspended' \| 'lockdown' \| undefined` | Set when the Enforcer overrode the policy decision |
| `error` | `Error \| undefined` | Present when a rule threw during evaluation |

The most important field for security operations is `reason`.

---

## Why `reason` matters

Silent denials are security holes. If your application rejects a request and you cannot tell from the logs why, you cannot distinguish a legitimate block from a misconfigured rule. You cannot audit. You cannot debug.

`reason` solves this. Every decision carries the id of the rule that decided it. If no rule matched and the `defaultEffect` applied, `reason` is `'default'` and `defaulted` is `true`. There is no decision without a traceable cause.

A minimal logging observer looks like this:

```typescript
import type { AuthObserver, DecisionEvent } from '@daltonr/authwrite-core'

const auditLogger: AuthObserver = {
  onDecision(event: DecisionEvent) {
    const { decision } = event
    console.log({
      allowed: decision.allowed,
      reason: decision.reason,
      subject: decision.context.subject.id,
      action: decision.context.action,
      resource: decision.context.resource?.id,
      durationMs: decision.durationMs,
    })
  },
}

const engine = createAuthEngine({
  policy,
  observers: [auditLogger],
})
```

A few things to notice:

- The observer receives `DecisionEvent`, which wraps `Decision` with an optional `traceId` and `source` for distributed tracing.
- `onDecision` can return a `Promise`. The engine fires observers and does not await them — they are true side effects and do not affect evaluation timing or outcome.
- You can attach multiple observers. All receive every decision.

---

## `evaluateAll()` for building capability maps

When rendering a UI, you often need to know several permissions at once. You could call `evaluate()` in a loop, but `evaluateAll()` is cleaner — it evaluates a list of actions against the same subject and resource in one call:

```typescript
const results = await engine.evaluateAll({
  subject: { id: 'user-1', roles: ['editor'] },
  resource: { type: 'document', id: 'doc-99', ownerId: 'user-2' },
  actions: ['read', 'update', 'delete', 'publish'],
})

// results is Record<Action, Decision>
const canEdit = results['update'].allowed
const canDelete = results['delete'].allowed
```

A few things to notice:

- The return type is `Record<Action, Decision>` — every action you asked about maps to its full `Decision`, not just a boolean.
- Each decision carries its own `reason`, `durationMs`, and `evaluatedAt`. You get the full audit trail, not a stripped capability map.
- This is the right place to build the `permissions` object you might serialise into a JWT or pass as props to a frontend component.

---

## `can()` for simple boolean checks

When you genuinely only need a boolean and do not need the audit trail inline, `can()` wraps `evaluate()` and returns the `allowed` value:

```typescript
if (await engine.can({ subject, resource, action: 'delete' })) {
  await deleteDocument(resource.id)
}
```

Prefer `evaluate()` in middleware and service boundaries where the decision should be logged. Use `can()` inside business logic where you are acting on an already-logged decision and just need a guard.

---

## `onError`: what happens when evaluation throws

A rule's `match` or `condition` function is your code. It can throw. `onError` controls what happens when it does:

```typescript
const engine = createAuthEngine({
  policy,
  onError: 'deny',  // 'deny' is the default — safe for production
})
```

| `onError` value | Behaviour |
|---|---|
| `'deny'` | Evaluation produces a denied `Decision` with `error` set. The observer fires. Your application receives a clean decision, not a thrown exception. |
| `'allow'` | Evaluation produces an allowed `Decision` with `error` set. Use only in non-critical paths where you prefer permissive degradation. |

In both cases the `error` field on the returned `Decision` is populated. Your observer can inspect it and route to an error-tracking service. Your application code never needs a try/catch around `evaluate()`.

The default is `'deny'`. Leave it there unless you have a specific reason not to.

---

Chapter 2 covers the structure of `PolicyDefinition` and `PolicyRule` in detail — how to write rules, why they are functions rather than configuration, and how to build a real-world policy from scratch.

© 2026 Devjoy Ltd. MIT License.
