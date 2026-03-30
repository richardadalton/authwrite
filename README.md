# AuthEngine

A zero-dependency TypeScript authorization library. Define policies as plain TypeScript objects, evaluate them anywhere — Node, edge, browser — and plug in observers for audit logging, caching, and metrics without touching your policy logic.

---

## The problem

Authorization in most codebases looks like this:

```typescript
if (user.role === 'admin' || user.id === document.ownerId) {
  // allowed
}
```

Scattered across hundreds of files. No audit trail. No way to know which check denied a request. No safe way to change the rules. No test coverage.

AuthEngine is a library — not a sidecar, not a DSL, not infrastructure — that you install and ship in an afternoon.

---

## Quick start

```typescript
import { createAuthEngine } from '@authwrite/core'

const engine = createAuthEngine({
  policy: {
    id: 'documents',
    version: '1.0.0',
    defaultEffect: 'deny',
    rules: [
      {
        id: 'owner-full-access',
        match: ({ subject, resource }) =>
          resource?.id !== undefined && resource.ownerId === subject.id,
        allow: ['*'],
      },
      {
        id: 'archived-blocks-mutation',
        priority: 10,
        match: ({ resource }) => resource?.attributes?.status === 'archived',
        deny: ['write', 'delete'],
      },
    ],
  },
})

const decision = await engine.evaluate({
  subject: { id: 'u1', roles: ['editor'] },
  resource: { type: 'document', id: 'doc-1', ownerId: 'u1' },
  action: 'delete',
})

console.log(decision.allowed) // true
console.log(decision.reason)  // 'owner-full-access'
```

---

## How it works

### Policies are plain TypeScript

A `PolicyDefinition` is a typed object — no DSL, no config files, no schema to learn. Rules are functions. Autocomplete works. Tests run without any framework.

```typescript
const policy: PolicyDefinition<User, Document> = {
  id: 'documents',
  defaultEffect: 'deny',   // safe starting point
  rules: [
    {
      id: 'owner-full-access',
      match: ({ subject, resource }) => resource?.ownerId === subject.id,
      allow: ['*'],
    },
    {
      id: 'confidential-requires-mfa',
      match: ({ resource }) => resource?.sensitivity === 'confidential',
      condition: ({ subject }) => subject.mfaVerified === true,
      allow: ['read'],
    },
  ],
}
```

### Every decision carries a reason

`evaluate()` always returns a `Decision` with the rule ID that determined the outcome. No silent denials.

```typescript
const d = await engine.evaluate(ctx)

d.allowed      // boolean
d.reason       // 'owner-full-access' | 'archived-blocks-mutation' | 'default' | ...
d.rule         // the full rule object that decided
d.durationMs   // how long evaluation took
```

### Three action categories

Not all actions target an existing resource. AuthEngine models this explicitly:

```typescript
// Instance action — read/update/delete a specific resource
await engine.evaluate({ subject, resource: { type: 'document', id: 'doc-1' }, action: 'read' })

// Type action — create (no id yet)
await engine.evaluate({ subject, resource: { type: 'document' }, action: 'create' })

// Subject action — no resource at all
await engine.evaluate({ subject, action: 'change-password' })
```

### Priority resolves conflicts

Higher number wins. Deny beats allow at equal priority.

```typescript
{
  id: 'archived-blocks-mutation',
  priority: 10,             // beats any rule at priority 0
  match: ({ resource }) => resource?.attributes?.status === 'archived',
  deny: ['write', 'delete'],
}
```

### Observers handle all side effects

Audit logging, caching, metrics — none of it lives in the engine. Observers receive every decision and run after evaluation.

```typescript
const engine = createAuthEngine({
  policy,
  observers: [
    {
      async onDecision({ decision }) {
        await auditLog.write({
          subject:  decision.context.subject.id,
          action:   decision.context.action,
          allowed:  decision.allowed,
          rule:     decision.reason,
        })
      },
    },
  ],
})
```

### Field-level filtering

`evaluateRead()` evaluates access and computes which fields the subject is permitted to see.

```typescript
const policy = {
  // ...
  fieldRules: [
    {
      id: 'owner-sees-own-fields',
      match: ({ subject, resource }) => resource?.ownerId === subject.id,
      expose: ['id', 'title', 'content', 'status'],
      redact: ['internalNotes', 'billingFlags'],
    },
    {
      id: 'admin-sees-all',
      match: ({ subject }) => subject.roles.includes('admin'),
      expose: ['*'],
      redact: [],
    },
  ],
}

const { decision, allowedFields } = await engine.evaluateRead({ subject, resource })
const safeDocument = applyFieldFilter(rawDocument, allowedFields)
```

---

## Gradual adoption

Already have `if` statements scattered through your codebase? Start in audit mode — the engine evaluates your policy and logs what it would deny, but never blocks anything. Flip to enforce when you're confident.

```typescript
// Phase 1 — observe without enforcing
const enforcer = createEnforcer(engine, { mode: 'audit' })

// Phase 2 — enforce
const enforcer = createEnforcer(engine, { mode: 'enforce' })

// Emergency — block everything regardless of policy
enforcer.setMode('lockdown')
```

---

## Testing

```typescript
import { decisionRecorder, coverageReport } from '@authwrite/testing'

const recorder = decisionRecorder()
const engine = createAuthEngine({ policy, observers: [recorder] })

// ... run your test suite ...

const report = coverageReport(engine, recorder.all())
console.log(report.untouchedRules)  // rules that never fired — add a test!
console.log(report.coveragePercent) // 87.5
```

---

## Packages

| Package | Description | Status |
|---|---|---|
| `@authwrite/core` | Zero-dependency engine, all types | ✅ |
| `@authwrite/testing` | `decisionRecorder`, `coverageReport` | ✅ |
| `@authwrite/express` | Express middleware | 🚧 |
| `@authwrite/fastify` | Fastify plugin | 🚧 |
| `@authwrite/nextjs` | Next.js App Router wrapper | 🚧 |
| `@authwrite/hono` | Hono middleware (edge-compatible) | 🚧 |
| `@authwrite/observer-pg` | Postgres audit log observer | 🚧 |
| `@authwrite/observer-redis` | Redis decision cache observer | 🚧 |
| `@authwrite/observer-otel` | OpenTelemetry spans and metrics | 🚧 |
| `@authwrite/loader-db` | Hot-reloadable database policy loader | 🚧 |
| `@authwrite/loader-yaml` | YAML/JSON file policy loader | 🚧 |

---

## License

MIT
