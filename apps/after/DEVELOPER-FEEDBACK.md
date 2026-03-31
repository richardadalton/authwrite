# Developer Feedback — Authwrite Migration

**Context:** Just completed migrating the `before` demo to `after`. The before app had 13
documented authorization anti-patterns across ~1,200 lines spread over four files. The after app
replaces all of it with authwrite. These are honest notes from that experience, written while
it's still fresh.

Overall verdict: the core model is right and the migration outcome is clearly better. Several
rough edges slowed me down and a few API decisions I think deserve a second look.

---

## What worked well

### `defaultEffect: 'deny'` is the single most impactful change

One property in `policy.ts` replaced a sprawling implicit allow-by-default assumption that was
baked into every corner of the before codebase. I expected this to be a painful change — in
practice it was the easiest. The policy simply doesn't compile unless you've thought about what
each role can do. That pressure is exactly what was missing before.

### Mode switching is trivial

Changing `'audit'` to `'enforce'` was a one-word change and it immediately started enforcing.
This is the right design. It means you can deploy in audit mode, watch real traffic in the
devtools, and gain confidence before flipping to enforce — without touching anything else.

### The observer pattern composes cleanly

Adding devtools was:

```typescript
const devtools = createDevTools({ port: DEVTOOLS_PORT })
const engine   = createAuthEngine({ policy, observers: [devtools.observer] })
```

That's it. Every route, every action, every decision started appearing in the sidebar without
touching a single route handler. If I want to swap in a Postgres observer in production, same
pattern. This is the right abstraction.

### Killing `checks.ts` felt good

Deleting the file full of four slightly-wrong copies of "can this user modify this document?"
was satisfying. Having one policy file where you can look up any permission question and get
a definitive answer is a significant improvement in navigability.

### `evaluateAll` for list pages is elegant

```typescript
const decisions = await engine.evaluateAll(user, all, 'read')
const visible   = all.filter((_, i) => decisions[i]!.allowed)
```

This is clean, fires one observer event per document (so the sidebar shows individual read
decisions), and keeps the data layer and auth layer separate. I like this pattern.

---

## Pain points

### Two-step setup with no obvious reason

```typescript
const engine   = createAuthEngine({ policy, observers: [...] })
const enforcer = createEnforcer(engine, { mode: 'enforce' })
```

Every integration starts with this pair. I understand there's a conceptual distinction — the
engine evaluates policy, the enforcer applies a mode on top — but from a developer's perspective
the common case is wanting one thing: a protected engine. The distinction didn't pay for itself
in this migration. I had to explain to myself why I was doing two steps and what the enforcer
actually adds.

What I expected to write:

```typescript
const engine = createAuthEngine({ policy, mode: 'enforce', observers: [...] })
```

If the two-step exists for a good reason (e.g. sharing one engine across multiple enforcers with
different modes) that's worth documenting in the quickstart — currently it reads like boilerplate.

### `engine.can()` vs `enforcer.can()` — which one do I call?

When pre-evaluating permissions for view rendering, I called `engine.can()` because I want to
know what the policy says, not what the enforcer's current mode would do. But it took me a while
to arrive at that reasoning. The API surface has both, they return different things in audit mode,
and there's nothing in the docs that addresses the "populate button visibility before rendering"
use case.

This pattern will come up in every web app. It needs an explicit answer in the docs or API:
*"For rendering UI permissions, call X. For enforcing access, call Y."*

### Type gymnastics for mixed resource types

My app has two resource shapes: documents and the system sentinel (for admin-level actions). This
required a local union type:

```typescript
type Resource = (Doc & { type?: string }) | { type: 'system' } | undefined
```

And then every rule that touches document-specific fields needs a cast:

```typescript
match: ({ resource }) => (resource as Doc)?.sensitive === true
```

This happened five times in the policy file. The casts are safe (the `?.` operator handles it)
but they're noise. I tried to find a way to write the policy without them and couldn't.

The underlying issue is that `PolicyDefinition<S, R>` uses one resource type for the whole policy,
but rules naturally operate on different resource shapes. A union type is the right model, but the
ergonomics of narrowing inside `match` functions need work — either through better inference or
a helper like `matchDoc()` that narrows for you.

### No batch permission check API

Pre-evaluating permissions for a page render looks like this:

```typescript
async function evalDocPerms(user: User, doc: Doc): Promise<DocPermissions> {
  const [write, archive, del, viewHistory] = await Promise.all([
    engine.can(user, doc, 'write'),
    engine.can(user, doc, 'archive'),
    engine.can(user, doc, 'delete'),
    engine.can(user, doc, 'viewHistory'),
  ])
  return { write, archive, delete: del, viewHistory }
}
```

This is fine once it's written, but I wrote it twice (once for documents, once for system
permissions), and I'll write it again for every new resource type. The pattern is obvious and
repetitive.

What I wanted:

```typescript
const perms = await engine.permissions(user, doc, ['write', 'archive', 'delete', 'viewHistory'])
// returns { write: boolean, archive: boolean, delete: boolean, viewHistory: boolean }
```

A `permissions()` method that takes an array of action names and returns a typed record. This
removes the `Promise.all` boilerplate and makes the call site read declaratively.

### Action names are untyped strings

```typescript
authFor('write')
authFor('wrtie')   // typo — no type error, just silent wrong behaviour
```

There is no type checking on action names anywhere. The policy defines `allow: ['write']`, the
route calls `authFor('write')`, and if they diverge the policy silently never matches — no
error, just unexpected denials.

This is particularly risky because:
1. The action name appears in multiple places (policy rule, route middleware, `engine.can()` call)
2. Typos won't be caught in tests unless you have full coverage across every action

The obvious fix is a per-policy type:

