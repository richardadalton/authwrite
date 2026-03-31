# Chapter 14 — Composable Rules with rulewrite

## The problem with opaque match functions

A `PolicyRule` requires a `match` function — a predicate that takes an `AuthContext` and returns `true` or `false`. That gets the engine what it needs to evaluate a policy. But it tells the developer nothing about *why* the rule matched, which makes debugging, auditing, and tooling harder than it needs to be.

When a decision comes back `deny` with `reason: "owner-read"`, you know which rule fired. You do not know which part of that rule's logic was responsible — was it the role check that failed? The ownership check? Some combination?

The `@daltonr/authwrite-rulewrite` package solves this by connecting authwrite's `PolicyRule` to [`@daltonr/rulewrite`](https://github.com/richardadalton/rulewrite), a composable predicate library. Every rule built with rulewrite can explain itself as a structured evaluation tree. Authwrite captures that tree on the deciding rule and attaches it to `Decision.matchExplanation` — available to observers, the devtools sidebar, and your own tooling.

---

## How it works

`PolicyRule` has an optional `explain` field:

```typescript
interface PolicyRule {
  match:    (ctx: AuthContext) => boolean
  explain?: (ctx: AuthContext) => unknown
  // ...
}
```

After the deciding rule is identified, the engine calls `decidingRule.explain?.(ctx)` and stores the result in `Decision.matchExplanation`. The field is `unknown` so it imposes no coupling on the core — any structured value works.

`fromRule()` wires up both functions from a rulewrite `Rule`:

```typescript
import { fromRule } from '@daltonr/authwrite-rulewrite'

// match(ctx)   → rule.isSatisfiedBy(ctx)  — fast boolean, called on every rule
// explain(ctx) → rule.evaluate(ctx)       — full tree, called only on the deciding rule
const { match, explain } = fromRule(myRulewriteRule)
```

---

## Building rules with rulewrite

Install the packages:

```bash
npm install @daltonr/authwrite-rulewrite @daltonr/rulewrite
```

Define atomic rules with `rule()`, then compose with `.and()`, `.or()`, `.not()`, etc.:

```typescript
import { rule, all, any } from '@daltonr/rulewrite'
import { fromRule }       from '@daltonr/authwrite-rulewrite'
import type { AuthContext, PolicyDefinition } from '@daltonr/authwrite-core'

interface User     { id: string; roles: string[] }
interface Document { type: 'doc'; ownerId: string; status: string }

// Atomic predicates
const isOwner = rule<AuthContext<User, Document>>(
  ctx => ctx.subject.id === ctx.resource?.ownerId,
  'IsOwner',
)

const isEditor = rule<AuthContext<User, Document>>(
  ctx => ctx.subject.roles.includes('editor'),
  'IsEditor',
)

const isPublished = rule<AuthContext<User, Document>>(
  ctx => ctx.resource?.status === 'published',
  'IsPublished',
)

const isAdmin = rule<AuthContext<User, Document>>(
  ctx => ctx.subject.roles.includes('admin'),
  'IsAdmin',
)

// Composed rules
const canRead  = isOwner.or(isEditor).or(isPublished)
const canEdit  = isOwner.or(isEditor)
const canAdmin = isAdmin

const docPolicy: PolicyDefinition<User, Document> = {
  id:            'document-policy',
  defaultEffect: 'deny',
  rules: [
    {
      id:    'admin-full-access',
      ...fromRule(canAdmin),
      allow: ['*'],
      priority: 10,
    },
    {
      id:    'owner-or-editor-edit',
      ...fromRule(canEdit),
      allow: ['read', 'update', 'delete'],
    },
    {
      id:    'published-public-read',
      ...fromRule(canRead),
      allow: ['read'],
    },
  ],
}
```

---

## Reading matchExplanation

When a rule built with `fromRule()` decides the outcome, `Decision.matchExplanation` contains the rulewrite `EvaluationResult` tree:

```typescript
interface EvaluationResult {
  satisfied: boolean
  label:     string
  children?: EvaluationResult[]
}
```

Example decision for `alice` (owner, non-editor) reading a draft document:

```typescript
const decision = engine.evaluate({ subject: alice, resource: doc, action: 'read' })

// decision.allowed           → true
// decision.reason            → 'owner-or-editor-edit'
// decision.matchExplanation  →
{
  satisfied: true,
  label: 'OR',
  children: [
    { satisfied: true,  label: 'OR',      children: [
      { satisfied: true,  label: 'IsOwner'    },
      { satisfied: false, label: 'IsEditor'   },
    ]},
    { satisfied: false, label: 'IsPublished' },
  ]
}
```

This tells you *exactly* why the rule matched: `IsOwner` was true, which satisfied the `OR`, even though `IsEditor` was false.

---

## Using matchExplanation in observers

Log the explanation tree alongside every decision:

```typescript
const engine = createAuthEngine({
  policy: docPolicy,
  observers: [{
    onDecision({ decision }) {
      if (decision.matchExplanation) {
        console.log(
          `[auth] ${decision.reason} → matched:`,
          JSON.stringify(decision.matchExplanation, null, 2),
        )
      }
    },
  }],
})
```

---

## Devtools sidebar

When `matchExplanation` is present, the devtools sidebar renders a **Rule trace** panel in the expanded decision view. Each node in the tree shows a green dot (satisfied) or grey circle (not satisfied) next to the rule label — letting you see at a glance which predicates were true and which were false for that exact request.

No extra configuration is needed. As long as your rules use `fromRule()`, the trace appears automatically.

---

## Rules without rulewrite

You can add `explain` to any `PolicyRule` manually — `fromRule()` is just the ergonomic path:

```typescript
const policy: PolicyDefinition = {
  id:            'manual-explain-policy',
  defaultEffect: 'deny',
  rules: [
    {
      id:      'admin-read',
      match:   ctx => ctx.subject.roles.includes('admin'),
      explain: ctx => ({
        satisfied: ctx.subject.roles.includes('admin'),
        label:     'IsAdmin',
        roles:     ctx.subject.roles,
      }),
      allow: ['read'],
    },
  ],
}
```

The `explain` return value can be any serialisable value. The devtools sidebar expects the `{ satisfied, label, children? }` shape to render the tree, but your own observers can consume any structure you define.

---

## The EvaluatableRule interface

`fromRule()` accepts any object that satisfies `EvaluatableRule<T>`:

```typescript
export interface EvaluatableRule<T> {
  isSatisfiedBy(value: T): boolean
  evaluate(value: T): unknown
}
```

This is a structural interface — you are not required to use `@daltonr/rulewrite` specifically. Any predicate library (or hand-written object) that provides these two methods works with `fromRule()`.

---

## What to use explain for

`matchExplanation` is ideal for:

- **Audit logs** — "why was this user denied access to this resource?"
- **Debugging** — "which sub-condition failed in this compound rule?"
- **Devtools** — visual rule trace in the sidebar
- **Test assertions** — verify not just the outcome but which predicates fired
- **Compliance** — produce structured records of authorization logic applied to specific requests

It is not a substitute for writing clear rule descriptions or structuring policies well. Use it as a diagnostic tool, not a crutch for opaque policy logic.

---

© 2026 Devjoy Ltd. MIT License.