```typescript
type DocAction = 'read' | 'write' | 'archive' | 'delete' | 'viewHistory'
const policy: PolicyDefinition<User, Doc, DocAction> = { ... }
// engine.can(user, doc, 'wrtie')  ← type error
```

Even just exporting a `const` of valid actions from the policy file would help:

```typescript
export const DOC_ACTIONS = ['read', 'write', 'archive', 'delete', 'viewHistory'] as const
export type DocAction = typeof DOC_ACTIONS[number]
```

### `evaluateAll` index-matching is fragile

```typescript
const decisions = await engine.evaluateAll(user, all, 'read')
const visible   = all.filter((_, i) => decisions[i]!.allowed)
```

The `!` non-null assertion is required because `decisions[i]` is typed as `Decision | undefined`
even though `evaluateAll` guarantees it returns one decision per input. The parallel array
pattern also means the relationship between `all[i]` and `decisions[i]` is maintained by
convention, not by types.

A result type that pairs input with output would be safer and easier to read:

```typescript
// hypothetical
const results = await engine.evaluateAll(user, all, 'read')
// results: Array<{ resource: Doc, decision: Decision }>
const visible = results.filter(r => r.decision.allowed).map(r => r.resource)
```

### The system resource is a workaround, not a first-class concept

I created `SYSTEM_RESOURCE = { type: 'system' as const }` to handle actions that aren't scoped
to a document (admin access, reports, user management). This works but it's not obvious that
this is the intended pattern — I arrived at it by trial and error.

There's nothing in the policy definition that says "this rule only applies when there's no
resource" or "this rule applies to system-level actions". The `match` function can check
`resource?.type === 'system'` but nothing enforces that you're consistent about this.

A named concept — whether that's a `SystemAction` type, a `resource: null` convention with
documented semantics, or explicit "subject-only" rules — would be clearer than an ad-hoc
sentinel value that every integrator reinvents.

### The `onDeny` callback is verbose and repeated

```typescript
function authFor(action: string) {
  return createAuthMiddleware<User, Doc>({
    engine:   enforcer,
    subject:  getUser,
    resource: getDoc,
    action,
    onDeny: (req, res, decision) => {
      res.status(403).send(deniedPage(getUser(req), action, decision.reason))
    },
  })
}
```

I factored this into a helper immediately because the alternative was inlining it on every route.
Most apps will want a consistent denial response — the common case shouldn't require a wrapper.

Something like a default `onDeny` at the engine or enforcer level, with per-route overrides
available when you need them:

```typescript
const enforcer = createEnforcer(engine, {
  mode:    'enforce',
  onDeny:  (req, res, decision) => res.status(403).json({ error: decision.reason }),
})
```

---

## Smaller friction points

**`resource` as a function, not a value.** In `createAuthMiddleware`, `resource` must be a
function `(req) => Doc | undefined` rather than the resource value itself. This makes sense for
Express middleware (the value isn't known until request time) but the type doesn't communicate
this — it's easy to accidentally pass the value and get a type error that doesn't explain why.

**What happens when `resource` returns `undefined`?** My `getDoc()` returns `Doc | undefined`
when the document ID doesn't exist. I handle this with a 404 guard before the middleware, but
it's not documented what the engine does if `resource` resolves to `undefined`. Does it deny
(safe default)? Error? Match rules that don't reference the resource? I guessed and tested; I
shouldn't have to.

**`PolicySwitcherOptions` isn't exported by default.** When I tried to type the `policies`
option for `createDevTools`, the type wasn't in the main export. I had to find it through
`DevServerOptions`. Minor, but the named options types should all be at the top level.

**The policies directory path.** Setting up the policy switcher required:

```typescript
new URL('../policies', import.meta.url).pathname
```

This is standard ESM but it surprised me — I expected to just pass a relative string. Worth
a note in the docs for the common case.

---

## What I'd want next

**A testing mode or dry-run helper.** Writing tests for the policy was the first thing I tried
after the migration. I wanted to write:

```typescript
expect(await engine.can(USERS.bob, DOCS[1], 'archive')).toBe(true)
```

This works, but the engine is a full runtime object. I'd prefer a lighter `evaluatePolicy(policy, subject, resource, action)` function that takes the raw policy and inputs — useful for unit
testing rules in isolation without the full engine overhead.

**A coverage report in CI.** The `@authwrite/testing` package has `coverageReport()` but there's
no guidance on how to wire this into a CI assertion: "fail the build if any policy rule is
untested." That would be a strong forcing function for keeping tests comprehensive.

**A policy linter or validator.** Rules with the same priority that both match the same case
produce indeterminate results. An unreachable rule (always shadowed by a higher-priority rule)
is a latent bug. A `validatePolicy(policy)` that catches these statically would catch real
mistakes before they reach production.

**Named actions on the enforcer mode.** Right now `mode: 'audit'` lets everything through.
It would be useful to have a mode that lets everything through *but emits a warning when it
overrides a deny*. This is different from the silent override currently — it would help during
migration to see "this request would have been denied in enforce mode."

---

## Summary

The model is sound. The migration outcome — one policy file as the single source of truth,
`defaultEffect: 'deny'`, typed decisions, full audit trail — is objectively better than what
it replaced. Nothing felt broken, just rough in places.

The biggest ROI improvements would be:
1. A typed action names pattern (or third generic on `PolicyDefinition`)
2. `engine.permissions(user, resource, actions[])` batch check
3. Documented guidance on `engine.can()` vs `enforcer.can()` for UI rendering
4. A clear first-class pattern for subject-only (non-resource) actions

The API is close. The rough edges are mostly about boilerplate reduction and filling in missing
patterns that every integration will have to reinvent — batch permission checks, system-level
actions, typed action names. These feel like things that only become obvious once you build a
real app with the library, which is exactly what this migration exercise was for.
